// ACS OPC UA driver
// Live values: read the current value of addresses for the Edge Scout panel
// Copyright 2026 University of Sheffield

//! The OPC UA [`Reader`], which reads the current value of the
//! addresses on the operator's screen while the Edge Scout panel has
//! live values turned on. The protocol is the "Values" section of
//! `docs/architecture/edge-management/edge-scout.md`.
//!
//! A read uses the handler's own session, as a scan does, and is one
//! Read of the `Value` attribute of every address, split into batches
//! of `MaxNodesPerRead` (read once a session from the server's
//! OperationLimits, as a scan reads it, and at most 100). On
//! `BadTooManyOperations` the batch halves.
//!
//! An address that ends in an array index is read as the node it names
//! first, as the subscriptions do (see `addr.rs`). One that the server
//! says does not exist is read again, in a second Read, as the node
//! without the suffix with the index range.
//!
//! A bad status goes in the entry's `error` by name, with no value. An
//! uncertain status keeps the value and puts the status in `error` too.
//! `ts` is the server's source timestamp.

use std::sync::Arc;

use async_trait::async_trait;
use opcua::client::Session;
use opcua::types::{DataValue, ReadValueId, StatusCode, Variant};
use rs_edge_driver::{ReadData, ReadValue, Reader, ScoutType};
use tokio::sync::OnceCell;

use crate::addr::Addr;
use crate::scout::{Service, SessionService, max_nodes_per_read};
use crate::subs::read_value_id;
use crate::value;

/// The error for an address that is not a node id.
pub const NOT_A_NODE: &str = "Not an OPC UA node id";

/// The reader the handler hands out, holding a clone of its session.
pub struct OpcuaReader {
    service: Arc<dyn Service>,
    /// `MaxNodesPerRead`, read on the first read of the session.
    batch: OnceCell<usize>,
}

impl OpcuaReader {
    pub fn new(session: Arc<Session>) -> Self {
        Self::with_service(Arc::new(SessionService(session)))
    }

    /// A reader on any [`Service`], for tests.
    pub fn with_service(service: Arc<dyn Service>) -> Self {
        Self {
            service,
            batch: OnceCell::new(),
        }
    }

    /// Read `ids` in batches, one entry for each. A batch whose request
    /// fails gives each of its ids that request's status.
    async fn read_ids(&self, ids: &[ReadValueId]) -> Vec<DataValue> {
        let mut batch = *self
            .batch
            .get_or_init(|| max_nodes_per_read(&*self.service))
            .await;
        let mut out = Vec::with_capacity(ids.len());
        let mut at = 0;
        while at < ids.len() {
            let end = (at + batch).min(ids.len());
            match self.service.read_live(&ids[at..end]).await {
                Ok(values) if values.len() == end - at => {
                    out.extend(values);
                    at = end;
                }
                Ok(values) => {
                    tracing::warn!(
                        "the OPC UA server answered a Read of {} values with {}",
                        end - at,
                        values.len()
                    );
                    out.extend((at..end).map(|_| bad(StatusCode::BadUnexpectedError)));
                    at = end;
                }
                Err(s) if s == StatusCode::BadTooManyOperations && end - at > 1 => {
                    batch = (end - at) / 2;
                    tracing::warn!(
                        "the OPC UA server answered BadTooManyOperations, so live reads are now {batch} at a time"
                    );
                }
                Err(s) => {
                    tracing::debug!("a live Read failed: {s}");
                    out.extend((at..end).map(|_| bad(s)));
                    at = end;
                }
            }
        }
        out
    }
}

#[async_trait]
impl Reader for OpcuaReader {
    async fn read(&self, addresses: Vec<String>) -> Vec<ReadValue> {
        let addrs: Vec<Addr> = addresses.iter().map(|a| Addr::parse(a)).collect();
        // The first Read: each address as the node it names, or as an
        // element when it is not a node id on its own.
        let first: Vec<(usize, bool)> = addrs
            .iter()
            .enumerate()
            .filter(|(_, a)| a.usable())
            .map(|(i, a)| (i, a.node.is_none()))
            .collect();
        let ids: Vec<_> = first
            .iter()
            .map(|&(i, element)| read_value_id(&addrs[i], element))
            .collect();
        let mut results: Vec<Option<(DataValue, bool)>> = vec![None; addrs.len()];
        for (&(i, element), dv) in first.iter().zip(self.read_ids(&ids).await) {
            results[i] = Some((dv, element));
        }

        // The second: element addresses whose node does not exist.
        let again: Vec<usize> = results
            .iter()
            .enumerate()
            .filter(|(i, r)| {
                addrs[*i].element.is_some()
                    && matches!(r, Some((dv, false)) if dv.status == Some(StatusCode::BadNodeIdUnknown))
            })
            .map(|(i, _)| i)
            .collect();
        if !again.is_empty() {
            let ids: Vec<_> = again
                .iter()
                .map(|&i| read_value_id(&addrs[i], true))
                .collect();
            for (&i, dv) in again.iter().zip(self.read_ids(&ids).await) {
                results[i] = Some((dv, true));
            }
        }

        addrs
            .iter()
            .zip(results)
            .map(|(a, r)| match r {
                None => ReadValue::error(a.raw.clone(), NOT_A_NODE),
                Some((dv, element)) => {
                    let single = element && a.element.as_ref().is_some_and(|e| e.single());
                    entry(&a.raw, dv, single)
                }
            })
            .collect()
    }
}

fn bad(s: StatusCode) -> DataValue {
    DataValue {
        status: Some(s),
        ..Default::default()
    }
}

/// The entry for one address from its DataValue. `single` unwraps the
/// array of one that a single element comes back as.
pub fn entry(address: &str, dv: DataValue, single: bool) -> ReadValue {
    let status = dv.status.unwrap_or(StatusCode::Good);
    if status.is_bad() {
        return ReadValue::error(address, status.to_string());
    }
    let ts = dv.source_timestamp.as_ref().map(value::date_ms);
    let mut out = match dv.value {
        None | Some(Variant::Empty) => ReadValue::error(address, "No value"),
        Some(v) => {
            let v = if single { value::single_element(v) } else { v };
            let t = scout_type(&v);
            let data: Option<ReadData> = match &v {
                Variant::Float(f) => Some((*f).into()),
                Variant::Double(f) => Some((*f).into()),
                other => value::to_json(other).map(ReadData::Json),
            };
            match data {
                Some(d) => {
                    let mut r = ReadValue::new(address, d);
                    if let Some(t) = t {
                        r = r.with_type(t);
                    }
                    r
                }
                None => ReadValue::error(address, "The value has no text form"),
            }
        }
    };
    if let Some(ts) = ts {
        out = out.with_ts(ts);
    }
    if status.is_uncertain() {
        out = out.with_error(status.to_string());
    }
    out
}

/// The Sparkplug type of a scalar value, as a scan types a Variable.
/// An array or a structure has none.
fn scout_type(v: &Variant) -> Option<ScoutType> {
    Some(match v {
        Variant::Boolean(_) => ScoutType::Boolean,
        Variant::SByte(_) => ScoutType::Int8,
        Variant::Byte(_) => ScoutType::UInt8,
        Variant::Int16(_) => ScoutType::Int16,
        Variant::UInt16(_) => ScoutType::UInt16,
        Variant::Int32(_) => ScoutType::Int32,
        Variant::UInt32(_) => ScoutType::UInt32,
        Variant::Int64(_) => ScoutType::Int64,
        Variant::UInt64(_) => ScoutType::UInt64,
        Variant::Float(_) => ScoutType::Float,
        Variant::Double(_) => ScoutType::Double,
        Variant::String(_) => ScoutType::String,
        Variant::DateTime(_) => ScoutType::DateTime,
        Variant::Guid(_) => ScoutType::Uuid,
        _ => return None,
    })
}

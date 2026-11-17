// ACS REST driver
// The rs-edge-driver handler: polls, connection state and writes
// Copyright 2026 University of Sheffield

//! The [`Handler`] that joins HTTP to the driver library.
//!
//! The built-in connection was always up: it had nothing to connect
//! to, and a failed request only meant no data. This driver does the
//! same while any address gets replies, and reports `CONN` (no reply)
//! or `AUTH` (`401` or `403`) only when every address is failing, as
//! [`health`](crate::health) decides. The library then calls
//! [`connect`](Handler::connect) every few seconds, which asks for
//! every failing address's URL again, all at once, and reports `UP`
//! once any of them gets a reply that isn't `401` or `403`.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use async_trait::async_trait;
use bytes::Bytes;
use rs_edge_driver::{
    ConnectError, DriverHandle, Handler, HandlerError, Poller, WriteError, WriteValue,
};
use serde_json::Value;

use crate::addr::{Addr, url};
use crate::config::Conf;
use crate::health::{Failure, Health, Read};
use crate::http::Client;
use crate::read::{Outcome, is_auth_failure, read};

/// The handler. Its work is done by [`Rest`], which polls share.
pub struct RestHandler {
    rest: Arc<Rest>,
}

/// One connection's client and what it last failed on.
struct Rest {
    client: Client,
    handle: DriverHandle<Addr>,
    /// The URL each failing address last failed on, by address, for
    /// `connect` to try again.
    failed: Mutex<HashMap<String, String>>,
    health: Mutex<Health>,
}

impl Rest {
    async fn read(&self, addr: &Addr) -> Option<Bytes> {
        // The built-in skipped this address, which is what a metric
        // with no address became.
        if addr.raw() == "undefined" {
            return None;
        }
        self.health
            .lock()
            .unwrap()
            .polled(addr.raw(), Instant::now());
        let outcome = read(self.client.base_url(), addr, |url| self.client.get(url)).await;

        if !matches!(outcome, Outcome::Auth { .. } | Outcome::Conn { .. }) {
            self.failed.lock().unwrap().remove(addr.raw());
        }
        let (data, read, why) = match outcome {
            Outcome::Data(body) => (Some(body), Read::Data, String::new()),
            Outcome::Status(s) => (None, Read::Status(s), format!("HTTP {s}, no data")),
            Outcome::NoData => (None, Read::NoData, String::new()),
            Outcome::Auth { url, status } => {
                self.failed
                    .lock()
                    .unwrap()
                    .insert(addr.raw().to_owned(), url);
                let why = format!("HTTP {status}, credentials refused");
                (None, Read::Failed(Failure::Auth), why)
            }
            Outcome::Conn { url, error } => {
                self.failed
                    .lock()
                    .unwrap()
                    .insert(addr.raw().to_owned(), url);
                (
                    None,
                    Read::Failed(Failure::Conn),
                    format!("no reply: {error}"),
                )
            }
        };

        let verdict = self
            .health
            .lock()
            .unwrap()
            .read(addr.raw(), read, Instant::now());
        if verdict.log && !why.is_empty() {
            tracing::warn!(
                address = addr.raw(),
                "{why} (logged once until it recovers)"
            );
        }
        if verdict.recovered {
            tracing::info!(address = addr.raw(), "giving data again");
        }
        if let Some(reason) = verdict.lost {
            tracing::warn!(?reason, "every address is failing");
            self.handle.disconnected(reason);
        }
        data
    }
}

#[async_trait]
impl Poller<Addr> for Rest {
    async fn poll(&self, addr: &Addr) -> Option<Bytes> {
        self.read(addr).await
    }
}

#[async_trait]
impl Handler for RestHandler {
    type Addr = Addr;

    /// Writes are confirmed: the Edge Agent reports a written value only
    /// once the server has accepted the POST.
    const TYPED_WRITES: bool = true;

    fn create(handle: DriverHandle<Addr>, config: Value) -> Result<Self, HandlerError> {
        let conf = Conf::parse(&config)?;
        let client = Client::new(&conf).map_err(HandlerError::new)?;
        Ok(Self {
            rest: Arc::new(Rest {
                client,
                handle,
                failed: Mutex::new(HashMap::new()),
                health: Mutex::new(Health::new(Instant::now())),
            }),
        })
    }

    fn parse_addr(&self, addr: &str) -> Option<Addr> {
        Some(Addr::parse(addr))
    }

    /// Up straight away, as the built-in was, unless every address was
    /// failing: then ask each failing address's URL again, all at once,
    /// and come up if any gets a reply other than 401 or 403. `AUTH` if
    /// every reply was 401 or 403, otherwise `CONN`.
    async fn connect(&mut self) -> Result<(), ConnectError> {
        let urls: Vec<String> = self.rest.failed.lock().unwrap().values().cloned().collect();
        if !urls.is_empty() {
            let mut probes = tokio::task::JoinSet::new();
            for url in urls {
                let client = self.rest.client.clone();
                probes.spawn(async move { client.get(url).await });
            }
            let mut auth = false;
            let mut up = false;
            while let Some(res) = probes.join_next().await {
                match res {
                    Ok(Ok(r)) if is_auth_failure(r.status) => auth = true,
                    Ok(Ok(_)) => up = true,
                    Ok(Err(error)) => tracing::debug!("still no reply: {error}"),
                    Err(_) => {}
                }
            }
            if !up {
                return Err(if auth {
                    ConnectError::AuthFailed
                } else {
                    ConnectError::ConnectionFailed
                });
            }
            self.rest.failed.lock().unwrap().clear();
        }
        self.rest.health.lock().unwrap().reset(Instant::now());
        Ok(())
    }

    async fn poll(&mut self, addr: &Addr) -> Option<Bytes> {
        self.rest.read(addr).await
    }

    /// Polls run at the same time, as the built-in's did.
    fn poller(&self) -> Option<Arc<dyn Poller<Addr>>> {
        Some(self.rest.clone())
    }

    /// POST the value as JSON to `baseURL + address`. Any 2xx reply
    /// means it was written.
    async fn write(&mut self, addr: &Addr, value: WriteValue) -> Result<(), WriteError> {
        let body = write_body(&value)?;
        let url = url(self.rest.client.base_url(), addr.raw());
        match self.rest.client.post_json(url, body).await {
            Err(e) => Err(WriteError::Failed(format!("no reply: {e}"))),
            Ok(r) if (200..300).contains(&r.status) => Ok(()),
            Ok(r) if is_auth_failure(r.status) => Err(WriteError::Failed(format!(
                "HTTP {}: credentials refused",
                r.status
            ))),
            Ok(r) => Err(WriteError::Failed(format!("HTTP {}", r.status))),
        }
    }

    async fn close(&mut self) {}
}

/// The body for a write: the value alone as JSON, such as `-2`, `true`
/// or `"text"`. A DateTime is its milliseconds since the epoch.
pub fn write_body(value: &WriteValue) -> Result<Vec<u8>, WriteError> {
    let json = match value {
        WriteValue::Boolean(v) => Value::from(*v),
        WriteValue::Int8(v) => Value::from(*v),
        WriteValue::Int16(v) => Value::from(*v),
        WriteValue::Int32(v) => Value::from(*v),
        WriteValue::Int64(v) => Value::from(*v),
        WriteValue::UInt8(v) => Value::from(*v),
        WriteValue::UInt16(v) => Value::from(*v),
        WriteValue::UInt32(v) => Value::from(*v),
        WriteValue::UInt64(v) => Value::from(*v),
        WriteValue::Float(v) => finite(f64::from(*v))?,
        WriteValue::Double(v) => finite(*v)?,
        WriteValue::String(v) | WriteValue::Text(v) | WriteValue::Uuid(v) => Value::from(v.clone()),
        WriteValue::DateTime(v) => Value::from(*v),
    };
    serde_json::to_vec(&json).map_err(|e| WriteError::Failed(e.to_string()))
}

fn finite(v: f64) -> Result<Value, WriteError> {
    serde_json::Number::from_f64(v)
        .map(Value::Number)
        .ok_or_else(|| WriteError::BadValue(format!("{v} can't be sent as JSON")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(v: WriteValue) -> String {
        String::from_utf8(write_body(&v).unwrap()).unwrap()
    }

    #[test]
    fn write_bodies() {
        assert_eq!(body(WriteValue::Boolean(true)), "true");
        assert_eq!(body(WriteValue::Int16(-2)), "-2");
        assert_eq!(body(WriteValue::Int64(i64::MIN)), "-9223372036854775808");
        assert_eq!(body(WriteValue::UInt64(u64::MAX)), "18446744073709551615");
        assert_eq!(body(WriteValue::Float(1.5)), "1.5");
        assert_eq!(body(WriteValue::Double(-0.25)), "-0.25");
        assert_eq!(body(WriteValue::String("a\"b".into())), r#""a\"b""#);
        assert_eq!(
            body(WriteValue::DateTime(1_700_000_000_000)),
            "1700000000000"
        );
    }

    #[test]
    fn non_finite_floats_are_refused() {
        for v in [
            WriteValue::Double(f64::NAN),
            WriteValue::Double(f64::INFINITY),
            WriteValue::Float(f32::NEG_INFINITY),
        ] {
            assert!(matches!(write_body(&v), Err(WriteError::BadValue(_))));
        }
    }
}

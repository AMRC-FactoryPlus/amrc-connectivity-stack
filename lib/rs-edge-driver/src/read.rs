//! Reading current values for the Edge Scout panel's live values.
//!
//! The Edge Agent sends a `read` op on the `scout` topic while an
//! operator has live values turned on, and the driver answers once on
//! `found/<id>` with a `values` message. The protocol is the "Values"
//! section of `docs/architecture/edge-management/edge-scout.md`. The
//! library does the protocol, and a handler only reads, through a
//! [`Reader`] it hands out from [`Handler::reader`](crate::Handler::reader).

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use serde_json::{Value, json};

use crate::scout::{ScoutError, ScoutType, Wire, cut};

/// How long a reader has to answer. After this the library abandons
/// the read and sends nothing, and the Edge Agent records `TIMEOUT`.
pub(crate) const READ_TIMEOUT: Duration = Duration::from_secs(4);

/// The most addresses in one read. The Edge Agent caps the addresses
/// of all a connection's leases at this.
pub(crate) const MAX_READ_ADDRESSES: usize = 40;

/// Lengths the protocol allows, in characters.
const MAX_ADDRESS: usize = 1024;
const MAX_VALUE: usize = 1024;
const MAX_ERROR: usize = 256;

/// The error for an address the reader gave no answer for.
const NO_ANSWER: &str = "The driver gave no value";

/// A value as a reader read it. Build one with `into()` from a JSON
/// [`Value`], a string, a boolean, an integer or a float.
///
/// A float has its own case because JSON has no NaN or infinity:
/// `serde_json` would turn them into `null`. The library writes them as
/// `NaN`, `Infinity` and `-Infinity`, so a device reporting NaN shows
/// NaN.
#[derive(Debug, Clone, PartialEq)]
pub enum ReadData {
    /// Any JSON value.
    Json(Value),
    /// A float, which may be NaN or infinite.
    Float(f64),
    /// A single-precision float, written in its own shortest form, so
    /// 0.1f32 is `0.1` and not the double nearest to it.
    Float32(f32),
}

impl ReadData {
    /// The value as text, or `None` for JSON `null`.
    fn to_text(&self) -> Option<String> {
        match self {
            Self::Json(Value::Null) => None,
            Self::Json(Value::String(s)) => Some(s.clone()),
            Self::Json(other) => Some(other.to_string()),
            Self::Float(f) if f.is_nan() => Some("NaN".into()),
            Self::Float(f) if f.is_infinite() => {
                Some(if *f > 0.0 { "Infinity" } else { "-Infinity" }.into())
            }
            // JSON's form, so 1.0 is written 1.0 as serde_json writes it.
            Self::Float(f) => Some(Value::from(*f).to_string()),
            Self::Float32(f) if !f.is_finite() => Self::Float(f64::from(*f)).to_text(),
            Self::Float32(f) => serde_json::to_string(f).ok(),
        }
    }
}

impl From<Value> for ReadData {
    fn from(v: Value) -> Self {
        Self::Json(v)
    }
}

impl From<f64> for ReadData {
    fn from(f: f64) -> Self {
        Self::Float(f)
    }
}

impl From<f32> for ReadData {
    fn from(f: f32) -> Self {
        Self::Float32(f)
    }
}

macro_rules! read_data_from_json {
    ($($t:ty),*) => {$(
        impl From<$t> for ReadData {
            fn from(v: $t) -> Self {
                Self::Json(Value::from(v))
            }
        }
    )*};
}
read_data_from_json!(
    &str, String, bool, i8, i16, i32, i64, u8, u16, u32, u64, isize, usize
);

/// The current value of one address, returned by [`Reader::read`].
///
/// Build one with [`ReadValue::new`] or [`ReadValue::error`] and the
/// `with_` methods. The library writes `value` as text: a string as it
/// is, a number or boolean as JSON writes it, a NaN or infinite float
/// as `NaN`, `Infinity` or `-Infinity`, and anything else as JSON. A
/// JSON `null` is sent as no value.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct ReadValue {
    /// The address as the Edge Agent sent it.
    pub address: String,
    /// The value, or `None` when there is none.
    pub value: Option<ReadData>,
    /// The Sparkplug type of the value, if the driver knows it.
    pub r#type: Option<ScoutType>,
    /// The source timestamp, in milliseconds since the epoch.
    pub ts: Option<i64>,
    /// Why there is no value, in a few words, such as
    /// `BadNodeIdUnknown`.
    pub error: Option<String>,
}

impl ReadValue {
    /// A value read from `address`.
    pub fn new(address: impl Into<String>, value: impl Into<ReadData>) -> Self {
        Self {
            address: address.into(),
            value: Some(value.into()),
            r#type: None,
            ts: None,
            error: None,
        }
    }

    /// An address that could not be read, and why.
    pub fn error(address: impl Into<String>, error: impl Into<String>) -> Self {
        Self {
            address: address.into(),
            value: None,
            r#type: None,
            ts: None,
            error: Some(error.into()),
        }
    }

    pub fn with_type(mut self, t: ScoutType) -> Self {
        self.r#type = Some(t);
        self
    }

    /// The source timestamp, in milliseconds since the epoch.
    pub fn with_ts(mut self, ts: i64) -> Self {
        self.ts = Some(ts);
        self
    }

    /// Add an error to a value, such as a status that is not good.
    pub fn with_error(mut self, error: impl Into<String>) -> Self {
        self.error = Some(error.into());
        self
    }

    /// The entry as the protocol sends it.
    fn to_json(&self) -> Value {
        let value = self
            .value
            .as_ref()
            .and_then(ReadData::to_text)
            .map(|s| cut(&s, MAX_VALUE));
        json!({
            "address": self.address,
            "value": value,
            "type": self.r#type,
            "ts": self.ts,
            "error": self.error.as_deref().map(|e| cut(e, MAX_ERROR)),
        })
    }
}

/// Reads the current values of addresses without the handler's lock.
/// See [`Handler::reader`](crate::Handler::reader).
///
/// A `Reader` is usually a small struct holding a clone of the
/// handler's device client, as a [`Poller`](crate::Poller) is. It must
/// use the connection the handler already has, and never open a
/// session, a subscription or a client for each read.
#[async_trait]
pub trait Reader: Send + Sync {
    /// Read the current value of each address, which are in the
    /// driver's canonical form and may not be in the address map.
    ///
    /// Return one entry per address, in any order. An address left out
    /// gets an error, and an entry for an address that was not asked
    /// for is dropped. The library abandons a read that has not
    /// answered in 4 s, and turns a panic into `ERR`.
    async fn read(&self, addresses: Vec<String>) -> Vec<ReadValue>;
}

/// Check the addresses of a `read` op. `Err` says why it can't run.
pub(crate) fn read_addresses(v: Option<&Value>) -> Result<Vec<String>, String> {
    let Some(list) = v.and_then(Value::as_array) else {
        return Err("read without an addresses array".into());
    };
    if list.len() > MAX_READ_ADDRESSES {
        return Err(format!(
            "a read may name at most {MAX_READ_ADDRESSES} addresses, not {}",
            list.len()
        ));
    }
    let mut out = Vec::with_capacity(list.len());
    let mut seen = HashSet::new();
    for a in list {
        let Some(a) = a.as_str() else {
            return Err("read addresses must be strings".into());
        };
        if a.is_empty() || a.chars().count() > MAX_ADDRESS {
            return Err("a read address is empty or over 1024 characters".into());
        }
        if seen.insert(a) {
            out.push(a.to_owned());
        }
    }
    Ok(out)
}

/// The `values` message: one entry per requested address, in the
/// order asked for, taking the reader's first answer for each.
fn values_json(addresses: &[String], got: Vec<ReadValue>) -> Value {
    let mut by_address: HashMap<String, ReadValue> = HashMap::new();
    for v in got {
        by_address.entry(v.address.clone()).or_insert(v);
    }
    let values: Vec<Value> = addresses
        .iter()
        .map(|a| match by_address.remove(a) {
            Some(v) => v.to_json(),
            None => ReadValue::error(a.clone(), NO_ANSWER).to_json(),
        })
        .collect();
    if !by_address.is_empty() {
        tracing::debug!(
            count = by_address.len(),
            "reader answered for addresses it was not asked for, dropping them"
        );
    }
    json!({ "type": "values", "values": values })
}

/// Run one read and answer it: `values` when the reader returns, `ERR`
/// when it panics, and nothing when it has not answered in time.
pub(crate) async fn run_read(
    reader: Arc<dyn Reader>,
    id: String,
    addresses: Vec<String>,
    wire: Arc<Wire>,
    timeout: Duration,
) {
    let task = tokio::spawn({
        let addresses = addresses.clone();
        async move { reader.read(addresses).await }
    });
    let abort = task.abort_handle();
    match tokio::time::timeout(timeout, task).await {
        Ok(Ok(got)) => {
            let _ = wire.send_json(&values_json(&addresses, got), true);
        }
        Ok(Err(join)) => {
            let msg = crate::scout::panic_message(join);
            tracing::warn!(id, msg, "reader failed");
            wire.end(Err(ScoutError::err(format!("the reader failed: {msg}"))));
        }
        Err(_) => {
            abort.abort();
            tracing::warn!(
                id,
                count = addresses.len(),
                "reader did not answer within {timeout:?}, abandoning the read"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn values_are_text() {
        let v = |x: Value| ReadValue::new("a", x).to_json()["value"].clone();
        assert_eq!(v(json!("plain")), "plain");
        assert_eq!(v(json!(1450.5)), "1450.5");
        assert_eq!(v(json!(-3)), "-3");
        assert_eq!(v(json!(true)), "true");
        assert_eq!(v(json!({ "t": 21.4 })), r#"{"t":21.4}"#);
        assert_eq!(v(json!([1, 2])), "[1,2]");
        assert_eq!(v(Value::Null), Value::Null);

        // JSON has no NaN or infinity, and serde_json would write null.
        let f = |x: f64| ReadValue::new("a", x).to_json()["value"].clone();
        assert_eq!(f(f64::NAN), "NaN");
        assert_eq!(f(f64::INFINITY), "Infinity");
        assert_eq!(f(f64::NEG_INFINITY), "-Infinity");
        assert_eq!(f(1450.5), "1450.5");
        assert_eq!(f(2.0), "2.0");
        let f32v = |x: f32| ReadValue::new("a", x).to_json()["value"].clone();
        assert_eq!(f32v(f32::NAN), "NaN");
        assert_eq!(f32v(f32::NEG_INFINITY), "-Infinity");
        assert_eq!(f32v(0.1), "0.1");
        assert_eq!(
            v(json!("é".repeat(2000))).as_str().unwrap().chars().count(),
            1024
        );

        let e = ReadValue::error("a", "x".repeat(300)).to_json();
        assert_eq!(e["value"], Value::Null);
        assert_eq!(e["error"].as_str().unwrap().len(), MAX_ERROR);
        let full = ReadValue::new("a", 1)
            .with_type(ScoutType::Int32)
            .with_ts(1_795_600_000_000)
            .to_json();
        assert_eq!(
            full,
            json!({ "address": "a", "value": "1", "type": "Int32",
                    "ts": 1_795_600_000_000_i64, "error": null })
        );
    }

    #[test]
    fn one_entry_per_address() {
        let addresses = vec!["a".to_owned(), "b".to_owned(), "c".to_owned()];
        let got = vec![
            ReadValue::new("c", 3),
            ReadValue::new("x", 9),
            ReadValue::new("a", 1),
            ReadValue::new("a", 2),
        ];
        let v = values_json(&addresses, got);
        assert_eq!(v["type"], "values");
        let values = v["values"].as_array().unwrap();
        let addrs: Vec<_> = values.iter().map(|v| v["address"].clone()).collect();
        assert_eq!(addrs, vec!["a", "b", "c"]);
        assert_eq!(values[0]["value"], "1", "the first answer wins");
        assert_eq!(values[1]["error"], NO_ANSWER);
        assert_eq!(values[2]["value"], "3");
    }

    #[test]
    fn addresses_are_checked() {
        assert_eq!(
            read_addresses(Some(&json!(["a", "b", "a"]))),
            Ok(vec!["a".to_owned(), "b".to_owned()])
        );
        assert_eq!(read_addresses(Some(&json!([]))), Ok(vec![]));
        assert!(read_addresses(None).is_err());
        assert!(read_addresses(Some(&json!("a"))).is_err());
        assert!(read_addresses(Some(&json!([1]))).is_err());
        assert!(read_addresses(Some(&json!([""]))).is_err());
        assert!(read_addresses(Some(&json!(["x".repeat(1025)]))).is_err());
        let many: Vec<_> = (0..41).map(|i| format!("a{i}")).collect();
        assert!(read_addresses(Some(&json!(many))).is_err());
    }
}

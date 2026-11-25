// ACS Rust test driver
// Edge Scout live values: a value per address that never changes
// Copyright 2026 University of Sheffield

//! The reader. Live values give each address the value its wave has
//! 250 ms after the clock starts, so tests of the Edge Agent and the
//! Admin UI get the same value every time. A `Float` address is read as
//! a float and a `Double` as a double, an address that does not parse
//! gets the error `Not an address of this driver`, and `ts` is null.
//!
//! Two keys of the connection's config make reads misbehave for the
//! conformance tests, because a read has no options of its own:
//!
//! Key|Default|Meaning
//! ---|---|---
//! `read_fail`|null|`CONN` to have no reader, so every read ends with `CONN`, or `ERR` to panic in the reader, which the library reports as `ERR`
//! `read_hang`|false|Never answer, so the library abandons each read after 4 s

use std::sync::Arc;

use async_trait::async_trait;
use rs_edge_driver::{HandlerError, ReadValue, Reader, ScoutType};
use serde_json::Value;

use crate::addr::{Addr, Packing};

/// The time, in ms, at which a read takes each wave's value.
pub const READ_AT_MS: f64 = 250.0;

/// How the `read_fail` key makes reads fail.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReadFail {
    /// No reader, so reads end with `CONN`.
    Conn,
    /// The reader panics, so reads end with `ERR`.
    Err,
}

/// The read keys of the connection's config.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ReadOptions {
    pub fail: Option<ReadFail>,
    pub hang: bool,
}

impl ReadOptions {
    /// Read the keys from the connection's config. Other keys are
    /// ignored, as the driver ignores the rest of its config.
    pub fn parse(config: &Value) -> Result<Self, HandlerError> {
        let fail = match config.get("read_fail") {
            None | Some(Value::Null) => None,
            Some(v) => match v.as_str() {
                Some("CONN") => Some(ReadFail::Conn),
                Some("ERR") => Some(ReadFail::Err),
                _ => return Err(HandlerError::new("read_fail must be CONN or ERR")),
            },
        };
        let hang = match config.get("read_hang") {
            None | Some(Value::Null) => false,
            Some(Value::Bool(b)) => *b,
            Some(_) => return Err(HandlerError::new("read_hang must be true or false")),
        };
        Ok(Self { fail, hang })
    }
}

/// The value of one address, as a live read gives it.
pub fn read_value(address: &str) -> ReadValue {
    let Some(addr) = Addr::parse(address) else {
        return ReadValue::error(address, "Not an address of this driver");
    };
    let v = addr.func.eval(addr.period, addr.amplitude, READ_AT_MS);
    match addr.packing {
        Packing::FloatBE | Packing::FloatLE => {
            ReadValue::new(address, v as f32).with_type(ScoutType::Float)
        }
        Packing::DoubleBE | Packing::DoubleLE => {
            ReadValue::new(address, v).with_type(ScoutType::Double)
        }
    }
}

/// Reads addresses without a device.
pub struct TestReader {
    options: ReadOptions,
}

impl TestReader {
    /// The reader for these options, or `None` when `read_fail` is
    /// `CONN`.
    pub fn for_options(options: ReadOptions) -> Option<Arc<dyn Reader>> {
        if options.fail == Some(ReadFail::Conn) {
            return None;
        }
        Some(Arc::new(Self { options }))
    }
}

#[async_trait]
impl Reader for TestReader {
    async fn read(&self, addresses: Vec<String>) -> Vec<ReadValue> {
        if self.options.hang {
            std::future::pending::<()>().await;
        }
        if self.options.fail == Some(ReadFail::Err) {
            panic!("read_fail is ERR");
        }
        addresses.iter().map(|a| read_value(a)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn values_are_fixed_per_address() {
        let v = read_value("const:1000:7:bd");
        assert_eq!(v.r#type, Some(ScoutType::Double));
        assert_eq!(v.value, Some(7.0.into()));
        // A quarter of a 1000 ms sine is its peak.
        let v = read_value("sin:1000:2:bf");
        assert_eq!(v.r#type, Some(ScoutType::Float));
        assert_eq!(v.value, Some(2.0f32.into()));
        assert_eq!(read_value("saw:1000:4:ld").value, Some(1.0.into()));
        // A zero period gives NaN, which the library writes as NaN.
        assert!(matches!(
            read_value("sin:0:1:bd").value,
            Some(rs_edge_driver::ReadData::Float(f)) if f.is_nan()
        ));
        let bad = read_value("nope");
        assert!(bad.value.is_none());
        assert_eq!(bad.error.as_deref(), Some("Not an address of this driver"));
        assert_eq!(read_value("const:1000:7:bd"), read_value("const:1000:7:bd"));
    }

    #[test]
    fn options() {
        assert_eq!(
            ReadOptions::parse(&json!({})).unwrap(),
            ReadOptions::default()
        );
        let o = ReadOptions::parse(&json!({ "read_fail": "CONN", "read_hang": true })).unwrap();
        assert_eq!(o.fail, Some(ReadFail::Conn));
        assert!(o.hang);
        assert_eq!(
            ReadOptions::parse(&json!({ "read_fail": "ERR" }))
                .unwrap()
                .fail,
            Some(ReadFail::Err)
        );
        assert!(ReadOptions::parse(&json!({ "read_fail": "AUTH" })).is_err());
        assert!(ReadOptions::parse(&json!({ "read_hang": "yes" })).is_err());
        assert!(TestReader::for_options(o).is_none());
    }
}

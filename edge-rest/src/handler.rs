// ACS REST driver
// The rs-edge-driver handler: polls, connection state and writes
// Copyright 2026 University of Sheffield

//! The [`Handler`] that joins HTTP to the driver library.
//!
//! The built-in connection was always up: it had nothing to connect
//! to, and a failed request only meant no data. This driver reports a
//! failed request instead, as `CONN` when there was no reply and `AUTH`
//! for `401` or `403`, so the Edge Agent marks the device dead. The
//! library then calls [`connect`](Handler::connect) every few seconds,
//! which asks for the URL that failed again and reports `UP` once it
//! gets a reply that isn't `401` or `403`.

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use bytes::Bytes;
use rs_edge_driver::{
    ConnectError, DriverHandle, Handler, HandlerError, Poller, WriteError, WriteValue,
};
use serde_json::Value;

use crate::addr::{Addr, url};
use crate::config::Conf;
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
    /// The URL whose request failed, for `connect` to try again.
    failed: Mutex<Option<String>>,
}

impl Rest {
    async fn read(&self, addr: &Addr) -> Option<Bytes> {
        // The built-in skipped this address, which is what a metric
        // with no address became.
        if addr.raw() == "undefined" {
            return None;
        }
        let outcome = read(self.client.base_url(), addr, |url| self.client.get(url)).await;
        match outcome {
            Outcome::Data(body) => Some(body),
            Outcome::NoData => None,
            Outcome::Auth { url, status } => {
                tracing::warn!(address = addr.raw(), status, "credentials refused");
                self.lost(url, ConnectError::AuthFailed);
                None
            }
            Outcome::Conn { url, error } => {
                tracing::warn!(address = addr.raw(), "no reply: {error}");
                self.lost(url, ConnectError::ConnectionFailed);
                None
            }
        }
    }

    fn lost(&self, url: String, reason: ConnectError) {
        *self.failed.lock().unwrap() = Some(url);
        self.handle.disconnected(reason);
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
                failed: Mutex::new(None),
            }),
        })
    }

    fn parse_addr(&self, addr: &str) -> Option<Addr> {
        Some(Addr::parse(addr))
    }

    /// Up straight away, as the built-in was, unless a request has
    /// failed: then up once that URL gets a reply other than 401 or
    /// 403.
    async fn connect(&mut self) -> Result<(), ConnectError> {
        let Some(url) = self.rest.failed.lock().unwrap().clone() else {
            return Ok(());
        };
        match self.rest.client.get(url).await {
            Err(error) => {
                tracing::debug!("still no reply: {error}");
                Err(ConnectError::ConnectionFailed)
            }
            Ok(r) if is_auth_failure(r.status) => Err(ConnectError::AuthFailed),
            Ok(_) => {
                *self.rest.failed.lock().unwrap() = None;
                Ok(())
            }
        }
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

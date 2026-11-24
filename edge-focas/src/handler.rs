// ACS FOCAS driver
// The rs-edge-driver handler
// Copyright 2026 University of Sheffield

//! The [`Handler`] that joins the FOCAS client to the driver library.
//!
//! The driver is polled and read-only. Each poll reads one address
//! over the connection's single FOCAS session and answers with JSON,
//! so devices on this driver use the `JSON` payload format and a
//! JSONPath in each metric's path.

use std::collections::HashSet;
use std::time::Duration;

use async_trait::async_trait;
use bytes::Bytes;
use rs_edge_driver::{ConnectError, DriverHandle, Handler, HandlerError};

use crate::addr::Addr;
use crate::client::{Client, ReadError};

pub const DEFAULT_PORT: u16 = 8193;
pub const DEFAULT_TIMEOUT_MS: u64 = 5000;

/// The connection details from the driver definition's schema.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Settings {
    pub host: String,
    pub port: u16,
    pub timeout: Duration,
}

impl Settings {
    pub fn from_json(conf: &serde_json::Value) -> Result<Self, HandlerError> {
        let host = conf["host"]
            .as_str()
            .filter(|h| !h.is_empty())
            .ok_or_else(|| HandlerError::new("'host' is required"))?
            .to_string();
        let port = match &conf["port"] {
            serde_json::Value::Null => DEFAULT_PORT,
            v => v
                .as_u64()
                .and_then(|p| u16::try_from(p).ok())
                .filter(|p| *p > 0)
                .ok_or_else(|| HandlerError::new("'port' must be 1 to 65535"))?,
        };
        let timeout = match &conf["timeout"] {
            serde_json::Value::Null => DEFAULT_TIMEOUT_MS,
            v => v
                .as_u64()
                .filter(|t| *t > 0)
                .ok_or_else(|| HandlerError::new("'timeout' must be a positive number of ms"))?,
        };
        Ok(Self {
            host,
            port,
            timeout: Duration::from_millis(timeout),
        })
    }
}

pub struct FocasHandler {
    handle: DriverHandle<Addr>,
    settings: Settings,
    client: Option<Client>,
    /// Addresses whose last read failed, so a failing address logs a
    /// warning once and not on every poll.
    failing: HashSet<Addr>,
}

#[async_trait]
impl Handler for FocasHandler {
    type Addr = Addr;

    fn create(handle: DriverHandle<Addr>, config: serde_json::Value) -> Result<Self, HandlerError> {
        Ok(Self {
            handle,
            settings: Settings::from_json(&config)?,
            client: None,
            failing: HashSet::new(),
        })
    }

    fn parse_addr(&self, addr: &str) -> Option<Addr> {
        let parsed = Addr::parse(addr);
        if parsed.is_none() {
            tracing::warn!("invalid FOCAS address {addr:?}");
        }
        parsed
    }

    async fn connect(&mut self) -> Result<(), ConnectError> {
        if let Some(old) = self.client.take() {
            old.close().await;
        }
        let s = &self.settings;
        match Client::connect(&s.host, s.port, s.timeout).await {
            Ok(client) => {
                let i = &client.info;
                tracing::info!(
                    "connected to {}:{}: series {} version {}, type {}{}, {} axes",
                    s.host,
                    s.port,
                    i.series,
                    i.version,
                    i.cnc_type,
                    i.mt_type,
                    i.axes
                );
                self.client = Some(client);
                Ok(())
            }
            Err(e) => {
                tracing::warn!("cannot connect to {}:{}: {e}", s.host, s.port);
                Err(ConnectError::ConnectionFailed)
            }
        }
    }

    async fn poll(&mut self, addr: &Addr) -> Option<Bytes> {
        let client = self.client.as_mut()?;
        match client.read(addr).await {
            Ok(v) => {
                self.failing.remove(addr);
                Some(Bytes::from(v.to_string()))
            }
            Err(ReadError::Link(e)) => {
                tracing::warn!("lost the control: {e}");
                self.client = None;
                self.handle.disconnected(ConnectError::ConnectionFailed);
                None
            }
            Err(e) => {
                if self.failing.insert(addr.clone()) {
                    tracing::warn!("cannot read {addr:?}: {e}");
                } else {
                    tracing::debug!("cannot read {addr:?}: {e}");
                }
                None
            }
        }
    }

    async fn close(&mut self) {
        if let Some(client) = self.client.take() {
            client.close().await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn settings_defaults_and_checks() {
        let s = Settings::from_json(&json!({ "host": "10.0.0.5" })).unwrap();
        assert_eq!(s.port, 8193);
        assert_eq!(s.timeout, Duration::from_secs(5));

        let s =
            Settings::from_json(&json!({ "host": "cnc", "port": 9000, "timeout": 250 })).unwrap();
        assert_eq!((s.port, s.timeout), (9000, Duration::from_millis(250)));

        for bad in [
            json!({}),
            json!({ "host": "" }),
            json!({ "host": "cnc", "port": 70000 }),
            json!({ "host": "cnc", "port": "8193" }),
            json!({ "host": "cnc", "timeout": 0 }),
        ] {
            assert!(Settings::from_json(&bad).is_err(), "{bad}");
        }
    }
}

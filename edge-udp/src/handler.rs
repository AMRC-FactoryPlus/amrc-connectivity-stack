// ACS UDP driver
// The rs-edge-driver handler
// Copyright 2026 University of Sheffield

//! The [`Handler`] that joins the socket to the driver library.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use async_trait::async_trait;
use rs_edge_driver::{ConnectError, DriverHandle, Handler, HandlerError, WriteError, WriteValue};

use crate::config::UdpConf;
use crate::receiver::{self, Receiver, Stats};
use crate::{DATAGRAM_ADDR, settings};

/// The handler: one socket, bound in `connect`.
pub struct UdpHandler {
    handle: DriverHandle<String>,
    conf: UdpConf,
    /// Whether the address map has the empty address, so datagrams
    /// have somewhere to go.
    routed: Arc<AtomicBool>,
    stats: Arc<Stats>,
    receiver: Option<Receiver>,
}

impl UdpHandler {
    /// The counters for this handler's datagrams.
    pub fn stats(&self) -> Arc<Stats> {
        self.stats.clone()
    }
}

#[async_trait]
impl Handler for UdpHandler {
    type Addr = String;

    /// Datagrams arrive when the device sends them, so a poll has
    /// nothing to read. The built-in connection ignores polls too.
    const SUPPORTS_POLL: bool = false;

    /// Take writes in the typed form so each can be refused with an
    /// answer. The built-in connection never writes and never reports
    /// a write; with `cmd` the agent would report every write as done.
    const TYPED_WRITES: bool = true;

    fn create(
        handle: DriverHandle<String>,
        config: serde_json::Value,
    ) -> Result<Self, HandlerError> {
        let conf = UdpConf::from_json(&config)?;
        Ok(Self {
            handle,
            conf,
            routed: Arc::new(AtomicBool::new(false)),
            stats: Arc::new(Stats::default()),
            receiver: None,
        })
    }

    /// Every address is accepted, as the built-in connection accepts
    /// them. Only the empty address gets data.
    fn parse_addr(&self, addr: &str) -> Option<String> {
        Some(addr.to_owned())
    }

    async fn connect(&mut self) -> Result<(), ConnectError> {
        // A reconnect after a socket error: let the old socket go first.
        self.receiver = None;
        let (socket, got) = match receiver::bind(self.conf.port, settings::recv_buffer()) {
            Ok(s) => s,
            Err(e) => {
                tracing::error!(%e, port = self.conf.port, "cannot listen on the UDP port");
                return Err(ConnectError::ConnectionFailed);
            }
        };
        let receiver = Receiver::start(
            socket,
            self.handle.clone(),
            self.routed.clone(),
            self.stats.clone(),
        )
        .map_err(|e| {
            tracing::error!(%e, "cannot read the UDP socket");
            ConnectError::ConnectionFailed
        })?;
        tracing::info!(
            port = receiver.port,
            recv_buffer = got,
            "listening for UDP datagrams on 0.0.0.0"
        );
        self.receiver = Some(receiver);
        Ok(())
    }

    async fn subscribe(&mut self, addrs: &[String]) -> bool {
        let routed = addrs.iter().any(|a| a == DATAGRAM_ADDR);
        if !routed && !self.routed.load(Ordering::Relaxed) {
            tracing::warn!(
                ?addrs,
                "no metric on this connection has an empty address, so datagrams \
                 have nowhere to go. UDP delivers every datagram to the empty address."
            );
        }
        self.routed.store(routed, Ordering::Relaxed);
        true
    }

    async fn write(&mut self, _addr: &String, value: WriteValue) -> Result<(), WriteError> {
        Err(WriteError::Failed(format!(
            "a UDP connection only receives, so the {} write was not sent",
            value.type_name()
        )))
    }

    async fn close(&mut self) {
        self.routed.store(false, Ordering::Relaxed);
        self.receiver = None;
    }
}

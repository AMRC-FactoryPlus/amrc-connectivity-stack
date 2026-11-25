// ACS Rust test driver
// The rs-edge-driver handler
// Copyright 2026 University of Sheffield

//! The [`Handler`] that joins the waves to the driver library.

use std::sync::{Arc, LazyLock};
use std::time::Instant;

use async_trait::async_trait;
use bytes::Bytes;
use rs_edge_driver::{ConnectError, DriverHandle, Handler, HandlerError, Poller, Reader, Scouter};

use crate::addr::Addr;
use crate::read::{ReadOptions, TestReader};
use crate::scout::TestScouter;
use crate::wave;

/// The time waves are measured from.
///
/// The JS driver uses `performance.now()`, the milliseconds since the
/// process started, so a new config does not restart the waves. This
/// does the same.
pub mod clock {
    use super::*;

    static START: LazyLock<Instant> = LazyLock::new(Instant::now);

    /// Fix the start time. Call it at the start of `main`, or the
    /// first poll will be time 0.
    pub fn start() {
        LazyLock::force(&START);
    }

    /// Milliseconds since [`start`].
    pub fn now_ms() -> f64 {
        START.elapsed().as_secs_f64() * 1000.0
    }
}

/// The handler. It has no device: every address is worked out from the
/// clock. Its only config is the read keys in [`crate::read`].
pub struct TestHandler {
    reads: ReadOptions,
}

/// Reads addresses without the handler's lock, so a poll request for
/// many addresses is answered at once, as the JS driver's
/// `serial: false` does.
struct WavePoller;

#[async_trait]
impl Poller<Addr> for WavePoller {
    async fn poll(&self, addr: &Addr) -> Option<Bytes> {
        Some(wave::value(addr, clock::now_ms()))
    }
}

#[async_trait]
impl Handler for TestHandler {
    type Addr = Addr;

    /// Scans list a made-up tree, set by the scan's options. See
    /// [`crate::scout`].
    const SCOUTS: bool = true;

    /// Live values give each address a fixed value. See
    /// [`crate::read`].
    const READS: bool = true;

    /// Any config is accepted, as in the JS driver, except a bad
    /// `read_fail` or `read_hang`. Other keys are ignored.
    fn create(
        _handle: DriverHandle<Addr>,
        config: serde_json::Value,
    ) -> Result<Self, HandlerError> {
        Ok(Self {
            reads: ReadOptions::parse(&config)?,
        })
    }

    fn parse_addr(&self, addr: &str) -> Option<Addr> {
        let parsed = Addr::parse(addr);
        if parsed.is_none() {
            tracing::debug!("invalid address {addr:?}");
        }
        parsed
    }

    async fn connect(&mut self) -> Result<(), ConnectError> {
        Ok(())
    }

    async fn poll(&mut self, addr: &Addr) -> Option<Bytes> {
        WavePoller.poll(addr).await
    }

    fn poller(&self) -> Option<Arc<dyn Poller<Addr>>> {
        Some(Arc::new(WavePoller))
    }

    fn scouter(&self) -> Option<Arc<dyn Scouter>> {
        Some(TestScouter::new())
    }

    fn reader(&self) -> Option<Arc<dyn Reader>> {
        TestReader::for_options(self.reads)
    }

    async fn close(&mut self) {}
}

//! A stub split driver for `acs-edge`'s `npm run bench:rate -- --stub`.
//!
//! It takes the usual `EDGE_MQTT`, `EDGE_USERNAME` and `EDGE_PASSWORD`,
//! plus `RATE_HZ`. Once the agent has given it its addresses it
//! publishes one `{"value", "timestamp"}` message per address, back to
//! back, `RATE_HZ` times a second, as edge-opcua does with the values
//! of one subscription notification. It is the Rust twin of
//! `acs-edge/bench/rate-stub.mjs`, so the benchmark can measure the
//! library's own link to the agent.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use bytes::Bytes;
use rs_edge_driver::*;

struct RateStub {
    handle: DriverHandle<String>,
    hz: f64,
    task: Option<tokio::task::JoinHandle<()>>,
}

#[async_trait]
impl Handler for RateStub {
    type Addr = String;
    const SUPPORTS_POLL: bool = false;

    fn create(
        handle: DriverHandle<String>,
        _config: serde_json::Value,
    ) -> Result<Self, HandlerError> {
        let hz = std::env::var("RATE_HZ")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(10.0);
        Ok(Self {
            handle,
            hz,
            task: None,
        })
    }

    fn parse_addr(&self, addr: &str) -> Option<String> {
        Some(addr.to_owned())
    }

    async fn connect(&mut self) -> Result<(), ConnectError> {
        Ok(())
    }

    async fn subscribe(&mut self, addrs: &[String]) -> bool {
        if let Some(t) = self.task.take() {
            t.abort();
        }
        let handle = self.handle.clone();
        let addrs = addrs.to_vec();
        let period = Duration::from_secs_f64(1.0 / self.hz);
        self.task = Some(tokio::spawn(async move {
            let mut tick = tokio::time::interval(period);
            let mut n = 0u64;
            loop {
                tick.tick().await;
                n += 1;
                let ts = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_millis();
                for (i, a) in addrs.iter().enumerate() {
                    let v = i as f64 + n as f64 * 0.5;
                    let payload = format!(r#"{{"value":{v},"timestamp":{ts}}}"#);
                    handle.publish(a.clone(), Bytes::from(payload));
                }
            }
        }));
        true
    }

    async fn close(&mut self) {
        if let Some(t) = self.task.take() {
            t.abort();
        }
    }
}

#[tokio::main]
async fn main() {
    init_logging();
    let config = DriverConfig::from_env().expect("EDGE_MQTT, EDGE_USERNAME and EDGE_PASSWORD");
    let mut driver = Driver::<RateStub>::new(config);
    if let Err(e) = driver.run().await {
        eprintln!("rate stub: {e}");
        std::process::exit(1);
    }
}

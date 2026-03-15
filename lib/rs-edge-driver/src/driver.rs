use std::collections::HashMap;
use std::marker::PhantomData;

use bytes::Bytes;
use tokio::sync::mpsc;

use crate::config::DriverConfig;
use crate::error::Error;
use crate::handler::Handler;
use crate::status::Status;

/// A handle given to [`Handler`] implementations so they can push
/// data back to the driver asynchronously.
///
/// This is the primary mechanism for async/event-driven handlers:
/// store the handle in your handler struct, then call
/// [`publish`](DriverHandle::publish) whenever new data arrives
/// from the device.
#[derive(Clone)]
pub struct DriverHandle {
    tx: mpsc::UnboundedSender<DriverEvent>,
}

/// Internal events sent from the handler back to the driver loop.
pub(crate) enum DriverEvent {
    /// Handler is publishing data for an address.
    Data { topic: String, payload: Bytes },
}

impl DriverHandle {
    pub(crate) fn new(tx: mpsc::UnboundedSender<DriverEvent>) -> Self {
        Self { tx }
    }

    /// Publish data for a topic back to the edge agent.
    ///
    /// Used by async handlers from within their [`subscribe`](crate::Handler::subscribe)
    /// callbacks. The topic should match one of the address topics
    /// configured by the edge agent.
    pub fn publish(&self, topic: impl Into<String>, data: Bytes) {
        let _ = self.tx.send(DriverEvent::Data {
            topic: topic.into(),
            payload: data,
        });
    }
}

/// The driver runtime. Manages the MQTT connection to the edge agent,
/// handler lifecycle, and data flow.
///
/// Generic over the [`Handler`] implementation, which defines the
/// device-specific protocol logic.
///
/// # Usage
///
/// ```rust,ignore
/// use rs_edge_driver::*;
///
/// #[tokio::main]
/// async fn main() -> Result<(), Error> {
///     let config = DriverConfig::from_env()?;
///     let mut driver = Driver::<MyHandler>::new(config);
///     driver.run().await
/// }
/// ```
pub struct Driver<H: Handler> {
    config: DriverConfig,
    status: Status,
    handler: Option<H>,
    /// topic → parsed address
    addrs: HashMap<String, H::Addr>,
    /// parsed address → topic (reverse lookup for async publishing)
    topics: HashMap<H::Addr, String>,
    _marker: PhantomData<H>,
}

impl<H: Handler> Driver<H> {
    /// Create a new driver with the given configuration.
    pub fn new(config: DriverConfig) -> Self {
        Self {
            config,
            status: Status::Down,
            handler: None,
            addrs: HashMap::new(),
            topics: HashMap::new(),
            _marker: PhantomData,
        }
    }

    /// Run the driver's main event loop.
    ///
    /// This connects to the edge agent's MQTT broker, listens for
    /// configuration and poll requests, and manages the handler
    /// lifecycle. It runs indefinitely until an unrecoverable error
    /// occurs.
    ///
    /// # Lifecycle
    ///
    /// 1. Connect to MQTT broker, publish status `READY`
    /// 2. Receive device config → call `Handler::create`
    /// 3. Call `Handler::connect` → status `UP` on success
    /// 4. Receive address mappings → call `Handler::parse_addr`
    /// 5. **Polled**: respond to poll requests via `Handler::poll`
    ///    **Async**: call `Handler::subscribe`, receive data via `DriverHandle::publish`
    /// 6. On reconfiguration: call `Handler::close`, restart from step 2
    pub async fn run(&mut self) -> Result<(), Error> {
        // TODO: implement MQTT connection and event loop
        //
        // This will involve:
        // - Connecting to the MQTT broker at self.config.mqtt_url
        // - Setting last-will to fpEdge1/{id}/status → "DOWN"
        // - Subscribing to fpEdge1/{id}/active, conf, addr, poll, cmd/#
        // - Publishing status updates
        // - Dispatching incoming messages to handler methods
        // - Managing reconnection on device connection failures

        tracing::info!(
            mqtt = %self.config.mqtt_url,
            id = %self.config.username,
            "driver starting"
        );

        todo!("MQTT event loop not yet implemented")
    }

    fn set_status(&mut self, status: Status) {
        self.status = status;
        tracing::info!(%status, "driver status changed");
        // TODO: publish to fpEdge1/{id}/status
    }
}

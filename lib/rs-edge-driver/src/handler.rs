use std::hash::Hash;

use async_trait::async_trait;
use bytes::Bytes;

use crate::driver::DriverHandle;
use crate::error::{ConnectError, HandlerError};

/// The trait that driver authors implement to define how to communicate
/// with a specific southbound device.
///
/// The library handles all MQTT communication with the edge agent;
/// implementors only need to deal with the device protocol itself.
///
/// # Driver modes
///
/// There are two modes of operation — choose one by overriding the
/// appropriate default method:
///
/// - **Polled**: override [`poll`](Handler::poll) to read data from
///   the device on demand when the edge agent requests it.
/// - **Async**: override [`subscribe`](Handler::subscribe) to set up
///   subscriptions, then push data back via
///   [`DriverHandle::publish`] when values arrive.
///
/// # Example
///
/// ```rust,ignore
/// use async_trait::async_trait;
/// use bytes::Bytes;
/// use rs_edge_driver::*;
///
/// struct ModbusHandler {
///     handle: DriverHandle,
///     host: String,
///     port: u16,
///     // ... client state
/// }
///
/// #[async_trait]
/// impl Handler for ModbusHandler {
///     type Addr = ModbusAddr;
///
///     fn create(
///         handle: DriverHandle,
///         config: serde_json::Value,
///     ) -> Result<Self, HandlerError> {
///         let host = config["host"].as_str()
///             .ok_or_else(|| HandlerError::new("missing 'host'"))?
///             .to_string();
///         let port = config["port"].as_u64()
///             .ok_or_else(|| HandlerError::new("missing 'port'"))? as u16;
///         Ok(Self { handle, host, port })
///     }
///
///     fn parse_addr(&self, raw: &str) -> Option<ModbusAddr> {
///         // parse "1,holding,100,10" into a typed address
///         todo!()
///     }
///
///     async fn connect(&mut self) -> Result<(), ConnectError> {
///         // establish TCP connection to the Modbus device
///         todo!()
///     }
///
///     async fn poll(&mut self, addr: &ModbusAddr) -> Option<Bytes> {
///         // read registers and return the raw bytes
///         todo!()
///     }
///
///     async fn close(&mut self) {
///         // disconnect from the device
///     }
/// }
/// ```
#[async_trait]
pub trait Handler: Send + Sized {
    /// A parsed, validated representation of a device address.
    ///
    /// The edge agent sends addresses as strings; [`parse_addr`](Handler::parse_addr)
    /// converts them into this type. Using an associated type gives
    /// compile-time safety — no downcasting needed.
    type Addr: Send + Sync + Hash + Eq + Clone;

    /// Construct a new handler from the configuration object sent
    /// by the edge agent.
    ///
    /// Return `Err` if the configuration is invalid — the driver will
    /// report status `CONF` to the edge agent.
    ///
    /// The [`DriverHandle`] can be stored and used later to push
    /// async data back to the driver via [`DriverHandle::publish`].
    fn create(handle: DriverHandle, config: serde_json::Value) -> Result<Self, HandlerError>;

    /// Parse and validate a raw address string from the edge agent.
    ///
    /// Return `None` if the address is not valid for this handler.
    /// Invalid addresses cause the driver to report status `ADDR`.
    fn parse_addr(&self, addr: &str) -> Option<Self::Addr>;

    /// Connect (or reconnect) to the southbound device.
    ///
    /// Return `Ok(())` on success. The driver will set status `UP`.
    /// Return `Err(ConnectError::ConnectionFailed)` or
    /// `Err(ConnectError::AuthFailed)` on failure — the driver will
    /// retry after the configured reconnect delay.
    async fn connect(&mut self) -> Result<(), ConnectError>;

    /// Clean up resources and disconnect from the device.
    ///
    /// Called before the handler is dropped — either due to
    /// reconfiguration or shutdown.
    async fn close(&mut self);

    /// **Polled mode**: read data for a single address from the device.
    ///
    /// Called when the edge agent sends a poll request. Return
    /// `Some(bytes)` with the raw data, or `None` if the read failed.
    ///
    /// The default implementation returns `None`. Override this for
    /// polled drivers.
    async fn poll(&mut self, _addr: &Self::Addr) -> Option<Bytes> {
        None
    }

    /// **Async mode**: set up subscriptions for the given addresses.
    ///
    /// Called after [`connect`](Handler::connect) succeeds and
    /// addresses have been configured. When data arrives, push it
    /// back to the driver via [`DriverHandle::publish`].
    ///
    /// Return `true` if all subscriptions were set up successfully.
    ///
    /// The default implementation returns `true` (no-op). Override
    /// this for async/event-driven drivers.
    async fn subscribe(&mut self, _addrs: &[Self::Addr]) -> bool {
        true
    }

    /// Handle a command sent from the edge agent.
    ///
    /// Commands arrive on `fpEdge1/{id}/cmd/{name}` and are
    /// forwarded here. Override this if the device supports commands.
    async fn cmd(&mut self, _command: &str, _payload: Bytes) {}
}

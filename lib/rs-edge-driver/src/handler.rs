use std::hash::Hash;
use std::sync::Arc;

use async_trait::async_trait;
use bytes::Bytes;

use crate::driver::DriverHandle;
use crate::error::{ConnectError, HandlerError, WriteError};
use crate::write::WriteValue;

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
///     handle: DriverHandle<ModbusAddr>,
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
///         handle: DriverHandle<ModbusAddr>,
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

    /// Whether this handler supports polled reads via [`poll`](Handler::poll).
    ///
    /// The edge agent sends explicit `poll` requests as a fallback
    /// whenever it isn't otherwise seeing timely data for an address —
    /// this happens regardless of whether the handler is async or
    /// polled, since the edge agent has no way to know. A handler that
    /// only implements [`subscribe`](Handler::subscribe) has nothing
    /// useful `poll` could ever do with those requests, so set this to
    /// `false` to have the driver discard them immediately instead of
    /// queueing them (which would otherwise eventually log spurious
    /// "poll queue full" warnings for a queue that was never going to
    /// produce anything anyway).
    ///
    /// Defaults to `true`.
    const SUPPORTS_POLL: bool = true;

    /// Whether this handler takes typed writes through
    /// [`write`](Handler::write) instead of raw bytes through
    /// [`cmd`](Handler::cmd).
    ///
    /// The edge agent sends every write in both forms, so the driver
    /// subscribes to only one: `cmd/#` when this is `false`, and
    /// `write/#` when it is `true`. Only one of `cmd` and `write` is
    /// ever called.
    ///
    /// Set it to `true` for a device that needs the value's type to
    /// write it, such as OPC UA. The edge agent must be from November
    /// 2026 or later: an older one refuses the `write/#` subscription
    /// and drops the driver's connection.
    ///
    /// Defaults to `false`, which keeps `cmd` exactly as before.
    const TYPED_WRITES: bool = false;

    /// Construct a new handler from the configuration object sent
    /// by the edge agent.
    ///
    /// Return `Err` if the configuration is invalid — the driver will
    /// report status `CONF` to the edge agent.
    ///
    /// The [`DriverHandle`] can be stored and used later to push
    /// async data back to the driver via [`DriverHandle::publish`].
    fn create(
        handle: DriverHandle<Self::Addr>,
        config: serde_json::Value,
    ) -> Result<Self, HandlerError>;

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
    /// report `CONN` or `AUTH` and retry after the configured
    /// reconnect delay.
    ///
    /// The driver calls this on its own task, so a slow connect
    /// doesn't hold up the edge agent's MQTT connection. If the
    /// connection is lost later, report it with
    /// [`DriverHandle::disconnected`] and the driver will call
    /// `connect` again.
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
    /// back to the driver via [`DriverHandle::publish`], passing the
    /// same address it came from — the driver resolves the address to
    /// the data topic name the edge agent assigned, so the handler
    /// never needs to track topic names itself.
    ///
    /// Each call replaces the previous set. If the address map becomes
    /// empty after the handler has subscribed to some addresses, this
    /// is called with an empty slice, so drop every subscription then.
    /// It is never called empty before the first non-empty call.
    ///
    /// If the device connection can fail after `connect` returns and
    /// before this is called, report it with
    /// [`DriverHandle::disconnected`] from wherever the handler finds
    /// out, or check the connection here and return `false`.
    ///
    /// Return `true` if all subscriptions were set up successfully.
    ///
    /// The default implementation returns `true` (no-op). Override
    /// this for async/event-driven drivers.
    async fn subscribe(&mut self, _addrs: &[Self::Addr]) -> bool {
        true
    }

    /// **Async mode, optional**: as [`subscribe`](Handler::subscribe),
    /// with the edge agent's address groups as well.
    ///
    /// The edge agent puts each device's addresses in a group with the
    /// device's poll interval. A handler that subscribes at a rate,
    /// such as OPC UA with its sampling and publishing intervals, can
    /// override this to use them. `addrs` is every address in the map,
    /// exactly as `subscribe` gets it. An address can be in more than
    /// one group, and an address in no group is still in `addrs`.
    ///
    /// The default calls [`subscribe`](Handler::subscribe) with
    /// `addrs`, so a handler that overrides only `subscribe` works as
    /// before.
    async fn subscribe_groups(
        &mut self,
        addrs: &[Self::Addr],
        _groups: &[AddrGroup<Self::Addr>],
    ) -> bool {
        self.subscribe(addrs).await
    }

    /// Handle a command sent from the edge agent.
    ///
    /// Commands arrive on `fpEdge1/{id}/cmd/{name}` and are
    /// forwarded here. Override this if the device supports commands.
    async fn cmd(&mut self, _command: &str, _payload: Bytes) {}

    /// Handle a typed write from the edge agent. Only called when
    /// [`TYPED_WRITES`](Handler::TYPED_WRITES) is `true`.
    ///
    /// Typed writes arrive on `fpEdge1/{id}/write/{address}`. The
    /// driver looks the address up in the current address map and
    /// passes its parsed form, so `parse_addr` has already accepted
    /// it. `value` carries the metric's Sparkplug type and its value.
    ///
    /// Return `Err` if the write fails, and the driver reports it to
    /// the edge agent on the address's `err` topic. A write the driver
    /// can't use (bad JSON, a value that doesn't fit its type, or an
    /// address not in the map) is reported as `CMD` without calling
    /// this.
    ///
    /// The default refuses every write. It is never called unless
    /// `TYPED_WRITES` is `true`, and a handler that leaves
    /// `TYPED_WRITES` at `false` gets its writes through `cmd` as
    /// before.
    async fn write(&mut self, _addr: &Self::Addr, value: WriteValue) -> Result<(), WriteError> {
        Err(WriteError::Failed(format!(
            "typed writes are not implemented ({} write refused)",
            value.type_name()
        )))
    }

    /// **Polled mode, optional**: hand out a [`Poller`] so polls can
    /// run at the same time as each other.
    ///
    /// [`poll`](Handler::poll) takes `&mut self`, so the driver holds
    /// the handler's lock for each poll and polls run one at a time.
    /// A handler whose device client can serve several reads at once
    /// (an HTTP client, a connection pool, a client with its own
    /// request queue) can return a `Poller` here instead. The driver
    /// asks for it after each successful [`connect`](Handler::connect)
    /// and then calls [`Poller::poll`] without taking the handler's
    /// lock, for as many addresses at once as the edge agent asks for.
    /// `serial_poll` in [`DriverConfig`](crate::DriverConfig) still
    /// limits it to one poll at a time.
    ///
    /// The default returns `None`, which keeps the locked `poll`.
    fn poller(&self) -> Option<Arc<dyn Poller<Self::Addr>>> {
        None
    }
}

/// One group from the edge agent's address configuration: the
/// addresses of one device and how often the edge agent wants them.
/// See [`Handler::subscribe_groups`].
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub struct AddrGroup<A> {
    /// The group's name, which is the device's name.
    pub name: String,
    /// The poll interval, zero if the edge agent gave none.
    pub poll: std::time::Duration,
    /// The group's addresses that are in the current address map.
    pub addrs: Vec<A>,
}

impl<A> AddrGroup<A> {
    /// A group, for a handler's own tests.
    pub fn new(name: impl Into<String>, poll: std::time::Duration, addrs: Vec<A>) -> Self {
        Self {
            name: name.into(),
            poll,
            addrs,
        }
    }
}

/// Reads addresses without needing the handler's lock. See
/// [`Handler::poller`].
///
/// A `Poller` is usually a small struct holding a clone of the
/// handler's device client.
#[async_trait]
pub trait Poller<A>: Send + Sync {
    /// Read data for a single address, as [`Handler::poll`] does.
    /// Return `None` if the read failed.
    async fn poll(&self, addr: &A) -> Option<Bytes>;
}

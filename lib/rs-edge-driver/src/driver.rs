use std::collections::HashMap;
use std::marker::PhantomData;
use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use rumqttc::{AsyncClient, Event, Incoming, MqttOptions, QoS};
use serde::Deserialize;
use tokio::sync::{Mutex, mpsc};

use crate::config::DriverConfig;
use crate::error::{ConnectError, Error};
use crate::handler::Handler;
use crate::status::Status;

/// Maximum number of poll batches that can queue before we start
/// dropping requests (backpressure). Matches the JS/Python versions.
const POLL_QUEUE_MAX: usize = 20;

/// Timeout for a single poll operation.
const POLL_TIMEOUT: Duration = Duration::from_secs(30);

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

/// The address configuration packet sent by the edge agent.
#[derive(Deserialize)]
struct AddrConfig {
    version: u32,
    addrs: HashMap<String, String>,
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
    handler: Option<Arc<Mutex<H>>>,
    /// topic → parsed address
    addrs: HashMap<String, H::Addr>,
    /// parsed address → topic (reverse lookup for async publishing)
    topics: HashMap<H::Addr, String>,
    _marker: PhantomData<H>,
}

impl<H: Handler + 'static> Driver<H> {
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

    /// Build the `fpEdge1/{id}/{msg}` topic string.
    fn topic(&self, msg: &str) -> String {
        format!("fpEdge1/{}/{}", self.config.username, msg)
    }

    /// Build the `fpEdge1/{id}/{msg}/{data}` topic string.
    fn topic_with(&self, msg: &str, data: &str) -> String {
        format!("fpEdge1/{}/{}/{}", self.config.username, msg, data)
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
        tracing::info!(
            mqtt = %self.config.mqtt_url,
            id = %self.config.username,
            "driver starting"
        );

        let (tx, mut rx) = mpsc::unbounded_channel::<DriverEvent>();
        self.run_loop(&tx, &mut rx).await
    }

    async fn run_loop(
        &mut self,
        tx: &mpsc::UnboundedSender<DriverEvent>,
        rx: &mut mpsc::UnboundedReceiver<DriverEvent>,
    ) -> Result<(), Error> {
        loop {
            tracing::info!("connecting to MQTT broker");
            let result = self.mqtt_session(tx, rx).await;
            match result {
                Ok(()) => {
                    tracing::info!("MQTT session ended cleanly");
                }
                Err(e) => {
                    tracing::error!(%e, "MQTT session error");
                }
            }

            // Clean up handler on disconnect
            self.close_handler().await;
            self.status = Status::Down;

            tracing::info!(
                delay = ?self.config.reconnect_delay,
                "reconnecting to MQTT broker"
            );
            tokio::time::sleep(self.config.reconnect_delay).await;
        }
    }

    /// Run a single MQTT session. Returns when the connection is lost.
    async fn mqtt_session(
        &mut self,
        tx: &mpsc::UnboundedSender<DriverEvent>,
        rx: &mut mpsc::UnboundedReceiver<DriverEvent>,
    ) -> Result<(), Error> {
        let (client, mut eventloop) = self.connect_mqtt()?;

        // Subscribe to our control topics
        let subs = ["active", "conf", "addr", "poll", "cmd/#"];
        for sub in &subs {
            client
                .subscribe(self.topic(sub), QoS::AtMostOnce)
                .await
                .map_err(|e| Error::Mqtt(e.to_string()))?;
        }

        self.set_status(Status::Ready, &client).await;

        // Create the bounded poll channel for this session
        let (poll_tx, poll_rx) = mpsc::channel::<Vec<(String, H::Addr)>>(POLL_QUEUE_MAX);

        // Shared handler reference for the poll worker. Updated by
        // on_conf when a new handler is created.
        let poll_handler: Arc<Mutex<Option<Arc<Mutex<H>>>>> = Arc::new(Mutex::new(None));

        // Spawn the poll worker task
        let poll_worker = tokio::spawn(Self::poll_worker(
            poll_rx,
            poll_handler.clone(),
            client.clone(),
            self.config.username.clone(),
            self.config.serial_poll,
        ));

        // Main event loop: select between MQTT events and handler data
        let result: Result<(), Error> = loop {
            tokio::select! {
                event = eventloop.poll() => {
                    match event {
                        Ok(Event::Incoming(incoming)) => {
                            self.handle_incoming(
                                &client, tx, &poll_tx, &poll_handler, incoming,
                            ).await?;
                        }
                        Ok(_) => {}
                        Err(e) => {
                            break Err(Error::Mqtt(e.to_string()));
                        }
                    }
                }
                Some(event) = rx.recv() => {
                    self.handle_driver_event(&client, event).await;
                }
            }
        };

        // Clean up the poll worker when the session ends
        poll_worker.abort();
        result
    }

    /// Background task that processes poll requests from the channel.
    async fn poll_worker(
        mut poll_rx: mpsc::Receiver<Vec<(String, H::Addr)>>,
        handler_ref: Arc<Mutex<Option<Arc<Mutex<H>>>>>,
        client: AsyncClient,
        id: String,
        serial: bool,
    ) {
        while let Some(polls) = poll_rx.recv().await {
            let handler_arc = {
                let guard = handler_ref.lock().await;
                match guard.clone() {
                    Some(h) => h,
                    None => continue,
                }
            };

            if serial {
                Self::poll_serial(&handler_arc, &client, &id, &polls).await;
            } else {
                Self::poll_parallel(&handler_arc, &client, &id, polls).await;
            }
        }
    }

    /// Poll addresses one at a time, holding the handler lock for each.
    async fn poll_serial(
        handler: &Arc<Mutex<H>>,
        client: &AsyncClient,
        id: &str,
        polls: &[(String, H::Addr)],
    ) {
        for (topic, addr) in polls {
            let result = tokio::time::timeout(POLL_TIMEOUT, async {
                let mut h = handler.lock().await;
                h.poll(addr).await
            })
            .await;

            match result {
                Ok(Some(data)) => {
                    let mtopic = format!("fpEdge1/{id}/data/{topic}");
                    if let Err(e) = client.publish(&mtopic, QoS::AtMostOnce, false, data).await {
                        tracing::error!(%e, %topic, "failed to publish poll data");
                    }
                }
                Ok(None) => {}
                Err(_) => {
                    tracing::warn!(%topic, "poll timed out");
                }
            }
        }
    }

    /// Poll all addresses concurrently, each in its own task.
    async fn poll_parallel(
        handler: &Arc<Mutex<H>>,
        client: &AsyncClient,
        id: &str,
        polls: Vec<(String, H::Addr)>,
    ) {
        let mut tasks = Vec::with_capacity(polls.len());

        for (topic, addr) in polls {
            let handler = handler.clone();
            let client = client.clone();
            let id = id.to_owned();

            tasks.push(tokio::spawn(async move {
                let result = tokio::time::timeout(POLL_TIMEOUT, async {
                    let mut h = handler.lock().await;
                    h.poll(&addr).await
                })
                .await;

                match result {
                    Ok(Some(data)) => {
                        let mtopic = format!("fpEdge1/{id}/data/{topic}");
                        if let Err(e) = client.publish(&mtopic, QoS::AtMostOnce, false, data).await
                        {
                            tracing::error!(%e, %topic, "failed to publish poll data");
                        }
                    }
                    Ok(None) => {}
                    Err(_) => {
                        tracing::warn!(%topic, "poll timed out");
                    }
                }
            }));
        }

        futures::future::join_all(tasks).await;
    }

    /// Create the MQTT client and set up connection options.
    fn connect_mqtt(&self) -> Result<(AsyncClient, rumqttc::EventLoop), Error> {
        let url = url::Url::parse(&self.config.mqtt_url)
            .map_err(|e| Error::Mqtt(format!("invalid MQTT URL: {e}")))?;

        let host = url
            .host_str()
            .ok_or_else(|| Error::Mqtt("MQTT URL has no host".into()))?;
        let port = url.port().unwrap_or(1883);

        let mut opts = MqttOptions::new(&self.config.username, host, port);
        opts.set_credentials(&self.config.username, &self.config.password);
        opts.set_last_will(rumqttc::LastWill::new(
            self.topic("status"),
            "DOWN",
            QoS::AtLeastOnce,
            false,
        ));
        opts.set_keep_alive(std::time::Duration::from_secs(30));

        let (client, eventloop) = AsyncClient::new(opts, 64);
        Ok((client, eventloop))
    }

    /// Handle an incoming MQTT message.
    async fn handle_incoming(
        &mut self,
        client: &AsyncClient,
        tx: &mpsc::UnboundedSender<DriverEvent>,
        poll_tx: &mpsc::Sender<Vec<(String, H::Addr)>>,
        poll_handler: &Arc<Mutex<Option<Arc<Mutex<H>>>>>,
        incoming: Incoming,
    ) -> Result<(), Error> {
        let publish = match incoming {
            Incoming::Publish(p) => p,
            Incoming::ConnAck(_) => {
                self.set_status(Status::Ready, client).await;
                return Ok(());
            }
            _ => return Ok(()),
        };

        let prefix = self.topic("");
        let suffix = publish
            .topic
            .strip_prefix(&prefix)
            .unwrap_or(&publish.topic);

        // Split into message type and optional data
        let (msg, data) = match suffix.split_once('/') {
            Some((m, d)) => (m, Some(d)),
            None => (suffix, None),
        };

        match msg {
            "active" => self.on_active(client, &publish.payload).await,
            "conf" => {
                self.on_conf(client, tx, poll_handler, &publish.payload)
                    .await;
            }
            "addr" => self.on_addr(client, &publish.payload).await,
            "poll" => self.on_poll(poll_tx, &publish.payload),
            "cmd" => {
                if let Some(name) = data {
                    self.on_cmd(name, Bytes::from(publish.payload.to_vec()))
                        .await;
                }
            }
            other => {
                tracing::warn!(msg = other, "unhandled message type");
            }
        }

        Ok(())
    }

    /// Handle `active` message from the edge agent.
    async fn on_active(&mut self, client: &AsyncClient, payload: &[u8]) {
        if payload == b"ONLINE" {
            tracing::info!("edge agent online");
            self.set_status(Status::Ready, client).await;
        }
    }

    /// Handle `conf` message — create a new handler.
    async fn on_conf(
        &mut self,
        client: &AsyncClient,
        tx: &mpsc::UnboundedSender<DriverEvent>,
        poll_handler: &Arc<Mutex<Option<Arc<Mutex<H>>>>>,
        payload: &[u8],
    ) {
        let conf: serde_json::Value = match serde_json::from_slice(payload) {
            Ok(v) => v,
            Err(e) => {
                tracing::error!(%e, "failed to parse conf JSON");
                self.set_status(Status::Conf, client).await;
                return;
            }
        };

        tracing::debug!(?conf, "received device configuration");

        self.close_handler().await;
        // Clear the poll worker's handler reference
        *poll_handler.lock().await = None;

        // Create new handler
        let handle = DriverHandle::new(tx.clone());
        match H::create(handle, conf) {
            Ok(handler) => {
                let handler = Arc::new(Mutex::new(handler));
                self.handler = Some(handler.clone());
                *poll_handler.lock().await = Some(handler);
                self.connect_handler(client).await;
            }
            Err(e) => {
                tracing::error!(reason = %e, "handler rejected configuration");
                self.set_status(Status::Conf, client).await;
            }
        }
    }

    /// Attempt to connect the handler to its southbound device,
    /// retrying on failure after the configured delay.
    async fn connect_handler(&mut self, client: &AsyncClient) {
        loop {
            let handler = match self.handler.as_ref() {
                Some(h) => h,
                None => return,
            };

            let result = handler.lock().await.connect().await;
            match result {
                Ok(()) => {
                    self.set_status(Status::Up, client).await;
                    self.try_subscribe().await;
                    return;
                }
                Err(ConnectError::ConnectionFailed) => {
                    tracing::warn!("handler connection failed, retrying");
                    self.set_status(Status::Conn, client).await;
                }
                Err(ConnectError::AuthFailed) => {
                    tracing::warn!("handler auth failed, retrying");
                    self.set_status(Status::Auth, client).await;
                }
            }

            tokio::time::sleep(self.config.reconnect_delay).await;
        }
    }

    /// Handle `addr` message — parse and store address mappings.
    async fn on_addr(&mut self, client: &AsyncClient, payload: &[u8]) {
        let pkt: AddrConfig = match serde_json::from_slice(payload) {
            Ok(v) => v,
            Err(e) => {
                tracing::error!(%e, "failed to parse addr JSON");
                self.set_status(Status::Addr, client).await;
                return;
            }
        };

        if pkt.version != 1 {
            tracing::error!(version = pkt.version, "unsupported addr config version");
            self.set_status(Status::Addr, client).await;
            return;
        }

        let handler = match self.handler.as_ref() {
            Some(h) => h,
            None => {
                tracing::warn!("received addrs without handler");
                return;
            }
        };

        // Parse all addresses while holding the handler lock, collecting
        // into a temporary vec to release the lock before mutating self.
        let guard = handler.lock().await;
        let mut parsed_addrs = Vec::with_capacity(pkt.addrs.len());
        for (topic, raw_addr) in &pkt.addrs {
            match guard.parse_addr(raw_addr) {
                Some(parsed) => {
                    parsed_addrs.push((topic.clone(), parsed));
                }
                None => {
                    tracing::error!(addr = raw_addr, "handler rejected address");
                    drop(guard);
                    self.clear_addrs();
                    self.set_status(Status::Addr, client).await;
                    return;
                }
            }
        }
        drop(guard);

        self.clear_addrs();
        for (topic, parsed) in parsed_addrs {
            self.topics.insert(parsed.clone(), topic.clone());
            self.addrs.insert(topic, parsed);
        }

        tracing::info!(count = self.addrs.len(), "addresses configured");
        self.try_subscribe().await;
    }

    /// Handle `poll` message — resolve topics and send to the poll worker.
    ///
    /// This returns immediately without awaiting any handler calls,
    /// keeping the MQTT event loop responsive. If the poll queue is
    /// full, the request is dropped (backpressure).
    fn on_poll(&self, poll_tx: &mpsc::Sender<Vec<(String, H::Addr)>>, payload: &[u8]) {
        let payload_str = match std::str::from_utf8(payload) {
            Ok(s) => s,
            Err(_) => return,
        };

        let polls: Vec<(String, H::Addr)> = payload_str
            .lines()
            .filter_map(|line| {
                let topic = line.trim();
                if topic.is_empty() {
                    return None;
                }
                match self.addrs.get(topic) {
                    Some(a) => Some((topic.to_owned(), a.clone())),
                    None => {
                        tracing::warn!(topic, "poll for unknown topic");
                        None
                    }
                }
            })
            .collect();

        if polls.is_empty() {
            return;
        }

        if poll_tx.try_send(polls).is_err() {
            tracing::warn!("poll queue full, dropping request");
        }
    }

    /// Handle `cmd` message — forward to handler.
    async fn on_cmd(&mut self, command: &str, payload: Bytes) {
        if let Some(handler) = self.handler.as_ref() {
            handler.lock().await.cmd(command, payload).await;
        }
    }

    /// Try to call handler.subscribe() if we're UP and have addresses.
    async fn try_subscribe(&mut self) {
        if self.status != Status::Up || self.addrs.is_empty() {
            return;
        }

        let specs: Vec<H::Addr> = self.addrs.values().cloned().collect();

        if let Some(handler) = self.handler.as_ref() {
            if !handler.lock().await.subscribe(&specs).await {
                tracing::error!("handler subscription failed");
            }
        }
    }

    /// Handle a DriverEvent from the handler channel (async data publish).
    async fn handle_driver_event(&self, client: &AsyncClient, event: DriverEvent) {
        match event {
            DriverEvent::Data { topic, payload } => {
                let mtopic = self.topic_with("data", &topic);
                if let Err(e) = client
                    .publish(&mtopic, QoS::AtMostOnce, false, payload)
                    .await
                {
                    tracing::error!(%e, topic, "failed to publish async data");
                }
            }
        }
    }

    fn clear_addrs(&mut self) {
        self.addrs.clear();
        self.topics.clear();
    }

    /// Close the current handler (if any) and reset address state.
    async fn close_handler(&mut self) {
        if let Some(handler) = self.handler.take() {
            handler.lock().await.close().await;
        }
        self.clear_addrs();
    }

    async fn set_status(&mut self, status: Status, client: &AsyncClient) {
        self.status = status;
        tracing::info!(%status, "driver status changed");
        let topic = self.topic("status");
        let payload = status.to_string();
        if let Err(e) = client
            .publish(&topic, QoS::AtLeastOnce, false, payload)
            .await
        {
            tracing::error!(%e, "failed to publish status");
        }
    }
}

use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::time::Duration;

use bytes::Bytes;
use rumqttc::{
    AsyncClient, Event, EventLoop, Incoming, MqttOptions, Publish, QoS, SubscribeFilter,
};
use serde::Deserialize;
use tokio::sync::{Mutex, Semaphore, mpsc};
use tokio::task::{JoinHandle, JoinSet};

use crate::config::{DriverConfig, DriverOptions, PUBLISH_QUEUE_OVERHEAD};
use crate::error::{ConnectError, Error, WriteError};
use crate::handler::{AddrGroup, Handler, Poller};
use crate::redact::redact;
use crate::status::State as Status;
use crate::write::WriteValue;

/// Maximum number of poll batches that can queue before we start
/// dropping requests (backpressure). Matches the JS/Python versions.
/// In parallel mode it is also the most batches that run at once.
const POLL_QUEUE_MAX: usize = 20;

/// Most packets from the edge agent waiting for the driver loop.
const NETWORK_QUEUE: usize = 256;

/// Most messages held back while an address map is being parsed.
const DEFER_MAX: usize = 1000;

/// A handle given to [`Handler`] implementations so they can push
/// data back to the driver asynchronously, and report a lost
/// southbound connection.
///
/// This is the primary mechanism for async/event-driven handlers:
/// store the handle in your handler struct, then call
/// [`publish`](DriverHandle::publish) whenever new data arrives
/// from the device.
#[derive(Clone)]
pub struct DriverHandle<A> {
    tx: mpsc::UnboundedSender<DriverEvent<A>>,
    /// Which handler this handle belongs to. Reports from a handler
    /// that has since been replaced are ignored.
    generation: u64,
    /// The data waiting to go to the edge agent, shared by every
    /// handle the driver gives out.
    queue: Arc<PublishQueue>,
}

/// How much data is waiting to go to the edge agent: published by a
/// handler and not yet handed to the MQTT client.
pub(crate) struct PublishQueue {
    bytes: AtomicUsize,
    limit: usize,
    /// Woken whenever bytes are given back, for
    /// [`DriverHandle::publish_wait`].
    freed: tokio::sync::Notify,
}

impl PublishQueue {
    pub(crate) fn new(limit: usize) -> Arc<Self> {
        Arc::new(Self {
            bytes: AtomicUsize::new(0),
            limit,
            freed: tokio::sync::Notify::new(),
        })
    }

    /// Count `size` bytes in, waiting while that would take the queue
    /// over its limit. The same limit as [`reserve`](Self::reserve):
    /// one limit, which a handler meets by dropping or by waiting.
    async fn wait(self: &Arc<Self>, size: usize) -> Queued {
        loop {
            // Register for the wake-up before looking, so bytes given
            // back in between are not missed.
            let freed = self.freed.notified();
            tokio::pin!(freed);
            freed.as_mut().enable();
            if let Some(queued) = self.reserve(size) {
                return queued;
            }
            freed.await;
        }
    }

    /// Count `size` bytes in, unless that would take the queue over
    /// its limit. An empty queue takes anything, so a message larger
    /// than the limit is not refused for ever.
    fn reserve(self: &Arc<Self>, size: usize) -> Option<Queued> {
        let mut now = self.bytes.load(Ordering::Relaxed);
        loop {
            if now > 0 && now.saturating_add(size) > self.limit {
                return None;
            }
            match self.bytes.compare_exchange_weak(
                now,
                now + size,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => return Some(Queued::new(self.clone(), size)),
                Err(actual) => now = actual,
            }
        }
    }

    /// Count `size` bytes in whatever the limit.
    fn force(self: &Arc<Self>, size: usize) -> Queued {
        self.bytes.fetch_add(size, Ordering::Relaxed);
        Queued::new(self.clone(), size)
    }
}

/// One message's share of a [`PublishQueue`]. It goes with the message
/// and gives its bytes back when dropped, which happens when the
/// message is handed to the MQTT client or thrown away, by whatever
/// path.
pub(crate) struct Queued {
    queue: Arc<PublishQueue>,
    size: usize,
}

impl Queued {
    fn new(queue: Arc<PublishQueue>, size: usize) -> Self {
        Self { queue, size }
    }
}

impl Drop for Queued {
    fn drop(&mut self) {
        self.queue.bytes.fetch_sub(self.size, Ordering::Relaxed);
        self.queue.freed.notify_waiters();
    }
}

/// Events sent to the driver loop, by handlers and by the driver's own
/// background tasks.
pub(crate) enum DriverEvent<A> {
    /// Handler is publishing data for an address.
    Data {
        generation: u64,
        addr: A,
        payload: Bytes,
        queued: Queued,
    },
    /// Handler has lost its southbound connection.
    Lost { generation: u64, status: Status },
    /// A call to `Handler::connect` has finished.
    Connected {
        generation: u64,
        result: Result<(), ConnectError>,
        poller: Option<Arc<dyn Poller<A>>>,
    },
    /// An address map has been parsed, as (data topic, address,
    /// parsed address). `None` if the handler rejected an address.
    Parsed {
        generation: u64,
        seq: u64,
        addrs: Option<Vec<(String, String, A)>>,
    },
    /// A typed write has finished. It is answered on `result/{id}` if
    /// the agent is waiting for it, and a failure is otherwise
    /// reported on `err/{topic}`.
    WriteDone {
        generation: u64,
        topic: String,
        id: Option<String>,
        result: Result<(), WriteError>,
    },
}

impl<A> DriverHandle<A> {
    pub(crate) fn new(
        tx: mpsc::UnboundedSender<DriverEvent<A>>,
        generation: u64,
        queue: Arc<PublishQueue>,
    ) -> Self {
        Self {
            tx,
            generation,
            queue,
        }
    }

    /// Publish data for an address back to the edge agent.
    ///
    /// Used by async handlers from within their [`subscribe`](crate::Handler::subscribe)
    /// callbacks. Pass the same address (as returned from
    /// [`parse_addr`](crate::Handler::parse_addr)) that the data came
    /// from — the driver resolves it to the data topic name the edge
    /// agent assigned. Data for an address the edge agent isn't
    /// currently interested in (e.g. after reconfiguration) is
    /// silently dropped, and so is data sent while the driver's
    /// status isn't `UP`.
    pub fn publish(&self, addr: A, data: Bytes) {
        let queued = self.queue.force(data.len() + PUBLISH_QUEUE_OVERHEAD);
        let _ = self.tx.send(DriverEvent::Data {
            generation: self.generation,
            addr,
            payload: data,
            queued,
        });
    }

    /// As [`publish`](DriverHandle::publish), but only if the data
    /// waiting to go to the edge agent is under
    /// [`DriverOptions::publish_queue_bytes`]. Returns `false`, and
    /// drops the data, if it isn't.
    ///
    /// `publish` queues without limit, which suits a device that sends
    /// at the rate it is asked for. A device that pushes data on its
    /// own, as fast as it likes, can outrun the edge agent, and the
    /// queue then grows until the container runs out of memory. Use
    /// this instead, and count and report what it refuses, so that the
    /// loss is visible. Data is published in the order it is accepted,
    /// whichever of the two calls accepted it.
    #[must_use = "a refused message is dropped, so count or report it"]
    pub fn try_publish(&self, addr: A, data: Bytes) -> bool {
        let Some(queued) = self.queue.reserve(data.len() + PUBLISH_QUEUE_OVERHEAD) else {
            return false;
        };
        let _ = self.tx.send(DriverEvent::Data {
            generation: self.generation,
            addr,
            payload: data,
            queued,
        });
        true
    }

    /// As [`try_publish`](DriverHandle::try_publish), but wait for room
    /// instead of dropping the data.
    ///
    /// Both calls meet the same limit,
    /// [`DriverOptions::publish_queue_bytes`]. `try_publish` drops what
    /// doesn't fit. `publish_wait` waits until the edge agent has taken
    /// enough data, so a handler that awaits it stops reading from its
    /// device meanwhile, and the device or its server holds the data
    /// back, as it would for any slow client. Use it where the device
    /// side can hold data back, such as a subscription to an MQTT
    /// broker, and `try_publish` where it can't, such as UDP.
    ///
    /// Data is published in the order it is accepted, whichever call
    /// accepted it. Data the driver throws away (see
    /// [`publish`](DriverHandle::publish)) gives its room back at once.
    pub async fn publish_wait(&self, addr: A, data: Bytes) {
        let queued = self.queue.wait(data.len() + PUBLISH_QUEUE_OVERHEAD).await;
        let _ = self.tx.send(DriverEvent::Data {
            generation: self.generation,
            addr,
            payload: data,
            queued,
        });
    }

    /// Tell the driver the southbound connection has gone, after
    /// [`connect`](crate::Handler::connect) had succeeded.
    ///
    /// The driver reports status `CONN` or `AUTH` to the edge agent
    /// according to `reason` (use [`error`](DriverHandle::error) for
    /// `ERR`), stops publishing data, and calls
    /// `connect` again after the configured reconnect delay, retrying
    /// until it succeeds. Further reports while that is in progress
    /// are ignored.
    pub fn disconnected(&self, reason: ConnectError) {
        let _ = self.tx.send(DriverEvent::Lost {
            generation: self.generation,
            status: status_for(reason),
        });
    }

    /// As [`disconnected`](DriverHandle::disconnected), for an error
    /// that is neither a connection nor an authentication failure,
    /// such as a protocol error. The driver reports status `ERR` and
    /// reconnects.
    pub fn error(&self) {
        let _ = self.tx.send(DriverEvent::Lost {
            generation: self.generation,
            status: Status::Err,
        });
    }
}

/// The address configuration packet sent by the edge agent.
#[derive(Deserialize)]
struct AddrConfig {
    version: u32,
    addrs: HashMap<String, String>,
    /// Each device's poll interval and data topics. Older agents may
    /// leave it out.
    #[serde(default)]
    groups: HashMap<String, GroupConfig>,
}

/// One entry of the address configuration's `groups`.
#[derive(Deserialize)]
struct GroupConfig {
    /// The poll interval in milliseconds.
    #[serde(default)]
    poll: Option<f64>,
    /// Data topics.
    #[serde(default)]
    addrs: Vec<String>,
}

/// Work done on a handler, one at a time and in order, by its own
/// task.
enum Op<A> {
    Parse {
        seq: u64,
        raw: HashMap<String, String>,
    },
    Subscribe(Vec<A>, Vec<AddrGroup<A>>),
    Cmd(String, Bytes),
    /// A typed write, with the data topic to report a failure on and
    /// the id to answer, if the agent is waiting for an answer.
    Write {
        topic: String,
        addr: A,
        value: WriteValue,
        id: Option<String>,
    },
}

/// One `poll` message's worth of addresses.
struct PollJob<H: Handler> {
    generation: u64,
    handler: Arc<Mutex<H>>,
    poller: Option<Arc<dyn Poller<H::Addr>>>,
    polls: Vec<(String, H::Addr)>,
}

/// A handler's op queue and the task working through it.
type OpQueue<A> = (mpsc::UnboundedSender<Op<A>>, JoinHandle<()>);

/// A message for the publisher task: topic, QoS, payload, and for data
/// its share of the publish queue.
type Outbound = (String, QoS, Bytes, Option<Queued>);

/// What the driver loop uses to talk to the MQTT session.
struct Session<H: Handler> {
    /// Messages for the publisher task, which sends them in order.
    outbound: mpsc::UnboundedSender<Outbound>,
    poll_tx: mpsc::Sender<PollJob<H>>,
}

/// The driver runtime. Manages the MQTT connection to the edge agent,
/// handler lifecycle, and data flow.
///
/// Generic over the [`Handler`] implementation, which defines the
/// device-specific protocol logic.
///
/// The MQTT loop never waits for the handler: `connect`, the retries
/// after a failed connect, address parsing, `subscribe`, `cmd`,
/// `write`, `poll` and `close` all run on other tasks, so pings keep flowing to the
/// edge agent however long the device takes.
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
    options: DriverOptions,
    status: Status,
    handler: Option<Arc<Mutex<H>>>,
    /// Counts handlers created, so events from an old one are ignored.
    generation: u64,
    /// The generation whose data may be published now, or 0 if none
    /// (the status isn't `UP`). Shared with the poll tasks.
    live: Arc<AtomicU64>,
    /// Whether the current handler's `connect` has succeeded and it
    /// hasn't reported a lost connection since.
    connected: bool,
    poller: Option<Arc<dyn Poller<H::Addr>>>,
    /// The current handler's op queue and the task working through it.
    ops: Option<OpQueue<H::Addr>>,
    /// A `connect` (or the wait before one) in progress.
    connecting: Option<JoinHandle<()>>,
    /// Closing of replaced handlers, which a new handler's first
    /// `connect` waits for.
    closing: Option<JoinHandle<()>>,
    /// topic → parsed address
    addrs: HashMap<String, H::Addr>,
    /// parsed address → topic (reverse lookup for async publishing)
    topics: HashMap<H::Addr, String>,
    /// address string → topic, for writes
    addr_topics: HashMap<String, String>,
    /// The groups from the latest address configuration: name, poll
    /// interval and data topics.
    groups: Vec<(String, Duration, Vec<String>)>,
    addr_seq: u64,
    /// The address map being parsed, if any. Messages that depend on
    /// it wait in `deferred` until it is done.
    parsing: Option<u64>,
    deferred: VecDeque<Publish>,
    tx: mpsc::UnboundedSender<DriverEvent<H::Addr>>,
    rx: Option<mpsc::UnboundedReceiver<DriverEvent<H::Addr>>>,
    /// Data published by handlers and not yet sent.
    queue: Arc<PublishQueue>,
}

impl<H: Handler + 'static> Driver<H> {
    /// Create a new driver with the given configuration.
    pub fn new(config: DriverConfig) -> Self {
        Self::with_options(config, DriverOptions::default())
    }

    /// Create a new driver with the given configuration and options.
    pub fn with_options(config: DriverConfig, options: DriverOptions) -> Self {
        let (tx, rx) = mpsc::unbounded_channel();
        let queue = PublishQueue::new(options.publish_queue_bytes);
        Self {
            queue,
            config,
            options,
            status: Status::Down,
            handler: None,
            generation: 0,
            live: Arc::new(AtomicU64::new(0)),
            connected: false,
            poller: None,
            ops: None,
            connecting: None,
            closing: None,
            addrs: HashMap::new(),
            topics: HashMap::new(),
            addr_topics: HashMap::new(),
            groups: Vec::new(),
            addr_seq: 0,
            parsing: None,
            deferred: VecDeque::new(),
            tx,
            rx: Some(rx),
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
    /// 1. Connect to MQTT broker, subscribe, publish status `READY`
    /// 2. Receive device config → call `Handler::create`
    /// 3. Call `Handler::connect` → status `UP` on success; on failure
    ///    status `CONN`, `AUTH` or `ERR` and retry after the reconnect
    ///    delay
    /// 4. Receive address mappings → call `Handler::parse_addr`
    /// 5. **Polled**: respond to poll requests via `Handler::poll` (or
    ///    the handler's [`Poller`])
    ///    **Async**: call `Handler::subscribe`, receive data via `DriverHandle::publish`
    /// 6. On reconfiguration: call `Handler::close`, restart from step 2
    /// 7. On `active OFFLINE`: call `Handler::close` and wait for a new
    ///    config
    pub async fn run(&mut self) -> Result<(), Error> {
        tracing::info!(
            mqtt = %self.config.mqtt_url,
            id = %self.config.username,
            "driver starting"
        );

        let mut rx = self
            .rx
            .take()
            .ok_or_else(|| Error::Other("Driver::run is already running".into()))?;

        loop {
            tracing::info!("connecting to MQTT broker");
            match self.mqtt_session(&mut rx).await {
                Ok(()) => tracing::info!("MQTT session ended cleanly"),
                Err(e) => tracing::error!(%e, "MQTT session error"),
            }

            // Clean up the handler before connecting again.
            self.close_handler();
            if let Some(closing) = self.closing.take() {
                let _ = closing.await;
            }
            self.status = Status::Down;
            self.live.store(0, Ordering::SeqCst);

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
        rx: &mut mpsc::UnboundedReceiver<DriverEvent<H::Addr>>,
    ) -> Result<(), Error> {
        let (client, eventloop) = self.connect_mqtt()?;
        let (net_tx, mut net_rx) = mpsc::channel(NETWORK_QUEUE);
        let network = tokio::spawn(Self::network(eventloop, net_tx));

        // Subscribe to our control topics. READY goes out when the
        // SUBACK comes back, as the spec asks.
        // The agent sends each write as raw bytes on cmd/ and typed on
        // write/. Take only the form the handler wants.
        let writes = if H::TYPED_WRITES { "write/#" } else { "cmd/#" };
        let subs = ["active", "conf", "addr", "poll", writes]
            .iter()
            .map(|s| SubscribeFilter::new(self.topic(s), QoS::AtMostOnce))
            .collect::<Vec<_>>();
        client
            .subscribe_many(subs)
            .await
            .map_err(|e| Error::Mqtt(e.to_string()))?;

        let (out_tx, out_rx) = mpsc::unbounded_channel();
        let publisher = tokio::spawn(Self::publisher(client.clone(), out_rx));

        let (poll_tx, poll_rx) = mpsc::channel::<PollJob<H>>(POLL_QUEUE_MAX);
        let poll_worker = tokio::spawn(Self::poll_worker(
            poll_rx,
            client.clone(),
            self.config.username.clone(),
            self.config.serial_poll,
            self.options.poll_timeout,
            self.live.clone(),
        ));

        let session = Session {
            outbound: out_tx,
            poll_tx,
        };

        // Main event loop. Nothing in it waits for the handler, so the
        // MQTT event loop is always polled and pings go out on time.
        let result: Result<(), Error> = loop {
            tokio::select! {
                event = net_rx.recv() => {
                    match event {
                        Some(Ok(Incoming::SubAck(_))) => {
                            self.set_status(&session, Status::Ready);
                        }
                        Some(Ok(Incoming::Publish(publish))) => {
                            self.on_publish(&session, publish);
                        }
                        Some(Ok(_)) => {}
                        Some(Err(e)) => break Err(Error::Mqtt(e)),
                        None => break Err(Error::Mqtt("MQTT event loop stopped".into())),
                    }
                }
                Some(event) = rx.recv() => {
                    self.on_event(&session, event);
                }
            }
        };

        network.abort();
        publisher.abort();
        poll_worker.abort();
        result
    }

    /// Run rumqttc's event loop on its own task, passing what arrives
    /// to the driver loop.
    ///
    /// `EventLoop::poll` writes queued packets to the socket inside
    /// the future it returns. If that future is dropped part way
    /// through a write, as it is when it loses a `select!` race, the
    /// bytes already written are sent again by the next `poll`, and
    /// the broker can no longer parse the stream. That happens
    /// whenever the edge agent reads more slowly than the driver
    /// publishes, so `poll` must only ever be awaited to completion.
    async fn network(mut eventloop: EventLoop, tx: mpsc::Sender<Result<Incoming, String>>) {
        loop {
            match eventloop.poll().await {
                Ok(Event::Incoming(incoming)) => {
                    if tx.send(Ok(incoming)).await.is_err() {
                        return;
                    }
                }
                Ok(Event::Outgoing(_)) => {}
                Err(e) => {
                    let _ = tx.send(Err(e.to_string())).await;
                    return;
                }
            }
        }
    }

    /// Send messages from the driver loop to the broker, in order.
    ///
    /// `AsyncClient::publish` waits when rumqttc's request queue is
    /// full, and only the driver loop empties that queue, so the loop
    /// must never call it itself.
    async fn publisher(client: AsyncClient, mut rx: mpsc::UnboundedReceiver<Outbound>) {
        while let Some((topic, qos, payload, queued)) = rx.recv().await {
            if let Err(e) = client.publish(&topic, qos, false, payload).await {
                tracing::error!(%e, %topic, "failed to publish");
            }
            // The message is the MQTT client's now.
            drop(queued);
        }
    }

    /// Background task that runs poll requests from the channel.
    ///
    /// In parallel mode up to `POLL_QUEUE_MAX` batches run at once; in
    /// serial mode one batch runs at a time.
    async fn poll_worker(
        mut poll_rx: mpsc::Receiver<PollJob<H>>,
        client: AsyncClient,
        id: String,
        serial: bool,
        timeout: Duration,
        live: Arc<AtomicU64>,
    ) {
        let slots = Arc::new(Semaphore::new(if serial { 1 } else { POLL_QUEUE_MAX }));
        // Dropping the set when this task is aborted aborts the polls.
        let mut running = JoinSet::new();

        loop {
            let Ok(permit) = slots.clone().acquire_owned().await else {
                return;
            };
            let Some(job) = poll_rx.recv().await else {
                return;
            };
            while running.try_join_next().is_some() {}

            let client = client.clone();
            let id = id.clone();
            let live = live.clone();
            running.spawn(async move {
                Self::run_batch(job, &client, &id, serial, timeout, &live).await;
                drop(permit);
            });
        }
    }

    /// Poll every address in a batch and publish the results.
    async fn run_batch(
        job: PollJob<H>,
        client: &AsyncClient,
        id: &str,
        serial: bool,
        timeout: Duration,
        live: &AtomicU64,
    ) {
        if serial {
            for (topic, addr) in &job.polls {
                let result = Self::poll_one(&job, addr, timeout).await;
                Self::publish_poll(client, id, live, job.generation, topic, result).await;
            }
        } else {
            futures::future::join_all(job.polls.iter().map(|(topic, addr)| async {
                let result = Self::poll_one(&job, addr, timeout).await;
                Self::publish_poll(client, id, live, job.generation, topic, result).await;
            }))
            .await;
        }
    }

    /// Poll one address. The timeout starts once the poll has started,
    /// so time spent waiting for the handler lock doesn't count.
    async fn poll_one(
        job: &PollJob<H>,
        addr: &H::Addr,
        timeout: Duration,
    ) -> Result<Option<Bytes>, tokio::time::error::Elapsed> {
        match &job.poller {
            Some(poller) => tokio::time::timeout(timeout, poller.poll(addr)).await,
            None => {
                let mut handler = job.handler.lock().await;
                tokio::time::timeout(timeout, handler.poll(addr)).await
            }
        }
    }

    async fn publish_poll(
        client: &AsyncClient,
        id: &str,
        live: &AtomicU64,
        generation: u64,
        topic: &str,
        result: Result<Option<Bytes>, tokio::time::error::Elapsed>,
    ) {
        match result {
            Ok(Some(data)) => {
                // The spec forbids data unless the status is UP, and a
                // replaced handler's topics may now mean something else.
                if live.load(Ordering::SeqCst) != generation {
                    return;
                }
                let mtopic = format!("fpEdge1/{id}/data/{topic}");
                if let Err(e) = client.publish(&mtopic, QoS::AtMostOnce, false, data).await {
                    tracing::error!(%e, %topic, "failed to publish poll data");
                }
            }
            Ok(None) => {}
            Err(_) => tracing::warn!(%topic, "poll timed out"),
        }
    }

    /// Create the MQTT client and set up connection options.
    fn connect_mqtt(&self) -> Result<(AsyncClient, EventLoop), Error> {
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
        opts.set_keep_alive(self.options.keep_alive);
        opts.set_max_packet_size(self.options.max_packet_size, self.options.max_packet_size);

        let (client, mut eventloop) = AsyncClient::new(opts, 64);
        // Without no-delay, Nagle's algorithm holds every value after
        // the first in a burst until the agent ACKs the first, which
        // an agent that has just sent us something delays by about
        // 40 ms. Those values then miss the DDATA the agent builds
        // from the values that arrive together.
        let mut network = eventloop.network_options();
        network.set_tcp_nodelay(true);
        eventloop.set_network_options(network);
        Ok((client, eventloop))
    }

    /// Handle an incoming MQTT message.
    fn on_publish(&mut self, session: &Session<H>, publish: Publish) {
        let prefix = self.topic("");
        let suffix = publish
            .topic
            .strip_prefix(&prefix)
            .unwrap_or(&publish.topic);

        // Split into message type and optional data
        let (msg, data) = match suffix.split_once('/') {
            Some((m, d)) => (m.to_owned(), Some(d.to_owned())),
            None => (suffix.to_owned(), None),
        };

        match msg.as_str() {
            "active" => self.on_active(session, &publish.payload),
            "conf" => self.on_conf(session, &publish.payload),
            // Everything else depends on the address map, so it waits
            // for one being parsed.
            _ if self.parsing.is_some() => self.defer(publish),
            "addr" => self.on_addr(session, &publish.payload),
            "poll" => self.on_poll(session, &publish.payload),
            // Only one form of a write is subscribed to. Ignore the
            // other in case a broker delivers it anyway, so a value is
            // never written twice.
            "cmd" if H::TYPED_WRITES => {}
            "write" if !H::TYPED_WRITES => {}
            "cmd" => {
                if let Some(name) = data {
                    self.on_cmd(name, publish.payload);
                }
            }
            "write" => {
                if let Some(addr) = data {
                    self.on_write(session, addr, &publish.payload);
                }
            }
            other => {
                tracing::warn!(msg = other, "unhandled message type");
            }
        }
    }

    fn defer(&mut self, publish: Publish) {
        if self.deferred.len() >= DEFER_MAX {
            tracing::warn!(topic = %publish.topic, "too many messages waiting for addresses, dropping");
            return;
        }
        self.deferred.push_back(publish);
    }

    /// Handle `active` message from the edge agent.
    fn on_active(&mut self, session: &Session<H>, payload: &[u8]) {
        match payload {
            b"ONLINE" => {
                tracing::info!("edge agent online");
                // READY makes the agent send conf and addr again.
                self.set_status(session, Status::Ready);
            }
            b"OFFLINE" => {
                // The spec says to discard the configuration, revert to
                // READY and disconnect from the device. READY is not
                // published: the agent has closed this connection, and
                // READY would make it send the old conf again. It goes
                // out when the agent sends ONLINE.
                tracing::info!("edge agent offline, closing handler");
                self.close_handler();
                self.status = Status::Ready;
                self.live.store(0, Ordering::SeqCst);
            }
            other => {
                tracing::warn!(payload = ?String::from_utf8_lossy(other), "unknown active message");
            }
        }
    }

    /// Handle `conf` message — create a new handler.
    fn on_conf(&mut self, session: &Session<H>, payload: &[u8]) {
        let conf: serde_json::Value = match serde_json::from_slice(payload) {
            Ok(v) => v,
            Err(e) => {
                tracing::error!(%e, "failed to parse conf JSON");
                self.set_status(session, Status::Conf);
                return;
            }
        };

        // The config may contain secrets from the edge agent.
        tracing::debug!(conf = ?redact(&conf), "received device configuration");

        self.close_handler();
        self.generation += 1;

        let handle = DriverHandle::new(self.tx.clone(), self.generation, self.queue.clone());
        match H::create(handle, conf) {
            Ok(handler) => {
                let handler = Arc::new(Mutex::new(handler));
                let (ops_tx, ops_rx) = mpsc::unbounded_channel();
                let worker = tokio::spawn(Self::ops_worker(
                    handler.clone(),
                    self.generation,
                    ops_rx,
                    self.tx.clone(),
                ));
                self.ops = Some((ops_tx, worker));
                self.handler = Some(handler);
                self.start_connect(Duration::ZERO);
            }
            Err(e) => {
                tracing::error!(reason = %e, "handler rejected configuration");
                self.set_status(session, Status::Conf);
            }
        }
    }

    /// Run `connect` on its own task after `delay`, unless a connect
    /// is already in progress. The result comes back as
    /// [`DriverEvent::Connected`].
    fn start_connect(&mut self, delay: Duration) {
        if self.connecting.is_some() {
            return;
        }
        let Some(handler) = self.handler.clone() else {
            return;
        };
        let generation = self.generation;
        let tx = self.tx.clone();
        let closing = self.closing.take();

        self.connecting = Some(tokio::spawn(async move {
            // A replaced handler must be closed before this one
            // connects, as they may share a device.
            if let Some(closing) = closing {
                let _ = closing.await;
            }
            tokio::time::sleep(delay).await;

            let mut h = handler.lock().await;
            let result = h.connect().await;
            let poller = if result.is_ok() { h.poller() } else { None };
            drop(h);

            let _ = tx.send(DriverEvent::Connected {
                generation,
                result,
                poller,
            });
        }));
    }

    /// Do handler work in order: address parsing, `subscribe`, `cmd`
    /// and `write`.
    async fn ops_worker(
        handler: Arc<Mutex<H>>,
        generation: u64,
        mut ops: mpsc::UnboundedReceiver<Op<H::Addr>>,
        tx: mpsc::UnboundedSender<DriverEvent<H::Addr>>,
    ) {
        while let Some(op) = ops.recv().await {
            let mut h = handler.lock().await;
            match op {
                Op::Parse { seq, raw } => {
                    let mut parsed = Some(Vec::with_capacity(raw.len()));
                    for (topic, addr) in raw {
                        match h.parse_addr(&addr) {
                            Some(a) => parsed.as_mut().unwrap().push((topic, addr, a)),
                            None => {
                                tracing::error!(addr, "handler rejected address");
                                parsed = None;
                                break;
                            }
                        }
                    }
                    drop(h);
                    let _ = tx.send(DriverEvent::Parsed {
                        generation,
                        seq,
                        addrs: parsed,
                    });
                }
                Op::Subscribe(specs, groups) => {
                    if !h.subscribe_groups(&specs, &groups).await {
                        tracing::error!("handler subscription failed");
                    }
                }
                Op::Cmd(name, payload) => h.cmd(&name, payload).await,
                Op::Write {
                    topic,
                    addr,
                    value,
                    id,
                } => {
                    let result = h.write(&addr, value).await;
                    if result.is_err() || id.is_some() {
                        let _ = tx.send(DriverEvent::WriteDone {
                            generation,
                            topic,
                            id,
                            result,
                        });
                    }
                }
            }
        }
    }

    fn send_op(&self, op: Op<H::Addr>) -> bool {
        match &self.ops {
            Some((tx, _)) => tx.send(op).is_ok(),
            None => false,
        }
    }

    /// Handle `addr` message — parse and store address mappings.
    fn on_addr(&mut self, session: &Session<H>, payload: &[u8]) {
        let pkt: AddrConfig = match serde_json::from_slice(payload) {
            Ok(v) => v,
            Err(e) => {
                tracing::error!(%e, "failed to parse addr JSON");
                self.set_status(session, Status::Addr);
                return;
            }
        };

        if pkt.version != 1 {
            tracing::error!(version = pkt.version, "unsupported addr config version");
            self.set_status(session, Status::Addr);
            return;
        }

        if self.handler.is_none() {
            tracing::warn!("received addrs without handler");
            return;
        }

        // parse_addr needs the handler, which may be busy (in connect,
        // say), so parse on the handler's own task and hold back
        // anything that depends on the result.
        let mut groups: Vec<_> = pkt
            .groups
            .into_iter()
            .map(|(name, g)| {
                let poll = g
                    .poll
                    .filter(|p| p.is_finite() && *p >= 0.0)
                    .map(|p| Duration::from_secs_f64(p / 1000.0))
                    .unwrap_or_default();
                (name, poll, g.addrs)
            })
            .collect();
        groups.sort_by(|a, b| a.0.cmp(&b.0));
        self.groups = groups;

        self.addr_seq += 1;
        let seq = self.addr_seq;
        if self.send_op(Op::Parse {
            seq,
            raw: pkt.addrs,
        }) {
            self.parsing = Some(seq);
        }
    }

    /// An address map has been parsed: store it, then handle the
    /// messages that were waiting for it.
    fn on_parsed(&mut self, session: &Session<H>, addrs: Option<Vec<(String, String, H::Addr)>>) {
        self.parsing = None;
        self.clear_addrs();

        match addrs {
            Some(addrs) => {
                for (topic, raw, parsed) in addrs {
                    self.topics.insert(parsed.clone(), topic.clone());
                    self.addr_topics.insert(raw, topic.clone());
                    self.addrs.insert(topic, parsed);
                }
                tracing::info!(count = self.addrs.len(), "addresses configured");
                if self.status == Status::Addr && self.connected {
                    self.set_status(session, Status::Up);
                }
                self.try_subscribe();
            }
            None => self.set_status(session, Status::Addr),
        }

        while self.parsing.is_none() {
            let Some(publish) = self.deferred.pop_front() else {
                break;
            };
            self.on_publish(session, publish);
        }
    }

    /// Handle `poll` message — resolve topics and send to the poll worker.
    ///
    /// This returns immediately without awaiting any handler calls,
    /// keeping the MQTT event loop responsive. If the poll queue is
    /// full, the request is dropped (backpressure).
    fn on_poll(&self, session: &Session<H>, payload: &[u8]) {
        if !H::SUPPORTS_POLL {
            return;
        }
        if self.status != Status::Up {
            tracing::debug!(status = %self.status, "ignoring poll while not UP");
            return;
        }
        let Some(handler) = self.handler.clone() else {
            return;
        };

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

        let job = PollJob {
            generation: self.generation,
            handler,
            poller: self.poller.clone(),
            polls,
        };
        if session.poll_tx.try_send(job).is_err() {
            tracing::warn!("poll queue full, dropping request");
        }
    }

    /// Handle `cmd` message — queue it for the handler.
    fn on_cmd(&self, command: String, payload: Bytes) {
        self.send_op(Op::Cmd(command, payload));
    }

    /// Handle a typed `write` — queue it for the handler, or report it
    /// as `CMD` if it can't be used.
    fn on_write(&self, session: &Session<H>, addr: String, payload: &[u8]) {
        let id = WriteValue::id_of(payload);
        let Some(topic) = self.addr_topics.get(&addr).cloned() else {
            tracing::warn!(addr, "write to an address not in the address map");
            if let Some(id) = id {
                let error = WriteError::BadValue("address not in the address map".into());
                self.report_write_result(session, &id, Err(&error));
            }
            return;
        };
        let Some(parsed) = self.addrs.get(&topic).cloned() else {
            return;
        };
        match WriteValue::from_json(payload) {
            Ok(value) => {
                self.send_op(Op::Write {
                    topic,
                    addr: parsed,
                    value,
                    id,
                });
            }
            Err(e) => {
                let error = WriteError::BadValue(e);
                match id {
                    Some(id) => self.report_write_result(session, &id, Err(&error)),
                    None => self.report_write_error(session, &topic, &error),
                }
            }
        }
    }

    /// Publish a failed write on `err/{topic}` as the code, a newline
    /// and the message.
    fn report_write_error(&self, session: &Session<H>, topic: &str, error: &WriteError) {
        tracing::warn!(topic, %error, "write failed");
        let payload = format!("{}\n{}", error.code(), error.message());
        let _ = session.outbound.send((
            self.topic_with("err", topic),
            QoS::AtLeastOnce,
            Bytes::from(payload),
            None,
        ));
    }

    /// Answer a write the agent is waiting for on `result/{id}`: empty
    /// if it was written, otherwise the code, a newline and the
    /// message.
    fn report_write_result(&self, session: &Session<H>, id: &str, result: Result<(), &WriteError>) {
        let payload = match result {
            Ok(()) => String::new(),
            Err(error) => {
                tracing::warn!(id, %error, "write failed");
                format!("{}\n{}", error.code(), error.message())
            }
        };
        let _ = session.outbound.send((
            self.topic_with("result", id),
            QoS::AtLeastOnce,
            Bytes::from(payload),
            None,
        ));
    }

    /// Queue handler.subscribe() if we're UP and have addresses.
    fn try_subscribe(&self) {
        if self.status != Status::Up || self.addrs.is_empty() {
            return;
        }
        let specs: Vec<H::Addr> = self.addrs.values().cloned().collect();
        let groups = self
            .groups
            .iter()
            .map(|(name, poll, topics)| AddrGroup {
                name: name.clone(),
                poll: *poll,
                addrs: topics
                    .iter()
                    .filter_map(|t| self.addrs.get(t).cloned())
                    .collect(),
            })
            .collect();
        self.send_op(Op::Subscribe(specs, groups));
    }

    /// Handle an event from a handler or a background task.
    fn on_event(&mut self, session: &Session<H>, event: DriverEvent<H::Addr>) {
        match event {
            DriverEvent::Data {
                generation,
                addr,
                payload,
                queued,
            } => {
                if generation != self.generation || self.status != Status::Up {
                    return;
                }
                // The edge agent only recognises data published on the topic
                // name it assigned (see `self.topics`); an address it no
                // longer knows about (e.g. after reconfiguration) has
                // nowhere to go and is dropped, matching the JS/Python
                // drivers' behaviour.
                let Some(topic) = self.topics.get(&addr) else {
                    return;
                };
                let mtopic = self.topic_with("data", topic);
                let _ = session
                    .outbound
                    .send((mtopic, QoS::AtMostOnce, payload, Some(queued)));
            }
            DriverEvent::Lost { generation, status } => {
                if generation != self.generation
                    || self.handler.is_none()
                    || self.connecting.is_some()
                {
                    return;
                }
                tracing::warn!(%status, "handler lost its connection, reconnecting");
                self.connected = false;
                self.set_status(session, status);
                self.start_connect(self.config.reconnect_delay);
            }
            DriverEvent::Connected {
                generation,
                result,
                poller,
            } => {
                if generation != self.generation {
                    return;
                }
                self.connecting = None;
                match result {
                    Ok(()) => {
                        self.connected = true;
                        self.poller = poller;
                        self.set_status(session, Status::Up);
                        self.try_subscribe();
                    }
                    Err(reason) => {
                        tracing::warn!(?reason, "handler connection failed, retrying");
                        self.set_status(session, status_for(reason));
                        self.start_connect(self.config.reconnect_delay);
                    }
                }
            }
            DriverEvent::Parsed {
                generation,
                seq,
                addrs,
            } => {
                if generation == self.generation && self.parsing == Some(seq) {
                    self.on_parsed(session, addrs);
                }
            }
            DriverEvent::WriteDone {
                generation,
                topic,
                id,
                result,
            } => match id {
                // The agent is waiting for this answer, and the write
                // has happened or not whatever has changed since.
                Some(id) => self.report_write_result(session, &id, result.as_ref().map(|_| ())),
                None if generation == self.generation => {
                    if let Err(error) = result {
                        self.report_write_error(session, &topic, &error);
                    }
                }
                None => {}
            },
        }
    }

    fn clear_addrs(&mut self) {
        self.addrs.clear();
        self.topics.clear();
        self.addr_topics.clear();
    }

    /// Close the current handler (if any) and reset address state.
    ///
    /// The handler finishes its queued work and is closed on its own
    /// task; the next handler's first `connect` waits for that.
    fn close_handler(&mut self) {
        if let Some(connecting) = self.connecting.take() {
            connecting.abort();
        }
        self.connected = false;
        self.poller = None;
        self.live.store(0, Ordering::SeqCst);
        self.parsing = None;
        self.deferred.clear();
        self.clear_addrs();
        self.groups.clear();

        let Some(handler) = self.handler.take() else {
            return;
        };
        let ops = self.ops.take();
        let previous = self.closing.take();
        self.closing = Some(tokio::spawn(async move {
            if let Some(previous) = previous {
                let _ = previous.await;
            }
            if let Some((tx, worker)) = ops {
                drop(tx);
                let _ = worker.await;
            }
            handler.lock().await.close().await;
        }));
    }

    fn set_status(&mut self, session: &Session<H>, status: Status) {
        self.status = status;
        let live = if status == Status::Up {
            self.generation
        } else {
            0
        };
        self.live.store(live, Ordering::SeqCst);
        tracing::info!(%status, "driver status changed");
        let topic = self.topic("status");
        let _ = session.outbound.send((
            topic,
            QoS::AtLeastOnce,
            Bytes::from(status.to_string()),
            None,
        ));
    }
}

/// The status to report for a failed or lost southbound connection.
fn status_for(reason: ConnectError) -> Status {
    match reason {
        ConnectError::ConnectionFailed => Status::Conn,
        ConnectError::AuthFailed => Status::Auth,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bytes(q: &PublishQueue) -> usize {
        q.bytes.load(Ordering::Relaxed)
    }

    #[test]
    fn reserve_stops_at_the_limit_and_drop_gives_back() {
        let q = PublishQueue::new(100);
        let a = q.reserve(60).expect("empty queue takes it");
        assert!(q.reserve(50).is_none(), "60 + 50 is over 100");
        let b = q.reserve(40).expect("60 + 40 is exactly the limit");
        assert_eq!(bytes(&q), 100);
        drop(a);
        assert_eq!(bytes(&q), 40);
        drop(b);
        assert_eq!(bytes(&q), 0);
    }

    #[test]
    fn empty_queue_takes_a_message_over_the_limit() {
        let q = PublishQueue::new(10);
        let big = q.reserve(1000).expect("nothing else is waiting");
        assert!(q.reserve(1).is_none());
        drop(big);
        assert!(q.reserve(1).is_some());
    }

    #[test]
    fn force_ignores_the_limit_but_counts() {
        let q = PublishQueue::new(10);
        let forced = q.force(50);
        assert_eq!(bytes(&q), 50);
        assert!(
            q.reserve(1).is_none(),
            "forced bytes count towards the limit"
        );
        drop(forced);
        assert_eq!(bytes(&q), 0);
    }

    #[tokio::test]
    async fn wait_takes_room_as_it_is_given_back() {
        let q = PublishQueue::new(100);
        let a = q.reserve(80).unwrap();
        let waiter = tokio::spawn({
            let q = q.clone();
            async move { q.wait(50).await }
        });
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(!waiter.is_finished(), "80 + 50 is over 100");
        drop(a);
        let b = tokio::time::timeout(std::time::Duration::from_secs(1), waiter)
            .await
            .expect("woken when room was given back")
            .unwrap();
        assert_eq!(bytes(&q), 50);
        drop(b);
        assert_eq!(bytes(&q), 0);
    }
}

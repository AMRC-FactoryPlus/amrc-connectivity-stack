//! A fake Edge Agent for driver-loop tests.
//!
//! [`FakeAgent`] is a minimal MQTT 3.1.1 broker that accepts the
//! driver's connection and plays the Edge Agent's side of the split
//! driver protocol (`acs-edge/docs/edge-split.md`). It answers pings,
//! counts them, and drops a client that goes quiet for 1.5 times its
//! keep-alive, as a real broker would. Messages the driver publishes
//! come back to the test as [`FromDriver`] events.

#![allow(dead_code)]

pub mod handler;

use std::any::Any;
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use bytes::{Bytes, BytesMut};
use rs_edge_driver::{Driver, DriverConfig, DriverOptions, Handler};
use rumqttc::mqttbytes::v4::{
    ConnAck, ConnectReturnCode, Packet, PingResp, PubAck, Publish, SubAck, SubscribeReasonCode,
};
use rumqttc::mqttbytes::{Error as MqttError, QoS};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio::time::Instant;

/// The largest packet the fake broker will read or write.
const BROKER_MAX_PACKET: usize = 64 * 1024 * 1024;

/// Something the driver did, as seen by the agent.
#[derive(Debug, Clone)]
pub enum FromDriver {
    /// A message on `fpEdge1/<id>/status`.
    Status(String),
    /// A message on `fpEdge1/<id>/data/<topic>`.
    Data { topic: String, payload: Bytes },
    /// A message on any other topic.
    Other { topic: String, payload: Bytes },
    /// The driver's MQTT connection closed, or the broker dropped it.
    Disconnected,
}

/// Counters kept by the fake broker.
#[derive(Default)]
pub struct Stats {
    /// MQTT CONNECTs accepted.
    pub connects: AtomicUsize,
    /// PINGREQs answered.
    pub pings: AtomicUsize,
    /// Connections dropped because the keep-alive ran out.
    pub expired: AtomicUsize,
    /// Every topic filter the driver has subscribed to, in order.
    pub subscriptions: Mutex<Vec<String>>,
}

impl Stats {
    pub fn connects(&self) -> usize {
        self.connects.load(Ordering::SeqCst)
    }
    pub fn pings(&self) -> usize {
        self.pings.load(Ordering::SeqCst)
    }
    pub fn expired(&self) -> usize {
        self.expired.load(Ordering::SeqCst)
    }
    pub fn subscriptions(&self) -> Vec<String> {
        self.subscriptions.lock().unwrap().clone()
    }
}

type ConnSender = mpsc::UnboundedSender<Publish>;

/// The agent side of the protocol, with its own broker.
pub struct FakeAgent {
    pub id: String,
    pub port: u16,
    pub stats: Arc<Stats>,
    events: mpsc::UnboundedReceiver<FromDriver>,
    conn: Arc<Mutex<Option<ConnSender>>>,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for FakeAgent {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl FakeAgent {
    /// Start a broker on a free local port.
    pub async fn start(id: &str) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let stats = Arc::new(Stats::default());
        let conn = Arc::new(Mutex::new(None));
        let (ev_tx, events) = mpsc::unbounded_channel();

        let task = tokio::spawn(accept_loop(
            listener,
            id.to_owned(),
            stats.clone(),
            conn.clone(),
            ev_tx,
        ));

        Self {
            id: id.to_owned(),
            port,
            stats,
            events,
            conn,
            task,
        }
    }

    /// A driver config pointing at this broker, with short delays
    /// suited to tests.
    pub fn config(&self) -> DriverConfig {
        let mut c = DriverConfig::new(
            format!("mqtt://127.0.0.1:{}", self.port),
            self.id.clone(),
            "password",
        );
        c.reconnect_delay = Duration::from_millis(200);
        c
    }

    /// Publish `payload` to the driver on `fpEdge1/<id>/<msg>`.
    pub fn send(&self, msg: &str, payload: impl Into<Vec<u8>>) {
        let topic = format!("fpEdge1/{}/{}", self.id, msg);
        let tx = self.conn.lock().unwrap().clone();
        let tx = tx.expect("driver is not connected");
        tx.send(Publish::new(topic, QoS::AtMostOnce, payload))
            .expect("driver connection has gone");
    }

    /// Send an address map in the agent's format.
    pub fn send_addrs(&self, addrs: &[(&str, &str)]) {
        let map: serde_json::Map<String, serde_json::Value> = addrs
            .iter()
            .map(|(t, a)| ((*t).to_owned(), serde_json::Value::from(*a)))
            .collect();
        let pkt = serde_json::json!({ "version": 1, "addrs": map, "groups": {} });
        self.send("addr", pkt.to_string());
    }

    /// The next event from the driver, or `None` after `within`.
    pub async fn next(&mut self, within: Duration) -> Option<FromDriver> {
        tokio::time::timeout(within, self.events.recv())
            .await
            .ok()
            .flatten()
    }

    /// Wait for a status message, skipping anything else. Panics,
    /// listing what it saw, if `status` doesn't come within `within`.
    pub async fn wait_status(&mut self, status: &str, within: Duration) -> Vec<FromDriver> {
        let deadline = Instant::now() + within;
        let mut seen = Vec::new();
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match self.next(left).await {
                Some(FromDriver::Status(s)) if s == status => return seen,
                Some(ev) => seen.push(ev),
                None => panic!("no {status} status within {within:?}; saw {seen:?}"),
            }
        }
    }

    /// Collect data messages until `n` have arrived or `within` runs
    /// out, skipping other events.
    pub async fn collect_data(&mut self, n: usize, within: Duration) -> Vec<(String, Bytes)> {
        let deadline = Instant::now() + within;
        let mut out = Vec::new();
        while out.len() < n {
            let left = deadline.saturating_duration_since(Instant::now());
            match self.next(left).await {
                Some(FromDriver::Data { topic, payload }) => out.push((topic, payload)),
                Some(_) => {}
                None => break,
            }
        }
        out
    }

    /// Collect every event until `within` has passed.
    pub async fn drain(&mut self, within: Duration) -> Vec<FromDriver> {
        let deadline = Instant::now() + within;
        let mut out = Vec::new();
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return out;
            }
            match self.next(left).await {
                Some(ev) => out.push(ev),
                None => return out,
            }
        }
    }

    /// The usual start: wait for `READY`, then send `conf` and `addr`
    /// as the agent does.
    pub async fn handshake(&mut self, conf: serde_json::Value, addrs: &[(&str, &str)]) {
        self.wait_status("READY", Duration::from_secs(5)).await;
        self.send("conf", conf.to_string());
        self.send_addrs(addrs);
    }
}

async fn accept_loop(
    listener: TcpListener,
    id: String,
    stats: Arc<Stats>,
    conn: Arc<Mutex<Option<ConnSender>>>,
    events: mpsc::UnboundedSender<FromDriver>,
) {
    loop {
        let Ok((sock, _)) = listener.accept().await else {
            return;
        };
        let (tx, rx) = mpsc::unbounded_channel();
        *conn.lock().unwrap() = Some(tx);
        tokio::spawn(serve(sock, id.clone(), stats.clone(), rx, events.clone()));
    }
}

/// Serve one client connection until it closes or goes quiet.
async fn serve(
    sock: TcpStream,
    id: String,
    stats: Arc<Stats>,
    mut outgoing: mpsc::UnboundedReceiver<Publish>,
    events: mpsc::UnboundedSender<FromDriver>,
) {
    let (mut rd, mut wr) = sock.into_split();
    let mut buf = BytesMut::with_capacity(64 * 1024);
    let mut keep_alive: Option<Duration> = None;
    let mut last_rx = Instant::now();
    let prefix = format!("fpEdge1/{id}/");

    'conn: loop {
        // A real broker drops a client after 1.5 keep-alive periods
        // with nothing received.
        let expiry = keep_alive.map(|ka| last_rx + ka * 3 / 2);
        let expired = async {
            match expiry {
                Some(t) => tokio::time::sleep_until(t).await,
                None => std::future::pending().await,
            }
        };

        tokio::select! {
            n = rd.read_buf(&mut buf) => {
                match n {
                    Ok(0) | Err(_) => break 'conn,
                    Ok(_) => last_rx = Instant::now(),
                }
                loop {
                    let pkt = match rumqttc::mqttbytes::v4::read(&mut buf, BROKER_MAX_PACKET) {
                        Ok(p) => p,
                        Err(MqttError::InsufficientBytes(_)) => break,
                        Err(e) => panic!("fake broker could not parse a packet: {e:?}"),
                    };
                    let mut out = BytesMut::new();
                    match pkt {
                        Packet::Connect(c) => {
                            stats.connects.fetch_add(1, Ordering::SeqCst);
                            if c.keep_alive > 0 {
                                keep_alive = Some(Duration::from_secs(c.keep_alive.into()));
                            }
                            ConnAck::new(ConnectReturnCode::Success, false)
                                .write(&mut out)
                                .unwrap();
                        }
                        Packet::Subscribe(s) => {
                            stats.subscriptions.lock().unwrap()
                                .extend(s.filters.iter().map(|f| f.path.clone()));
                            let codes = s
                                .filters
                                .iter()
                                .map(|_| SubscribeReasonCode::Success(QoS::AtLeastOnce))
                                .collect();
                            SubAck::new(s.pkid, codes).write(&mut out).unwrap();
                        }
                        Packet::PingReq => {
                            stats.pings.fetch_add(1, Ordering::SeqCst);
                            PingResp.write(&mut out).unwrap();
                        }
                        Packet::Publish(p) => {
                            if p.qos != QoS::AtMostOnce {
                                PubAck::new(p.pkid).write(&mut out).unwrap();
                            }
                            let suffix = p.topic.strip_prefix(&prefix).unwrap_or(&p.topic);
                            let ev = if suffix == "status" {
                                FromDriver::Status(String::from_utf8_lossy(&p.payload).into_owned())
                            } else if let Some(t) = suffix.strip_prefix("data/") {
                                FromDriver::Data { topic: t.to_owned(), payload: p.payload }
                            } else {
                                FromDriver::Other { topic: p.topic.clone(), payload: p.payload }
                            };
                            let _ = events.send(ev);
                        }
                        Packet::Disconnect => break 'conn,
                        _ => {}
                    }
                    if !out.is_empty() && wr.write_all(&out).await.is_err() {
                        break 'conn;
                    }
                }
            }
            Some(p) = outgoing.recv() => {
                let mut out = BytesMut::new();
                p.write(&mut out).unwrap();
                if wr.write_all(&out).await.is_err() {
                    break 'conn;
                }
            }
            _ = expired => {
                stats.expired.fetch_add(1, Ordering::SeqCst);
                break 'conn;
            }
        }
    }

    let _ = events.send(FromDriver::Disconnected);
}

/// Runs a driver in the background and stops it when dropped.
pub struct RunningDriver(tokio::task::JoinHandle<()>);

impl Drop for RunningDriver {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// Start `Driver::<H>::run` on its own task.
pub fn spawn_driver<H: Handler + 'static>(config: DriverConfig) -> RunningDriver {
    RunningDriver(tokio::spawn(async move {
        let mut driver = Driver::<H>::new(config);
        let _ = driver.run().await;
    }))
}

/// Start a driver built with [`Driver::with_options`].
pub fn spawn_driver_with<H: Handler + 'static>(
    config: DriverConfig,
    options: DriverOptions,
) -> RunningDriver {
    RunningDriver(tokio::spawn(async move {
        let mut driver = Driver::<H>::with_options(config, options);
        let _ = driver.run().await;
    }))
}

/// Shared state between a test and the handler it is driving.
///
/// `Handler::create` only gets a JSON config, so a test registers its
/// control object here and passes the key in the `conf` message.
static REGISTRY: LazyLock<Mutex<HashMap<String, Arc<dyn Any + Send + Sync>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static NEXT_KEY: AtomicUsize = AtomicUsize::new(0);

/// Register a control object, returning a `conf` value that carries
/// its key.
pub fn register<T: Any + Send + Sync>(ctl: Arc<T>) -> serde_json::Value {
    let key = format!("k{}", NEXT_KEY.fetch_add(1, Ordering::SeqCst));
    REGISTRY.lock().unwrap().insert(key.clone(), ctl);
    serde_json::json!({ "key": key })
}

/// Look up the control object named in a `conf` value.
pub fn lookup<T: Any + Send + Sync>(conf: &serde_json::Value) -> Option<Arc<T>> {
    let key = conf.get("key")?.as_str()?;
    let any = REGISTRY.lock().unwrap().get(key)?.clone();
    any.downcast::<T>().ok()
}

/// Shorthand for seconds.
pub fn secs(s: u64) -> Duration {
    Duration::from_secs(s)
}

/// Shorthand for milliseconds.
pub fn ms(m: u64) -> Duration {
    Duration::from_millis(m)
}

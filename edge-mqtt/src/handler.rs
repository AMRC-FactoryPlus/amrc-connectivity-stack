// ACS MQTT driver
// The rs-edge-driver handler: one client connection to the device's broker
// Copyright 2026 University of Sheffield

//! The [`Handler`] that connects to the device's MQTT broker,
//! subscribes to the addresses and passes each message on.
//!
//! Each message's payload goes to the Edge Agent as it arrived, as
//! bytes, under the message's own topic. The driver never looks inside
//! a payload, so its cost per message does not depend on how many
//! metrics read it: the agent decodes the payload once per message,
//! as it does for the built-in connection.

use std::collections::{BTreeSet, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use rs_edge_driver::{
    ConnectError, DEFAULT_MAX_PACKET_SIZE, DriverHandle, Handler, HandlerError, Reader, Scouter,
    WriteError, WriteValue,
};
use rumqttc::{
    AsyncClient, ConnectReturnCode, ConnectionError, Event, EventLoop, Incoming, MqttOptions, QoS,
    SubscribeFilter, SubscribeReasonCode, TlsConfiguration, Transport,
};
use tokio::sync::Notify;
use tokio::task::JoinHandle;

use crate::config::{Conf, Protocol, WS_PATH};
use crate::live::{Live, MqttReader, Subscriber};
use crate::scout::MqttScouter;
use crate::{topics, write};

/// The largest packet MQTT allows. The built-in accepts any message,
/// so the driver does too.
const MQTT_MAX_PACKET: usize = 268_435_455;

/// The largest payload passed to the Edge Agent. The driver's own
/// connection to the agent takes packets up to
/// [`DEFAULT_MAX_PACKET_SIZE`], and the rest is room for the topic.
/// A larger message is dropped with a warning.
pub const FORWARD_MAX: usize = DEFAULT_MAX_PACKET_SIZE - 64 * 1024;

/// Requests (subscriptions and writes) the client queues before
/// `subscribe` or `write` waits.
const REQUEST_QUEUE: usize = 64;

/// How often the driver looks for live-values topics no read has asked
/// for in a minute.
const EXPIRE_EVERY: Duration = Duration::from_secs(1);

/// How long a write may wait for room in the client's queue.
const WRITE_TIMEOUT: Duration = Duration::from_secs(5);

/// Where to find CA certificates when `SSL_CERT_FILE` is not set. The
/// first is where the driver image keeps them.
const CA_FILES: [&str; 3] = [
    "/etc/ssl/certs/ca-certificates.crt",
    "/etc/pki/tls/certs/ca-bundle.crt",
    "/etc/ssl/cert.pem",
];

/// The handler.
pub struct MqttHandler {
    handle: DriverHandle<String>,
    conf: Conf,
    /// The client id for every connection this handler makes. With a
    /// blank `clientId` it is made up once, as the built-in does, so a
    /// reconnect with `cleanSession: false` resumes the same session
    /// on the broker instead of leaving one behind each time.
    client_id: String,
    session: Option<Session>,
}

/// One connection to the broker.
struct Session {
    client: AsyncClient,
    /// The task reading from the broker.
    task: JoinHandle<()>,
    /// Set when the driver closes the connection, so the task doesn't
    /// report it as lost.
    stopping: Arc<AtomicBool>,
    /// The filters subscribed to on this connection.
    subscribed: BTreeSet<String>,
    /// Filters waiting for a SUBACK, in the order they were sent.
    pending: Arc<Mutex<VecDeque<Vec<String>>>>,
    /// Set when this connection is lost, so a scan can stop.
    lost: Arc<Lost>,
    /// The topics live values read on this connection. See
    /// [`crate::live`].
    live: Arc<Live>,
    /// Sends this connection's SUBSCRIBEs, noting each for its SUBACK.
    sub: Arc<ClientSub>,
    /// The task that unsubscribes from live-values topics nobody reads.
    expiry: JoinHandle<()>,
}

/// The data connection's client as a [`Subscriber`] for live values.
struct ClientSub {
    client: AsyncClient,
    pending: Arc<Mutex<VecDeque<Vec<String>>>>,
}

#[async_trait]
impl Subscriber for ClientSub {
    async fn subscribe(&self, topics: Vec<String>) -> Result<(), String> {
        let filters: Vec<_> = topics
            .iter()
            .map(|t| SubscribeFilter::new(t.clone(), QoS::AtMostOnce))
            .collect();
        // Never waits, so a read the library abandons can't leave a
        // SUBACK noted for a SUBSCRIBE that was never sent. The caller
        // holds the order lock, so nothing else is noted in between.
        let mut pending = self.pending.lock().unwrap();
        pending.push_back(topics);
        self.client.try_subscribe_many(filters).map_err(|e| {
            pending.pop_back();
            e.to_string()
        })
    }

    async fn unsubscribe(&self, topic: String) -> Result<(), String> {
        self.client
            .unsubscribe(topic)
            .await
            .map_err(|e| e.to_string())
    }
}

/// Whether the driver's own connection has been lost. A scan watches
/// it and stops when it is set, because a broker that sets the client
/// id from the login gives the scan's connection the driver's client
/// id. mosquitto does this with `use_username_as_clientid`. The broker
/// then drops the driver's connection for the scan's, and when the
/// driver reconnects it drops the scan's in turn. Stopping the scan at
/// the first loss lets the driver reconnect once and carry on.
#[derive(Default)]
pub(crate) struct Lost {
    set: AtomicBool,
    notify: Notify,
}

impl Lost {
    /// Mark the connection lost and wake every waiter.
    pub(crate) fn set(&self) {
        self.set.store(true, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    pub(crate) fn is_set(&self) -> bool {
        self.set.load(Ordering::SeqCst)
    }

    /// Wait until the connection is lost.
    pub(crate) async fn wait(&self) {
        loop {
            // Made before the check, so a `set` between the check and
            // the await still wakes it.
            let notified = self.notify.notified();
            if self.is_set() {
                return;
            }
            notified.await;
        }
    }
}

impl MqttHandler {
    /// The client options for the driver's connection.
    fn options(&self) -> Result<MqttOptions, String> {
        let mut opts = client_options(&self.conf, &self.client_id)?;
        opts.set_clean_session(self.conf.clean_session);
        opts.set_request_channel_capacity(REQUEST_QUEUE);
        Ok(opts)
    }

    /// Close the current connection, if any.
    async fn stop(&mut self) {
        let Some(mut s) = self.session.take() else {
            return;
        };
        s.stopping.store(true, Ordering::SeqCst);
        s.expiry.abort();
        // A broker keeps the subscriptions of a session that is not
        // clean, so drop the ones only live values wanted.
        if !self.conf.clean_session {
            for t in s.live.own_topics() {
                let _ = s.client.try_unsubscribe(t);
            }
        }
        let _ = s.client.try_disconnect();
        // Give the task a moment to send the DISCONNECT. It may be
        // waiting for the Edge Agent, so don't wait long.
        if tokio::time::timeout(Duration::from_millis(500), &mut s.task)
            .await
            .is_err()
        {
            s.task.abort();
        }
    }
}

/// The client options for a connection to the broker in `c` with
/// `client_id`: host, transport, TLS, credentials and keep-alive. The
/// driver's connection and a scan's connection both use this.
pub(crate) fn client_options(c: &Conf, client_id: &str) -> Result<MqttOptions, String> {
    let mut opts = match c.protocol {
        Protocol::Tcp | Protocol::Tls => MqttOptions::new(client_id, &c.host, c.port),
        Protocol::Ws | Protocol::Wss => {
            MqttOptions::new(client_id, format!("{}{WS_PATH}", c.url()), c.port)
        }
    };
    let transport = match c.protocol {
        Protocol::Tcp => Transport::Tcp,
        Protocol::Tls => Transport::Tls(tls_config()?),
        Protocol::Ws => Transport::Ws,
        Protocol::Wss => Transport::Wss(tls_config()?),
    };
    opts.set_transport(transport);
    if let Some((u, p)) = &c.credentials {
        opts.set_credentials(u, p);
    }
    opts.set_keep_alive(c.keep_alive);
    opts.set_max_packet_size(MQTT_MAX_PACKET, MQTT_MAX_PACKET);
    Ok(opts)
}

/// Server certificates are checked against the system's CA
/// certificates, as Node checks them against its own copy of the same
/// list. `SSL_CERT_FILE` names a different file.
fn tls_config() -> Result<TlsConfiguration, String> {
    let path = match std::env::var("SSL_CERT_FILE") {
        Ok(p) if !p.is_empty() => p,
        _ => CA_FILES
            .iter()
            .find(|p| std::path::Path::new(p).exists())
            .ok_or("no CA certificates found; set SSL_CERT_FILE")?
            .to_string(),
    };
    let ca = std::fs::read(&path).map_err(|e| format!("can't read {path}: {e}"))?;
    Ok(TlsConfiguration::Simple {
        ca,
        alpn: None,
        client_auth: None,
    })
}

/// Read from the broker until the connection is lost, passing each
/// message to the Edge Agent in the order it arrived.
///
/// `publish_wait` waits while the driver already has a full queue of
/// messages on their way to the agent. This task then stops reading,
/// and the broker holds messages back as it would for any slow client.
/// The built-in behaves the same way: a busy agent stops reading its
/// socket.
async fn read_loop(
    mut eventloop: EventLoop,
    handle: DriverHandle<String>,
    url: String,
    stopping: Arc<AtomicBool>,
    pending: Arc<Mutex<VecDeque<Vec<String>>>>,
    lost: Arc<Lost>,
    live: Arc<Live>,
) {
    loop {
        match eventloop.poll().await {
            Ok(Event::Incoming(Incoming::Publish(p))) => {
                // Kept for live values when a read wants the topic. A
                // topic only a read wants goes no further.
                if !live.record(&p.topic, &p.payload) {
                    continue;
                }
                if p.payload.len() > FORWARD_MAX {
                    tracing::warn!(
                        topic = %p.topic,
                        bytes = p.payload.len(),
                        "message too large to pass to the Edge Agent, dropped"
                    );
                    continue;
                }
                handle.publish_wait(p.topic, p.payload).await;
            }
            Ok(Event::Incoming(Incoming::SubAck(ack))) => {
                let filters = pending.lock().unwrap().pop_front().unwrap_or_default();
                let refused: Vec<&str> = ack
                    .return_codes
                    .iter()
                    .zip(&filters)
                    .filter(|(code, _)| matches!(code, SubscribeReasonCode::Failure))
                    .map(|(_, f)| f.as_str())
                    .collect();
                if !refused.is_empty() {
                    tracing::warn!(?refused, "broker refused subscriptions");
                    live.refused(&refused);
                }
            }
            Ok(_) => {}
            Err(e) => {
                if !stopping.load(Ordering::SeqCst) {
                    tracing::warn!(%url, %e, "lost the connection to the MQTT server");
                    lost.set();
                    handle.disconnected(ConnectError::ConnectionFailed);
                }
                return;
            }
        }
    }
}

#[async_trait]
impl Handler for MqttHandler {
    type Addr = String;

    /// Nothing to poll: data arrives as the broker sends it.
    const SUPPORTS_POLL: bool = false;

    /// A write is published to the address's topic, and reported
    /// written once the client has taken it.
    const TYPED_WRITES: bool = true;

    /// A scan listens on the broker with a second client. See
    /// [`crate::scout`].
    const SCOUTS: bool = true;

    /// Live values subscribe to the topics on screen on the driver's
    /// own connection. See [`crate::live`].
    const READS: bool = true;

    fn create(
        handle: DriverHandle<String>,
        config: serde_json::Value,
    ) -> Result<Self, HandlerError> {
        let conf = Conf::from_json(&config).map_err(HandlerError::new)?;
        tracing::info!(url = %conf.url(), "MQTT server configured");
        let client_id = conf.client_id();
        Ok(Self {
            handle,
            conf,
            client_id,
            session: None,
        })
    }

    /// Every address is accepted. One that is not a valid topic
    /// filter is left out when subscribing, as the broker would refuse
    /// it, so it can't stop the rest of the connection working.
    fn parse_addr(&self, addr: &str) -> Option<String> {
        Some(addr.to_owned())
    }

    async fn connect(&mut self) -> Result<(), ConnectError> {
        // Live-values topics of a connection that was lost, which a
        // broker keeps for a session that is not clean.
        let leftover = match &self.session {
            Some(s) if !self.conf.clean_session && s.lost.is_set() => s.live.own_topics(),
            _ => Vec::new(),
        };
        self.stop().await;
        let url = self.conf.url();
        let opts = self.options().map_err(|e| {
            tracing::error!(%url, error = %e, "can't set up the connection");
            ConnectError::ConnectionFailed
        })?;

        // The first poll connects, within rumqttc's 5 second timeout,
        // the same as the built-in's.
        let (client, mut eventloop) = AsyncClient::new(opts, REQUEST_QUEUE);
        match eventloop.poll().await {
            Ok(Event::Incoming(Incoming::ConnAck(_))) => {}
            Err(ConnectionError::ConnectionRefused(code)) => {
                tracing::warn!(%url, ?code, "MQTT server refused the connection");
                return Err(match code {
                    ConnectReturnCode::BadUserNamePassword | ConnectReturnCode::NotAuthorized => {
                        ConnectError::AuthFailed
                    }
                    _ => ConnectError::ConnectionFailed,
                });
            }
            Err(e) => {
                tracing::warn!(%url, %e, "could not connect to the MQTT server");
                return Err(ConnectError::ConnectionFailed);
            }
            Ok(event) => {
                tracing::warn!(%url, ?event, "unexpected first packet from the MQTT server");
                return Err(ConnectError::ConnectionFailed);
            }
        }
        tracing::info!(%url, "connected to the MQTT server");

        // Sent before `subscribe` makes the address map's
        // subscriptions, so a mapped topic among them is subscribed to
        // again after.
        for t in leftover {
            let _ = client.try_unsubscribe(t);
        }

        let stopping = Arc::new(AtomicBool::new(false));
        let pending = Arc::new(Mutex::new(VecDeque::new()));
        let lost = Arc::new(Lost::default());
        let live = Arc::new(Live::default());
        let task = tokio::spawn(read_loop(
            eventloop,
            self.handle.clone(),
            url,
            stopping.clone(),
            pending.clone(),
            lost.clone(),
            live.clone(),
        ));
        let sub = Arc::new(ClientSub {
            client: client.clone(),
            pending: pending.clone(),
        });
        let expiry = tokio::spawn({
            let (live, sub) = (live.clone(), sub.clone());
            async move {
                loop {
                    tokio::time::sleep(EXPIRE_EVERY).await;
                    live.expire(&*sub).await;
                }
            }
        });
        self.session = Some(Session {
            client,
            task,
            stopping,
            subscribed: BTreeSet::new(),
            pending,
            lost,
            live,
            sub,
            expiry,
        });
        Ok(())
    }

    async fn close(&mut self) {
        self.stop().await;
    }

    /// A scan opens its own connection with the same details, so it
    /// needs only those. It is offered only while the driver is
    /// connected, so a broker the driver can't reach gives `CONN`. The
    /// scan watches this connection and stops with `CONN` if it is
    /// lost. See [`Lost`].
    fn scouter(&self) -> Option<Arc<dyn Scouter>> {
        let s = self.session.as_ref()?;
        Some(Arc::new(MqttScouter::new(
            self.conf.clone(),
            self.client_id.clone(),
            s.lost.clone(),
        )))
    }

    /// Live values subscribe to topics on this connection too. See
    /// [`crate::live`].
    fn reader(&self) -> Option<Arc<dyn Reader>> {
        let s = self.session.as_ref()?;
        Some(Arc::new(MqttReader {
            live: s.live.clone(),
            sub: s.sub.clone(),
            lost: s.lost.clone(),
        }))
    }

    /// Called with every address after each connect and each new
    /// address map. Subscribes at QoS 0, as the built-in does.
    ///
    /// Live values subscribe on the same connection, so the whole
    /// change is made under their order lock, and a filter a live read
    /// still wants is not unsubscribed. See [`crate::live`].
    async fn subscribe(&mut self, addrs: &[String]) -> bool {
        let Some(live) = self.session.as_ref().map(|s| s.live.clone()) else {
            return false;
        };
        let _order = live.order.lock().await;
        let ok = self.subscribe_locked(addrs).await;
        if let Some(s) = &self.session {
            live.set_mapped(&s.subscribed);
        }
        ok
    }

    /// Publish the value as text to the address's topic, at QoS 0 and
    /// not retained, as the built-in publishes. See [`write`].
    async fn write(&mut self, addr: &String, value: WriteValue) -> Result<(), WriteError> {
        let Some(s) = self.session.as_ref() else {
            return Err(WriteError::Failed(
                "not connected to the MQTT server".into(),
            ));
        };
        if addr.is_empty() || addr.contains(['+', '#', '\0']) {
            return Err(WriteError::BadValue(format!("can't publish to {addr:?}")));
        }
        let publish = s
            .client
            .publish(addr, QoS::AtMostOnce, false, write::payload(&value));
        match tokio::time::timeout(WRITE_TIMEOUT, publish).await {
            Ok(Ok(())) => Ok(()),
            Ok(Err(e)) => Err(WriteError::Failed(e.to_string())),
            Err(_) => Err(WriteError::Failed("the MQTT client is busy".into())),
        }
    }
}

impl MqttHandler {
    /// [`Handler::subscribe`], under the live-values order lock.
    async fn subscribe_locked(&mut self, addrs: &[String]) -> bool {
        let Some(s) = self.session.as_mut() else {
            return false;
        };
        // The read loop reports a lost connection, but the driver
        // ignores that report while `connect` is still in progress, as
        // a duplicate from the old connection. A broker that closes
        // straight after CONNACK can therefore end the read loop
        // unheard, leaving the status UP with nothing connected. The
        // driver calls this as soon as the connection is up, so report
        // it again here, where it is heard.
        if s.task.is_finished() && !s.stopping.load(Ordering::SeqCst) {
            tracing::warn!(url = %self.conf.url(), "the MQTT server closed the connection");
            self.handle.disconnected(ConnectError::ConnectionFailed);
            return false;
        }
        let plan = topics::plan(&s.subscribed, addrs.iter().map(String::as_str));
        for a in &plan.invalid {
            tracing::warn!(address = %a, "not a valid MQTT topic, not subscribed");
        }

        for f in plan.unsubscribe {
            if s.live.may_unsubscribe(&f) {
                if let Err(e) = s.client.unsubscribe(&f).await {
                    tracing::error!(%e, filter = %f, "could not unsubscribe");
                    return false;
                }
            } else {
                tracing::debug!(filter = %f, "kept for live values");
            }
            s.subscribed.remove(&f);
        }

        if plan.subscribe.is_empty() {
            return true;
        }
        let filters = plan
            .subscribe
            .iter()
            .map(|f| SubscribeFilter::new(f.clone(), QoS::AtMostOnce))
            .collect::<Vec<_>>();
        s.pending.lock().unwrap().push_back(plan.subscribe.clone());
        if let Err(e) = s.client.subscribe_many(filters).await {
            s.pending.lock().unwrap().pop_back();
            tracing::error!(%e, "could not subscribe");
            return false;
        }
        tracing::info!(count = plan.subscribe.len(), "subscribed");
        s.subscribed.extend(plan.subscribe);
        true
    }
}

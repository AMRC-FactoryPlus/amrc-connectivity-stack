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
    ConnectError, DEFAULT_MAX_PACKET_SIZE, DriverHandle, Handler, HandlerError, WriteError,
    WriteValue,
};
use rumqttc::{
    AsyncClient, ConnectReturnCode, ConnectionError, Event, EventLoop, Incoming, MqttOptions, QoS,
    SubscribeFilter, SubscribeReasonCode, TlsConfiguration, Transport,
};
use tokio::task::JoinHandle;

use crate::config::{Conf, Protocol, WS_PATH};
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
}

impl MqttHandler {
    /// The client options for one connection.
    fn options(&self) -> Result<MqttOptions, String> {
        let c = &self.conf;
        let mut opts = match c.protocol {
            Protocol::Tcp | Protocol::Tls => MqttOptions::new(c.client_id(), &c.host, c.port),
            Protocol::Ws | Protocol::Wss => {
                MqttOptions::new(c.client_id(), format!("{}{WS_PATH}", c.url()), c.port)
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
        opts.set_clean_session(c.clean_session);
        opts.set_keep_alive(c.keep_alive);
        opts.set_max_packet_size(MQTT_MAX_PACKET, MQTT_MAX_PACKET);
        opts.set_request_channel_capacity(REQUEST_QUEUE);
        Ok(opts)
    }

    /// Close the current connection, if any.
    async fn stop(&mut self) {
        let Some(mut s) = self.session.take() else {
            return;
        };
        s.stopping.store(true, Ordering::SeqCst);
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
) {
    loop {
        match eventloop.poll().await {
            Ok(Event::Incoming(Incoming::Publish(p))) => {
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
                }
            }
            Ok(_) => {}
            Err(e) => {
                if !stopping.load(Ordering::SeqCst) {
                    tracing::warn!(%url, %e, "lost the connection to the MQTT server");
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

    fn create(
        handle: DriverHandle<String>,
        config: serde_json::Value,
    ) -> Result<Self, HandlerError> {
        let conf = Conf::from_json(&config).map_err(HandlerError::new)?;
        tracing::info!(url = %conf.url(), "MQTT server configured");
        Ok(Self {
            handle,
            conf,
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

        let stopping = Arc::new(AtomicBool::new(false));
        let pending = Arc::new(Mutex::new(VecDeque::new()));
        let task = tokio::spawn(read_loop(
            eventloop,
            self.handle.clone(),
            url,
            stopping.clone(),
            pending.clone(),
        ));
        self.session = Some(Session {
            client,
            task,
            stopping,
            subscribed: BTreeSet::new(),
            pending,
        });
        Ok(())
    }

    async fn close(&mut self) {
        self.stop().await;
    }

    /// Called with every address after each connect and each new
    /// address map. Subscribes at QoS 0, as the built-in does.
    async fn subscribe(&mut self, addrs: &[String]) -> bool {
        let Some(s) = self.session.as_mut() else {
            return false;
        };
        let plan = topics::plan(&s.subscribed, addrs.iter().map(String::as_str));
        for a in &plan.invalid {
            tracing::warn!(address = %a, "not a valid MQTT topic, not subscribed");
        }

        for f in plan.unsubscribe {
            if let Err(e) = s.client.unsubscribe(&f).await {
                tracing::error!(%e, filter = %f, "could not unsubscribe");
                return false;
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

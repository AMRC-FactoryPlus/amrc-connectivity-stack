// ACS MQTT driver
// A fake device broker for the driver tests
// Copyright 2026 University of Sheffield

//! [`FakeBroker`] is a minimal MQTT 3.1.1 broker standing in for the
//! device's broker. It records what the driver sends (CONNECT,
//! SUBSCRIBE, UNSUBSCRIBE, PUBLISH) and lets a test publish to the
//! driver, refuse a connection or a subscription, and drop the
//! connection.

#![allow(dead_code)]

use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::{Bytes, BytesMut};
use rumqttc::mqttbytes::QoS;
use rumqttc::mqttbytes::v4::{
    ConnAck, ConnectReturnCode, Packet, PingResp, Publish, SubAck, SubscribeReasonCode, UnsubAck,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::mpsc;

/// What the driver sent to the broker.
#[derive(Debug, Clone, PartialEq)]
pub enum Seen {
    Connect {
        client_id: String,
        clean_session: bool,
        keep_alive: u16,
        login: Option<(String, String)>,
    },
    Subscribe(Vec<(String, QoS)>),
    Unsubscribe(Vec<String>),
    Publish {
        topic: String,
        payload: Bytes,
        qos: QoS,
        retain: bool,
    },
    Disconnect,
    Closed,
}

#[derive(Default)]
struct Shared {
    /// The current connection's sender.
    conn: Option<mpsc::UnboundedSender<Option<Publish>>>,
    /// The CONNACK code to answer with.
    connack: Option<ConnectReturnCode>,
    /// Filters containing this are refused in the SUBACK.
    refuse: Option<String>,
}

pub struct FakeBroker {
    pub port: u16,
    shared: Arc<Mutex<Shared>>,
    events: mpsc::UnboundedReceiver<Seen>,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for FakeBroker {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl FakeBroker {
    pub async fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let shared = Arc::new(Mutex::new(Shared::default()));
        let (tx, events) = mpsc::unbounded_channel();
        let task = tokio::spawn(accept(listener, shared.clone(), tx));
        Self {
            port,
            shared,
            events,
            task,
        }
    }

    /// Connection details for the driver pointing at this broker.
    pub fn conf(&self) -> serde_json::Value {
        serde_json::json!({
            "protocol": "mqtt",
            "host": "127.0.0.1",
            "port": self.port,
            "clientId": "edge-test",
            "cleanSession": true,
            "keepAlive": 60,
        })
    }

    /// Answer future CONNECTs with this code.
    pub fn refuse_connect(&self, code: ConnectReturnCode) {
        self.shared.lock().unwrap().connack = Some(code);
    }

    /// Refuse subscriptions to filters containing `part`.
    pub fn refuse_filters(&self, part: &str) {
        self.shared.lock().unwrap().refuse = Some(part.to_owned());
    }

    /// Publish to the driver at QoS 0.
    pub fn publish(&self, topic: &str, payload: impl Into<Vec<u8>>) {
        let tx = self.shared.lock().unwrap().conn.clone();
        tx.expect("driver is not connected")
            .send(Some(Publish::new(topic, QoS::AtMostOnce, payload)))
            .expect("connection gone");
    }

    /// Drop the driver's connection.
    pub fn kick(&self) {
        if let Some(tx) = self.shared.lock().unwrap().conn.take() {
            let _ = tx.send(None);
        }
    }

    pub async fn next(&mut self, within: Duration) -> Option<Seen> {
        tokio::time::timeout(within, self.events.recv())
            .await
            .ok()
            .flatten()
    }

    /// Wait for an event `pick` accepts, skipping others.
    pub async fn wait<T>(&mut self, within: Duration, pick: impl Fn(&Seen) -> Option<T>) -> T {
        let deadline = tokio::time::Instant::now() + within;
        let mut seen = Vec::new();
        loop {
            let left = deadline.saturating_duration_since(tokio::time::Instant::now());
            match self.next(left).await {
                Some(ev) => match pick(&ev) {
                    Some(t) => return t,
                    None => seen.push(ev),
                },
                None => panic!("not seen within {within:?}; saw {seen:?}"),
            }
        }
    }

    /// Collect events until `within` has passed.
    pub async fn drain(&mut self, within: Duration) -> Vec<Seen> {
        let deadline = tokio::time::Instant::now() + within;
        let mut out = Vec::new();
        loop {
            let left = deadline.saturating_duration_since(tokio::time::Instant::now());
            if left.is_zero() {
                return out;
            }
            match self.next(left).await {
                Some(ev) => out.push(ev),
                None => return out,
            }
        }
    }
}

async fn accept(
    listener: TcpListener,
    shared: Arc<Mutex<Shared>>,
    events: mpsc::UnboundedSender<Seen>,
) {
    loop {
        let Ok((sock, _)) = listener.accept().await else {
            return;
        };
        let (tx, mut rx) = mpsc::unbounded_channel::<Option<Publish>>();
        shared.lock().unwrap().conn = Some(tx);
        let shared = shared.clone();
        let events = events.clone();
        tokio::spawn(async move {
            let (mut rd, mut wr) = sock.into_split();
            let mut buf = BytesMut::with_capacity(64 * 1024);
            'conn: loop {
                tokio::select! {
                    n = rd.read_buf(&mut buf) => {
                        if !matches!(n, Ok(n) if n > 0) {
                            break 'conn;
                        }
                        loop {
                            let pkt = match Packet::read(&mut buf, 1 << 28) {
                                Ok(p) => p,
                                Err(rumqttc::mqttbytes::Error::InsufficientBytes(_)) => break,
                                Err(e) => panic!("fake broker could not parse a packet: {e:?}"),
                            };
                            let mut out = BytesMut::new();
                            let mut close = false;
                            match pkt {
                                Packet::Connect(c) => {
                                    let _ = events.send(Seen::Connect {
                                        client_id: c.client_id.clone(),
                                        clean_session: c.clean_session,
                                        keep_alive: c.keep_alive,
                                        login: c.login.map(|l| (l.username, l.password)),
                                    });
                                    let code = shared.lock().unwrap().connack
                                        .unwrap_or(ConnectReturnCode::Success);
                                    ConnAck::new(code, false).write(&mut out).unwrap();
                                    close = code != ConnectReturnCode::Success;
                                }
                                Packet::Subscribe(s) => {
                                    let refuse = shared.lock().unwrap().refuse.clone();
                                    let codes = s.filters.iter().map(|f| match &refuse {
                                        Some(r) if f.path.contains(r.as_str()) =>
                                            SubscribeReasonCode::Failure,
                                        _ => SubscribeReasonCode::Success(QoS::AtMostOnce),
                                    }).collect();
                                    let _ = events.send(Seen::Subscribe(
                                        s.filters.iter().map(|f| (f.path.clone(), f.qos)).collect()));
                                    SubAck::new(s.pkid, codes).write(&mut out).unwrap();
                                }
                                Packet::Unsubscribe(u) => {
                                    let _ = events.send(Seen::Unsubscribe(u.topics.clone()));
                                    UnsubAck::new(u.pkid).write(&mut out).unwrap();
                                }
                                Packet::Publish(p) => {
                                    let _ = events.send(Seen::Publish {
                                        topic: p.topic.clone(),
                                        payload: p.payload.clone(),
                                        qos: p.qos,
                                        retain: p.retain,
                                    });
                                }
                                Packet::PingReq => {
                                    PingResp.write(&mut out).unwrap();
                                }
                                Packet::Disconnect => {
                                    let _ = events.send(Seen::Disconnect);
                                    break 'conn;
                                }
                                _ => {}
                            }
                            if !out.is_empty() && wr.write_all(&out).await.is_err() {
                                break 'conn;
                            }
                            if close {
                                break 'conn;
                            }
                        }
                    }
                    p = rx.recv() => {
                        let Some(Some(p)) = p else { break 'conn };
                        let mut out = BytesMut::new();
                        p.write(&mut out).unwrap();
                        if wr.write_all(&out).await.is_err() {
                            break 'conn;
                        }
                    }
                }
            }
            let _ = events.send(Seen::Closed);
        });
    }
}

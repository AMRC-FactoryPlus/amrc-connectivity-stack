// ACS MQTT driver
// Live values: the last message on each topic the Edge Scout panel reads
// Copyright 2026 University of Sheffield

//! Live values for the Edge Scout panel. MQTT has no way to read a
//! topic's current value, so the driver subscribes to the topics a read
//! asks for on its own data connection and answers each read with the
//! last message it holds for each topic. The protocol is the "Values"
//! section of `docs/architecture/edge-management/edge-scout.md`.
//!
//! The data connection carries the device's data, so this keeps out of
//! its way:
//!
//! - **One set of subscriptions.** [`Live`] knows the filters the
//!   address map subscribes to (`mapped`) and the topics reads asked
//!   for. A read subscribes only to a topic that is neither, so a
//!   mapped topic is never subscribed to again and its retained message
//!   never sent to the Edge Agent twice. The handler's own `subscribe`
//!   never unsubscribes from a topic a read still wants, and a read's
//!   topic is unsubscribed 60 s after the last read that asked for it,
//!   never while the address map has it.
//! - **One order.** Every SUBSCRIBE and UNSUBSCRIBE, from the handler
//!   and from reads, is decided and sent under one lock
//!   ([`Live::order`]), so an UNSUBSCRIBE for a topic that has just
//!   been mapped can't overtake that topic's SUBSCRIBE, and SUBACKs come
//!   back in the order the read loop expects.
//! - **No data from reads.** A message on a topic only a read wants is
//!   kept here and never passed to the Edge Agent, so it takes no room
//!   in the queue to the agent. The agent looks data up by exact topic,
//!   so it would have dropped it anyway.
//! - **Nothing on the data path without a read.** While no read topic
//!   is held, the read loop checks one atomic flag per message.
//! - **Exact topics only.** A read of a filter with `+` or `#` is
//!   refused, because it could subscribe the data connection to the
//!   whole broker.
//!
//! A mapped topic holds no message until its next one arrives after a
//! read first asks for it, because the driver passes messages on
//! without keeping them, and subscribing again to get the retained
//! message would send that message to the Edge Agent a second time.

use std::collections::{BTreeSet, HashMap};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use bytes::Bytes;
use rs_edge_driver::{ReadValue, Reader, ScoutType};
use tokio::sync::Notify;

use crate::handler::Lost;
use crate::topics::valid_filter;

/// How long after the last read that asked for a topic the driver
/// stays subscribed to it.
pub const READ_TTL: Duration = Duration::from_secs(60);

/// How long a read waits for the first message on topics it has just
/// subscribed to, such as a retained message, before it answers.
pub const FIRST_WAIT: Duration = Duration::from_secs(1);

/// The most bytes of a payload looked at for its text. The value is
/// cut at 1024 characters, which are at most 4096 bytes of UTF-8.
const TEXT_BYTES: usize = 4096;

pub const NO_MESSAGE: &str = "No message yet";
pub const REFUSED: &str = "The broker refused the subscription";
pub const WILDCARD: &str = "A filter with + or # is not one topic";
pub const INVALID: &str = "Not a valid MQTT topic";
pub const NOT_CONNECTED: &str = "Not connected to the MQTT server";
pub const BUSY: &str = "The MQTT client is busy, so the topic was not subscribed to";

/// Sends SUBSCRIBE and UNSUBSCRIBE on the data connection. The handler
/// implements it for its client, and the tests record what is sent.
#[async_trait]
pub trait Subscriber: Send + Sync {
    /// Subscribe to `topics` at QoS 0 in one SUBSCRIBE.
    async fn subscribe(&self, topics: Vec<String>) -> Result<(), String>;
    /// Unsubscribe from `topic`.
    async fn unsubscribe(&self, topic: String) -> Result<(), String>;
}

/// The last message on a topic, and when it arrived.
#[derive(Clone, Debug)]
struct Message {
    payload: Bytes,
    ts: i64,
}

/// A topic a read asked for.
#[derive(Debug)]
struct Watched {
    asked: Instant,
    message: Option<Message>,
    refused: bool,
}

#[derive(Default)]
struct State {
    /// The filters the address map has subscribed to on this
    /// connection.
    mapped: BTreeSet<String>,
    /// The topics reads asked for.
    topics: HashMap<String, Watched>,
}

/// The live-values state of one connection to the broker.
pub struct Live {
    state: Mutex<State>,
    /// Whether any read topic is held, checked by the read loop before
    /// it takes the lock.
    active: AtomicBool,
    /// Woken when a message for a read topic arrives.
    arrived: Notify,
    /// Held while subscriptions are decided and sent. See the module
    /// documentation.
    pub order: tokio::sync::Mutex<()>,
    ttl: Duration,
    first_wait: Duration,
}

impl Default for Live {
    fn default() -> Self {
        Self::new(READ_TTL, FIRST_WAIT)
    }
}

impl Live {
    pub fn new(ttl: Duration, first_wait: Duration) -> Self {
        Self {
            state: Mutex::default(),
            active: AtomicBool::new(false),
            arrived: Notify::new(),
            order: tokio::sync::Mutex::new(()),
            ttl,
            first_wait,
        }
    }

    /// The address map's filters as subscribed now. Call under
    /// [`order`](Live::order).
    pub fn set_mapped(&self, mapped: &BTreeSet<String>) {
        self.state.lock().unwrap().mapped = mapped.clone();
    }

    /// Whether a mapped filter that the address map no longer has may
    /// be unsubscribed: not while a read wants it. A read's own expiry
    /// unsubscribes it later. Call under [`order`](Live::order).
    pub fn may_unsubscribe(&self, filter: &str) -> bool {
        !self.state.lock().unwrap().topics.contains_key(filter)
    }

    /// A message arrived. Returns whether to pass it to the Edge Agent:
    /// false for a topic that only a read wants.
    pub fn record(&self, topic: &str, payload: &Bytes) -> bool {
        if !self.active.load(Ordering::Acquire) {
            return true;
        }
        let mut st = self.state.lock().unwrap();
        let mapped = st.mapped.contains(topic);
        let Some(w) = st.topics.get_mut(topic) else {
            return true;
        };
        w.message = Some(Message {
            payload: payload.clone(),
            ts: now_ms(),
        });
        drop(st);
        self.arrived.notify_waiters();
        mapped
    }

    /// The broker refused these filters. A read topic among them
    /// answers with an error.
    pub fn refused(&self, filters: &[&str]) {
        let mut st = self.state.lock().unwrap();
        for f in filters {
            if let Some(w) = st.topics.get_mut(*f) {
                w.refused = true;
            }
        }
    }

    /// The topics reads subscribed to that the address map does not
    /// have, to unsubscribe from when the connection is closed.
    pub fn own_topics(&self) -> Vec<String> {
        let st = self.state.lock().unwrap();
        st.topics
            .keys()
            .filter(|t| !st.mapped.contains(*t))
            .cloned()
            .collect()
    }

    fn set_active(&self, st: &State) {
        self.active.store(!st.topics.is_empty(), Ordering::Release);
    }

    /// Answer a read: subscribe to the topics not yet subscribed to,
    /// wait a moment for their first message, and give the last
    /// message held for each address.
    pub async fn read(&self, sub: &dyn Subscriber, addresses: &[String]) -> Vec<ReadValue> {
        let now = Instant::now();
        let mut new = Vec::new();
        {
            let _order = self.order.lock().await;
            {
                let mut st = self.state.lock().unwrap();
                for a in addresses {
                    if !valid_filter(a) || a.contains(['+', '#']) {
                        continue;
                    }
                    let fresh = !st.topics.contains_key(a.as_str());
                    if fresh && !st.mapped.contains(a.as_str()) {
                        new.push(a.clone());
                    }
                    st.topics
                        .entry(a.clone())
                        .and_modify(|w| w.asked = now)
                        .or_insert(Watched {
                            asked: now,
                            message: None,
                            refused: false,
                        });
                }
                self.set_active(&st);
            }
            if !new.is_empty() {
                tracing::debug!(count = new.len(), "subscribing for live values");
                if let Err(e) = sub.subscribe(new.clone()).await {
                    tracing::warn!(%e, "could not subscribe for live values");
                    let mut st = self.state.lock().unwrap();
                    for t in &new {
                        st.topics.remove(t);
                    }
                    self.set_active(&st);
                    drop(st);
                    return addresses
                        .iter()
                        .map(|a| ReadValue::error(a.clone(), BUSY))
                        .collect();
                }
            }
        }
        if !new.is_empty() {
            self.wait_first(&new).await;
        }
        let st = self.state.lock().unwrap();
        addresses
            .iter()
            .map(|a| {
                if a.contains(['+', '#']) && valid_filter(a) {
                    return ReadValue::error(a.clone(), WILDCARD);
                }
                match st.topics.get(a.as_str()) {
                    None => ReadValue::error(a.clone(), INVALID),
                    Some(w) if w.refused => ReadValue::error(a.clone(), REFUSED),
                    Some(Watched {
                        message: Some(m), ..
                    }) => entry(a, m),
                    Some(_) => ReadValue::error(a.clone(), NO_MESSAGE),
                }
            })
            .collect()
    }

    /// Wait until each of `topics` has a message or was refused, or
    /// for `first_wait`.
    async fn wait_first(&self, topics: &[String]) {
        let deadline = tokio::time::Instant::now() + self.first_wait;
        loop {
            let arrived = self.arrived.notified();
            {
                let st = self.state.lock().unwrap();
                let done = topics.iter().all(|t| {
                    st.topics
                        .get(t.as_str())
                        .is_none_or(|w| w.message.is_some() || w.refused)
                });
                if done {
                    return;
                }
            }
            if tokio::time::timeout_at(deadline, arrived).await.is_err() {
                return;
            }
        }
    }

    /// Forget the topics no read has asked for in `ttl`, and
    /// unsubscribe from those the address map does not have.
    pub async fn expire(&self, sub: &dyn Subscriber) {
        if !self.active.load(Ordering::Acquire) {
            return;
        }
        let _order = self.order.lock().await;
        let gone: Vec<String> = {
            let mut st = self.state.lock().unwrap();
            let old: Vec<String> = st
                .topics
                .iter()
                .filter(|(_, w)| w.asked.elapsed() >= self.ttl)
                .map(|(t, _)| t.clone())
                .collect();
            for t in &old {
                st.topics.remove(t);
            }
            self.set_active(&st);
            old.into_iter().filter(|t| !st.mapped.contains(t)).collect()
        };
        for t in gone {
            tracing::debug!(topic = %t, "no live reads for a minute, unsubscribing");
            if let Err(e) = sub.unsubscribe(t.clone()).await {
                tracing::warn!(%e, topic = %t, "could not unsubscribe a live-values topic");
            }
        }
    }
}

/// The entry for a topic's last message: its text, cut by the library
/// at 1024 characters, or an error for a payload that is not text.
fn entry(address: &str, m: &Message) -> ReadValue {
    let head = &m.payload[..m.payload.len().min(TEXT_BYTES)];
    let text = match std::str::from_utf8(head) {
        Ok(s) => Some(s),
        // Cut in the middle of a character by TEXT_BYTES.
        Err(e) if e.error_len().is_none() && head.len() < m.payload.len() => {
            std::str::from_utf8(&head[..e.valid_up_to()]).ok()
        }
        Err(_) => None,
    };
    match text {
        Some(t) => ReadValue::new(address, t)
            .with_type(ScoutType::String)
            .with_ts(m.ts),
        None => ReadValue::error(
            address,
            format!("Binary payload of {} bytes", m.payload.len()),
        )
        .with_ts(m.ts),
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

/// The reader the handler hands out for one connection.
pub struct MqttReader {
    pub(crate) live: Arc<Live>,
    pub(crate) sub: Arc<dyn Subscriber>,
    /// Set when the connection is lost.
    pub(crate) lost: Arc<Lost>,
}

#[async_trait]
impl Reader for MqttReader {
    async fn read(&self, addresses: Vec<String>) -> Vec<ReadValue> {
        if self.lost.is_set() {
            return addresses
                .into_iter()
                .map(|a| ReadValue::error(a, NOT_CONNECTED))
                .collect();
        }
        self.live.read(&*self.sub, &addresses).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rs_edge_driver::ReadData;

    /// Records what is sent, and fails when told to.
    #[derive(Default)]
    struct Record {
        sent: Mutex<Vec<String>>,
        fail: AtomicBool,
    }

    impl Record {
        fn take(&self) -> Vec<String> {
            std::mem::take(&mut self.sent.lock().unwrap())
        }
    }

    #[async_trait]
    impl Subscriber for Record {
        async fn subscribe(&self, topics: Vec<String>) -> Result<(), String> {
            if self.fail.load(Ordering::SeqCst) {
                return Err("request queue closed".into());
            }
            self.sent
                .lock()
                .unwrap()
                .push(format!("sub {}", topics.join(",")));
            Ok(())
        }
        async fn unsubscribe(&self, topic: String) -> Result<(), String> {
            self.sent.lock().unwrap().push(format!("unsub {topic}"));
            Ok(())
        }
    }

    fn live() -> Live {
        Live::new(Duration::from_millis(200), Duration::from_millis(50))
    }

    fn strings(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    fn mapped(v: &[&str]) -> BTreeSet<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[tokio::test]
    async fn subscribes_once_and_answers_the_last_message() {
        let live = live();
        let sub = Record::default();
        let got = live.read(&sub, &strings(&["a/b", "c"])).await;
        assert_eq!(sub.take(), ["sub a/b,c"]);
        assert!(got.iter().all(|v| v.error.as_deref() == Some(NO_MESSAGE)));

        assert!(
            !live.record("a/b", &Bytes::from("1")),
            "only a read wants a/b"
        );
        assert!(!live.record("a/b", &Bytes::from(r#"{"t":21.4}"#)));
        assert!(live.record("other", &Bytes::from("x")), "not a read topic");
        let got = live.read(&sub, &strings(&["a/b", "c"])).await;
        assert!(sub.take().is_empty(), "no second SUBSCRIBE");
        assert_eq!(got[0].value, Some(ReadData::from(r#"{"t":21.4}"#)));
        assert_eq!(got[0].r#type, Some(ScoutType::String));
        assert!(got[0].ts.is_some());
        assert_eq!(got[1].error.as_deref(), Some(NO_MESSAGE));
    }

    /// A mapped topic is never subscribed to again, its messages still
    /// go to the Edge Agent, and it is never unsubscribed by a read.
    #[tokio::test]
    async fn mapped_topics_are_left_alone() {
        let live = live();
        let sub = Record::default();
        live.set_mapped(&mapped(&["m"]));
        live.read(&sub, &strings(&["m", "r"])).await;
        assert_eq!(sub.take(), ["sub r"]);
        assert!(live.record("m", &Bytes::from("5")), "mapped data goes on");
        let got = live.read(&sub, &strings(&["m"])).await;
        assert_eq!(got[0].value, Some(ReadData::from("5")));

        tokio::time::sleep(Duration::from_millis(250)).await;
        live.expire(&sub).await;
        assert_eq!(sub.take(), ["unsub r"]);
        assert!(live.record("r", &Bytes::from("x")), "r is forgotten");
        assert!(!live.active.load(Ordering::SeqCst));
    }

    /// The address map dropping a topic a read wants leaves it
    /// subscribed until the read's expiry.
    #[tokio::test]
    async fn an_unmapped_topic_a_read_wants_stays_until_it_expires() {
        let live = live();
        let sub = Record::default();
        live.set_mapped(&mapped(&["m"]));
        live.read(&sub, &strings(&["m"])).await;
        assert!(sub.take().is_empty());
        assert!(!live.may_unsubscribe("m"));
        assert!(live.may_unsubscribe("other"));
        live.set_mapped(&mapped(&[]));
        assert_eq!(live.own_topics(), ["m"]);
        tokio::time::sleep(Duration::from_millis(250)).await;
        live.expire(&sub).await;
        assert_eq!(sub.take(), ["unsub m"]);
    }

    /// Reads keep a topic alive, and only topics nobody asked for in
    /// the TTL go.
    #[tokio::test]
    async fn reads_keep_topics_alive() {
        let live = live();
        let sub = Record::default();
        live.read(&sub, &strings(&["a", "b"])).await;
        sub.take();
        for _ in 0..3 {
            tokio::time::sleep(Duration::from_millis(100)).await;
            live.read(&sub, &strings(&["a"])).await;
            live.expire(&sub).await;
        }
        assert_eq!(sub.take(), ["unsub b"]);
    }

    #[tokio::test]
    async fn wildcards_and_bad_topics_are_refused() {
        let live = live();
        let sub = Record::default();
        let got = live
            .read(&sub, &strings(&["a/#", "+", "a/#/b", "ok"]))
            .await;
        assert_eq!(sub.take(), ["sub ok"]);
        assert_eq!(got[0].error.as_deref(), Some(WILDCARD));
        assert_eq!(got[1].error.as_deref(), Some(WILDCARD));
        assert_eq!(got[2].error.as_deref(), Some(INVALID));
    }

    #[tokio::test]
    async fn refused_and_failed_subscriptions() {
        let live = live();
        let sub = Record::default();
        live.read(&sub, &strings(&["no"])).await;
        live.refused(&["no"]);
        let got = live.read(&sub, &strings(&["no"])).await;
        assert_eq!(got[0].error.as_deref(), Some(REFUSED));

        sub.fail.store(true, Ordering::SeqCst);
        let got = live.read(&sub, &strings(&["x"])).await;
        assert_eq!(got[0].error.as_deref(), Some(BUSY));
        assert_eq!(live.own_topics(), ["no"], "x is not held");
    }

    /// A read waits for the first message on a topic it has just
    /// subscribed to, such as a retained one.
    #[tokio::test]
    async fn a_new_topic_waits_for_its_first_message() {
        let live = Arc::new(Live::new(Duration::from_secs(60), Duration::from_secs(2)));
        let sub = Arc::new(Record::default());
        let read = tokio::spawn({
            let (live, sub) = (live.clone(), sub.clone());
            async move { live.read(&*sub, &strings(&["r"])).await }
        });
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(!read.is_finished());
        live.record("r", &Bytes::from("retained"));
        let got = tokio::time::timeout(Duration::from_millis(500), read)
            .await
            .expect("answered on the message")
            .unwrap();
        assert_eq!(got[0].value, Some(ReadData::from("retained")));
    }

    #[test]
    fn payload_text() {
        let m = |p: &[u8]| Message {
            payload: Bytes::copy_from_slice(p),
            ts: 7,
        };
        let v = entry("a", &m(b"plain"));
        assert_eq!(v.value, Some(ReadData::from("plain")));
        assert_eq!(v.ts, Some(7));
        let v = entry("a", &m(&[0xff, 0x00, 0x01]));
        assert_eq!(v.value, None);
        assert_eq!(v.error.as_deref(), Some("Binary payload of 3 bytes"));
        // A long payload cut in the middle of a character is still text.
        let long = "é".repeat(3000);
        let v = entry("a", &m(long.as_bytes()));
        let Some(ReadData::Json(serde_json::Value::String(s))) = v.value else {
            panic!("not text: {v:?}");
        };
        assert_eq!(s.chars().count(), TEXT_BYTES / 2);
    }
}

//! Findings from the code review of the split-driver work (ACS-51).
//! Each test failed on the library before its fix.

mod common;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use bytes::Bytes;
use common::handler::{Ctl, FakeHandler};
use common::{FakeAgent, FromDriver, lookup, ms, register, secs, spawn_driver, spawn_driver_with};
use rs_edge_driver::{
    ConnectError, DriverHandle, DriverOptions, Handler, HandlerError, WriteError, WriteValue,
};

/// Statuses among `events`, in order.
fn statuses(events: &[FromDriver]) -> Vec<String> {
    events
        .iter()
        .filter_map(|e| match e {
            FromDriver::Status(s) => Some(s.clone()),
            _ => None,
        })
        .collect()
}

/// Answers on `result/<id>` among `events`, as (id, payload).
fn results(events: &[FromDriver]) -> Vec<(String, String)> {
    events
        .iter()
        .filter_map(|e| match e {
            FromDriver::Other { topic, payload } => {
                let id = topic.split("/result/").nth(1)?;
                Some((id.to_owned(), String::from_utf8_lossy(payload).into_owned()))
            }
            _ => None,
        })
        .collect()
}

// ---------------------------------------------------------------------
// Finding 1: a session drop while a handler waits in publish_wait.

/// Pushes data with `publish_wait` from its own task, as a subscribed
/// device does, and joins that task in `close`.
struct PushHandler {
    handle: DriverHandle<String>,
    stop: Arc<AtomicBool>,
    pusher: Option<tokio::task::JoinHandle<()>>,
}

#[async_trait]
impl Handler for PushHandler {
    type Addr = String;
    const SUPPORTS_POLL: bool = false;

    fn create(handle: DriverHandle<String>, _: serde_json::Value) -> Result<Self, HandlerError> {
        Ok(Self {
            handle,
            stop: Arc::new(AtomicBool::new(false)),
            pusher: None,
        })
    }

    fn parse_addr(&self, addr: &str) -> Option<String> {
        Some(addr.to_owned())
    }

    async fn connect(&mut self) -> Result<(), ConnectError> {
        Ok(())
    }

    async fn subscribe(&mut self, addrs: &[String]) -> bool {
        if self.pusher.is_none() {
            let handle = self.handle.clone();
            let stop = self.stop.clone();
            let addr = addrs[0].clone();
            self.pusher = Some(tokio::spawn(async move {
                while !stop.load(Ordering::SeqCst) {
                    handle
                        .publish_wait(addr.clone(), Bytes::from(vec![b'x'; 1024]))
                        .await;
                }
            }));
        }
        true
    }

    async fn cmd(&mut self, _: &str, _: Bytes) {
        tokio::time::sleep(secs(1)).await;
    }

    async fn close(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(pusher) = self.pusher.take() {
            let _ = pusher.await;
        }
    }
}

#[tokio::test]
async fn session_drop_with_a_waiting_publisher_reconnects() {
    let mut agent = FakeAgent::start("Conn").await;
    let mut options = DriverOptions::default();
    options.publish_queue_bytes = 8 * 1024;
    let _driver = spawn_driver_with::<PushHandler>(agent.config(), options);

    agent.handshake(serde_json::json!({}), &[("1", "a")]).await;
    agent.wait_status("UP", secs(5)).await;
    assert!(!agent.collect_data(10, secs(5)).await.is_empty());

    // A slow cmd keeps the handler busy, then the session drops.
    agent.send("cmd/a", "1");
    tokio::time::sleep(ms(100)).await;
    agent.kick();

    agent.wait_status("READY", secs(8)).await;
    assert_eq!(agent.stats.connects(), 2);
}

// ---------------------------------------------------------------------
// Finding 2: a rejected address map is overwritten by UP.

#[tokio::test]
async fn rejected_addrs_stay_addr_when_the_device_returns() {
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<FakeHandler>(agent.config());
    let ctl = Ctl::new();
    *ctl.connect_error.lock().unwrap() = Some(ConnectError::ConnectionFailed);

    agent.handshake(ctl.conf(), &[("1", "bad")]).await;
    agent.wait_status("ADDR", secs(5)).await;

    // The device comes back, with the address map still rejected.
    *ctl.connect_error.lock().unwrap() = None;
    let seen = statuses(&agent.drain(ms(1500)).await);
    assert!(
        !seen.contains(&"UP".to_owned()),
        "UP with no addresses: {seen:?}"
    );
    assert_eq!(seen.last().map(String::as_str), Some("ADDR"), "{seen:?}");

    // A good map brings it up.
    agent.send_addrs(&[("1", "a")]);
    agent.wait_status("UP", secs(5)).await;
}

// ---------------------------------------------------------------------
// Finding 3: one oversized outgoing message ends the session.

#[tokio::test]
async fn oversized_poll_result_is_dropped_not_fatal() {
    let mut agent = FakeAgent::start("Conn").await;
    let mut options = DriverOptions::default();
    options.max_packet_size = 64 * 1024;
    let _driver = spawn_driver_with::<FakeHandler>(agent.config(), options);
    let ctl = Ctl::new();
    *ctl.poll_size.lock().unwrap() = Some(100 * 1024);

    agent.handshake(ctl.conf(), &[("1", "a")]).await;
    agent.wait_status("UP", secs(5)).await;
    agent.send("poll", "1");
    tokio::time::sleep(ms(500)).await;

    *ctl.poll_size.lock().unwrap() = None;
    agent.send("poll", "1");
    let data = agent.collect_data(1, secs(5)).await;
    assert_eq!(data, vec![("1".to_owned(), Bytes::from("a"))]);
    assert_eq!(agent.stats.connects(), 1, "the session ended");
}

#[tokio::test]
async fn oversized_async_data_is_dropped_not_fatal() {
    let mut agent = FakeAgent::start("Conn").await;
    let mut options = DriverOptions::default();
    options.max_packet_size = 64 * 1024;
    let _driver = spawn_driver_with::<FakeHandler>(agent.config(), options);
    let ctl = Ctl::new();

    agent.handshake(ctl.conf(), &[("1", "a")]).await;
    agent.wait_status("UP", secs(5)).await;
    ctl.handle()
        .publish("a".into(), Bytes::from(vec![0u8; 100 * 1024]));
    ctl.handle().publish("a".into(), Bytes::from("small"));

    let data = agent.collect_data(1, secs(5)).await;
    assert_eq!(data, vec![("1".to_owned(), Bytes::from("small"))]);
    assert_eq!(agent.stats.connects(), 1, "the session ended");
}

// ---------------------------------------------------------------------
// Finding 7: writes dropped while a map parses get no answer.

/// A typed-write handler whose `connect` holds the handler for a
/// while, so an address map waits to be parsed and writes are held
/// back behind it.
struct SlowTyped {
    written: Arc<Mutex<Vec<String>>>,
}

#[async_trait]
impl Handler for SlowTyped {
    type Addr = String;
    const TYPED_WRITES: bool = true;

    fn create(_: DriverHandle<String>, config: serde_json::Value) -> Result<Self, HandlerError> {
        let written = lookup(&config).ok_or_else(|| HandlerError::new("no key"))?;
        Ok(Self { written })
    }

    fn parse_addr(&self, addr: &str) -> Option<String> {
        Some(addr.to_owned())
    }

    async fn connect(&mut self) -> Result<(), ConnectError> {
        tokio::time::sleep(secs(2)).await;
        Ok(())
    }

    async fn close(&mut self) {}

    async fn write(&mut self, addr: &String, _: WriteValue) -> Result<(), WriteError> {
        self.written.lock().unwrap().push(addr.clone());
        Ok(())
    }
}

/// Send conf, let `connect` take the handler, then send the address
/// map, which must wait for it, so writes sent next are held back.
async fn hold_writes(agent: &mut FakeAgent, written: &Arc<Mutex<Vec<String>>>) {
    agent.wait_status("READY", secs(5)).await;
    agent.send("conf", register(written.clone()).to_string());
    tokio::time::sleep(ms(200)).await;
    agent.send_addrs(&[("1", "a")]);
}

fn write_with_id(id: &str) -> String {
    format!(r#"{{"type":"Int16","value":1,"id":"{id}"}}"#)
}

#[tokio::test]
async fn writes_dropped_at_the_deferral_cap_are_answered() {
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<SlowTyped>(agent.config());
    let written: Arc<Mutex<Vec<String>>> = Arc::default();

    hold_writes(&mut agent, &written).await;
    for i in 0..1005 {
        agent.send("write/a", write_with_id(&format!("w{i}")));
    }
    let answers = results(&agent.drain(secs(1)).await);
    let refused: Vec<_> = answers
        .iter()
        .filter(|(_, p)| p.starts_with("ERR"))
        .collect();
    assert_eq!(refused.len(), 5, "{answers:?}");
}

#[tokio::test]
async fn writes_held_when_the_handler_closes_are_answered() {
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<SlowTyped>(agent.config());
    let written: Arc<Mutex<Vec<String>>> = Arc::default();

    hold_writes(&mut agent, &written).await;
    agent.send("write/a", write_with_id("held1"));
    agent.send("write/a", write_with_id("held2"));
    tokio::time::sleep(ms(200)).await;

    // A new conf closes the handler while the writes are held.
    agent.send("conf", register(written.clone()).to_string());
    let answers = results(&agent.drain(secs(1)).await);
    let mut ids: Vec<_> = answers
        .iter()
        .filter(|(_, p)| p.starts_with("ERR"))
        .map(|(id, _)| id.as_str())
        .collect();
    ids.sort();
    assert_eq!(ids, ["held1", "held2"], "{answers:?}");
}

// ---------------------------------------------------------------------
// Finding 10: a Lost that arrives while connecting is ignored.

#[tokio::test]
async fn lost_reported_during_connect_is_not_ignored() {
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<FakeHandler>(agent.config());
    let ctl = Ctl::new();
    ctl.lose_on_connect.store(1, Ordering::SeqCst);

    agent.handshake(ctl.conf(), &[("1", "a")]).await;
    let seen = agent.wait_status("UP", secs(5)).await;
    // The first connect lost its session at once, so the driver must
    // have reported it and connected again.
    assert!(
        statuses(&seen).contains(&"CONN".to_owned()),
        "no CONN before UP: {seen:?}"
    );
    tokio::time::sleep(ms(300)).await;
    assert_eq!(Ctl::count(&ctl.connects), 2);
    let later = statuses(&agent.drain(ms(500)).await);
    assert!(later.is_empty(), "status changed after UP: {later:?}");
}

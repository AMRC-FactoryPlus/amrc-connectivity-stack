//! Address groups: the agent sends each device's poll interval and
//! data topics with the address map, and a handler can have them
//! through `Handler::subscribe_groups`.

mod common;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use common::{FakeAgent, lookup, ms, register, secs, spawn_driver};
use rs_edge_driver::{AddrGroup, ConnectError, DriverHandle, Handler, HandlerError};

/// What the handlers have been asked to subscribe to.
#[derive(Default)]
struct Seen {
    subscribes: Mutex<Vec<Vec<String>>>,
    groups: Mutex<Vec<Vec<AddrGroup<String>>>>,
}

/// Overrides `subscribe_groups`.
struct GroupHandler {
    seen: Arc<Seen>,
}

#[async_trait]
impl Handler for GroupHandler {
    type Addr = String;

    fn create(_: DriverHandle<String>, config: serde_json::Value) -> Result<Self, HandlerError> {
        let seen = lookup(&config).ok_or_else(|| HandlerError::new("no ctl key"))?;
        Ok(Self { seen })
    }

    fn parse_addr(&self, addr: &str) -> Option<String> {
        Some(addr.to_owned())
    }

    async fn connect(&mut self) -> Result<(), ConnectError> {
        Ok(())
    }

    async fn close(&mut self) {}

    async fn subscribe_groups(&mut self, addrs: &[String], groups: &[AddrGroup<String>]) -> bool {
        let mut addrs = addrs.to_vec();
        addrs.sort();
        self.seen.subscribes.lock().unwrap().push(addrs);
        self.seen.groups.lock().unwrap().push(groups.to_vec());
        true
    }
}

/// Overrides only `subscribe`, as every handler written before
/// `subscribe_groups` existed does.
struct PlainHandler {
    seen: Arc<Seen>,
}

#[async_trait]
impl Handler for PlainHandler {
    type Addr = String;

    fn create(_: DriverHandle<String>, config: serde_json::Value) -> Result<Self, HandlerError> {
        let seen = lookup(&config).ok_or_else(|| HandlerError::new("no ctl key"))?;
        Ok(Self { seen })
    }

    fn parse_addr(&self, addr: &str) -> Option<String> {
        Some(addr.to_owned())
    }

    async fn connect(&mut self) -> Result<(), ConnectError> {
        Ok(())
    }

    async fn close(&mut self) {}

    async fn subscribe(&mut self, addrs: &[String]) -> bool {
        let mut addrs = addrs.to_vec();
        addrs.sort();
        self.seen.subscribes.lock().unwrap().push(addrs);
        true
    }
}

/// The address map the agent sends for two devices, one polled every
/// 250 ms and one every 1.5 s, sharing one address. `extra` is a topic
/// that is in a group but not in the map.
fn addr_packet() -> String {
    serde_json::json!({
        "version": 1,
        "addrs": { "1": "ns=2;s=A", "2": "ns=2;s=B", "3": "ns=2;s=C" },
        "groups": {
            "Fast": { "poll": 250, "addrs": ["1", "2"] },
            "Slow": { "poll": 1500, "addrs": ["2", "3", "extra"] },
        },
    })
    .to_string()
}

async fn wait_for(seen: &Seen, n: usize) {
    let deadline = tokio::time::Instant::now() + secs(5);
    while seen.subscribes.lock().unwrap().len() < n {
        assert!(tokio::time::Instant::now() < deadline, "no subscribe call");
        tokio::time::sleep(ms(20)).await;
    }
}

#[tokio::test]
async fn handler_gets_each_group_with_its_poll_interval() {
    let mut agent = FakeAgent::start("groups").await;
    let _driver = spawn_driver::<GroupHandler>(agent.config());
    let seen = Arc::new(Seen::default());

    agent.wait_status("READY", secs(5)).await;
    agent.send("conf", register(seen.clone()).to_string());
    agent.send("addr", addr_packet());
    agent.wait_status("UP", secs(5)).await;
    wait_for(&seen, 1).await;

    assert_eq!(
        seen.subscribes.lock().unwrap()[0],
        vec!["ns=2;s=A", "ns=2;s=B", "ns=2;s=C"]
    );
    let groups = seen.groups.lock().unwrap()[0].clone();
    assert_eq!(groups.len(), 2);
    assert_eq!(groups[0].name, "Fast");
    assert_eq!(groups[0].poll, Duration::from_millis(250));
    assert_eq!(groups[0].addrs, vec!["ns=2;s=A", "ns=2;s=B"]);
    assert_eq!(groups[1].name, "Slow");
    assert_eq!(groups[1].poll, Duration::from_millis(1500));
    // A topic missing from the map is left out.
    assert_eq!(groups[1].addrs, vec!["ns=2;s=B", "ns=2;s=C"]);
}

#[tokio::test]
async fn a_map_without_groups_gives_none() {
    let mut agent = FakeAgent::start("nogroups").await;
    let _driver = spawn_driver::<GroupHandler>(agent.config());
    let seen = Arc::new(Seen::default());

    agent.wait_status("READY", secs(5)).await;
    agent.send("conf", register(seen.clone()).to_string());
    agent.send(
        "addr",
        serde_json::json!({ "version": 1, "addrs": { "1": "ns=2;s=A" } }).to_string(),
    );
    agent.wait_status("UP", secs(5)).await;
    wait_for(&seen, 1).await;

    assert_eq!(seen.subscribes.lock().unwrap()[0], vec!["ns=2;s=A"]);
    assert!(seen.groups.lock().unwrap()[0].is_empty());
}

#[tokio::test]
async fn a_handler_without_subscribe_groups_gets_subscribe_as_before() {
    let mut agent = FakeAgent::start("plain").await;
    let _driver = spawn_driver::<PlainHandler>(agent.config());
    let seen = Arc::new(Seen::default());

    agent.wait_status("READY", secs(5)).await;
    agent.send("conf", register(seen.clone()).to_string());
    agent.send("addr", addr_packet());
    agent.wait_status("UP", secs(5)).await;
    wait_for(&seen, 1).await;

    assert_eq!(
        seen.subscribes.lock().unwrap()[0],
        vec!["ns=2;s=A", "ns=2;s=B", "ns=2;s=C"]
    );
}

//! Scouting: the feature gate, the hello, scans and their limits, as
//! the "Scouting" section of `acs-edge/docs/edge-split.md` sets them.
//! Every message the driver sends is checked against the JSON Schemas
//! in `lib/edge-scout-schemas`.

mod common;

use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use bytes::Bytes;
use common::handler::{Ctl, FakeHandler};
use common::{Acl, FakeAgent, FromDriver, lookup, ms, register, secs, spawn_driver};
use rs_edge_driver::{
    ConnectError, DriverHandle, Excluded, Handler, HandlerError, Item, Progress, ReadValue, Reader,
    ScoutEnd, ScoutError, ScoutRequest, ScoutSink, ScoutType, Scouter,
};
use serde_json::{Value, json};
use tokio::time::Instant;

const SCAN: &str = "3f9c1a2b44e04d0c9a7e5b1f2c3d4e5f";

// ---------------------------------------------------------------
// Schemas

fn schema_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../edge-scout-schemas")
}

fn load(path: PathBuf) -> Value {
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path:?}: {e}"));
    serde_json::from_str(&text).unwrap()
}

struct Schemas {
    found: jsonschema::Validator,
    item: jsonschema::Validator,
    request: jsonschema::Validator,
}

fn compile(name: &str) -> jsonschema::Validator {
    let dir = schema_dir().join("schemas");
    let common = load(dir.join("common.schema.json"));
    let schema = load(dir.join(format!("{name}.schema.json")));
    jsonschema::options()
        .with_draft(jsonschema::Draft::Draft202012)
        .with_resource(
            "urn:edge-scout:common",
            jsonschema::Resource::from_contents(common).expect("common schema"),
        )
        .build(&schema)
        .unwrap_or_else(|e| panic!("{name} schema: {e}"))
}

static SCHEMAS: LazyLock<Schemas> = LazyLock::new(|| Schemas {
    found: compile("found"),
    item: compile("item"),
    request: compile("request"),
});

/// Whether found.schema.json in this checkout knows the `values`
/// message yet. The library's tests check a `values` message against
/// it when it does, and against the shape in the spec always.
fn schema_knows_values() -> bool {
    SCHEMAS
        .found
        .is_valid(&json!({ "seq": 0, "type": "values", "values": [] }))
}

/// Check a `values` message against the shape in the "Values" section
/// of the Edge Scout spec.
fn check_values(msg: &Value) {
    assert_eq!(msg["seq"], 0, "{msg}");
    for v in msg["values"].as_array().expect("values array") {
        let keys: Vec<_> = v.as_object().unwrap().keys().cloned().collect();
        assert_eq!(keys.len(), 5, "{v}");
        assert!(v["address"].is_string(), "{v}");
        assert!(v["value"].is_null() || v["value"].as_str().unwrap().chars().count() <= 1024);
        assert!(v["type"].is_null() || v["type"].is_string(), "{v}");
        assert!(v["ts"].is_null() || v["ts"].is_i64(), "{v}");
        assert!(v["error"].is_null() || v["error"].as_str().unwrap().chars().count() <= 256);
    }
}

/// Check a found message, and each item in it, against the schemas.
fn check_found(msg: &Value) {
    if msg["type"] == "values" {
        check_values(msg);
        if !schema_knows_values() {
            return;
        }
    }
    let errors: Vec<_> = SCHEMAS
        .found
        .iter_errors(msg)
        .map(|e| e.to_string())
        .collect();
    assert!(
        errors.is_empty(),
        "{msg} breaks found.schema.json: {errors:?}"
    );
    if let Some(items) = msg.get("items").and_then(Value::as_array) {
        for item in items {
            let errors: Vec<_> = SCHEMAS
                .item
                .iter_errors(item)
                .map(|e| e.to_string())
                .collect();
            assert!(
                errors.is_empty(),
                "{item} breaks item.schema.json: {errors:?}"
            );
        }
    }
}

// ---------------------------------------------------------------
// A handler that scouts

/// What the scouting handler's scouter does.
#[derive(Clone, Debug)]
enum Mode {
    /// Folders and values, `n` in all, added `batch` at a time.
    Tree { n: usize, batch: usize },
    /// Adds 10 items, then waits forever, ignoring cancellation.
    Hang,
    /// Adds an item and paces, until stopped, honouring `pace`.
    Slow,
    /// Panics.
    Panic,
    /// Returns this error.
    Fail(ScoutError),
    /// `scouter()` returns `None`.
    NoScouter,
    /// Reports progress, then waits until cancelled.
    Progress,
}

/// What the scouting handler's reader does.
#[derive(Clone, Debug, PartialEq)]
enum ReadMode {
    /// Answers `value of <address>` for each address, except `missing`
    /// which it leaves out, and adds one it was not asked for.
    Answer,
    /// `reader()` returns `None`.
    NoReader,
    /// Panics.
    Panic,
    /// Never answers.
    Hang,
}

struct ScoutCtl {
    mode: Mutex<Mode>,
    read_mode: Mutex<ReadMode>,
    reads: AtomicUsize,
    connect_fails: Mutex<bool>,
    scans: AtomicUsize,
    stopped: AtomicUsize,
    requests: Mutex<Vec<ScoutRequest>>,
    cmds: Mutex<Vec<String>>,
}

impl ScoutCtl {
    fn new(mode: Mode) -> Arc<Self> {
        Arc::new(Self {
            mode: Mutex::new(mode),
            read_mode: Mutex::new(ReadMode::Answer),
            reads: AtomicUsize::new(0),
            connect_fails: Mutex::new(false),
            scans: AtomicUsize::new(0),
            stopped: AtomicUsize::new(0),
            requests: Mutex::new(Vec::new()),
            cmds: Mutex::new(Vec::new()),
        })
    }

    /// A `conf` payload that makes the handler use this control.
    fn conf(self: &Arc<Self>) -> Value {
        register(self.clone())
    }
}

struct ScoutHandler {
    ctl: Arc<ScoutCtl>,
}

struct TestScouter {
    ctl: Arc<ScoutCtl>,
}

#[async_trait]
impl Scouter for TestScouter {
    async fn scout(&self, req: ScoutRequest, sink: ScoutSink) -> Result<ScoutEnd, ScoutError> {
        self.ctl.scans.fetch_add(1, Ordering::SeqCst);
        self.ctl.requests.lock().unwrap().push(req.clone());
        let mode = self.ctl.mode.lock().unwrap().clone();
        match mode {
            Mode::Tree { n, batch } => {
                let mut items = Vec::new();
                if let Some(folder) = &req.folder_id {
                    items.push(Item::folder(folder.clone(), None, "branch"));
                }
                for i in items.len()..n {
                    let parent = format!("f{}", i / 100);
                    let item = if i % 100 == 0 {
                        Item::folder(format!("f{}", i / 100), None, format!("Folder {}", i / 100))
                    } else {
                        Item::value(
                            format!("v{i}"),
                            Some(&parent),
                            format!("V{i}"),
                            format!("a{i}"),
                        )
                        .with_type(ScoutType::Double)
                        .with_sample("1.5")
                        .with_detail(json!({ "n": i }))
                    };
                    items.push(item);
                    if items.len() >= batch {
                        sink.add(std::mem::take(&mut items)).await?;
                    }
                }
                if !items.is_empty() {
                    sink.add(items).await?;
                }
                Ok(ScoutEnd::new(true)
                    .exclude(Excluded::new("i=2253", "skipped").with_prefixes(["i="])))
            }
            Mode::Hang => {
                let items = (0..10)
                    .map(|i| Item::folder(format!("h{i}"), None, "H"))
                    .collect();
                sink.add(items).await?;
                std::future::pending::<()>().await;
                unreachable!()
            }
            Mode::Slow => {
                let token = sink.cancelled();
                let mut i = 0;
                loop {
                    if token.is_cancelled() {
                        self.ctl.stopped.fetch_add(1, Ordering::SeqCst);
                        return Err(ScoutError::err("stopped"));
                    }
                    sink.add(vec![Item::folder(format!("s{i}"), None, "S")])
                        .await?;
                    i += 1;
                    if let Err(stop) = sink.pace().await {
                        self.ctl.stopped.fetch_add(1, Ordering::SeqCst);
                        return Err(stop.into());
                    }
                }
            }
            Mode::Panic => panic!("the device spoke Klingon"),
            Mode::Fail(e) => Err(e),
            Mode::NoScouter => unreachable!(),
            Mode::Progress => {
                sink.progress(Progress::new(7).with_note("Line1"));
                sink.cancelled().cancelled().await;
                Err(ScoutError::err("cancelled"))
            }
        }
    }
}

struct TestReader {
    ctl: Arc<ScoutCtl>,
}

#[async_trait]
impl Reader for TestReader {
    async fn read(&self, addresses: Vec<String>) -> Vec<ReadValue> {
        self.ctl.reads.fetch_add(1, Ordering::SeqCst);
        let mode = self.ctl.read_mode.lock().unwrap().clone();
        match mode {
            ReadMode::Panic => panic!("the PLC caught fire"),
            ReadMode::Hang => std::future::pending().await,
            ReadMode::NoReader => unreachable!(),
            ReadMode::Answer => {
                let mut out: Vec<_> = addresses
                    .into_iter()
                    .filter(|a| a != "missing")
                    .map(|a| match a.as_str() {
                        "nan" => ReadValue::new(a, f64::NAN).with_type(ScoutType::Double),
                        "gone" => ReadValue::error(a, "BadNodeIdUnknown"),
                        _ => ReadValue::new(a.clone(), format!("value of {a}"))
                            .with_type(ScoutType::String)
                            .with_ts(1_795_600_000_000),
                    })
                    .collect();
                out.push(ReadValue::new("not asked for", 1));
                out
            }
        }
    }
}

#[async_trait]
impl Handler for ScoutHandler {
    type Addr = String;
    const SCOUTS: bool = true;
    const READS: bool = true;

    fn create(_: DriverHandle<String>, config: Value) -> Result<Self, HandlerError> {
        let ctl = lookup(&config).ok_or_else(|| HandlerError::new("no ctl key"))?;
        Ok(Self { ctl })
    }

    fn parse_addr(&self, addr: &str) -> Option<String> {
        (addr != "bad").then(|| addr.to_owned())
    }

    async fn connect(&mut self) -> Result<(), ConnectError> {
        if *self.ctl.connect_fails.lock().unwrap() {
            return Err(ConnectError::ConnectionFailed);
        }
        Ok(())
    }

    async fn close(&mut self) {}

    async fn poll(&mut self, addr: &String) -> Option<Bytes> {
        Some(Bytes::from(addr.clone()))
    }

    async fn cmd(&mut self, command: &str, _payload: Bytes) {
        self.ctl.cmds.lock().unwrap().push(command.to_owned());
        if command == "block" {
            // Hold the handler's lock for good.
            std::future::pending::<()>().await;
        }
    }

    fn reader(&self) -> Option<Arc<dyn Reader>> {
        if *self.ctl.read_mode.lock().unwrap() == ReadMode::NoReader {
            return None;
        }
        Some(Arc::new(TestReader {
            ctl: self.ctl.clone(),
        }))
    }

    fn scouter(&self) -> Option<Arc<dyn Scouter>> {
        if matches!(*self.ctl.mode.lock().unwrap(), Mode::NoScouter) {
            return None;
        }
        Some(Arc::new(TestScouter {
            ctl: self.ctl.clone(),
        }))
    }
}

// ---------------------------------------------------------------
// Helpers

fn scout_topic(agent: &FakeAgent) -> String {
    format!("fpEdge1/{}/scout", agent.id)
}

fn scout_subs(agent: &FakeAgent) -> usize {
    let topic = scout_topic(agent);
    agent
        .stats
        .subscriptions()
        .iter()
        .filter(|s| **s == topic)
        .count()
}

/// Wait until the driver has subscribed to `scout` `n` times.
async fn wait_scout_subs(agent: &FakeAgent, n: usize) {
    let deadline = Instant::now() + secs(5);
    while scout_subs(agent) < n {
        assert!(
            Instant::now() < deadline,
            "the driver did not subscribe to scout"
        );
        tokio::time::sleep(ms(10)).await;
    }
}

/// Start a driver for `H`, bring it UP with the scouting feature, and
/// wait for its `scout` subscription.
async fn up_with_scouting<H: Handler + 'static>(conf: Value) -> (FakeAgent, common::RunningDriver) {
    let mut agent = FakeAgent::start("Conn").await;
    agent.stats.set_acl(Some(Acl::with_scout()));
    let driver = spawn_driver::<H>(agent.config());
    agent.wait_status("READY", secs(5)).await;
    agent.send("conf", conf.to_string());
    agent.send_addrs_features(&[("1", "a")], json!({ "scout": 1 }));
    agent.wait_status("UP", secs(5)).await;
    wait_scout_subs(&agent, 1).await;
    (agent, driver)
}

fn start_msg(id: &str, limits: Value) -> String {
    json!({
        "op": "start", "id": id, "version": 1, "root": null, "folder_id": null,
        "options": {}, "limits": limits,
    })
    .to_string()
}

fn limits(items: u64, seconds: u64) -> Value {
    json!({ "items": items, "depth": 8, "seconds": seconds, "pace_ms": 0, "samples": false })
}

/// Collect the messages on `found/<id>` up to and including the end,
/// checking each against the schema. Other events go in `others`.
async fn found_until_end(
    agent: &mut FakeAgent,
    id: &str,
    within: Duration,
    others: &mut Vec<FromDriver>,
) -> Vec<Value> {
    let topic = format!("fpEdge1/{}/found/{id}", agent.id);
    let deadline = Instant::now() + within;
    let mut out = Vec::new();
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        match agent.next(left).await {
            Some(FromDriver::Other { topic: t, payload }) if t == topic => {
                let v: Value = serde_json::from_slice(&payload).unwrap();
                check_found(&v);
                // A hello or values answer is the only message on its
                // topic.
                let end = v["type"] == "end" || v["type"] == "hello" || v["type"] == "values";
                out.push(v);
                if end {
                    return out;
                }
            }
            Some(ev) => others.push(ev),
            None => panic!("no end on {topic} within {within:?}; got {out:?}"),
        }
    }
}

async fn found(agent: &mut FakeAgent, id: &str, within: Duration) -> Vec<Value> {
    found_until_end(agent, id, within, &mut Vec::new()).await
}

fn assert_seq(msgs: &[Value]) {
    for (i, m) in msgs.iter().enumerate() {
        assert_eq!(m["seq"], i as u64, "seq gap in {msgs:?}");
    }
}

fn items_of(msgs: &[Value]) -> Vec<Value> {
    msgs.iter()
        .filter(|m| m["type"] == "items")
        .flat_map(|m| m["items"].as_array().unwrap().clone())
        .collect()
}

fn end_of(msgs: &[Value]) -> &Value {
    let end = msgs.last().unwrap();
    assert_eq!(end["type"], "end");
    end
}

fn error_code(msgs: &[Value]) -> &str {
    end_of(msgs)["error"]["code"].as_str().unwrap_or("none")
}

// ---------------------------------------------------------------
// The feature gate

/// No `scout` subscription until an addr on this session carries the
/// feature, and only one per session after that. The second SUBACK
/// does not send READY again.
#[tokio::test]
async fn subscribes_only_after_the_feature_and_once() {
    let mut agent = FakeAgent::start("Conn").await;
    agent.stats.set_acl(Some(Acl::with_scout()));
    let _driver = spawn_driver::<FakeHandler>(agent.config());
    let ctl = Ctl::new();
    agent.handshake(ctl.conf(), &[("1", "a")]).await;
    agent.wait_status("UP", secs(5)).await;
    tokio::time::sleep(ms(200)).await;
    assert_eq!(scout_subs(&agent), 0, "subscribed without the feature");

    agent.send_addrs_features(&[("1", "a")], json!({ "scout": 1 }));
    wait_scout_subs(&agent, 1).await;
    agent.send_addrs_features(&[("1", "a")], json!({ "scout": 1 }));
    agent.send_addrs_features(&[("2", "b")], json!({ "scout": 1 }));
    let seen = agent.drain(ms(500)).await;
    assert_eq!(scout_subs(&agent), 1, "subscribed twice on one session");
    assert!(
        !seen
            .iter()
            .any(|e| matches!(e, FromDriver::Status(s) if s == "READY")),
        "the scout SUBACK sent READY again: {seen:?}"
    );
    assert_eq!(agent.stats.kicked(), 0);
}

/// A later version of the feature is not one this library knows.
#[tokio::test]
async fn ignores_a_feature_version_it_does_not_know() {
    let mut agent = FakeAgent::start("Conn").await;
    // The old ACL: a scout subscription would get the driver dropped.
    agent.stats.set_acl(Some(Acl::pre_v6_8()));
    let _driver = spawn_driver::<FakeHandler>(agent.config());
    let ctl = Ctl::new();
    agent.wait_status("READY", secs(5)).await;
    agent.send("conf", ctl.conf().to_string());
    agent.send_addrs_features(&[("1", "a")], json!({ "scout": 2, "other": 1 }));
    agent.wait_status("UP", secs(5)).await;
    agent.send_addrs_features(&[("1", "a")], json!({ "scout": "1" }));
    agent.drain(ms(300)).await;
    assert_eq!(scout_subs(&agent), 0);
    assert_eq!(agent.stats.kicked(), 0);
}

/// The harness check for the test below: the old ACL really does drop
/// a driver that subscribes to `scout`.
#[tokio::test]
async fn the_old_acl_drops_a_scout_subscription() {
    let mut agent = FakeAgent::start("Conn").await;
    agent.stats.set_acl(Some(Acl::pre_v6_8()));
    let _driver = spawn_driver::<FakeHandler>(agent.config());
    agent.handshake(Ctl::new().conf(), &[("1", "a")]).await;
    agent.wait_status("UP", secs(5)).await;
    agent.send_addrs_features(&[("1", "a")], json!({ "scout": 1 }));
    let seen = agent.drain(secs(1)).await;
    assert!(seen.iter().any(|e| matches!(e, FromDriver::Disconnected)));
    assert_eq!(agent.stats.kicked(), 1);
}

/// The feature is read before the version check, the handler check
/// and address parsing, so a driver in any of those states still
/// subscribes and answers the hello.
#[tokio::test]
async fn reads_features_before_anything_else() {
    // No handler: conf refused.
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<ScoutHandler>(agent.config());
    agent.wait_status("READY", secs(5)).await;
    agent.send("conf", "{}");
    agent.wait_status("CONF", secs(5)).await;
    agent.send_addrs_features(&[("1", "a")], json!({ "scout": 1 }));
    wait_scout_subs(&agent, 1).await;
    agent.send("scout", r#"{"op":"hello","version":1}"#);
    let hello = found(&mut agent, "hello", secs(5)).await;
    assert_eq!(
        hello[0]["supported"], true,
        "the hello comes from the class"
    );

    // An unknown addr version.
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<FakeHandler>(agent.config());
    agent.handshake(Ctl::new().conf(), &[("1", "a")]).await;
    agent.wait_status("UP", secs(5)).await;
    agent.send(
        "addr",
        json!({ "version": 2, "addrs": {}, "features": { "scout": 1 } }).to_string(),
    );
    agent.wait_status("ADDR", secs(5)).await;
    wait_scout_subs(&agent, 1).await;

    // A bad address.
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<FakeHandler>(agent.config());
    agent.wait_status("READY", secs(5)).await;
    agent.send("conf", Ctl::new().conf().to_string());
    agent.send_addrs_features(&[("1", "bad")], json!({ "scout": 1 }));
    agent.wait_status("ADDR", secs(5)).await;
    wait_scout_subs(&agent, 1).await;
}

/// The driver sees the feature, then its broker restarts as an Edge
/// Agent rolled back to before v6.8.0, whose addr has no features and
/// whose ACL drops a driver that subscribes to `scout`. The driver
/// must never ask for it, so it is never disconnected.
#[tokio::test]
async fn reconnect_to_an_old_agent_forgets_the_feature() {
    let (mut agent, _driver) =
        up_with_scouting::<ScoutHandler>(ScoutCtl::new(Mode::Tree { n: 5, batch: 5 }).conf()).await;
    let ctl = ScoutCtl::new(Mode::Tree { n: 5, batch: 5 });

    agent.stats.set_acl(Some(Acl::pre_v6_8()));
    agent.kick();
    agent.wait_status("READY", secs(5)).await;
    assert_eq!(agent.stats.connects(), 2);
    agent.send("conf", ctl.conf().to_string());
    agent.send_addrs(&[("1", "a")]);
    agent.wait_status("UP", secs(5)).await;
    agent.send("poll", "1");
    assert_eq!(agent.collect_data(1, secs(5)).await.len(), 1);
    // A scout message the old agent would never send is not answered
    // either: the driver has not subscribed on this session.
    agent.send("scout", r#"{"op":"hello","version":1}"#);
    let seen = agent.drain(secs(2)).await;
    assert!(
        !seen
            .iter()
            .any(|e| matches!(e, FromDriver::Other { topic, .. } if topic.contains("/found/"))),
        "the driver answered on found without the feature: {seen:?}"
    );
    assert_eq!(scout_subs(&agent), 1, "only the first session subscribed");
    assert_eq!(agent.stats.kicked(), 0, "the old ACL dropped the driver");
    assert_eq!(agent.stats.connects(), 2, "the driver reconnected again");
    assert!(!seen.iter().any(|e| matches!(e, FromDriver::Disconnected)));
}

// ---------------------------------------------------------------
// Hello

#[tokio::test]
async fn hello_says_whether_the_handler_scouts() {
    let (mut agent, _driver) = up_with_scouting::<FakeHandler>(Ctl::new().conf()).await;
    agent.send("scout", r#"{"op":"hello","version":1}"#);
    let msgs = found(&mut agent, "hello", secs(5)).await;
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0]["seq"], 0);
    assert_eq!(msgs[0]["supported"], false);
    assert_eq!(msgs[0]["reads"], false);
    assert_eq!(msgs[0]["versions"], json!([1]));
    assert_eq!(
        msgs[0]["library"],
        format!("rs-edge-driver {}", env!("CARGO_PKG_VERSION"))
    );
    // Every hello gets seq 0.
    agent.send("scout", r#"{"op":"hello","version":1}"#);
    assert_eq!(found(&mut agent, "hello", secs(5)).await[0]["seq"], 0);

    let (mut agent, _driver) =
        up_with_scouting::<ScoutHandler>(ScoutCtl::new(Mode::Tree { n: 1, batch: 1 }).conf()).await;
    agent.send("scout", r#"{"op":"hello","version":1}"#);
    let hello = &found(&mut agent, "hello", secs(5)).await[0];
    assert_eq!(hello["supported"], true);
    assert_eq!(hello["reads"], true);
}

/// A handler that does not scout ends every scan with UNSUPPORTED,
/// straight away.
#[tokio::test]
async fn default_handler_answers_unsupported() {
    let (mut agent, _driver) = up_with_scouting::<FakeHandler>(Ctl::new().conf()).await;
    agent.send("scout", start_msg(SCAN, limits(100, 10)));
    let msgs = found(&mut agent, SCAN, secs(5)).await;
    assert_eq!(msgs.len(), 1, "no accept before UNSUPPORTED");
    assert_eq!(msgs[0]["seq"], 0);
    assert_eq!(error_code(&msgs), "UNSUPPORTED");
}

// ---------------------------------------------------------------
// Scans

#[tokio::test]
async fn a_scan_streams_items_in_numbered_batches() {
    let ctl = ScoutCtl::new(Mode::Tree {
        n: 1234,
        batch: 700,
    });
    let (mut agent, _driver) = up_with_scouting::<ScoutHandler>(ctl.conf()).await;
    agent.send(
        "scout",
        json!({
            "op": "start", "id": SCAN, "version": 1, "root": "r", "folder_id": "f0",
            "options": { "x": 1 },
            "limits": { "items": 20000, "depth": 8, "seconds": 120, "pace_ms": 20, "samples": false },
        })
        .to_string(),
    );
    let msgs = found(&mut agent, SCAN, secs(10)).await;
    assert_seq(&msgs);
    assert_eq!(msgs[0]["type"], "accept");
    let batches: Vec<_> = msgs
        .iter()
        .filter(|m| m["type"] == "items")
        .map(|m| m["items"].as_array().unwrap().len())
        .collect();
    assert!(batches.iter().all(|n| *n <= 500), "{batches:?}");
    let items = items_of(&msgs);
    assert_eq!(items.len(), 1234);
    assert_eq!(items[0]["id"], "f0", "a branch scan starts with folder_id");
    assert!(
        items.iter().all(|i| i.get("sample").is_none()),
        "samples were not asked for"
    );
    let end = end_of(&msgs);
    assert_eq!(end["exhaustive"], true);
    assert_eq!(end["truncated"], false);
    assert_eq!(end["reason"], Value::Null);
    assert_eq!(end["excluded"][0]["id"], "i=2253");

    let req = ctl.requests.lock().unwrap()[0].clone();
    assert_eq!(req.root.as_deref(), Some("r"));
    assert_eq!(req.folder_id.as_deref(), Some("f0"));
    assert_eq!(req.options["x"], 1);
    assert_eq!(req.limits.pace_ms, 20);

    // Another scan can follow once one has ended.
    agent.send("scout", start_msg("second", limits(100, 10)));
    let msgs = found(&mut agent, "second", secs(10)).await;
    assert_eq!(end_of(&msgs)["truncated"], true);
}

#[tokio::test]
async fn the_item_cap_truncates() {
    let ctl = ScoutCtl::new(Mode::Tree { n: 250, batch: 40 });
    let (mut agent, _driver) = up_with_scouting::<ScoutHandler>(ctl.conf()).await;
    agent.send("scout", start_msg(SCAN, limits(100, 10)));
    let msgs = found(&mut agent, SCAN, secs(10)).await;
    assert_seq(&msgs);
    assert_eq!(items_of(&msgs).len(), 100);
    let end = end_of(&msgs);
    assert_eq!(end["truncated"], true);
    assert_eq!(end["reason"], "items");
}

#[tokio::test]
async fn samples_go_out_when_asked_for() {
    let ctl = ScoutCtl::new(Mode::Tree { n: 3, batch: 3 });
    let (mut agent, _driver) = up_with_scouting::<ScoutHandler>(ctl.conf()).await;
    let mut l = limits(100, 10);
    l["samples"] = json!(true);
    agent.send("scout", start_msg(SCAN, l));
    let items = items_of(&found(&mut agent, SCAN, secs(10)).await);
    assert_eq!(items[1]["sample"], "1.5");
}

/// The watchdog ends a scan at `limits.seconds` even when the scouter
/// never returns and ignores cancellation.
#[tokio::test]
async fn the_watchdog_ends_a_hung_scan() {
    let ctl = ScoutCtl::new(Mode::Hang);
    let (mut agent, _driver) = up_with_scouting::<ScoutHandler>(ctl.conf()).await;
    let started = Instant::now();
    agent.send("scout", start_msg(SCAN, limits(100, 1)));
    let msgs = found(&mut agent, SCAN, secs(10)).await;
    let took = started.elapsed();
    assert_seq(&msgs);
    assert_eq!(items_of(&msgs).len(), 10);
    let end = end_of(&msgs);
    assert_eq!(end["truncated"], true);
    assert_eq!(end["reason"], "seconds");
    assert_eq!(end["exhaustive"], false);
    assert!(took >= secs(1) && took < secs(6), "took {took:?}");

    // The slot is free again.
    *ctl.mode.lock().unwrap() = Mode::Tree { n: 2, batch: 2 };
    agent.send("scout", start_msg("next", limits(100, 10)));
    assert_eq!(items_of(&found(&mut agent, "next", secs(5)).await).len(), 2);
}

#[tokio::test]
async fn cancel_stops_a_scan() {
    let ctl = ScoutCtl::new(Mode::Slow);
    let (mut agent, _driver) = up_with_scouting::<ScoutHandler>(ctl.conf()).await;
    let mut l = limits(50000, 60);
    l["pace_ms"] = json!(50);
    agent.send("scout", start_msg(SCAN, l));
    tokio::time::sleep(ms(500)).await;
    // A cancel for another id changes nothing.
    agent.send(
        "scout",
        json!({ "op": "cancel", "id": "other", "version": 1 }).to_string(),
    );
    tokio::time::sleep(ms(100)).await;
    let started = Instant::now();
    agent.send(
        "scout",
        json!({ "op": "cancel", "id": SCAN, "version": 1 }).to_string(),
    );
    let msgs = found(&mut agent, SCAN, secs(5)).await;
    assert!(
        started.elapsed() < secs(1),
        "cancel took {:?}",
        started.elapsed()
    );
    assert_seq(&msgs);
    assert_eq!(error_code(&msgs), "CANCELLED");
    assert!(!items_of(&msgs).is_empty());
    assert_eq!(
        ctl.stopped.load(Ordering::SeqCst),
        1,
        "the scouter saw the cancel"
    );
}

/// A scouter that ignores the cancel is aborted, and the scan still
/// ends with CANCELLED within the protocol's 5 s.
#[tokio::test]
async fn cancel_ends_a_hung_scan() {
    let ctl = ScoutCtl::new(Mode::Hang);
    let (mut agent, _driver) = up_with_scouting::<ScoutHandler>(ctl.conf()).await;
    agent.send("scout", start_msg(SCAN, limits(100, 60)));
    tokio::time::sleep(ms(300)).await;
    let started = Instant::now();
    agent.send(
        "scout",
        json!({ "op": "cancel", "id": SCAN, "version": 1 }).to_string(),
    );
    let msgs = found(&mut agent, SCAN, secs(10)).await;
    assert!(
        started.elapsed() < secs(5),
        "cancel took {:?}",
        started.elapsed()
    );
    assert_eq!(error_code(&msgs), "CANCELLED");
}

#[tokio::test]
async fn a_new_conf_cancels_a_scan() {
    let ctl = ScoutCtl::new(Mode::Slow);
    let (mut agent, _driver) = up_with_scouting::<ScoutHandler>(ctl.conf()).await;
    let mut l = limits(50000, 60);
    l["pace_ms"] = json!(50);
    agent.send("scout", start_msg(SCAN, l));
    tokio::time::sleep(ms(300)).await;
    agent.send("conf", ScoutCtl::new(Mode::Slow).conf().to_string());
    let msgs = found(&mut agent, SCAN, secs(5)).await;
    assert_eq!(error_code(&msgs), "CANCELLED");
}

/// Only a faulty agent sends a second start while one runs. It gets
/// ERR, and the running scan carries on.
#[tokio::test]
async fn a_second_start_gets_err() {
    let ctl = ScoutCtl::new(Mode::Slow);
    let (mut agent, _driver) = up_with_scouting::<ScoutHandler>(ctl.conf()).await;
    let mut l = limits(50000, 60);
    l["pace_ms"] = json!(50);
    agent.send("scout", start_msg(SCAN, l.clone()));
    tokio::time::sleep(ms(300)).await;
    agent.send("scout", start_msg("second", l));
    let mut others = Vec::new();
    let msgs = found_until_end(&mut agent, "second", secs(5), &mut others).await;
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0]["seq"], 0);
    assert_eq!(error_code(&msgs), "ERR");

    agent.send(
        "scout",
        json!({ "op": "cancel", "id": SCAN, "version": 1 }).to_string(),
    );
    let rest = found(&mut agent, SCAN, secs(5)).await;
    // The first scan's messages that came before the ERR, then the rest.
    let topic = format!("fpEdge1/Conn/found/{SCAN}");
    let mut msgs: Vec<Value> = others
        .into_iter()
        .filter_map(|e| match e {
            FromDriver::Other { topic: t, payload } if t == topic => {
                Some(serde_json::from_slice(&payload).unwrap())
            }
            _ => None,
        })
        .collect();
    msgs.extend(rest);
    assert_seq(&msgs);
    assert_eq!(error_code(&msgs), "CANCELLED");
    assert_eq!(ctl.scans.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_panic_gives_err() {
    let (mut agent, _driver) =
        up_with_scouting::<ScoutHandler>(ScoutCtl::new(Mode::Panic).conf()).await;
    agent.send("scout", start_msg(SCAN, limits(100, 10)));
    let msgs = found(&mut agent, SCAN, secs(5)).await;
    assert_seq(&msgs);
    assert_eq!(error_code(&msgs), "ERR");
    let message = end_of(&msgs)["error"]["message"].as_str().unwrap();
    assert!(message.contains("Klingon"), "{message}");

    // The driver is still working.
    agent.send("poll", "1");
    assert_eq!(agent.collect_data(1, secs(5)).await.len(), 1);
}

#[tokio::test]
async fn a_handler_error_keeps_its_code() {
    let (mut agent, _driver) = up_with_scouting::<ScoutHandler>(
        ScoutCtl::new(Mode::Fail(ScoutError::options(
            "Root ns=2;s=Nope does not exist",
        )))
        .conf(),
    )
    .await;
    agent.send("scout", start_msg(SCAN, limits(100, 10)));
    let msgs = found(&mut agent, SCAN, secs(5)).await;
    assert_eq!(error_code(&msgs), "OPTIONS");
    assert_eq!(
        end_of(&msgs)["error"]["message"],
        "Root ns=2;s=Nope does not exist"
    );
}

/// `scouter()` returning `None` means the handler has nothing to scan
/// with, which is CONN. So is a handler that hasn't connected.
#[tokio::test]
async fn no_scouter_gives_conn() {
    let (mut agent, _driver) =
        up_with_scouting::<ScoutHandler>(ScoutCtl::new(Mode::NoScouter).conf()).await;
    agent.send("scout", start_msg(SCAN, limits(100, 10)));
    let msgs = found(&mut agent, SCAN, secs(5)).await;
    assert_eq!(msgs.len(), 1);
    assert_eq!(error_code(&msgs), "CONN");

    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<ScoutHandler>(agent.config());
    let ctl = ScoutCtl::new(Mode::Tree { n: 1, batch: 1 });
    *ctl.connect_fails.lock().unwrap() = true;
    agent.wait_status("READY", secs(5)).await;
    agent.send("conf", ctl.conf().to_string());
    agent.send_addrs_features(&[("1", "a")], json!({ "scout": 1 }));
    agent.wait_status("CONN", secs(5)).await;
    wait_scout_subs(&agent, 1).await;
    agent.send("scout", start_msg(SCAN, limits(100, 10)));
    assert_eq!(error_code(&found(&mut agent, SCAN, secs(5)).await), "CONN");
}

/// A scan never holds the handler's lock, so polls and commands carry
/// on while one runs.
#[tokio::test]
async fn polls_and_commands_carry_on_during_a_scan() {
    let ctl = ScoutCtl::new(Mode::Hang);
    let (mut agent, _driver) = up_with_scouting::<ScoutHandler>(ctl.conf()).await;
    agent.send("scout", start_msg(SCAN, limits(100, 30)));
    tokio::time::sleep(ms(300)).await;
    for _ in 0..3 {
        agent.send("poll", "1");
        let data = agent.collect_data(1, secs(2)).await;
        assert_eq!(data, vec![("1".to_owned(), Bytes::from("a"))]);
    }
    agent.send("cmd/a", "1");
    tokio::time::sleep(ms(300)).await;
    assert_eq!(*ctl.cmds.lock().unwrap(), vec!["a".to_owned()]);

    agent.send(
        "scout",
        json!({ "op": "cancel", "id": SCAN, "version": 1 }).to_string(),
    );
    assert_eq!(
        error_code(&found(&mut agent, SCAN, secs(5)).await),
        "CANCELLED"
    );
}

/// Progress goes out when the scouter reports it, and on its own at
/// least every 5 s.
#[tokio::test]
async fn progress_flows_during_a_long_scan() {
    let ctl = ScoutCtl::new(Mode::Progress);
    let (mut agent, _driver) = up_with_scouting::<ScoutHandler>(ctl.conf()).await;
    agent.send("scout", start_msg(SCAN, limits(100, 11)));
    let msgs = found(&mut agent, SCAN, secs(20)).await;
    assert_seq(&msgs);
    let progress: Vec<_> = msgs.iter().filter(|m| m["type"] == "progress").collect();
    assert!(progress.len() >= 2, "{msgs:?}");
    assert_eq!(progress[0]["visited"], 7);
    assert_eq!(progress[0]["note"], "Line1");
    assert_eq!(end_of(&msgs)["reason"], "seconds");
}

/// With a `window` in the start, the driver echoes it in its accept
/// and sends at most that many `items` messages ahead of the agent's
/// acks.
#[tokio::test]
async fn a_scan_keeps_to_the_agents_window() {
    let ctl = ScoutCtl::new(Mode::Tree {
        n: 1000,
        batch: 100,
    });
    let (mut agent, _driver) = up_with_scouting::<ScoutHandler>(ctl.conf()).await;
    agent.send(
        "scout",
        json!({
            "op": "start", "id": SCAN, "version": 1, "root": null, "folder_id": null,
            "options": {},
            "limits": { "items": 20000, "depth": 8, "seconds": 120, "pace_ms": 0, "samples": false },
            "window": 2,
        })
        .to_string(),
    );
    let topic = format!("fpEdge1/{}/found/{SCAN}", agent.id);
    let mut msgs: Vec<Value> = Vec::new();
    let mut unacked: Vec<u64> = Vec::new();
    loop {
        let ev = agent.next(secs(1)).await;
        match ev {
            Some(FromDriver::Other { topic: t, payload }) if t == topic => {
                let v: Value = serde_json::from_slice(&payload).unwrap();
                check_found(&v);
                if v["type"] == "items" {
                    unacked.push(v["seq"].as_u64().unwrap());
                    assert!(
                        unacked.len() <= 2,
                        "more than the window ahead: {unacked:?}"
                    );
                }
                let end = v["type"] == "end";
                msgs.push(v);
                if end {
                    break;
                }
            }
            Some(_) => {}
            // Nothing more comes until the agent acks.
            None => {
                assert_eq!(
                    unacked.len(),
                    2,
                    "the driver stopped with room in the window"
                );
                let seq = unacked.remove(0);
                agent.send(
                    "scout",
                    json!({ "op": "ack", "id": SCAN, "seq": seq }).to_string(),
                );
            }
        }
        // Ack the oldest message now and then, as an agent catching up.
        if unacked.len() == 2 && msgs.len().is_multiple_of(3) {
            let seq = unacked.remove(0);
            agent.send(
                "scout",
                json!({ "op": "ack", "id": SCAN, "seq": seq }).to_string(),
            );
        }
    }
    assert_seq(&msgs);
    assert_eq!(msgs[0], json!({ "seq": 0, "type": "accept", "window": 2 }));
    assert_eq!(items_of(&msgs).len(), 1000);
    assert_eq!(end_of(&msgs)["truncated"], false);
}

/// A full window doesn't stop the time cap.
#[tokio::test]
async fn a_full_window_still_ends_at_the_time_cap() {
    let ctl = ScoutCtl::new(Mode::Tree {
        n: 1000,
        batch: 100,
    });
    let (mut agent, _driver) = up_with_scouting::<ScoutHandler>(ctl.conf()).await;
    agent.send(
        "scout",
        json!({
            "op": "start", "id": SCAN, "version": 1, "root": null, "folder_id": null,
            "options": {},
            "limits": { "items": 20000, "depth": 8, "seconds": 1, "pace_ms": 0, "samples": false },
            "window": 1,
        })
        .to_string(),
    );
    let msgs = found(&mut agent, SCAN, secs(10)).await;
    assert_seq(&msgs);
    assert_eq!(msgs.iter().filter(|m| m["type"] == "items").count(), 1);
    let end = end_of(&msgs);
    assert_eq!(end["truncated"], true);
    assert_eq!(end["reason"], "seconds");
}

/// Requests from the shared fixtures: valid starts run, and a start
/// whose id would make a bad topic gets no answer.
#[tokio::test]
async fn request_fixtures() {
    let ctl = ScoutCtl::new(Mode::Tree { n: 3, batch: 3 });
    let (mut agent, _driver) = up_with_scouting::<ScoutHandler>(ctl.conf()).await;
    let dir = schema_dir().join("fixtures");
    for name in ["request-start", "request-start-branch"] {
        let fixture = load(dir.join("valid").join(format!("{name}.json")));
        assert!(SCHEMAS.request.is_valid(&fixture["data"]));
        let id = fixture["data"]["id"].as_str().unwrap().to_owned();
        agent.send("scout", fixture["data"].to_string());
        let msgs = found(&mut agent, &id, secs(5)).await;
        assert_eq!(msgs[0]["type"], "accept", "{name}");
        assert_eq!(end_of(&msgs)["exhaustive"], true, "{name}");
    }
    for name in ["request-start-dashed-id", "request-start-hello-id"] {
        let fixture = load(dir.join("invalid").join(format!("{name}.json")));
        assert!(!SCHEMAS.request.is_valid(&fixture["data"]));
        agent.send("scout", fixture["data"].to_string());
    }
    let seen = agent.drain(secs(1)).await;
    assert!(
        !seen
            .iter()
            .any(|e| matches!(e, FromDriver::Other { topic, .. } if topic.contains("/found/"))),
        "answered a start with a bad id: {seen:?}"
    );
    assert_eq!(agent.stats.kicked(), 0, "published outside the ACL");
}

/// The library's own messages match the shared valid fixtures' shapes.
#[test]
fn library_messages_match_fixtures() {
    let dir = schema_dir().join("fixtures/valid");
    for name in [
        "found-hello-supported",
        "found-hello-unsupported",
        "found-end",
        "found-end-truncated",
    ] {
        let fixture = load(dir.join(format!("{name}.json")));
        assert!(SCHEMAS.found.is_valid(&fixture["data"]), "{name}");
    }
    let end = load(dir.join("found-end.json"))["data"].clone();
    assert_eq!(end["excluded"][0]["prefixes"], json!(["i="]));
    for name in [
        "item-opcua-value",
        "item-mqtt-topic",
        "item-opcua-folder-more",
    ] {
        let fixture = load(dir.join(format!("{name}.json")));
        let item: Item = serde_json::from_value(fixture["data"].clone())
            .unwrap_or_else(|e| panic!("{name}: {e}"));
        let back = serde_json::to_value(&item).unwrap();
        assert!(SCHEMAS.item.is_valid(&back), "{name} round trip: {back}");
    }
}

// ---------------------------------------------------------------
// Reads

const READ: &str = "r1";

fn read_msg(id: &str, addresses: &[&str]) -> String {
    json!({ "op": "read", "id": id, "version": 1, "addresses": addresses }).to_string()
}

/// One `values` answer with an entry per requested address, values as
/// text, and the reader's extra entry dropped.
#[tokio::test]
async fn a_read_answers_once_with_values() {
    let ctl = ScoutCtl::new(Mode::Tree { n: 1, batch: 1 });
    let (mut agent, _driver) = up_with_scouting::<ScoutHandler>(ctl.conf()).await;
    agent.send(
        "scout",
        read_msg(READ, &["a", "nan", "gone", "missing", "a"]),
    );
    let msgs = found(&mut agent, READ, secs(5)).await;
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0]["type"], "values");
    let values = msgs[0]["values"].as_array().unwrap();
    let addrs: Vec<_> = values
        .iter()
        .map(|v| v["address"].as_str().unwrap())
        .collect();
    assert_eq!(addrs, vec!["a", "nan", "gone", "missing"]);
    assert_eq!(
        values[0],
        json!({ "address": "a", "value": "value of a", "type": "String",
                "ts": 1_795_600_000_000_i64, "error": null })
    );
    assert_eq!(values[1]["value"], "NaN");
    assert_eq!(values[1]["type"], "Double");
    assert_eq!(values[2]["value"], Value::Null);
    assert_eq!(values[2]["error"], "BadNodeIdUnknown");
    assert!(
        values[3]["error"].is_string(),
        "a left out address gets an error"
    );
    assert_eq!(ctl.reads.load(Ordering::SeqCst), 1);
    let more = agent.drain(ms(300)).await;
    assert!(
        !more
            .iter()
            .any(|e| matches!(e, FromDriver::Other { topic, .. } if topic.ends_with("/found/r1"))),
        "answered twice: {more:?}"
    );
}

#[tokio::test]
async fn a_handler_that_does_not_read_answers_unsupported() {
    let (mut agent, _driver) = up_with_scouting::<FakeHandler>(Ctl::new().conf()).await;
    agent.send("scout", read_msg(READ, &["a"]));
    let msgs = found(&mut agent, READ, secs(5)).await;
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0]["seq"], 0);
    assert_eq!(error_code(&msgs), "UNSUPPORTED");
}

#[tokio::test]
async fn no_reader_gives_conn() {
    let ctl = ScoutCtl::new(Mode::Tree { n: 1, batch: 1 });
    *ctl.read_mode.lock().unwrap() = ReadMode::NoReader;
    let (mut agent, _driver) = up_with_scouting::<ScoutHandler>(ctl.conf()).await;
    agent.send("scout", read_msg(READ, &["a"]));
    assert_eq!(error_code(&found(&mut agent, READ, secs(5)).await), "CONN");

    // So does a handler that hasn't connected.
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<ScoutHandler>(agent.config());
    let ctl = ScoutCtl::new(Mode::Tree { n: 1, batch: 1 });
    *ctl.connect_fails.lock().unwrap() = true;
    agent.wait_status("READY", secs(5)).await;
    agent.send("conf", ctl.conf().to_string());
    agent.send_addrs_features(&[("1", "a")], json!({ "scout": 1 }));
    agent.wait_status("CONN", secs(5)).await;
    wait_scout_subs(&agent, 1).await;
    agent.send("scout", read_msg(READ, &["a"]));
    assert_eq!(error_code(&found(&mut agent, READ, secs(5)).await), "CONN");
}

#[tokio::test]
async fn a_reader_panic_gives_err() {
    let ctl = ScoutCtl::new(Mode::Tree { n: 1, batch: 1 });
    *ctl.read_mode.lock().unwrap() = ReadMode::Panic;
    let (mut agent, _driver) = up_with_scouting::<ScoutHandler>(ctl.conf()).await;
    agent.send("scout", read_msg(READ, &["a"]));
    let msgs = found(&mut agent, READ, secs(5)).await;
    assert_eq!(error_code(&msgs), "ERR");
    let message = end_of(&msgs)["error"]["message"].as_str().unwrap();
    assert!(message.contains("caught fire"), "{message}");
}

/// Bad reads are answered with ERR on their own topic.
#[tokio::test]
async fn a_bad_read_gives_err() {
    let ctl = ScoutCtl::new(Mode::Tree { n: 1, batch: 1 });
    let (mut agent, _driver) = up_with_scouting::<ScoutHandler>(ctl.conf()).await;
    agent.send(
        "scout",
        json!({ "op": "read", "id": READ, "version": 2, "addresses": ["a"] }).to_string(),
    );
    assert_eq!(error_code(&found(&mut agent, READ, secs(5)).await), "ERR");
    agent.send(
        "scout",
        json!({ "op": "read", "id": "r2", "version": 1, "addresses": [1] }).to_string(),
    );
    assert_eq!(error_code(&found(&mut agent, "r2", secs(5)).await), "ERR");
    assert_eq!(ctl.reads.load(Ordering::SeqCst), 0);
}

/// A reader that hangs is abandoned after 4 s with no answer, and the
/// next read still works.
#[tokio::test]
async fn a_hung_read_is_abandoned() {
    let ctl = ScoutCtl::new(Mode::Tree { n: 1, batch: 1 });
    *ctl.read_mode.lock().unwrap() = ReadMode::Hang;
    let (mut agent, _driver) = up_with_scouting::<ScoutHandler>(ctl.conf()).await;
    agent.send("scout", read_msg(READ, &["a"]));
    let seen = agent.drain(secs(5)).await;
    assert!(
        !seen
            .iter()
            .any(|e| matches!(e, FromDriver::Other { topic, .. } if topic.contains("/found/"))),
        "a hung read was answered: {seen:?}"
    );
    *ctl.read_mode.lock().unwrap() = ReadMode::Answer;
    agent.send("scout", read_msg("r2", &["a"]));
    let msgs = found(&mut agent, "r2", secs(5)).await;
    assert_eq!(msgs[0]["type"], "values");
}

/// A read runs beside a scan, and never takes the handler's lock, so it
/// answers while a command holds it.
#[tokio::test]
async fn reads_run_beside_a_scan_without_the_lock() {
    let ctl = ScoutCtl::new(Mode::Hang);
    let (mut agent, _driver) = up_with_scouting::<ScoutHandler>(ctl.conf()).await;
    agent.send("scout", start_msg(SCAN, limits(100, 30)));
    agent.send("cmd/block", "1");
    tokio::time::sleep(ms(300)).await;
    assert_eq!(*ctl.cmds.lock().unwrap(), vec!["block".to_owned()]);
    for id in ["r1", "r2"] {
        agent.send("scout", read_msg(id, &["a"]));
        let mut others = Vec::new();
        let msgs = found_until_end(&mut agent, id, secs(5), &mut others).await;
        assert_eq!(msgs[0]["values"][0]["value"], "value of a");
    }
    agent.send(
        "scout",
        json!({ "op": "cancel", "id": SCAN, "version": 1 }).to_string(),
    );
    let msgs = found(&mut agent, SCAN, secs(5)).await;
    assert_eq!(error_code(&msgs), "CANCELLED");
}

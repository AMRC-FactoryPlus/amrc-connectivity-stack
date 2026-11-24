// ACS OPC UA driver
// Scanning a real OPC UA server's address space
// Copyright 2026 University of Sheffield

//! Edge Scout scans end to end: a fake Edge Agent that advertises
//! scouting on one side and a node-opcua server in `SCOUT` mode on the
//! other (`tests/server/scout.cjs` describes its address space). Every
//! `found` message, and every item in it, is checked against the
//! schemas in `lib/edge-scout-schemas`.
//!
//! Like `tests/opcua.rs` these need Node.js and acs-edge's
//! `node_modules`, so they only run when `EDGE_OPCUA_SERVER_TESTS` is
//! set:
//!
//! ```sh
//! (cd acs-edge && npm install --save=false --install-links)
//! cd edge-opcua && EDGE_OPCUA_SERVER_TESTS=1 cargo test --test scout -- --nocapture
//! ```
//!
//! `the_size_of_a_20000_item_scan` prints the item and snapshot sizes
//! the storage estimate in the design uses.

mod support;

use std::collections::{BTreeSet, HashMap};
use std::io::Write;
use std::path::PathBuf;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use edge_opcua::OpcuaHandler;
use serde_json::{Value, json};
use support::*;

// ---------------------------------------------------------------
// Schemas

fn schema_dir() -> PathBuf {
    repo().join("lib/edge-scout-schemas/schemas")
}

fn load(name: &str) -> Value {
    let path = schema_dir().join(format!("{name}.schema.json"));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path:?}: {e}"));
    serde_json::from_str(&text).unwrap()
}

fn compile(name: &str) -> jsonschema::Validator {
    jsonschema::options()
        .with_draft(jsonschema::Draft::Draft202012)
        .with_resource(
            "urn:edge-scout:common",
            jsonschema::Resource::from_contents(load("common")).expect("common schema"),
        )
        .build(&load(name))
        .unwrap_or_else(|e| panic!("{name} schema: {e}"))
}

static FOUND: LazyLock<jsonschema::Validator> = LazyLock::new(|| compile("found"));
static ITEM: LazyLock<jsonschema::Validator> = LazyLock::new(|| compile("item"));

fn check(schema: &jsonschema::Validator, name: &str, v: &Value) {
    let errors: Vec<String> = schema.iter_errors(v).map(|e| e.to_string()).collect();
    assert!(
        errors.is_empty(),
        "{v} breaks {name}.schema.json: {errors:?}"
    );
}

// ---------------------------------------------------------------
// Driving a scan

/// The settings the scout tests' server always has.
const SCOUT: (&str, &str) = ("SCOUT", "1");

fn anon(server: &Server) -> Value {
    conf(server, "None", "None", None)
}

/// An address map with `features.scout`, as an Edge Agent with
/// scouting sends it: data topic `t<i>` for the i-th node.
fn addr_with_features(nodes: &[String]) -> String {
    let mut v: Value = serde_json::from_str(&addr_packet(nodes)).unwrap();
    v["features"] = json!({ "scout": 1 });
    v.to_string()
}

/// Start a driver, wait for it to be UP and to have subscribed to
/// `scout`.
async fn scout_driver(conf: Value, nodes: &[String]) -> (FakeAgent, RunningDriver) {
    // Logs with RUST_LOG set, such as RUST_LOG=edge_opcua=debug.
    if std::env::var_os("RUST_LOG").is_some() {
        rs_edge_driver::init_logging();
    }
    let mut agent = FakeAgent::start("OPCUA").await;
    let driver = spawn_driver::<OpcuaHandler>(agent.config());
    agent.wait_status("READY", secs(5)).await;
    agent.send("conf", conf.to_string());
    agent.send("addr", addr_with_features(nodes));
    agent.wait_status("UP", secs(30)).await;
    let deadline = Instant::now() + secs(5);
    while !agent
        .stats
        .subscriptions
        .lock()
        .unwrap()
        .iter()
        .any(|s| s == "fpEdge1/OPCUA/scout")
    {
        assert!(
            Instant::now() < deadline,
            "the driver never subscribed to scout"
        );
        tokio::time::sleep(ms(50)).await;
    }
    (agent, driver)
}

fn limits(items: u64, depth: u64) -> Value {
    json!({ "items": items, "depth": depth, "seconds": 300, "pace_ms": 0, "samples": false })
}

fn start(agent: &FakeAgent, id: &str, root: Option<&str>, options: Value, limits: Value) {
    agent.send(
        "scout",
        json!({
            "op": "start", "id": id, "version": 1, "root": root, "folder_id": root,
            "options": options, "limits": limits,
        })
        .to_string(),
    );
}

/// What a scan sent.
struct Scan {
    items: Vec<Value>,
    end: Value,
    /// When the end arrived.
    ended: Instant,
    /// Data messages that arrived during the scan, by topic.
    data: HashMap<String, Vec<Value>>,
}

impl Scan {
    fn ids(&self) -> Vec<String> {
        self.items
            .iter()
            .map(|i| i["id"].as_str().unwrap().to_owned())
            .collect()
    }

    fn get(&self, id: &str) -> &Value {
        self.items
            .iter()
            .find(|i| i["id"] == id)
            .unwrap_or_else(|| panic!("no item {id}"))
    }

    fn children(&self, id: &str) -> Vec<&Value> {
        self.items.iter().filter(|i| i["parent"] == id).collect()
    }

    fn error(&self) -> Option<&str> {
        self.end["error"]["code"].as_str()
    }
}

/// Collect the `found/<id>` messages of a scan until its `end`,
/// checking each against the schema and that `seq` has no gaps.
/// With `seq` set, the first message must have that `seq`. Without it,
/// collecting starts part way through a scan.
async fn collect(agent: &mut FakeAgent, id: &str, seq: Option<u64>, within: Duration) -> Scan {
    let topic = format!("fpEdge1/OPCUA/found/{id}");
    let deadline = tokio::time::Instant::now() + within;
    let mut seq = seq;
    let mut items = Vec::new();
    let mut data: HashMap<String, Vec<Value>> = HashMap::new();
    loop {
        let left = deadline.saturating_duration_since(tokio::time::Instant::now());
        match agent.next(left).await {
            Some(FromDriver::Other { topic: t, payload }) if t == topic => {
                let msg: Value = serde_json::from_slice(&payload).unwrap();
                check(&FOUND, "found", &msg);
                let got = msg["seq"].as_u64().unwrap();
                assert_eq!(seq.unwrap_or(got), got, "a gap in seq: {msg}");
                seq = Some(got + 1);
                match msg["type"].as_str().unwrap() {
                    "items" => {
                        for item in msg["items"].as_array().unwrap() {
                            check(&ITEM, "item", item);
                            items.push(item.clone());
                        }
                    }
                    "end" => {
                        return Scan {
                            items,
                            end: msg,
                            ended: Instant::now(),
                            data,
                        };
                    }
                    _ => {}
                }
            }
            Some(FromDriver::Data { topic, payload }) => {
                let p: Value = serde_json::from_slice(&payload).unwrap();
                data.entry(topic).or_default().push(p["value"].clone());
            }
            Some(_) => {}
            None => panic!(
                "scan {id} did not end within {within:?}; {} items",
                items.len()
            ),
        }
    }
}

async fn scan(
    agent: &mut FakeAgent,
    id: &str,
    root: Option<&str>,
    options: Value,
    limits: Value,
) -> Scan {
    start(agent, id, root, options, limits);
    collect(agent, id, Some(0), secs(120)).await
}

fn assert_unique(scan: &Scan) {
    let ids = scan.ids();
    let set: BTreeSet<&String> = ids.iter().collect();
    assert_eq!(set.len(), ids.len(), "duplicate ids");
}

/// Wait for a data topic to report a value that `ok` accepts.
async fn wait_data(
    agent: &mut FakeAgent,
    topic: &str,
    within: Duration,
    ok: impl Fn(&Value) -> bool,
) {
    let deadline = tokio::time::Instant::now() + within;
    let mut last = None;
    loop {
        let left = deadline.saturating_duration_since(tokio::time::Instant::now());
        match agent.next(left).await {
            Some(FromDriver::Data { topic: t, payload }) if t == topic => {
                let v: Value = serde_json::from_slice::<Value>(&payload).unwrap()["value"].clone();
                if ok(&v) {
                    return;
                }
                last = Some(v);
            }
            Some(_) => {}
            None => panic!("{topic} never reported the value wanted, last {last:?}"),
        }
    }
}

/// The ids `scout.cjs` makes under `ns=1;s=Scout`, apart from the
/// AnalogItem's properties, whose ids node-opcua chooses.
fn scout_space_ids(hidden: bool) -> BTreeSet<String> {
    let mut ids = BTreeSet::new();
    let mut add = |s: &str| {
        ids.insert(format!("ns=1;s={s}"));
    };
    for s in [
        "Scout",
        "Scout/Tree",
        "Scout/Big",
        "Scout/Loop",
        "Scout/Loop/A",
        "Scout/Loop/B",
        "Scout/P1",
        "Scout/P2",
        "Scout/Shared",
        "Scout/Secure",
        "Scout/Arr",
        "Scout/Matrix",
        "Scout/Long",
        "Scout/Huge",
        "Scout/State",
        "Scout/When",
        "Scout/Speed",
        "Scout/Blob",
        "Scout/Text",
        "Scout/Build",
        "Scout/Refused",
        "Scout/OpenCPs",
    ] {
        add(s);
    }
    if hidden {
        add("Scout/Secure/Hidden");
    }
    for i in 0..2500 {
        add(&format!("Scout/Big/{i}"));
    }
    fn grow(path: &str, level: usize, add: &mut dyn FnMut(&str)) {
        for i in 0..4 {
            let id = format!("{path}/{i}");
            add(&id);
            if level + 1 < 4 {
                grow(&id, level + 1, add);
            } else {
                for e in 0..18 {
                    add(&format!("{id}/v{e}"));
                }
            }
        }
    }
    grow("Scout/Tree", 0, &mut add);
    ids
}

// ---------------------------------------------------------------
// Tests

/// A branch scan of the whole test space lists every node exactly
/// once, with its type, through cycles, two parents and a folder that
/// needs continuation points.
#[tokio::test(flavor = "multi_thread")]
async fn a_scan_lists_the_address_space_exactly() {
    if !enabled() {
        return;
    }
    let server = Server::start_with(&[SCOUT]).await;
    let (mut agent, _driver) = scout_driver(anon(&server), &[node("Double")]).await;
    let scan = scan(
        &mut agent,
        "full1",
        Some("ns=1;s=Scout"),
        json!({}),
        limits(50000, 8),
    )
    .await;
    assert_eq!(scan.error(), None, "{}", scan.end);
    assert_eq!(scan.end["exhaustive"], true);
    assert_eq!(scan.end["truncated"], false);
    assert_eq!(scan.end["excluded"], json!([]));
    assert_unique(&scan);

    // The first item is the root, with no parent.
    assert_eq!(scan.items[0]["id"], "ns=1;s=Scout");
    assert_eq!(scan.items[0]["parent"], Value::Null);
    assert_eq!(scan.items[0]["kind"], "folder");

    let speed_props: Vec<String> = scan
        .children("ns=1;s=Scout/Speed")
        .iter()
        .map(|i| i["name"].as_str().unwrap().to_owned())
        .collect();
    let mut props = speed_props.clone();
    props.sort();
    assert_eq!(props, ["EURange", "EngineeringUnits"]);
    let got: BTreeSet<String> = scan
        .items
        .iter()
        .filter(|i| i["parent"] != "ns=1;s=Scout/Speed")
        .map(|i| i["id"].as_str().unwrap().to_owned())
        .collect();
    let want = scout_space_ids(true);
    let missing: Vec<_> = want.difference(&got).take(10).collect();
    let extra: Vec<_> = got.difference(&want).take(10).collect();
    assert!(
        missing.is_empty() && extra.is_empty(),
        "missing {missing:?}, extra {extra:?}"
    );

    // Parents come first, and a node with two parents is under the
    // first the walk met.
    let ids = scan.ids();
    for (n, item) in scan.items.iter().enumerate() {
        if let Some(p) = item["parent"].as_str() {
            assert!(
                ids[..n].iter().any(|i| i == p),
                "{} before its parent",
                item["id"]
            );
        }
    }
    assert_eq!(scan.get("ns=1;s=Scout/Shared")["parent"], "ns=1;s=Scout/P1");
    assert_eq!(
        scan.get("ns=1;s=Scout/Loop/B")["parent"],
        "ns=1;s=Scout/Loop/A"
    );
    assert_eq!(
        scan.get("ns=1;s=Scout/Loop/A")["parent"],
        "ns=1;s=Scout/Loop"
    );
    assert_eq!(scan.children("ns=1;s=Scout/Big").len(), 2500);

    // Types and the rest.
    let uri = scan.get("ns=1;s=Scout")["detail"]["namespace_uri"].clone();
    assert!(uri.as_str().is_some_and(|u| u.starts_with("urn:")), "{uri}");
    let types = [
        ("Scout/Tree/0/0/0/0/v0", json!("Double")),
        ("Scout/Tree/0/0/0/0/v1", json!("Int32")),
        ("Scout/Tree/3/3/3/3/v2", json!("Boolean")),
        ("Scout/Tree/3/3/3/3/v17", json!("Int32")),
        ("Scout/Tree/1/2/3/0/v3", json!("String")),
        ("Scout/Big/0", json!("UInt16")),
        ("Scout/State", json!("Int32")),
        ("Scout/When", json!("DateTime")),
        ("Scout/Speed", json!("Double")),
        ("Scout/Text", json!("String")),
        ("Scout/Blob", Value::Null),
        ("Scout/Build", Value::Null),
        ("Scout/Arr", Value::Null),
    ];
    for (id, t) in types {
        let item = scan.get(&format!("ns=1;s={id}"));
        assert_eq!(item["kind"], "value", "{id}");
        assert_eq!(item["address"], format!("ns=1;s={id}"), "{id}");
        assert_eq!(item.get("type").cloned().unwrap_or(Value::Null), t, "{id}");
        assert_eq!(item["detail"]["namespace_uri"], uri, "{id}");
    }
    assert_eq!(scan.get("ns=1;s=Scout/Blob")["detail"]["ua_type"], "i=15");
    assert_eq!(scan.get("ns=1;s=Scout/Build")["detail"]["ua_type"], "i=338");
    assert_eq!(scan.get("ns=1;s=Scout/Arr")["detail"]["dims"], json!([4]));
    assert_eq!(scan.get("ns=1;s=Scout/Arr")["detail"]["ua_type"], "i=11");
    assert_eq!(
        scan.get("ns=1;s=Scout/Matrix")["detail"]["dims"],
        json!([2, 3])
    );
    assert_eq!(scan.get("ns=1;s=Scout/Tree/0/0/0/0/v0")["access"], "rw");
    assert_eq!(scan.get("ns=1;s=Scout/Tree")["kind"], "folder");
}

/// A scan from the top skips the Server object and says so, and lists
/// the driver's own test nodes in canonical form.
#[tokio::test(flavor = "multi_thread")]
async fn a_full_scan_skips_the_server_object() {
    if !enabled() {
        return;
    }
    let server = Server::start_with(&[SCOUT]).await;
    let (mut agent, _driver) = scout_driver(anon(&server), &[node("Double")]).await;
    let s = scan(&mut agent, "top", None, json!({}), limits(50000, 8)).await;
    assert_eq!(s.error(), None, "{}", s.end);
    assert_eq!(
        s.end["excluded"],
        json!([{ "id": "i=2253", "reason": "skipped", "prefixes": ["i="] }])
    );
    assert_eq!(s.end["exhaustive"], true);
    assert_eq!(s.end["truncated"], false);
    assert_unique(&s);
    let ids = s.ids();
    assert!(!ids.iter().any(|i| i == "i=2253" || i == "i=2256"));
    assert!(!ids.iter().any(|i| i.starts_with("ns=0;")));
    let scout = s.get("ns=1;s=Scout");
    assert_eq!(scout["parent"], Value::Null);
    let counter = s.get(&node("Counter"));
    assert_eq!(counter["type"], "UInt32");
    assert_eq!(counter["access"], "rw");
    assert_eq!(s.get(&node("ReadOnly"))["access"], "r");
    assert_eq!(s.get(&node("Guid"))["type"], "UUID");
    assert_eq!(s.get(&node("SByte"))["type"], "Int8");
    assert_eq!(s.get(&node("LocalizedText"))["type"], "String");

    // include_server lists it instead.
    let s = scan(
        &mut agent,
        "withserver",
        None,
        json!({ "include_server": true }),
        limits(50000, 8),
    )
    .await;
    assert_eq!(s.error(), None, "{}", s.end);
    assert_eq!(s.end["excluded"], json!([]));
    assert_eq!(s.get("i=2253")["kind"], "folder");
    assert_eq!(s.get("i=2256")["parent"], "i=2253");
    assert_eq!(s.get("i=2258")["type"], "DateTime");
    assert_eq!(s.get("i=2258")["address"], "i=2258");
}

/// Folders at the depth cap say there is more, and the item cap
/// truncates.
#[tokio::test(flavor = "multi_thread")]
async fn the_caps_truncate() {
    if !enabled() {
        return;
    }
    let server = Server::start_with(&[SCOUT]).await;
    let (mut agent, _driver) = scout_driver(anon(&server), &[node("Double")]).await;

    let s = scan(
        &mut agent,
        "depth",
        Some("ns=1;s=Scout"),
        json!({}),
        limits(50000, 2),
    )
    .await;
    assert_eq!(s.error(), None, "{}", s.end);
    assert_eq!(s.end["truncated"], true);
    assert_eq!(s.end["reason"], "depth");
    // Scout is depth 0, Tree 1 and Tree/0 2, the cap.
    let cap = s.get("ns=1;s=Scout/Tree/0");
    assert_eq!(cap["more"], true);
    assert!(s.children("ns=1;s=Scout/Tree/0").is_empty());
    assert_eq!(s.get("ns=1;s=Scout/Tree").get("more"), None);
    // A leaf at the cap has nothing more.
    assert_eq!(s.get("ns=1;s=Scout/Big/7").get("more"), None);
    // Loop/A's one child is B, which the cap leaves out.
    assert_eq!(s.get("ns=1;s=Scout/Loop/A")["more"], true);

    let s = scan(
        &mut agent,
        "items",
        Some("ns=1;s=Scout"),
        json!({}),
        limits(100, 8),
    )
    .await;
    assert_eq!(s.error(), None, "{}", s.end);
    assert_eq!(s.end["truncated"], true);
    assert_eq!(s.end["reason"], "items");
    assert_eq!(s.items.len(), 100);
}

/// A cancel ends the scan within a second, and the server holds no
/// continuation points afterwards.
#[tokio::test(flavor = "multi_thread")]
async fn a_cancel_stops_within_a_second_and_releases_continuation_points() {
    if !enabled() {
        return;
    }
    let server = Server::start_with(&[
        SCOUT,
        ("MAX_REFS_PER_NODE", "10"),
        ("BROWSE_DELAY_MS", "50"),
    ])
    .await;
    let (mut agent, _driver) =
        scout_driver(anon(&server), &["ns=1;s=Scout/OpenCPs".to_owned()]).await;
    wait_data(&mut agent, "t0", secs(10), |v| v == 0).await;
    // Scout/Big needs 250 BrowseNexts of 10 references.
    start(
        &agent,
        "cancel1",
        Some("ns=1;s=Scout/Big"),
        json!({}),
        limits(50000, 8),
    );
    wait_data(&mut agent, "t0", secs(15), |v| {
        v.as_u64().is_some_and(|n| n > 0)
    })
    .await;
    tokio::time::sleep(ms(500)).await;
    let sent = Instant::now();
    agent.send(
        "scout",
        json!({ "op": "cancel", "id": "cancel1", "version": 1 }).to_string(),
    );
    let s = collect(&mut agent, "cancel1", None, secs(5)).await;
    assert_eq!(s.error(), Some("CANCELLED"), "{}", s.end);
    let took = s.ended - sent;
    assert!(took < secs(1), "the cancel took {took:?}");
    wait_data(&mut agent, "t0", secs(5), |v| v == 0).await;
}

/// User `test` may not browse Scout/Secure: the scan carries on and
/// ends with `partial_access`.
#[tokio::test(flavor = "multi_thread")]
async fn a_denied_branch_is_partial_access() {
    if !enabled() {
        return;
    }
    let server = Server::start_with(&[SCOUT]).await;
    let c = conf(
        &server,
        "SignAndEncrypt",
        "Basic256Sha256",
        Some(("test", "testpass")),
    );
    let (mut agent, _driver) = scout_driver(c, &[node("Double")]).await;
    let s = scan(
        &mut agent,
        "denied",
        Some("ns=1;s=Scout"),
        json!({}),
        limits(50000, 2),
    )
    .await;
    assert_eq!(s.error(), None, "{}", s.end);
    assert_eq!(s.end["truncated"], true);
    assert_eq!(s.end["reason"], "partial_access");
    let secure = s.get("ns=1;s=Scout/Secure");
    assert_eq!(secure["more"], true);
    assert_eq!(secure["detail"]["denied"], true);
    assert!(s.children("ns=1;s=Scout/Secure").is_empty());
    // The rest of the level is there.
    assert_eq!(s.children("ns=1;s=Scout/Loop").len(), 1);
}

/// A server that enforces limits it doesn't advertise: the driver
/// backs off and still lists everything. Only one level, because the
/// pace doubles with each back-off.
#[tokio::test(flavor = "multi_thread")]
async fn too_many_operations_backs_off() {
    if !enabled() {
        return;
    }
    let server = Server::start_with(&[SCOUT, ("HIDE_LIMITS", "1")]).await;
    let (mut agent, _driver) =
        scout_driver(anon(&server), &["ns=1;s=Scout/Refused".to_owned()]).await;
    wait_data(&mut agent, "t0", secs(10), |v| v == 0).await;
    let s = scan(
        &mut agent,
        "backoff",
        Some("ns=1;s=Scout"),
        json!({}),
        limits(50000, 1),
    )
    .await;
    assert_eq!(s.error(), None, "{}", s.end);
    assert_unique(&s);
    // Scout and its 18 children, each peeked at in Browses the server
    // first refused.
    let want: BTreeSet<String> = scout_space_ids(true)
        .into_iter()
        .filter(|i| i == "ns=1;s=Scout" || i.matches('/').count() == 1)
        .filter(|i| i != "ns=1;s=Scout/Shared")
        .collect();
    assert_eq!(want.len(), 19);
    assert_eq!(s.ids().into_iter().collect::<BTreeSet<_>>(), want);
    assert_eq!(s.get("ns=1;s=Scout/Tree")["more"], true);
    // The server did refuse something.
    let refused = s
        .data
        .get("t0")
        .into_iter()
        .flatten()
        .any(|v| v.as_u64() > Some(0));
    if !refused {
        wait_data(&mut agent, "t0", secs(5), |v| {
            v.as_u64().is_some_and(|n| n > 0)
        })
        .await;
    }
}

/// A server that goes away during a scan ends it with `CONN`, and once
/// it is back the next scan works.
#[tokio::test(flavor = "multi_thread")]
async fn a_lost_server_is_conn_and_the_next_scan_works() {
    if !enabled() {
        return;
    }
    let mut server = Server::start_with(&[
        SCOUT,
        ("MAX_REFS_PER_NODE", "10"),
        ("BROWSE_DELAY_MS", "50"),
    ])
    .await;
    let (mut agent, _driver) = scout_driver(anon(&server), &[node("Counter")]).await;
    start(
        &agent,
        "lost",
        Some("ns=1;s=Scout/Big"),
        json!({}),
        limits(50000, 8),
    );
    tokio::time::sleep(secs(1)).await;
    server.stop().await;
    let s = collect(&mut agent, "lost", Some(0), secs(20)).await;
    assert_eq!(s.error(), Some("CONN"), "{}", s.end);
    server.run().await;
    agent.wait_status("UP", secs(60)).await;
    let s = scan(
        &mut agent,
        "back",
        Some("ns=1;s=Scout/Loop"),
        json!({}),
        limits(50000, 8),
    )
    .await;
    assert_eq!(s.error(), None, "{}", s.end);
    assert_eq!(
        s.ids(),
        [
            "ns=1;s=Scout/Loop",
            "ns=1;s=Scout/Loop/A",
            "ns=1;s=Scout/Loop/B"
        ]
    );
}

/// A scan shares the session with the subscriptions, and data keeps
/// its rate while it runs, with every option that reads values on, and
/// Scout/Huge, an array of 5,000 elements with no declared length.
#[tokio::test(flavor = "multi_thread")]
async fn data_keeps_its_rate_during_a_scan() {
    if !enabled() {
        return;
    }
    let server = Server::start_with(&[SCOUT]).await;
    let (mut agent, _driver) = scout_driver(anon(&server), &[node("Counter")]).await;
    let before = agent.collect_data(1000, secs(3)).await.len();
    let started = Instant::now();
    let mut l = limits(50000, 8);
    l["samples"] = json!(true);
    let s = scan(
        &mut agent,
        "busy",
        Some("ns=1;s=Scout"),
        json!({ "expand_arrays": true, "units": true }),
        l,
    )
    .await;
    let took = started.elapsed();
    assert_eq!(s.error(), None, "{}", s.end);
    let during = s.data.get("t0").map_or(0, Vec::len);
    let rate_before = before as f64 / 3.0;
    let rate_during = during as f64 / took.as_secs_f64();
    eprintln!(
        "T/Counter: {rate_before:.1}/s before, {rate_during:.1}/s during a {took:?} scan of {} items",
        s.items.len()
    );
    assert!(took > secs(1), "the scan was too short to tell: {took:?}");
    assert!(
        rate_during >= rate_before * 0.7,
        "{rate_during:.1}/s during the scan against {rate_before:.1}/s before"
    );
    // Too long for elements, but read in part for its sample.
    assert!(s.children("ns=1;s=Scout/Huge").is_empty());
    assert_eq!(s.get("ns=1;s=Scout/Huge")["detail"]["dims"], json!([0]));
    assert!(
        s.get("ns=1;s=Scout/Huge")["sample"]
            .as_str()
            .is_some_and(|t| t.starts_with("[0.0,1.0,2.0")),
        "{}",
        s.get("ns=1;s=Scout/Huge")
    );
    // The connection stayed up: data still comes.
    assert!(!agent.collect_data(1000, secs(2)).await.is_empty());
}

/// Folders too big to browse together, and too big for the client's
/// message size even one at a time at 1,000 references, are listed in
/// full by smaller requests, and the connection stays up.
#[tokio::test(flavor = "multi_thread")]
async fn answers_over_the_message_size_shrink_the_requests() {
    if !enabled() {
        return;
    }
    let server = Server::start_with(&[("SCOUT_WIDE", "6")]).await;
    let (mut agent, _driver) = scout_driver(anon(&server), &[node("Counter")]).await;
    let mut l = limits(50000, 8);
    l["samples"] = json!(true);
    let s = scan(&mut agent, "wide", Some("ns=1;s=Wide"), json!({}), l).await;
    assert_eq!(s.error(), None, "{}", s.end);
    assert_eq!(s.end["exhaustive"], true, "{}", s.end);
    assert_eq!(s.items.len(), 1 + 6 + 6000);
    assert_unique(&s);
    for f in 0..6 {
        let id = format!("ns=1;s=Wide/{f}");
        assert_eq!(s.get(&id).get("more"), None, "{id}");
        assert_eq!(s.children(&id).len(), 1000, "{id}");
    }
    assert!(!agent.collect_data(1000, secs(2)).await.is_empty());
}

/// Arrays element by element, units and samples, as the options and
/// limits ask.
#[tokio::test(flavor = "multi_thread")]
async fn options_and_samples() {
    if !enabled() {
        return;
    }
    let server = Server::start_with(&[SCOUT]).await;
    let (mut agent, _driver) = scout_driver(anon(&server), &[node("Double")]).await;
    let mut l = limits(50000, 8);
    l["samples"] = json!(true);
    let s = scan(
        &mut agent,
        "opts",
        Some("ns=1;s=T"),
        json!({ "expand_arrays": true, "units": true }),
        l.clone(),
    )
    .await;
    // T has a numeric id, so the root must be given as one: OPTIONS.
    assert_eq!(s.error(), Some("OPTIONS"), "{}", s.end);

    let s = scan(
        &mut agent,
        "opts2",
        None,
        json!({ "expand_arrays": true, "units": true }),
        l,
    )
    .await;
    assert_eq!(s.error(), None, "{}", s.end);
    assert_unique(&s);
    let temps: Vec<&str> = s
        .children(&node("Temps"))
        .iter()
        .map(|i| i["address"].as_str().unwrap())
        .collect();
    assert_eq!(temps.len(), 6);
    assert_eq!(temps[3], "ns=1;s=T/Temps[3]");
    assert_eq!(s.get("ns=1;s=T/Temps[3]")["type"], "Double");
    assert_eq!(s.get("ns=1;s=T/Grid[1,2]")["type"], "Int32");
    // T/Elem[3] is a node of its own, listed once, under T.
    assert_eq!(
        s.ids().iter().filter(|i| *i == "ns=1;s=T/Elem[3]").count(),
        1
    );
    assert_ne!(s.get("ns=1;s=T/Elem[3]")["parent"], node("Elem"));
    assert_eq!(s.children(&node("Elem")).len(), 3);
    assert!(s.children("ns=1;s=Scout/Long").is_empty());
    // node-opcua's display name for revolutions per minute.
    assert_eq!(s.get("ns=1;s=Scout/Speed")["unit"], "r/min");
    assert_eq!(s.get(&node("Double"))["sample"], "2.2");
    assert_eq!(s.get(&node("String"))["sample"], "hello");
    assert_eq!(s.get(&node("Boolean"))["sample"], "true");
    // The element addresses are ones the driver reads.
    let (mut reader, _d2) = driver(
        anon(&server),
        &["ns=1;s=T/Temps[3]".into(), "ns=1;s=T/Grid[1,2]".into()],
    )
    .await;
    let v = values(&mut reader, &["t0", "t1"], secs(10)).await;
    assert_eq!(v["t0"], json!(13.5));
    assert_eq!(v["t1"], json!(6));
}

/// How big a 20,000-variable scan is, as items on the wire and as the
/// gzipped NDJSON snapshot the Edge Agent stores.
#[tokio::test(flavor = "multi_thread")]
async fn the_size_of_a_20000_item_scan() {
    if !enabled() {
        return;
    }
    let server = Server::start_with(&[("SCOUT_SIZE", "20000")]).await;
    let (mut agent, _driver) = scout_driver(anon(&server), &[node("Double")]).await;
    let started = Instant::now();
    let s = scan(
        &mut agent,
        "size",
        Some("ns=1;s=Plant"),
        json!({}),
        limits(50000, 8),
    )
    .await;
    let took = started.elapsed();
    assert_eq!(s.error(), None, "{}", s.end);
    // Plant, 4 areas, 40 lines, 400 cells and 20,000 variables.
    assert_eq!(s.items.len(), 1 + 4 + 40 + 400 + 20_000);
    assert_unique(&s);

    let mut raw = Vec::new();
    let header = json!({
        "version": 1, "scan": "3f9c1a2b-44e0-4d0c-9a7e-5b1f2c3d4e5f",
        "connection": "5d0c7f3e-8a21-4c55-9a7e-0f6b1d2c3e4a",
        "driver": rs_edge_driver::LIBRARY, "started": "2026-11-24T10:41:00Z",
        "root": "ns=1;s=Plant", "folder_id": "ns=1;s=Plant", "options": {},
    });
    writeln!(raw, "{header}").unwrap();
    for item in &s.items {
        writeln!(raw, "{item}").unwrap();
    }
    let end = json!({ "end": {
        "finished": "2026-11-24T10:42:13Z", "exhaustive": true, "truncated": false,
        "reason": null, "excluded": [], "rejected": 0, "items": s.items.len(), "branches": [],
    }});
    writeln!(raw, "{end}").unwrap();
    let gz = gzip(&raw);
    let per_item = raw.len() as f64 / s.items.len() as f64;
    eprintln!(
        "SIZE: {} items in {took:?}: {} bytes raw ({per_item:.0} per item), {} bytes gzipped \
         ({:.1}%)",
        s.items.len(),
        raw.len(),
        gz,
        100.0 * gz as f64 / raw.len() as f64,
    );
    // The Edge Agent's caps: 32 MiB raw, 8 MiB gzipped.
    assert!(raw.len() < 32 << 20);
    assert!(gz < 8 << 20);
}

/// The gzipped size of `data`, at gzip's default level, as Node's
/// `zlib.createGzip()` uses.
fn gzip(data: &[u8]) -> usize {
    use std::process::{Command, Stdio};
    let mut child = Command::new("gzip")
        .args(["-6", "-c"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("can't run gzip");
    let mut stdin = child.stdin.take().unwrap();
    let data = data.to_vec();
    let writer = std::thread::spawn(move || stdin.write_all(&data).unwrap());
    let out = child.wait_with_output().unwrap();
    writer.join().unwrap();
    assert!(out.status.success());
    out.stdout.len()
}

// ACS Rust test driver
// Run scans through the whole driver against a fake Edge Agent
// Copyright 2026 University of Sheffield

//! Edge Scout end to end over MQTT: the hello, full, rooted and branch
//! scans, every cap, and each option that makes a scan misbehave. The
//! fake Edge Agent is the one `rs-edge-driver` tests itself with, run
//! with the Edge Agent's ACL, so a driver that steps outside it is
//! dropped. Every message is checked against the JSON Schemas in
//! `lib/edge-scout-schemas`.

#[path = "../../lib/rs-edge-driver/tests/common/mod.rs"]
mod common;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::LazyLock;
use std::time::Duration;

use common::{Acl, FakeAgent, FromDriver, RunningDriver, ms, secs, spawn_driver};
use edge_test_rs::scout::Tree;
use edge_test_rs::{Addr, TestHandler, clock};
use serde_json::{Value, json};
use tokio::time::Instant;

// ---------------------------------------------------------------
// Schemas

fn load(path: PathBuf) -> Value {
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path:?}: {e}"));
    serde_json::from_str(&text).unwrap()
}

fn compile(name: &str) -> jsonschema::Validator {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../lib/edge-scout-schemas/schemas");
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

static FOUND: LazyLock<jsonschema::Validator> = LazyLock::new(|| compile("found"));
static ITEM: LazyLock<jsonschema::Validator> = LazyLock::new(|| compile("item"));
static REQUEST: LazyLock<jsonschema::Validator> = LazyLock::new(|| compile("request"));

fn check(validator: &jsonschema::Validator, what: &str, v: &Value) {
    let errors: Vec<_> = validator.iter_errors(v).map(|e| e.to_string()).collect();
    assert!(errors.is_empty(), "{v} breaks {what}: {errors:?}");
}

/// Check a found message, and each item in it, against the schemas.
fn check_found(msg: &Value) {
    check(&FOUND, "found.schema.json", msg);
    for item in msg["items"].as_array().into_iter().flatten() {
        check(&ITEM, "item.schema.json", item);
        if item["kind"] == "value" {
            let addr = item["address"].as_str().unwrap();
            let parsed = Addr::parse(addr).unwrap_or_else(|| panic!("{addr} does not parse"));
            assert_eq!(parsed.to_string(), addr, "{addr} is not canonical");
        }
    }
}

// ---------------------------------------------------------------
// Helpers

const SCAN: &str = "3f9c1a2b44e04d0c9a7e5b1f2c3d4e5f";

/// Start the driver, bring it UP with the scouting feature, and wait
/// for its `scout` subscription.
async fn up() -> (FakeAgent, RunningDriver) {
    clock::start();
    let mut agent = FakeAgent::start("Test").await;
    agent.stats.set_acl(Some(Acl::with_scout()));
    let driver = spawn_driver::<TestHandler>(agent.config());
    agent.wait_status("READY", secs(5)).await;
    agent.send("conf", "{}");
    agent.send_addrs_features(&[("a", "const:1000:1:bd")], json!({ "scout": 1 }));
    agent.wait_status("UP", secs(5)).await;

    let topic = format!("fpEdge1/{}/scout", agent.id);
    let deadline = Instant::now() + secs(5);
    while !agent.stats.subscriptions().contains(&topic) {
        assert!(Instant::now() < deadline, "no scout subscription");
        tokio::time::sleep(ms(10)).await;
    }
    (agent, driver)
}

fn limits() -> Value {
    json!({ "items": 20000, "depth": 8, "seconds": 120, "pace_ms": 0, "samples": false })
}

/// Send a `start`, after checking it against the request schema.
fn start(
    agent: &FakeAgent,
    root: Option<&str>,
    folder: Option<&str>,
    options: Value,
    limits: Value,
) {
    let msg = json!({
        "op": "start", "id": SCAN, "version": 1, "root": root, "folder_id": folder,
        "options": options, "limits": limits,
    });
    check(&REQUEST, "request.schema.json", &msg);
    agent.send("scout", msg.to_string());
}

/// The scan's messages, up to and including the end. Data and status
/// messages in between are left out.
async fn scan_messages(agent: &mut FakeAgent, within: Duration) -> Vec<Value> {
    let mut out = Vec::new();
    read_scan(agent, within, &mut out, false).await;
    out
}

/// Read the scan's messages into `out` until the end. With `data`,
/// return early, with true, when a data message arrives.
async fn read_scan(
    agent: &mut FakeAgent,
    within: Duration,
    out: &mut Vec<Value>,
    data: bool,
) -> bool {
    let topic = format!("fpEdge1/{}/found/{SCAN}", agent.id);
    let deadline = Instant::now() + within;
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        match agent.next(left).await {
            Some(FromDriver::Other { topic: t, payload }) if t == topic => {
                let v: Value = serde_json::from_slice(&payload).unwrap();
                check_found(&v);
                assert_eq!(v["seq"], out.len() as u64, "seq gap before {v}");
                let end = v["type"] == "end";
                out.push(v);
                if end {
                    return false;
                }
            }
            Some(FromDriver::Data { .. }) if data => return true,
            Some(FromDriver::Disconnected) => panic!("the driver was disconnected"),
            Some(_) => {}
            None => panic!("no end within {within:?}; got {} messages", out.len()),
        }
    }
}

async fn scan(
    agent: &mut FakeAgent,
    root: Option<&str>,
    folder: Option<&str>,
    options: Value,
    limits: Value,
) -> (Vec<Value>, Value) {
    start(agent, root, folder, options, limits);
    let msgs = scan_messages(agent, secs(30)).await;
    let items = msgs
        .iter()
        .filter(|m| m["type"] == "items")
        .flat_map(|m| m["items"].as_array().unwrap().clone())
        .collect();
    let end = msgs.last().unwrap().clone();
    (items, end)
}

fn ids(items: &[Value]) -> Vec<&str> {
    items.iter().map(|i| i["id"].as_str().unwrap()).collect()
}

fn code(end: &Value) -> &str {
    end["error"]["code"].as_str().unwrap_or("none")
}

/// Items with this many folders and values: `size` values under
/// `depth` levels.
fn tree_len(size: u64, depth: u32) -> usize {
    (1..=depth + 1)
        .map(|level| size.div_ceil(10u64.pow(depth + 1 - level)) as usize)
        .sum()
}

// ---------------------------------------------------------------
// Tests

#[tokio::test]
async fn hello_says_supported() {
    let (mut agent, _driver) = up().await;
    agent.send("scout", json!({ "op": "hello", "version": 1 }).to_string());
    let topic = format!("fpEdge1/{}/found/hello", agent.id);
    loop {
        match agent.next(secs(5)).await {
            Some(FromDriver::Other { topic: t, payload }) if t == topic => {
                let v: Value = serde_json::from_slice(&payload).unwrap();
                check_found(&v);
                assert_eq!(v["supported"], true);
                assert_eq!(v["seq"], 0);
                return;
            }
            Some(_) => {}
            None => panic!("no hello answer"),
        }
    }
}

#[tokio::test]
async fn full_scan_with_default_options() {
    let (mut agent, _driver) = up().await;
    start(&agent, None, None, json!({}), limits());
    let msgs = scan_messages(&mut agent, secs(10)).await;
    assert_eq!(msgs[0]["type"], "accept");
    let items: Vec<Value> = msgs
        .iter()
        .filter(|m| m["type"] == "items")
        .flat_map(|m| m["items"].as_array().unwrap().clone())
        .collect();
    // 100 values in 10 folders in 1 folder.
    assert_eq!(items.len(), 111);
    assert_eq!(items.len(), tree_len(100, 2));
    assert_eq!(ids(&items)[..3], ["f1.0", "f2.0", "v0"]);
    let v7 = items.iter().find(|i| i["id"] == "v7").unwrap();
    assert_eq!(
        *v7,
        json!({
            "id": "v7", "parent": "f2.0", "name": "Value 7", "kind": "value",
            "address": "sin:1000:7:bf", "type": "Float", "access": "r",
            "description": "Sine wave with amplitude 7 and period 1000 ms, sent as a big-endian float",
            "detail": { "index": 7 },
        })
    );

    let end = msgs.last().unwrap();
    assert_eq!(end["exhaustive"], true);
    assert_eq!(end["truncated"], false);
    assert_eq!(end["reason"], Value::Null);
    assert!(
        msgs.iter().any(|m| m["type"] == "progress"),
        "no progress message"
    );
    assert_eq!(agent.stats.kicked(), 0);
}

/// The scan's options and limits: the item cap, the depth cap and
/// samples.
#[tokio::test]
async fn keeps_to_the_caps() {
    let (mut agent, _driver) = up().await;

    let mut l = limits();
    l["items"] = json!(250);
    let (items, end) = scan(&mut agent, None, None, json!({ "size": 1000 }), l).await;
    assert_eq!(items.len(), 250);
    assert_eq!(end["truncated"], true);
    assert_eq!(end["reason"], "items");

    let mut l = limits();
    l["depth"] = json!(2);
    let (items, end) = scan(&mut agent, None, None, json!({ "size": 1000 }), l).await;
    assert_eq!(items.len(), 10 + 100);
    assert!(
        items
            .iter()
            .filter(|i| i["id"].as_str().unwrap().starts_with("f2."))
            .all(|i| i["more"] == true)
    );
    assert_eq!(end["truncated"], true);
    assert_eq!(end["reason"], "depth");

    let (items, _) = scan(
        &mut agent,
        None,
        None,
        json!({ "size": 5, "depth": 0 }),
        limits(),
    )
    .await;
    assert!(items.iter().all(|i| i.get("sample").is_none()));
    let mut l = limits();
    l["samples"] = json!(true);
    let (items, _) = scan(&mut agent, None, None, json!({ "size": 5, "depth": 0 }), l).await;
    assert_eq!(items[0]["sample"], "0");
    assert!(items.iter().all(|i| i["sample"].is_string()));
}

/// A branch scan lists the folder first, then the same items, with the
/// same parents, as the full scan has under it.
#[tokio::test]
async fn branch_scan_matches_the_full_scan() {
    let (mut agent, _driver) = up().await;
    let options = json!({ "size": 2000, "depth": 3 });
    let (full, _) = scan(&mut agent, None, None, options.clone(), limits()).await;
    assert_eq!(full.len(), tree_len(2000, 3));
    let parents: HashMap<&str, &Value> = full
        .iter()
        .map(|i| (i["id"].as_str().unwrap(), &i["parent"]))
        .collect();

    let (branch, end) = scan(
        &mut agent,
        Some("f2.13"),
        Some("f2.13"),
        options.clone(),
        limits(),
    )
    .await;
    assert_eq!(end["truncated"], false);
    assert_eq!(branch[0]["id"], "f2.13");
    assert_eq!(branch[0]["parent"], "f1.1");
    assert_eq!(branch.len(), 1 + 10 + 100);
    for item in &branch {
        let full_item = full.iter().find(|f| f["id"] == item["id"]).unwrap();
        assert_eq!(item, full_item);
        let mut id = item["id"].as_str().unwrap();
        while id != "f2.13" {
            id = parents[id].as_str().expect("left the branch");
        }
    }

    // A rooted scan without folder_id lists only what the folder holds.
    let (rooted, _) = scan(&mut agent, Some("f2.13"), None, options, limits()).await;
    assert_eq!(rooted.len(), 10 + 100);
    assert_eq!(rooted[0]["id"], "f3.130");
}

#[tokio::test]
async fn bad_roots_and_options_end_with_options() {
    let (mut agent, _driver) = up().await;
    for (root, folder, options) in [
        (Some("f1.5"), None, json!({})),
        (Some("v3"), None, json!({})),
        (Some("f2.1"), Some("f2.2"), json!({})),
        (None, None, json!({ "colour": "blue" })),
        (None, None, json!({ "size": -1 })),
        (None, None, json!({ "depth": 99 })),
    ] {
        let (items, end) = scan(&mut agent, root, folder, options.clone(), limits()).await;
        assert!(items.is_empty(), "{root:?} {options}");
        assert_eq!(
            code(&end),
            "OPTIONS",
            "{root:?} {folder:?} {options}: {end}"
        );
    }
}

/// `fail` sends the first request's items, then ends with its code.
/// `PANIC` comes back as `ERR` from the library.
#[tokio::test]
async fn fail_option_ends_with_its_code() {
    let (mut agent, _driver) = up().await;
    for (fail, want) in [
        ("CONN", "CONN"),
        ("AUTH", "AUTH"),
        ("OPTIONS", "OPTIONS"),
        ("ERR", "ERR"),
        ("PANIC", "ERR"),
    ] {
        let (items, end) = scan(
            &mut agent,
            None,
            None,
            json!({ "size": 1000, "fail": fail }),
            limits(),
        )
        .await;
        assert_eq!(items.len(), 100, "{fail}");
        assert_eq!(code(&end), want, "{fail}");
    }
    // The driver carries on scanning after a panic.
    let (items, end) = scan(&mut agent, None, None, json!({ "size": 3 }), limits()).await;
    assert_eq!(items.len(), tree_len(3, 2));
    assert_eq!(end["truncated"], false);
}

/// A hung scan is ended by the library at `limits.seconds`.
#[tokio::test]
async fn hang_is_ended_by_the_watchdog() {
    let (mut agent, _driver) = up().await;
    let mut l = limits();
    l["seconds"] = json!(1);
    let started = Instant::now();
    let (items, end) = scan(
        &mut agent,
        None,
        None,
        json!({ "size": 1000, "hang": true }),
        l,
    )
    .await;
    assert_eq!(items.len(), 100);
    assert_eq!(end["truncated"], true);
    assert_eq!(end["reason"], "seconds");
    assert!(started.elapsed() < secs(6), "took {:?}", started.elapsed());
}

/// A slow scan stops promptly on a cancel, and polls carry on during it.
#[tokio::test]
async fn delay_and_cancel() {
    let (mut agent, _driver) = up().await;
    start(
        &agent,
        None,
        None,
        json!({ "size": 10000, "delay_ms": 200 }),
        limits(),
    );
    let mut msgs = Vec::new();
    tokio::time::sleep(ms(500)).await;
    agent.send("poll", "a");
    assert!(
        read_scan(&mut agent, secs(2), &mut msgs, true).await,
        "no data during the scan"
    );

    let cancelled = Instant::now();
    agent.send(
        "scout",
        json!({ "op": "cancel", "id": SCAN, "version": 1 }).to_string(),
    );
    read_scan(&mut agent, secs(6), &mut msgs, false).await;
    assert_eq!(code(msgs.last().unwrap()), "CANCELLED");
    assert!(
        cancelled.elapsed() < secs(1),
        "cancel took {:?}",
        cancelled.elapsed()
    );
    let n: usize = msgs
        .iter()
        .filter(|m| m["type"] == "items")
        .map(|m| m["items"].as_array().unwrap().len())
        .sum();
    assert!(n < 1000, "the delay did not slow the scan: {n} items");
}

/// `duplicates` sends every tenth value twice, for the agent to drop.
#[tokio::test]
async fn duplicates_repeat_ids() {
    let (mut agent, _driver) = up().await;
    let (items, _) = scan(
        &mut agent,
        None,
        None,
        json!({ "size": 30, "depth": 0, "duplicates": true }),
        limits(),
    )
    .await;
    assert_eq!(items.len(), 33);
    assert_eq!(ids(&items).iter().filter(|i| **i == "v20").count(), 2);
}

/// The biggest scan the library allows, as the end-to-end load test
/// runs it: 49,950 items in batches of at most 500.
#[tokio::test]
async fn large_scan() {
    let (mut agent, _driver) = up().await;
    let mut l = limits();
    l["items"] = json!(50000);
    start(&agent, None, None, json!({ "size": 45000 }), l);
    let msgs = scan_messages(&mut agent, secs(60)).await;
    let mut n = 0;
    for m in msgs.iter().filter(|m| m["type"] == "items") {
        let len = m["items"].as_array().unwrap().len();
        assert!(len <= 500);
        n += len;
    }
    assert_eq!(n, tree_len(45000, 2));
    assert_eq!(n, 49_950);
    assert_eq!(msgs.last().unwrap()["truncated"], false);
    assert_eq!(
        Tree::new(45000, 2)
            .walk(None, false, 8, false, false)
            .count(),
        n
    );
}

// ACS MQTT driver
// Helpers for the scan tests: start a scan and check what comes back
// Copyright 2026 University of Sheffield

//! The Edge Agent's side of a scan, on the fake agent from
//! `rs-edge-driver`'s tests. Every `found` message, and every item in
//! one, is checked against the JSON Schemas in `lib/edge-scout-schemas`.

#![allow(dead_code)]

use std::path::PathBuf;
use std::sync::LazyLock;
use std::time::Duration;

use edge_mqtt::MqttHandler;
use serde_json::{Value, json};
use tokio::time::Instant;

use super::common::{Acl, FakeAgent, FromDriver, ms, secs, spawn_driver};

pub const SCAN: &str = "3f9c1a2b44e04d0c9a7e5b1f2c3d4e5f";

fn schema_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../lib/edge-scout-schemas/schemas")
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

/// Check a found message, and each item in it, against the schemas.
pub fn check_found(msg: &Value) {
    let errors: Vec<_> = FOUND.iter_errors(msg).map(|e| e.to_string()).collect();
    assert!(
        errors.is_empty(),
        "{msg} breaks found.schema.json: {errors:?}"
    );
    for item in msg
        .get("items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let errors: Vec<_> = ITEM.iter_errors(item).map(|e| e.to_string()).collect();
        assert!(
            errors.is_empty(),
            "{item} breaks item.schema.json: {errors:?}"
        );
    }
}

/// Start the MQTT driver against `conf`, with the scouting feature, and
/// wait until it is UP and subscribed to `scout`.
pub async fn up(conf: Value, addrs: &[(&str, &str)]) -> (FakeAgent, super::common::RunningDriver) {
    let mut agent = FakeAgent::start("MQTT").await;
    agent.stats.set_acl(Some(Acl::with_scout()));
    let driver = spawn_driver::<MqttHandler>(agent.config());
    agent.wait_status("READY", secs(5)).await;
    agent.send("conf", conf.to_string());
    agent.send_addrs_features(addrs, json!({ "scout": 1 }));
    agent.wait_status("UP", secs(5)).await;
    let topic = format!("fpEdge1/{}/scout", agent.id);
    let deadline = Instant::now() + secs(5);
    while !agent.stats.subscriptions().contains(&topic) {
        assert!(
            Instant::now() < deadline,
            "the driver did not subscribe to scout"
        );
        tokio::time::sleep(ms(10)).await;
    }
    (agent, driver)
}

/// Default limits, with a time cap.
pub fn limits(items: u64, depth: u64, seconds: u64, samples: bool) -> Value {
    json!({ "items": items, "depth": depth, "seconds": seconds, "pace_ms": 0, "samples": samples })
}

/// Send a start for a full scan.
pub fn start(agent: &FakeAgent, options: Value, limits: Value) {
    start_at(agent, None, None, options, limits);
}

/// Send a start, for a branch scan when `root` and `folder_id` are set.
pub fn start_at(
    agent: &FakeAgent,
    root: Option<&str>,
    folder_id: Option<&str>,
    options: Value,
    limits: Value,
) {
    let msg = json!({
        "op": "start", "id": SCAN, "version": 1, "root": root, "folder_id": folder_id,
        "options": options, "limits": limits,
    });
    agent.send("scout", msg.to_string());
}

/// The messages on `found/<SCAN>` up to and including the end, checked
/// against the schemas and for `seq` gaps. Data messages that arrive
/// meanwhile go in `data`.
pub async fn until_end(
    agent: &mut FakeAgent,
    within: Duration,
    data: &mut Vec<(String, bytes::Bytes)>,
) -> Vec<Value> {
    let topic = format!("fpEdge1/{}/found/{SCAN}", agent.id);
    let deadline = Instant::now() + within;
    let mut out = Vec::new();
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
                    return out;
                }
            }
            Some(FromDriver::Data { topic, payload }) => data.push((topic, payload)),
            Some(FromDriver::Disconnected) => panic!("the driver disconnected during the scan"),
            Some(_) => {}
            None => panic!("no end on {topic} within {within:?}; got {out:?}"),
        }
    }
}

pub async fn scan(agent: &mut FakeAgent, within: Duration) -> Vec<Value> {
    until_end(agent, within, &mut Vec::new()).await
}

/// Every item in the scan's messages.
pub fn items_of(msgs: &[Value]) -> Vec<Value> {
    msgs.iter()
        .filter(|m| m["type"] == "items")
        .flat_map(|m| m["items"].as_array().unwrap().clone())
        .collect()
}

pub fn end_of(msgs: &[Value]) -> &Value {
    let end = msgs.last().unwrap();
    assert_eq!(end["type"], "end");
    end
}

/// The end's error code, or "none".
pub fn error_code(msgs: &[Value]) -> &str {
    end_of(msgs)["error"]["code"].as_str().unwrap_or("none")
}

pub fn find<'a>(items: &'a [Value], id: &str) -> &'a Value {
    items
        .iter()
        .find(|i| i["id"] == id)
        .unwrap_or_else(|| panic!("no item {id:?} among {:?}", ids(items)))
}

pub fn has(items: &[Value], id: &str) -> bool {
    items.iter().any(|i| i["id"] == id)
}

pub fn ids(items: &[Value]) -> Vec<&str> {
    items.iter().map(|i| i["id"].as_str().unwrap()).collect()
}

/// Every item's parent comes before it, and no id repeats.
pub fn assert_tree(items: &[Value]) {
    let mut seen = std::collections::HashSet::new();
    for i in items {
        if let Some(p) = i["parent"].as_str() {
            assert!(seen.contains(p), "{} comes before its parent {p}", i["id"]);
        }
        assert!(
            seen.insert(i["id"].as_str().unwrap()),
            "duplicate {}",
            i["id"]
        );
    }
}

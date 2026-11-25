// ACS MQTT driver
// Live values against a real broker: mosquitto
// Copyright 2026 University of Sheffield

//! See `real/mod.rs` for what these tests need. A read subscribes the
//! driver's own connection to the topics it asks for, so the broker's
//! retained message answers the first read, while the address map's
//! data reaches the Edge Agent exactly as before.

#[path = "../../lib/rs-edge-driver/tests/common/mod.rs"]
mod common;
mod real;
mod scouting;

use common::{FakeAgent, FromDriver, ms, secs};
use real::*;
use rumqttc::{AsyncClient, Event, Incoming, MqttOptions, QoS};
use scouting::*;
use serde_json::{Value, json};
use tokio::time::Instant;

fn conf(port: u16) -> Value {
    json!({
        "protocol": "mqtt", "host": "127.0.0.1", "port": port,
        "clientId": "edge-main", "cleanSession": true, "keepAlive": 60,
    })
}

/// Send a read and wait for its answer, counting data messages by
/// topic meanwhile.
async fn read(
    agent: &mut FakeAgent,
    id: &str,
    addresses: &[&str],
    data: &mut Vec<String>,
) -> Value {
    read_keeping(agent, id, addresses, data, &mut Vec::new()).await
}

/// As [`read`], keeping the scan's messages that arrive meanwhile.
async fn read_keeping(
    agent: &mut FakeAgent,
    id: &str,
    addresses: &[&str],
    data: &mut Vec<String>,
    scan_msgs: &mut Vec<Value>,
) -> Value {
    agent.send(
        "scout",
        json!({ "op": "read", "id": id, "version": 1, "addresses": addresses }).to_string(),
    );
    let topic = format!("fpEdge1/{}/found/{id}", agent.id);
    let deadline = Instant::now() + secs(5);
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        match agent.next(left).await {
            Some(FromDriver::Other { topic: t, payload }) if t == topic => {
                return serde_json::from_slice(&payload).unwrap();
            }
            Some(FromDriver::Other { topic: t, payload }) if t.ends_with(SCAN) => {
                scan_msgs.push(serde_json::from_slice(&payload).unwrap());
            }
            Some(FromDriver::Data { topic, .. }) => data.push(topic),
            Some(_) => {}
            None => panic!("no answer to read {id}"),
        }
    }
}

/// Publish a retained message and wait until the broker holds it, so
/// a test under load doesn't race the device.
async fn retain(port: u16, topic: &str, payload: &str) {
    let device = device(port, None).await;
    device
        .publish(topic, QoS::AtLeastOnce, true, payload.as_bytes().to_vec())
        .await
        .unwrap();
    let (client, mut ev) = AsyncClient::new(MqttOptions::new("checker", "127.0.0.1", port), 10);
    client.subscribe(topic, QoS::AtMostOnce).await.unwrap();
    let found = tokio::time::timeout(secs(10), async {
        loop {
            match ev.poll().await {
                Ok(Event::Incoming(Incoming::Publish(p))) if p.topic == topic => return,
                Ok(_) => {}
                Err(e) => panic!("checker: {e}"),
            }
        }
    })
    .await;
    assert!(found.is_ok(), "the broker never retained {topic}");
    let _ = client.disconnect().await;
    let _ = ev.poll().await;
}

fn entry<'a>(msg: &'a Value, address: &str) -> &'a Value {
    msg["values"]
        .as_array()
        .unwrap_or_else(|| panic!("not values: {msg}"))
        .iter()
        .find(|v| v["address"] == address)
        .unwrap_or_else(|| panic!("no {address} in {msg}"))
}

#[tokio::test]
async fn reads_answer_from_retained_and_live_messages() {
    if !tools() {
        return;
    }
    let dir = temp_dir("live");
    let broker = mosquitto(dir.clone(), "allow_anonymous true").await;
    retain(broker.port, "plant/config", r#"{"mode":"auto"}"#).await;
    retain(broker.port, "plant/data", "1").await;
    let device = device(broker.port, None).await;
    let (mut agent, _driver) = up(conf(broker.port), &[("1", "plant/data")]).await;
    // The mapped topic's retained message, once.
    let first = agent.collect_data(1, secs(5)).await;
    assert_eq!(first[0].1.as_ref(), b"1");

    let mut data = Vec::new();
    let msg = read(
        &mut agent,
        "r1",
        &["plant/config", "plant/live", "plant/data"],
        &mut data,
    )
    .await;
    assert_eq!(msg["type"], "values");
    // The retained message answers the first read.
    assert_eq!(entry(&msg, "plant/config")["value"], r#"{"mode":"auto"}"#);
    assert_eq!(entry(&msg, "plant/live")["error"], "No message yet");
    // A mapped topic is not subscribed to again, so its retained
    // message is not sent again and the read has nothing for it yet.
    assert_eq!(entry(&msg, "plant/data")["error"], "No message yet");

    device
        .publish("plant/live", QoS::AtMostOnce, false, b"42".to_vec())
        .await
        .unwrap();
    device
        .publish("plant/data", QoS::AtMostOnce, false, b"2".to_vec())
        .await
        .unwrap();
    tokio::time::sleep(ms(300)).await;
    let msg = read(&mut agent, "r2", &["plant/live", "plant/data"], &mut data).await;
    assert_eq!(entry(&msg, "plant/live")["value"], "42");
    assert_eq!(entry(&msg, "plant/data")["value"], "2");
    data.extend(
        agent
            .drain(ms(300))
            .await
            .into_iter()
            .filter_map(|e| match e {
                FromDriver::Data { topic, .. } => Some(topic),
                _ => None,
            }),
    );
    assert_eq!(data, ["1"], "only the new mapped message reaches the agent");
}

/// A read runs while a scan listens on its own connection.
#[tokio::test]
async fn reads_run_beside_a_scan() {
    if !tools() {
        return;
    }
    let dir = temp_dir("live-scan");
    let broker = mosquitto(dir.clone(), "allow_anonymous true").await;
    retain(broker.port, "plant/a", "5").await;
    let (mut agent, _driver) = up(conf(broker.port), &[("1", "plant/data")]).await;
    start(&agent, json!({ "seconds": 3 }), limits(100, 8, 30, true));
    tokio::time::sleep(ms(500)).await;
    let mut data = Vec::new();
    let mut msgs = Vec::new();
    let msg = read_keeping(&mut agent, "r1", &["plant/a"], &mut data, &mut msgs).await;
    assert_eq!(entry(&msg, "plant/a")["value"], "5", "{msg}");
    let topic = format!("fpEdge1/{}/found/{SCAN}", agent.id);
    while msgs.last().is_none_or(|m| m["type"] != "end") {
        match agent.next(secs(10)).await {
            Some(FromDriver::Other { topic: t, payload }) if t == topic => {
                msgs.push(serde_json::from_slice(&payload).unwrap());
            }
            Some(_) => {}
            None => panic!("the scan did not end: {msgs:?}"),
        }
    }
    for (i, m) in msgs.iter().enumerate() {
        check_found(m);
        assert_eq!(m["seq"], i as u64, "a gap in seq: {msgs:?}");
    }
    let end = end_of(&msgs);
    assert!(end.get("error").is_none(), "{end}");
    let items = items_of(&msgs);
    // The scan heard the retained message, with its sample.
    assert_eq!(find(&items, "plant/a")["sample"], "5");
}

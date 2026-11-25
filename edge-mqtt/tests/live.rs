// ACS MQTT driver
// Live values between a fake Edge Agent and a fake device broker
// Copyright 2026 University of Sheffield

//! Live values on the driver's own connection, against
//! [`broker::FakeBroker`]: what the driver subscribes to and
//! unsubscribes from, what reaches the Edge Agent, and what a read
//! answers. See `src/live.rs`.

mod broker;
#[path = "../../lib/rs-edge-driver/tests/common/mod.rs"]
mod common;
mod scouting;

use std::time::Duration;

use broker::{FakeBroker, Seen};
use common::{FakeAgent, FromDriver, ms, secs};
use scouting::*;
use serde_json::{Value, json};
use tokio::time::Instant;

/// Send a read and wait for its one answer. Data messages that arrive
/// meanwhile go in `data`.
async fn read(
    agent: &mut FakeAgent,
    id: &str,
    addresses: &[&str],
    data: &mut Vec<String>,
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
                let v: Value = serde_json::from_slice(&payload).unwrap();
                assert_eq!(v["seq"], 0);
                return v;
            }
            Some(FromDriver::Data { topic, .. }) => data.push(topic),
            Some(_) => {}
            None => panic!("no answer to read {id}"),
        }
    }
}

fn entry<'a>(msg: &'a Value, address: &str) -> &'a Value {
    msg["values"]
        .as_array()
        .unwrap_or_else(|| panic!("not values: {msg}"))
        .iter()
        .find(|v| v["address"] == address)
        .unwrap_or_else(|| panic!("no {address} in {msg}"))
}

/// The SUBSCRIBEs and UNSUBSCRIBEs the driver sent within `within`.
async fn changes(broker: &mut FakeBroker, within: Duration) -> Vec<String> {
    broker
        .drain(within)
        .await
        .into_iter()
        .filter_map(|e| match e {
            Seen::Subscribe(f) => Some(format!(
                "sub {}",
                f.iter()
                    .map(|(t, _)| t.as_str())
                    .collect::<Vec<_>>()
                    .join(",")
            )),
            Seen::Unsubscribe(f) => Some(format!("unsub {}", f.join(","))),
            _ => None,
        })
        .collect()
}

/// A read subscribes the data connection to a topic the address map
/// does not have, answers from the last message, never passes that
/// topic's messages to the Edge Agent, and leaves mapped topics alone.
#[tokio::test]
async fn reads_subscribe_on_the_data_connection() {
    let mut broker = FakeBroker::start().await;
    let (mut agent, _driver) = up(broker.conf(), &[("1", "plant/data")]).await;
    assert_eq!(changes(&mut broker, ms(300)).await, ["sub plant/data"]);

    agent.send("scout", json!({ "op": "hello", "version": 1 }).to_string());
    let hello = loop {
        match agent.next(secs(5)).await {
            Some(FromDriver::Other { topic, payload }) if topic.ends_with("/found/hello") => {
                break serde_json::from_slice::<Value>(&payload).unwrap();
            }
            Some(_) => {}
            None => panic!("no hello"),
        }
    };
    check_found(&hello);
    assert_eq!(hello["reads"], true);

    let mut data = Vec::new();
    let msg = read(
        &mut agent,
        "r1",
        &["plant/temp", "plant/data", "plant/#"],
        &mut data,
    )
    .await;
    assert_eq!(msg["type"], "values");
    assert_eq!(entry(&msg, "plant/temp")["error"], "No message yet");
    assert_eq!(entry(&msg, "plant/data")["error"], "No message yet");
    assert_eq!(
        entry(&msg, "plant/#")["error"],
        "A filter with + or # is not one topic"
    );
    // Only the topic the map does not have.
    assert_eq!(changes(&mut broker, ms(300)).await, ["sub plant/temp"]);

    broker.publish("plant/temp", r#"{"t":21.4}"#);
    broker.publish("plant/data", "7");
    tokio::time::sleep(ms(200)).await;
    let msg = read(&mut agent, "r2", &["plant/temp", "plant/data"], &mut data).await;
    let temp = entry(&msg, "plant/temp");
    assert_eq!(temp["value"], r#"{"t":21.4}"#);
    assert_eq!(temp["type"], "String");
    assert!(temp["ts"].is_i64());
    assert_eq!(entry(&msg, "plant/data")["value"], "7");
    let more = agent.drain(ms(300)).await;
    data.extend(more.into_iter().filter_map(|e| match e {
        FromDriver::Data { topic, .. } => Some(topic),
        _ => None,
    }));
    assert_eq!(data, ["1"], "only the mapped topic reaches the agent");
    assert!(
        changes(&mut broker, ms(300)).await.is_empty(),
        "no second SUBSCRIBE"
    );
}

/// A new address map that drops a topic a read still wants leaves it
/// subscribed, and one that adds a read's topic subscribes to it as
/// usual. Its messages then reach the Edge Agent.
#[tokio::test]
async fn the_address_map_and_reads_share_subscriptions() {
    let mut broker = FakeBroker::start().await;
    let (mut agent, _driver) = up(broker.conf(), &[("1", "a"), ("2", "b")]).await;
    assert_eq!(changes(&mut broker, ms(300)).await, ["sub a,b"]);
    let mut data = Vec::new();
    read(&mut agent, "r1", &["b", "c"], &mut data).await;
    assert_eq!(changes(&mut broker, ms(300)).await, ["sub c"]);

    agent.send_addrs_features(&[("1", "a"), ("3", "c")], json!({ "scout": 1 }));
    // b is kept for the read, and c subscribed to again as mapped.
    assert_eq!(changes(&mut broker, ms(500)).await, ["sub c"]);
    broker.publish("c", "9");
    let got = agent.collect_data(1, secs(2)).await;
    assert_eq!(got[0].0, "3");
}

/// A topic no read has asked for in 60 s is unsubscribed, unless the
/// address map has it.
#[tokio::test]
async fn read_topics_go_a_minute_after_the_last_read() {
    let mut broker = FakeBroker::start().await;
    let (mut agent, _driver) = up(broker.conf(), &[("1", "m")]).await;
    changes(&mut broker, ms(300)).await;
    let mut data = Vec::new();
    read(&mut agent, "r1", &["m", "x", "y"], &mut data).await;
    assert_eq!(changes(&mut broker, ms(300)).await, ["sub x,y"]);
    tokio::time::sleep(secs(30)).await;
    read(&mut agent, "r2", &["y"], &mut data).await;
    // x goes about 60 s after r1, y about 60 s after r2, m never.
    let started = Instant::now();
    let seen = changes(&mut broker, secs(33)).await;
    assert_eq!(seen, ["unsub x"], "after {:?}", started.elapsed());
    let seen = changes(&mut broker, secs(30)).await;
    assert_eq!(seen, ["unsub y"]);
}

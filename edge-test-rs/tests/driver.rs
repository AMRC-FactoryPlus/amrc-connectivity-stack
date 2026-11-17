// ACS Rust test driver
// Run the whole driver against a fake Edge Agent
// Copyright 2026 University of Sheffield

//! The driver end to end over MQTT: READY, conf, addr, UP, poll and
//! data, and ADDR for an address it cannot read. The fake Edge Agent
//! and its broker are the ones `rs-edge-driver` tests itself with.

#[path = "../../lib/rs-edge-driver/tests/common/mod.rs"]
mod common;

use bytes::Bytes;
use common::{FakeAgent, secs, spawn_driver};
use edge_test_rs::{TestHandler, clock};

#[tokio::test]
async fn polls_return_wave_values() {
    clock::start();
    let mut agent = FakeAgent::start("Test").await;
    let _driver = spawn_driver::<TestHandler>(agent.config());

    agent
        .handshake(
            serde_json::json!({}),
            &[
                ("a", "const:1000:2.5:bd"),
                ("b", "const:1000:-1:lf"),
                ("c", "sin:1000:5:ld"),
                ("d", "saw:1000:10:bf"),
            ],
        )
        .await;
    agent.wait_status("UP", secs(5)).await;

    agent.send("poll", "a\nb\nc\nd");
    let mut data = agent.collect_data(4, secs(5)).await;
    data.sort();
    let topics: Vec<&str> = data.iter().map(|(t, _)| t.as_str()).collect();
    assert_eq!(topics, ["a", "b", "c", "d"]);

    assert_eq!(data[0].1, Bytes::from(2.5f64.to_be_bytes().to_vec()));
    assert_eq!(data[1].1, Bytes::from((-1.0f32).to_le_bytes().to_vec()));

    let sin = f64::from_le_bytes(data[2].1[..].try_into().unwrap());
    assert!((-5.0..=5.0).contains(&sin), "sin {sin}");
    let saw = f32::from_be_bytes(data[3].1[..].try_into().unwrap());
    assert!((0.0..10.0).contains(&saw), "saw {saw}");
}

#[tokio::test]
async fn bad_address_reports_addr() {
    let mut agent = FakeAgent::start("Test").await;
    let _driver = spawn_driver::<TestHandler>(agent.config());

    agent
        .handshake(serde_json::json!({}), &[("a", "cos:1000:1:bd")])
        .await;
    agent.wait_status("ADDR", secs(5)).await;

    agent.send_addrs(&[("a", "sin:1000:1:bd")]);
    agent.wait_status("UP", secs(5)).await;
}

/// The JS driver accepts any config, even one that is not an object.
#[tokio::test]
async fn any_config_is_accepted() {
    let mut agent = FakeAgent::start("Test").await;
    let _driver = spawn_driver::<TestHandler>(agent.config());

    agent
        .handshake(serde_json::json!(["any", 1]), &[("a", "const:1:1:bd")])
        .await;
    agent.wait_status("UP", secs(5)).await;
}

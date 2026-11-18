// ACS MQTT driver
// The driver against a real broker: mosquitto, plain and with passwords
// Copyright 2026 University of Sheffield

//! See `real/mod.rs` for what these tests need.

#[path = "../../lib/rs-edge-driver/tests/common/mod.rs"]
mod common;
mod real;

use std::process::Command;
use std::time::Duration;

use bytes::Bytes;
use common::{FakeAgent, secs, spawn_driver};
use edge_mqtt::MqttHandler;
use real::*;
use rumqttc::QoS;

#[tokio::test]
async fn messages_pass_through_mosquitto_in_order() {
    if !tools() {
        return;
    }
    let broker = mosquitto(temp_dir("plain"), "allow_anonymous true").await;
    let conf = serde_json::json!({
        "protocol": "mqtt", "host": "127.0.0.1", "port": broker.port,
        "clientId": "", "cleanSession": true, "keepAlive": 60,
    });
    let (mut agent, _driver) =
        driver_up(conf, &[("1", "plant/line1/data"), ("2", "plant/+/data")]).await;
    // Let the SUBSCRIBE reach the broker.
    tokio::time::sleep(Duration::from_millis(300)).await;

    let device = device(broker.port, None).await;
    const N: usize = 2000;
    for i in 0..N {
        device
            .publish("plant/line1/data", QoS::AtMostOnce, false, i.to_string())
            .await
            .unwrap();
    }
    // Matches the wildcard address only, so nothing reaches the agent.
    device
        .publish("plant/line2/data", QoS::AtMostOnce, false, "x")
        .await
        .unwrap();

    let data = agent.collect_data(N + 1, secs(10)).await;
    assert_eq!(data.len(), N, "wrong number of messages");
    assert!(data.iter().all(|(t, _)| t == "1"));
    let got: Vec<usize> = data
        .iter()
        .map(|(_, p)| std::str::from_utf8(p).unwrap().parse().unwrap())
        .collect();
    assert_eq!(got, (0..N).collect::<Vec<_>>());

    // A retained message is sent on subscribing, as to the built-in.
    device
        .publish("plant/retained", QoS::AtLeastOnce, true, "kept")
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(200)).await;
    agent.send_addrs(&[("1", "plant/line1/data"), ("3", "plant/retained")]);
    let data = agent.collect_data(1, secs(5)).await;
    assert_eq!(data, [("3".to_owned(), Bytes::from_static(b"kept"))]);
}

#[tokio::test]
async fn passwords_are_checked() {
    if !tools() {
        return;
    }
    let dir = temp_dir("auth");
    let passwd = dir.join("passwd");
    run(Command::new("mosquitto_passwd")
        .args(["-c", "-b"])
        .arg(&passwd)
        .args(["edge", "right"]));
    let broker = mosquitto(
        dir.clone(),
        &format!("allow_anonymous false\npassword_file {}", passwd.display()),
    )
    .await;
    let conf = |password: &str| {
        serde_json::json!({
            "protocol": "mqtt", "host": "127.0.0.1", "port": broker.port,
            "clientId": "edge-auth", "username": "edge", "password": password,
            "cleanSession": true, "keepAlive": 60,
        })
    };

    let mut agent = FakeAgent::start("MQTT").await;
    let _driver = spawn_driver::<MqttHandler>(agent.config());
    agent.handshake(conf("wrong"), &[("1", "a")]).await;
    agent.wait_status("AUTH", secs(5)).await;

    let (mut agent, _driver) = driver_up(conf("right"), &[("1", "a")]).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let device = device(broker.port, Some(("edge", "right"))).await;
    device
        .publish("a", QoS::AtMostOnce, false, "ok")
        .await
        .unwrap();
    let data = agent.collect_data(1, secs(5)).await;
    assert_eq!(data, [("1".to_owned(), Bytes::from_static(b"ok"))]);
}

// ACS MQTT driver
// The driver against mosquitto over TLS
// Copyright 2026 University of Sheffield

//! See `real/mod.rs` for what this test needs. It sets
//! `SSL_CERT_FILE`, which is global to the process, so it is the only
//! test in this file.

#[path = "../../lib/rs-edge-driver/tests/common/mod.rs"]
mod common;
mod real;

use std::time::Duration;

use bytes::Bytes;
use common::{FakeAgent, secs, spawn_driver};
use edge_mqtt::MqttHandler;
use real::*;
use rumqttc::{AsyncClient, MqttOptions, QoS};

/// A server whose certificate the driver trusts works over TLS. One it
/// doesn't trust is refused, as Node refuses it for the built-in.
#[tokio::test]
async fn tls_checks_the_server_certificate() {
    if !tools() {
        return;
    }
    // Two brokers, each with a certificate from its own CA. The driver
    // is told to trust the first CA only.
    let trusted = temp_dir("tls-trusted");
    let untrusted = temp_dir("tls-untrusted");
    certificates(&trusted);
    certificates(&untrusted);
    // SAFETY: this is the only test in its binary and nothing has
    // started yet that could read the environment while it changes.
    unsafe { std::env::set_var("SSL_CERT_FILE", trusted.join("ca.crt")) };

    let tls = |dir: &std::path::Path| {
        format!(
            "allow_anonymous true\ncafile {0}/ca.crt\ncertfile {0}/server.crt\nkeyfile {0}/server.key",
            dir.display()
        )
    };
    let good = mosquitto(trusted.clone(), &tls(&trusted)).await;
    let bad = mosquitto(untrusted.clone(), &tls(&untrusted)).await;
    let conf = |port: u16| {
        serde_json::json!({
            "protocol": "mqtts", "host": "127.0.0.1", "port": port,
            "clientId": "edge-tls", "cleanSession": true, "keepAlive": 60,
        })
    };

    let mut agent = FakeAgent::start("MQTT").await;
    let _driver = spawn_driver::<MqttHandler>(agent.config());
    agent.handshake(conf(bad.port), &[("1", "a")]).await;
    agent.wait_status("CONN", secs(5)).await;

    let (mut agent, _driver) = driver_up(conf(good.port), &[("1", "a")]).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    // The broker has one listener, so the device uses TLS too.
    let mut opts = MqttOptions::new("device", "127.0.0.1", good.port);
    opts.set_transport(rumqttc::Transport::Tls(rumqttc::TlsConfiguration::Simple {
        ca: std::fs::read(trusted.join("ca.crt")).unwrap(),
        alpn: None,
        client_auth: None,
    }));
    let (device, mut eventloop) = AsyncClient::new(opts, 10);
    tokio::spawn(async move { while eventloop.poll().await.is_ok() {} });
    device
        .publish("a", QoS::AtMostOnce, false, "secure")
        .await
        .unwrap();
    let data = agent.collect_data(1, secs(5)).await;
    assert_eq!(data, [("1".to_owned(), Bytes::from_static(b"secure"))]);
}

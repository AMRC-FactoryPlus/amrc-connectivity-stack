// ACS UDP driver
// Run the whole driver against a fake Edge Agent
// Copyright 2026 University of Sheffield

//! The driver end to end over MQTT and a real UDP socket: datagrams
//! reach the agent in order on the empty address's data topic, other
//! addresses get nothing, a bad port is `CONF`, a port in use is
//! `CONN` until it is free, and writes are refused. The fake Edge
//! Agent and its broker are the ones `rs-edge-driver` tests itself
//! with.

#[path = "../../lib/rs-edge-driver/tests/common/mod.rs"]
mod common;

use std::net::UdpSocket;
use std::time::Duration;

use bytes::Bytes;
use common::{FakeAgent, FromDriver, ms, secs, spawn_driver};
use edge_udp::UdpHandler;

/// A UDP port nothing is bound to, as far as anyone can tell.
fn free_port() -> u16 {
    UdpSocket::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

fn sender() -> UdpSocket {
    UdpSocket::bind("127.0.0.1:0").unwrap()
}

/// Start the driver on `port` with these addresses and wait for UP.
async fn up(port: u16, addrs: &[(&str, &str)]) -> (FakeAgent, common::RunningDriver) {
    let mut agent = FakeAgent::start("UDP").await;
    let driver = spawn_driver::<UdpHandler>(agent.config());
    agent
        .handshake(serde_json::json!({ "port": port }), addrs)
        .await;
    agent.wait_status("UP", secs(5)).await;
    // subscribe runs after UP, on the handler's own task.
    tokio::time::sleep(ms(200)).await;
    (agent, driver)
}

#[tokio::test]
async fn datagrams_arrive_in_order_as_sent() {
    let port = free_port();
    let (mut agent, _driver) = up(port, &[("5", "")]).await;

    let tx = sender();
    let n = 3000u32;
    for i in 0..n {
        tx.send_to(format!("{{\"seq\":{i}}}").as_bytes(), ("127.0.0.1", port))
            .unwrap();
        // Stay well inside the socket buffer of the machine running
        // the test.
        if i % 200 == 199 {
            tokio::time::sleep(ms(5)).await;
        }
    }

    let data = agent.collect_data(n as usize, secs(10)).await;
    assert_eq!(data.len(), n as usize);
    assert!(data.iter().all(|(t, _)| t == "5"));
    for (i, (_, payload)) in data.iter().enumerate() {
        assert_eq!(payload, &Bytes::from(format!("{{\"seq\":{i}}}")));
    }
}

/// Binary payloads pass through byte for byte, including empty ones.
#[tokio::test]
async fn bytes_pass_through_unchanged() {
    let port = free_port();
    let (mut agent, _driver) = up(port, &[("5", "")]).await;

    let tx = sender();
    let payloads: Vec<Vec<u8>> = vec![
        vec![],
        vec![0, 255, 0x80, 0x7f, b'\n', 0],
        (0..=255u8).cycle().take(60_000).collect(),
    ];
    for p in &payloads {
        tx.send_to(p, ("127.0.0.1", port)).unwrap();
    }
    let data = agent.collect_data(payloads.len(), secs(5)).await;
    let got: Vec<Vec<u8>> = data.into_iter().map(|(_, p)| p.to_vec()).collect();
    assert_eq!(got, payloads);
}

/// Only the empty address gets datagrams, as with the built-in
/// connection.
#[tokio::test]
async fn only_the_empty_address_gets_data() {
    let port = free_port();
    let (mut agent, _driver) = up(port, &[("1", "50205"), ("2", "")]).await;

    sender().send_to(b"hello", ("127.0.0.1", port)).unwrap();
    let events = agent.drain(ms(500)).await;
    let data: Vec<_> = events
        .iter()
        .filter_map(|e| match e {
            FromDriver::Data { topic, payload } => Some((topic.as_str(), payload.clone())),
            _ => None,
        })
        .collect();
    assert_eq!(data, [("2", Bytes::from("hello"))]);
}

/// With no empty address, datagrams go nowhere, and a new address map
/// with one starts them flowing.
#[tokio::test]
async fn no_empty_address_means_no_data_until_one_arrives() {
    let port = free_port();
    let (mut agent, _driver) = up(port, &[("1", "50205")]).await;

    let tx = sender();
    tx.send_to(b"lost", ("127.0.0.1", port)).unwrap();
    assert!(agent.collect_data(1, ms(500)).await.is_empty());

    agent.send_addrs(&[("1", "50205"), ("9", "")]);
    tokio::time::sleep(ms(300)).await;
    tx.send_to(b"found", ("127.0.0.1", port)).unwrap();
    assert_eq!(
        agent.collect_data(1, secs(5)).await,
        [("9".to_owned(), Bytes::from("found"))]
    );
}

#[tokio::test]
async fn bad_port_is_conf() {
    let mut agent = FakeAgent::start("UDP").await;
    let _driver = spawn_driver::<UdpHandler>(agent.config());
    agent.wait_status("READY", secs(5)).await;
    agent.send("conf", r#"{"port": 70000}"#);
    agent.wait_status("CONF", secs(5)).await;
    agent.send("conf", r#"{}"#);
    agent.wait_status("CONF", secs(5)).await;
}

/// A port something else holds is `CONN`, retried until it is free.
/// The built-in connection logged the error and stayed silent.
#[tokio::test]
async fn port_in_use_is_conn_until_free() {
    let holder = UdpSocket::bind("0.0.0.0:0").unwrap();
    let port = holder.local_addr().unwrap().port();

    let mut agent = FakeAgent::start("UDP").await;
    let _driver = spawn_driver::<UdpHandler>(agent.config());
    agent
        .handshake(serde_json::json!({ "port": port }), &[("5", "")])
        .await;
    agent.wait_status("CONN", secs(5)).await;

    drop(holder);
    // The fake agent's config retries quickly.
    agent.wait_status("UP", secs(10)).await;
    tokio::time::sleep(ms(200)).await;
    sender().send_to(b"after", ("127.0.0.1", port)).unwrap();
    assert_eq!(
        agent.collect_data(1, secs(5)).await,
        [("5".to_owned(), Bytes::from("after"))]
    );
}

/// The driver takes the typed form of a write and refuses it, so the
/// agent doesn't report a value that was never sent.
#[tokio::test]
async fn writes_are_refused() {
    let port = free_port();
    let (mut agent, _driver) = up(port, &[("5", ""), ("6", "x")]).await;

    agent.send("write/x", r#"{"type":"Int32","value":1,"id":"w_1"}"#);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        let left = deadline.saturating_duration_since(tokio::time::Instant::now());
        match agent.next(left).await {
            Some(FromDriver::Other { topic, payload }) if topic.ends_with("/result/w_1") => {
                let answer = String::from_utf8_lossy(&payload);
                assert!(!answer.is_empty(), "the write was reported done");
                assert!(answer.contains("only receives"), "{answer}");
                break;
            }
            Some(_) => {}
            None => panic!("no answer to the write"),
        }
    }
}

// ACS FOCAS driver
// Run the whole driver against a fake Edge Agent and the fake control
// Copyright 2026 University of Sheffield

//! The driver end to end: READY, conf, addr, UP, poll and JSON data,
//! ADDR for an address it cannot parse, CONF for bad connection
//! details, and CONN when the control is not there.

#[path = "../../lib/rs-edge-driver/tests/common/mod.rs"]
mod common;

#[path = "support/fake_cnc.rs"]
mod fake_cnc;

use common::{FakeAgent, secs, spawn_driver};
use edge_focas::FocasHandler;
use serde_json::{Value, json};
use tokio::net::TcpListener;

async fn sim() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(fake_cnc::serve(listener));
    port
}

#[tokio::test]
async fn polls_return_json() {
    let port = sim().await;
    let mut agent = FakeAgent::start("Focas").await;
    let _driver = spawn_driver::<FocasHandler>(agent.config());

    agent
        .handshake(
            json!({ "host": "127.0.0.1", "port": port }),
            &[
                ("1", "sysinfo"),
                ("2", "macro:100"),
                ("3", "position"),
                ("4", "pmc:D10:word"),
            ],
        )
        .await;
    agent.wait_status("UP", secs(5)).await;

    agent.send("poll", "1\n2\n3\n4");
    let mut data = agent.collect_data(4, secs(5)).await;
    data.sort();
    let json: Vec<Value> = data
        .iter()
        .map(|(_, b)| serde_json::from_slice(b).unwrap())
        .collect();
    assert_eq!(json[0]["series"], "G4A1");
    assert_eq!(json[1], json!({ "value": 12.345 }));
    assert_eq!(json[2]["absolute"].as_array().unwrap().len(), 3);
    assert_eq!(json[3], json!({ "value": 1234 }));
}

#[tokio::test]
async fn bad_address_reports_addr() {
    let port = sim().await;
    let mut agent = FakeAgent::start("Focas").await;
    let _driver = spawn_driver::<FocasHandler>(agent.config());

    agent
        .handshake(
            json!({ "host": "127.0.0.1", "port": port }),
            &[("1", "axis:1")],
        )
        .await;
    agent.wait_status("ADDR", secs(5)).await;

    agent.send_addrs(&[("1", "status")]);
    agent.wait_status("UP", secs(5)).await;
}

#[tokio::test]
async fn missing_host_reports_conf() {
    let mut agent = FakeAgent::start("Focas").await;
    let _driver = spawn_driver::<FocasHandler>(agent.config());

    agent
        .handshake(json!({ "port": 8193 }), &[("1", "status")])
        .await;
    agent.wait_status("CONF", secs(5)).await;
}

#[tokio::test]
async fn no_control_reports_conn_then_recovers() {
    // Find a free port, and start the fake control on it only after
    // the driver has failed to connect once.
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);

    let mut agent = FakeAgent::start("Focas").await;
    let _driver = spawn_driver::<FocasHandler>(agent.config());
    agent
        .handshake(
            json!({ "host": "127.0.0.1", "port": port, "timeout": 500 }),
            &[("1", "status")],
        )
        .await;
    agent.wait_status("CONN", secs(5)).await;

    let listener = TcpListener::bind(("127.0.0.1", port)).await.unwrap();
    tokio::spawn(fake_cnc::serve(listener));
    agent.wait_status("UP", secs(10)).await;
}

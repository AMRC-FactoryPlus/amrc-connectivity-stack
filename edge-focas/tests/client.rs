// ACS FOCAS driver
// The client against the fake control, over TCP
// Copyright 2026 University of Sheffield

//! Every address read through a real TCP connection to the fake
//! control. The values change with time, so each check allows for the
//! whole range the machine can be in.

#[path = "support/fake_cnc.rs"]
mod fake_cnc;

use std::time::Duration;

use edge_focas::Addr;
use edge_focas::client::{Client, ReadError};
use serde_json::json;
use tokio::net::TcpListener;

async fn sim() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(fake_cnc::serve(listener));
    port
}

async fn client() -> Client {
    let port = sim().await;
    Client::connect("127.0.0.1", port, Duration::from_secs(2))
        .await
        .unwrap()
}

async fn read(c: &mut Client, addr: &str) -> serde_json::Value {
    c.read(&Addr::parse(addr).unwrap()).await.unwrap()
}

#[tokio::test]
async fn reads_every_address() {
    let mut c = client().await;

    assert_eq!(
        read(&mut c, "sysinfo").await,
        json!({ "cnc_type": "31", "mt_type": "M", "series": "G4A1",
                "version": "14.0", "axes": 3, "max_axes": 8 })
    );

    // The fake machine starts cutting.
    let status = read(&mut c, "status").await;
    assert_eq!(status["run"], 3);
    assert_eq!(status["alarm"], 0);
    assert_eq!(
        read(&mut c, "alarm").await,
        json!({ "active": false, "bits": 0 })
    );
    assert_eq!(
        read(&mut c, "program").await,
        json!({ "running": 1234, "main": 1234 })
    );

    let speeds = read(&mut c, "speeds").await;
    assert_eq!(speeds["feed"], 500.0);
    assert!(speeds["spindle"].as_f64().unwrap() <= 1200.0);

    let pos = read(&mut c, "position").await;
    for k in ["absolute", "relative", "machine", "distance"] {
        assert_eq!(pos[k].as_array().unwrap().len(), 3, "{k}");
    }
    let x = pos["absolute"][0].as_f64().unwrap();
    let mx = pos["machine"][0].as_f64().unwrap();
    assert!((mx - (x - 250.0)).abs() < 0.002, "{x} {mx}");

    assert_eq!(read(&mut c, "macro:100").await, json!({ "value": 12.345 }));
    assert_eq!(read(&mut c, "macro:101").await, json!({ "value": null }));
    assert_eq!(read(&mut c, "macro:3901").await, json!({ "value": 0.0 }));

    assert_eq!(
        read(&mut c, "param:1320").await,
        json!({ "values": [500000, 400000, 300000] })
    );
    assert_eq!(
        read(&mut c, "param:1020:2").await,
        json!({ "values": [89] })
    );
    assert_eq!(read(&mut c, "param:6711").await, json!({ "values": [0] }));

    assert_eq!(read(&mut c, "pmc:D10:word").await, json!({ "value": 1234 }));
    assert_eq!(read(&mut c, "pmc:D10").await, json!({ "value": 4 }));
    assert_eq!(read(&mut c, "pmc:R0:long").await, json!({ "value": 0 }));
    assert_eq!(read(&mut c, "pmc:G0").await, json!({ "value": 0 }));

    c.close().await;
}

#[tokio::test]
async fn refused_reads_keep_the_connection() {
    let mut c = client().await;
    match c.read(&Addr::Macro(5000)).await {
        Err(ReadError::Cnc(3)) => {}
        other => panic!("{other:?}"),
    }
    match c.read(&Addr::parse("pmc:R9999:word").unwrap()).await {
        Err(ReadError::Cnc(3)) => {}
        other => panic!("{other:?}"),
    }
    // The session still works.
    assert_eq!(read(&mut c, "macro:100").await, json!({ "value": 12.345 }));
}

#[tokio::test]
async fn nothing_listening_fails_to_connect() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    assert!(matches!(
        Client::connect("127.0.0.1", port, Duration::from_secs(1)).await,
        Err(ReadError::Link(_))
    ));
}

#[tokio::test]
async fn silent_peer_times_out() {
    // Accepts the TCP connection and never answers.
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        let _held = listener.accept().await;
        tokio::time::sleep(Duration::from_secs(30)).await;
    });
    let start = std::time::Instant::now();
    assert!(matches!(
        Client::connect("127.0.0.1", port, Duration::from_millis(300)).await,
        Err(ReadError::Link(_))
    ));
    assert!(start.elapsed() < Duration::from_secs(2));
}

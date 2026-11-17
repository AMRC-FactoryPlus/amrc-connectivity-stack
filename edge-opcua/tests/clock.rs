// ACS OPC UA driver
// A server whose clock is out
// Copyright 2026 University of Sheffield

//! A server clock an hour fast, as on a PLC set to local summer time.
//! The client times its secure channel token renewal on its own clock
//! (`ignore_clock_skew`), so the channel is renewed in time and doesn't
//! drop, and DateTime values still arrive as the server sent them.
//!
//! This is its own test binary because it shortens the token lifetime
//! for the whole process, so that a renewal happens within the test.
//! Like `opcua.rs` it needs `EDGE_OPCUA_SERVER_TESTS`.

mod support;

use serde_json::json;
use support::*;

use edge_opcua::OpcuaHandler;

#[tokio::test(flavor = "multi_thread")]
async fn a_server_clock_an_hour_fast_keeps_its_channel_and_dates() {
    if !enabled() {
        return;
    }
    // SAFETY: set before any client is made, and nothing else in this
    // test binary reads the environment at the same time.
    unsafe { std::env::set_var("EDGE_OPCUA_CHANNEL_LIFETIME_MS", "4000") };

    let server = Server::start_with(&[("SKEW_MS", "3600000")]).await;
    let nodes = [node("Counter"), node("DateTime")];
    let mut agent = FakeAgent::start("OPCUA").await;
    let _driver = spawn_driver::<OpcuaHandler>(agent.config());
    agent.wait_status("READY", secs(5)).await;
    let c = conf(
        &server,
        "SignAndEncrypt",
        "Basic256Sha256",
        Some(("test", "testpass")),
    );
    agent.send("conf", c.to_string());
    agent.send("addr", addr_packet(&nodes));
    agent.wait_status("UP", secs(30)).await;

    let v = values(&mut agent, &["t0", "t1"], secs(10)).await;
    // As the server holds it, not moved by the clock offset.
    assert_eq!(v["t1"], json!(1763380800123i64));

    // Several token lifetimes: the channel is renewed each time, so the
    // status never leaves UP and values keep coming.
    let deadline = tokio::time::Instant::now() + secs(15);
    let mut seen = 0;
    while tokio::time::Instant::now() < deadline {
        match agent.next(secs(2)).await {
            Some(FromDriver::Status(s)) => panic!("status changed to {s}"),
            Some(FromDriver::Data { .. }) => seen += 1,
            Some(_) => {}
            None => panic!("no data for 2 s"),
        }
    }
    assert!(seen > 50, "only {seen} values in 15 s");
}

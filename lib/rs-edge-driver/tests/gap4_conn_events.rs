//! Gap 4: a handler had no way to report losing its device after
//! `UP`. `DriverHandle::disconnected` now moves the status to CONN or
//! AUTH, and `DriverHandle::error` to ERR, and both start a reconnect.

mod common;

use bytes::Bytes;
use common::handler::{Ctl, FakeHandler};
use common::{FakeAgent, FromDriver, ms, secs, spawn_driver};
use rs_edge_driver::ConnectError;

async fn lost_after_up(report: impl Fn(&rs_edge_driver::DriverHandle<String>), status: &str) {
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<FakeHandler>(agent.config());
    let ctl = Ctl::new();

    agent.handshake(ctl.conf(), &[("1", "a")]).await;
    agent.wait_status("UP", secs(5)).await;
    assert_eq!(Ctl::count(&ctl.connects), 1);

    report(&ctl.handle());
    agent.wait_status(status, secs(2)).await;

    // The spec forbids data while the status isn't UP.
    ctl.handle().publish("a".into(), Bytes::from("stale"));

    let seen = agent.wait_status("UP", secs(5)).await;
    assert!(
        !seen.iter().any(|e| matches!(e, FromDriver::Data { .. })),
        "data published while not UP: {seen:?}"
    );
    assert_eq!(Ctl::count(&ctl.connects), 2, "connect was not called again");
}

#[tokio::test]
async fn connection_lost_after_up() {
    lost_after_up(|h| h.disconnected(ConnectError::ConnectionFailed), "CONN").await;
}

#[tokio::test]
async fn auth_failed_after_up() {
    lost_after_up(|h| h.disconnected(ConnectError::AuthFailed), "AUTH").await;
}

#[tokio::test]
async fn other_error_after_up() {
    lost_after_up(|h| h.error(), "ERR").await;
}

/// Reports from a handler that has since been replaced are ignored.
#[tokio::test]
async fn stale_handle_is_ignored() {
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<FakeHandler>(agent.config());
    let first = Ctl::new();

    agent.handshake(first.conf(), &[("1", "a")]).await;
    agent.wait_status("UP", secs(5)).await;
    let old = first.handle();

    let second = Ctl::new();
    agent.send("conf", second.conf().to_string());
    agent.send_addrs(&[("1", "a")]);
    agent.wait_status("UP", secs(5)).await;

    old.disconnected(ConnectError::ConnectionFailed);
    let events = agent.drain(ms(800)).await;
    assert!(
        !events.iter().any(|e| matches!(e, FromDriver::Status(_))),
        "a stale handle changed the status: {events:?}"
    );
}

/// Several reports in a row start one reconnect, not several.
#[tokio::test]
async fn repeated_reports_reconnect_once() {
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<FakeHandler>(agent.config());
    let ctl = Ctl::new();

    agent.handshake(ctl.conf(), &[("1", "a")]).await;
    agent.wait_status("UP", secs(5)).await;

    for _ in 0..5 {
        ctl.handle().disconnected(ConnectError::ConnectionFailed);
    }
    agent.wait_status("UP", secs(5)).await;
    tokio::time::sleep(ms(600)).await;
    assert_eq!(Ctl::count(&ctl.connects), 2);
}

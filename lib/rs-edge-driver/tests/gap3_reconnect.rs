//! Gap 3: southbound connect and retry ran inside the MQTT loop, so
//! while a device was down no pings went out and the broker dropped
//! the driver. `cmd` and `subscribe` blocked the loop the same way.

mod common;

use std::sync::atomic::Ordering;
use std::time::Duration;

use bytes::Bytes;
use common::handler::{Ctl, FakeHandler};
use common::{FakeAgent, ms, secs, spawn_driver};
use rs_edge_driver::ConnectError;

/// Hold the device down for `down`, check pings kept flowing and the
/// broker never dropped the driver, then bring it back.
async fn device_down_for(keep_alive: Duration, reconnect_delay: Duration, down: Duration) {
    let mut agent = FakeAgent::start("Conn").await;
    let mut config = agent.config();
    config.keep_alive = keep_alive;
    config.reconnect_delay = reconnect_delay;
    let _driver = spawn_driver::<FakeHandler>(config);
    let ctl = Ctl::new();
    *ctl.connect_error.lock().unwrap() = Some(ConnectError::ConnectionFailed);

    agent.handshake(ctl.conf(), &[("1", "a")]).await;
    agent.wait_status("CONN", secs(5)).await;

    tokio::time::sleep(down).await;
    let expected = (down.as_secs_f64() / keep_alive.as_secs_f64()) as usize;
    assert_eq!(agent.stats.expired(), 0, "the broker dropped the driver");
    assert_eq!(agent.stats.connects(), 1, "the driver reconnected to MQTT");
    assert!(
        agent.stats.pings() + 1 >= expected,
        "{} pings in {down:?} with a {keep_alive:?} keep-alive",
        agent.stats.pings()
    );
    assert!(Ctl::count(&ctl.connects) > 1, "connect was not retried");

    *ctl.connect_error.lock().unwrap() = None;
    agent.wait_status("UP", reconnect_delay * 2 + secs(2)).await;
    agent.send("poll", "1");
    assert_eq!(
        agent.collect_data(1, secs(5)).await,
        vec![("1".to_owned(), Bytes::from("a"))]
    );
}

#[tokio::test]
async fn pings_flow_while_device_is_down() {
    device_down_for(secs(1), ms(300), secs(8)).await;
}

/// The case from the audit at real settings: a 30 s keep-alive and a
/// device down for two minutes. Slow, so run it with `--ignored`.
#[tokio::test]
#[ignore]
async fn pings_flow_while_device_is_down_for_two_minutes() {
    device_down_for(secs(30), secs(5), secs(120)).await;
}

/// A `connect` that hangs must not stop pings either, and an `addr`
/// map sent meanwhile must still be applied in order.
#[tokio::test]
async fn slow_connect_does_not_block_mqtt() {
    let mut agent = FakeAgent::start("Conn").await;
    let mut config = agent.config();
    config.keep_alive = secs(1);
    let _driver = spawn_driver::<FakeHandler>(config);
    let ctl = Ctl::new();
    *ctl.connect_delay.lock().unwrap() = secs(5);

    agent.handshake(ctl.conf(), &[("1", "a")]).await;
    agent.send_addrs(&[("2", "b")]);
    agent.wait_status("UP", secs(10)).await;
    assert_eq!(agent.stats.expired(), 0, "the broker dropped the driver");
    assert_eq!(agent.stats.connects(), 1);
    assert!(agent.stats.pings() >= 3, "{} pings", agent.stats.pings());

    agent.send("poll", "2");
    assert_eq!(
        agent.collect_data(1, secs(5)).await,
        vec![("2".to_owned(), Bytes::from("b"))]
    );
}

/// A slow `cmd` must not stop pings.
#[tokio::test]
async fn slow_cmd_does_not_block_mqtt() {
    let mut agent = FakeAgent::start("Conn").await;
    let mut config = agent.config();
    config.keep_alive = secs(1);
    let _driver = spawn_driver::<FakeHandler>(config);
    let ctl = Ctl::new();
    *ctl.cmd_delay.lock().unwrap() = secs(4);

    agent.handshake(ctl.conf(), &[("1", "a")]).await;
    agent.wait_status("UP", secs(5)).await;
    let pings = agent.stats.pings();

    agent.send("cmd/a", "1");
    tokio::time::sleep(secs(5)).await;
    assert_eq!(agent.stats.expired(), 0, "the broker dropped the driver");
    assert!(agent.stats.pings() >= pings + 3, "pings stopped during cmd");
    assert_eq!(ctl.cmds.lock().unwrap().len(), 1);
    assert_eq!(ctl.closes.load(Ordering::SeqCst), 0);
}

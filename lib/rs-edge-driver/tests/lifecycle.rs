//! The basic protocol: READY, conf, addr, UP, poll, data, cmd and
//! reconfiguration. These pass on the old code too; they guard the
//! behaviour the gap fixes must keep.

mod common;

use std::sync::atomic::Ordering;

use bytes::Bytes;
use common::handler::{Ctl, FakeHandler};
use common::{FakeAgent, FromDriver, ms, secs, spawn_driver};

#[tokio::test]
async fn polled_round_trip() {
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<FakeHandler>(agent.config());
    let ctl = Ctl::new();

    agent
        .handshake(ctl.conf(), &[("1", "addr-one"), ("2", "addr-two")])
        .await;
    agent.wait_status("UP", secs(5)).await;

    agent.send("poll", "1\n2");
    let mut data = agent.collect_data(2, secs(5)).await;
    data.sort();
    assert_eq!(
        data,
        vec![
            ("1".to_owned(), Bytes::from("addr-one")),
            ("2".to_owned(), Bytes::from("addr-two")),
        ]
    );
}

#[tokio::test]
async fn cmd_reaches_handler() {
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<FakeHandler>(agent.config());
    let ctl = Ctl::new();

    agent.handshake(ctl.conf(), &[("1", "a")]).await;
    agent.wait_status("UP", secs(5)).await;

    agent.send("cmd/a", "42");
    agent.send("cmd/a", "43");
    tokio::time::sleep(ms(500)).await;
    let cmds = ctl.cmds.lock().unwrap().clone();
    assert_eq!(
        cmds,
        vec![
            ("a".to_owned(), Bytes::from("42")),
            ("a".to_owned(), Bytes::from("43")),
        ]
    );
}

#[tokio::test]
async fn async_publish_uses_assigned_topic() {
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<FakeHandler>(agent.config());
    let ctl = Ctl::new();

    agent.handshake(ctl.conf(), &[("17", "temp")]).await;
    agent.wait_status("UP", secs(5)).await;
    tokio::time::sleep(ms(200)).await;
    assert_eq!(
        *ctl.subscribed.lock().unwrap(),
        vec![vec!["temp".to_owned()]]
    );

    ctl.handle().publish("temp".into(), Bytes::from("21.5"));
    ctl.handle()
        .publish("unknown".into(), Bytes::from("dropped"));
    let data = agent.collect_data(2, secs(1)).await;
    assert_eq!(data, vec![("17".to_owned(), Bytes::from("21.5"))]);
}

#[tokio::test]
async fn bad_conf_and_bad_addr() {
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<FakeHandler>(agent.config());

    agent.wait_status("READY", secs(5)).await;
    agent.send("conf", "{\"no\":\"key\"}");
    agent.wait_status("CONF", secs(5)).await;

    let ctl = Ctl::new();
    agent.send("conf", ctl.conf().to_string());
    agent.wait_status("UP", secs(5)).await;
    agent.send_addrs(&[("1", "bad")]);
    agent.wait_status("ADDR", secs(5)).await;
}

#[tokio::test]
async fn reconfigure_closes_old_handler() {
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<FakeHandler>(agent.config());
    let first = Ctl::new();

    agent.handshake(first.conf(), &[("1", "a")]).await;
    agent.wait_status("UP", secs(5)).await;

    let second = Ctl::new();
    agent.send("conf", second.conf().to_string());
    agent.send_addrs(&[("2", "b")]);
    agent.wait_status("UP", secs(5)).await;
    tokio::time::sleep(ms(200)).await;
    assert_eq!(first.closes.load(Ordering::SeqCst), 1);
    assert_eq!(second.creates.load(Ordering::SeqCst), 1);

    agent.send("poll", "2");
    let data = agent.collect_data(1, secs(5)).await;
    assert_eq!(data, vec![("2".to_owned(), Bytes::from("b"))]);
    assert_eq!(agent.stats.connects(), 1);
    assert!(
        !agent
            .drain(ms(100))
            .await
            .iter()
            .any(|e| matches!(e, FromDriver::Disconnected))
    );
}

/// READY goes out once per MQTT session, after the SUBACK. The agent
/// sends conf on every READY, so a second one recreates the handler.
#[tokio::test]
async fn ready_is_published_once() {
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<FakeHandler>(agent.config());
    let ctl = Ctl::new();

    agent.handshake(ctl.conf(), &[("1", "a")]).await;
    let seen = agent.wait_status("UP", secs(5)).await;
    let later = agent.drain(ms(500)).await;
    let readies = seen
        .iter()
        .chain(&later)
        .filter(|e| matches!(e, FromDriver::Status(s) if s == "READY"))
        .count();
    assert_eq!(readies, 0, "READY again after conf: {seen:?} {later:?}");
    assert_eq!(ctl.creates.load(Ordering::SeqCst), 1);
}

/// A good address map after a bad one puts the status back to UP.
#[tokio::test]
async fn good_addrs_after_bad_restore_up() {
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<FakeHandler>(agent.config());
    let ctl = Ctl::new();

    agent.handshake(ctl.conf(), &[("1", "a")]).await;
    agent.wait_status("UP", secs(5)).await;
    agent.send_addrs(&[("1", "bad")]);
    agent.wait_status("ADDR", secs(5)).await;
    agent.send_addrs(&[("2", "b")]);
    agent.wait_status("UP", secs(5)).await;

    agent.send("poll", "2");
    assert_eq!(
        agent.collect_data(1, secs(5)).await,
        vec![("2".to_owned(), Bytes::from("b"))]
    );
}

/// The cmd address is everything after `cmd/`, slashes included
/// (`acs-edge/docs/edge-split.md`, "fpEdge1/Conn/cmd/Address").
#[tokio::test]
async fn cmd_address_keeps_its_slashes() {
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<FakeHandler>(agent.config());
    let ctl = Ctl::new();

    agent
        .handshake(ctl.conf(), &[("1", "plant/line1/speed")])
        .await;
    agent.wait_status("UP", secs(5)).await;

    agent.send("cmd/plant/line1/speed", "7");
    tokio::time::sleep(ms(500)).await;
    assert_eq!(
        *ctl.cmds.lock().unwrap(),
        vec![("plant/line1/speed".to_owned(), Bytes::from("7"))]
    );
}

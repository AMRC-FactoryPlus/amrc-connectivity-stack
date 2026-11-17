//! `DriverHandle::try_publish`: data is delivered in order, and once
//! more than `DriverOptions::publish_queue_bytes` is waiting the
//! driver refuses more until the queue has drained.

mod common;

use bytes::Bytes;
use common::handler::{Ctl, FakeHandler};
use common::{FakeAgent, ms, secs, spawn_driver, spawn_driver_with};
use rs_edge_driver::{DriverOptions, PUBLISH_QUEUE_OVERHEAD};

/// The data topics' payloads as sequence numbers.
fn seqs(data: &[(String, Bytes)]) -> Vec<u32> {
    data.iter()
        .map(|(_, p)| std::str::from_utf8(p).unwrap().parse().unwrap())
        .collect()
}

#[tokio::test]
async fn try_publish_delivers_in_order() {
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<FakeHandler>(agent.config());
    let ctl = Ctl::new();

    agent.handshake(ctl.conf(), &[("7", "push")]).await;
    agent.wait_status("UP", secs(5)).await;
    tokio::time::sleep(ms(200)).await;

    let handle = ctl.handle();
    for i in 0..5000u32 {
        assert!(handle.try_publish("push".into(), Bytes::from(i.to_string())));
    }
    let data = agent.collect_data(5000, secs(10)).await;
    assert_eq!(data.len(), 5000);
    assert!(data.iter().all(|(t, _)| t == "7"));
    assert_eq!(seqs(&data), (0..5000).collect::<Vec<_>>());
}

#[tokio::test]
async fn try_publish_refuses_over_the_limit_then_recovers() {
    let mut agent = FakeAgent::start("Conn").await;
    let mut options = DriverOptions::default();
    // Room for four short messages.
    options.publish_queue_bytes = 4 * (PUBLISH_QUEUE_OVERHEAD + 8);
    let _driver = spawn_driver_with::<FakeHandler>(agent.config(), options);
    let ctl = Ctl::new();

    agent.handshake(ctl.conf(), &[("7", "push")]).await;
    agent.wait_status("UP", secs(5)).await;
    tokio::time::sleep(ms(200)).await;

    // Far faster than the driver can send, so the queue fills.
    let handle = ctl.handle();
    let accepted: Vec<u32> = (0..10_000u32)
        .filter(|i| handle.try_publish("push".into(), Bytes::from(i.to_string())))
        .collect();
    assert!(!accepted.is_empty());
    assert!(accepted.len() < 10_000, "nothing was refused");

    // What was accepted arrives, in order, and nothing else does.
    let mut data = agent.collect_data(accepted.len(), secs(10)).await;
    data.extend(agent.collect_data(1, ms(300)).await);
    assert_eq!(seqs(&data), accepted);

    // The queue has drained, so it takes data again.
    assert!(handle.try_publish("push".into(), Bytes::from("10000")));
    let data = agent.collect_data(1, secs(5)).await;
    assert_eq!(seqs(&data), [10_000]);
}

/// Data dropped by the driver (for an unknown address) gives its room
/// back, as sent data does.
#[tokio::test]
async fn dropped_data_frees_its_room() {
    let mut agent = FakeAgent::start("Conn").await;
    let mut options = DriverOptions::default();
    options.publish_queue_bytes = PUBLISH_QUEUE_OVERHEAD + 8;
    let _driver = spawn_driver_with::<FakeHandler>(agent.config(), options);
    let ctl = Ctl::new();

    agent.handshake(ctl.conf(), &[("7", "push")]).await;
    agent.wait_status("UP", secs(5)).await;
    tokio::time::sleep(ms(200)).await;

    let handle = ctl.handle();
    for _ in 0..100 {
        while !handle.try_publish("unknown".into(), Bytes::from("x")) {
            tokio::time::sleep(ms(1)).await;
        }
    }
    tokio::time::sleep(ms(100)).await;
    assert!(handle.try_publish("push".into(), Bytes::from("1")));
    assert_eq!(seqs(&agent.collect_data(1, secs(5)).await), [1]);
}

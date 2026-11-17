//! `DriverHandle::publish_wait`: data pushed by a device reaches the
//! edge agent in order, and a handler that sends faster than the agent
//! reads is made to wait instead of queueing without limit.

mod common;

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use bytes::Bytes;
use common::handler::{Ctl, FakeHandler};
use common::{FakeAgent, FromDriver, ms, secs, spawn_driver};

#[tokio::test]
async fn messages_arrive_in_order() {
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<FakeHandler>(agent.config());
    let ctl = Ctl::new();

    agent.handshake(ctl.conf(), &[("1", "a")]).await;
    agent.wait_status("UP", secs(5)).await;

    let handle = ctl.handle();
    tokio::spawn(async move {
        for i in 0..5000u32 {
            handle
                .publish_wait("a".into(), Bytes::from(i.to_string()))
                .await;
        }
    });

    let data = agent.collect_data(5000, secs(10)).await;
    let got: Vec<u32> = data
        .iter()
        .map(|(_, p)| std::str::from_utf8(p).unwrap().parse().unwrap())
        .collect();
    assert_eq!(got, (0..5000).collect::<Vec<_>>());
}

/// Data the driver drops, here because the status isn't UP yet, frees
/// its place at once, so it can never fill the queue.
#[tokio::test]
async fn dropped_data_does_not_fill_the_queue() {
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<FakeHandler>(agent.config());
    let ctl = Ctl::new();
    *ctl.connect_delay.lock().unwrap() = secs(30);

    agent.handshake(ctl.conf(), &[("1", "a")]).await;
    while Ctl::count(&ctl.creates) == 0 {
        tokio::time::sleep(ms(10)).await;
    }

    let handle = ctl.handle();
    let sent = tokio::time::timeout(secs(5), async {
        for _ in 0..5000 {
            handle.publish_wait("a".into(), Bytes::from("x")).await;
        }
    })
    .await;
    assert!(sent.is_ok(), "publish_wait blocked on dropped data");
}

#[tokio::test]
async fn waits_while_the_agent_is_not_reading() {
    const TOTAL: usize = 20_000;
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<FakeHandler>(agent.config());
    let ctl = Ctl::new();

    agent.handshake(ctl.conf(), &[("1", "a")]).await;
    agent.wait_status("UP", secs(5)).await;

    agent.stats.stalled.store(true, Ordering::SeqCst);
    let done = Arc::new(AtomicUsize::new(0));
    let handle = ctl.handle();
    let count = done.clone();
    tokio::spawn(async move {
        // 1 KiB each, 20 MB in all: far more than the socket buffers
        // and the queue hold between them.
        let payload = Bytes::from(vec![b'x'; 1024]);
        for _ in 0..TOTAL {
            handle.publish_wait("a".into(), payload.clone()).await;
            count.fetch_add(1, Ordering::SeqCst);
        }
    });

    tokio::time::sleep(ms(1000)).await;
    let first = done.load(Ordering::SeqCst);
    tokio::time::sleep(ms(500)).await;
    let second = done.load(Ordering::SeqCst);
    assert!(
        first < TOTAL,
        "nothing waited: {first} sent to a stalled agent"
    );
    assert_eq!(first, second, "still sending to a stalled agent");

    agent.stats.stalled.store(false, Ordering::SeqCst);
    let data = agent.collect_data(TOTAL, secs(20)).await;
    assert_eq!(data.len(), TOTAL);
    assert_eq!(done.load(Ordering::SeqCst), TOTAL);
    let extra = agent.drain(ms(200)).await;
    assert!(
        !extra.iter().any(|e| matches!(e, FromDriver::Disconnected)),
        "the driver lost its connection: {extra:?}"
    );
}

/// The driver's connection to the agent survives the agent falling
/// behind. Before the MQTT event loop had its own task, a write cut
/// short by the driver loop was sent again in part, and the agent read
/// garbage and dropped the driver.
#[tokio::test]
async fn stream_survives_a_stalled_agent() {
    const TOTAL: usize = 20_000;
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<FakeHandler>(agent.config());
    let ctl = Ctl::new();

    agent.handshake(ctl.conf(), &[("1", "a")]).await;
    agent.wait_status("UP", secs(5)).await;

    agent.stats.stalled.store(true, Ordering::SeqCst);
    let payload = Bytes::from(vec![b'x'; 1024]);
    for _ in 0..TOTAL {
        ctl.handle().publish("a".into(), payload.clone());
    }
    tokio::time::sleep(ms(1000)).await;
    agent.stats.stalled.store(false, Ordering::SeqCst);

    let data = agent.collect_data(TOTAL, secs(20)).await;
    assert_eq!(data.len(), TOTAL);
    assert_eq!(agent.stats.connects(), 1, "the driver reconnected");
}

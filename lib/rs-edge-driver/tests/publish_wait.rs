//! `DriverHandle::publish_wait`: data pushed by a device reaches the
//! edge agent in order, and a handler that sends faster than the agent
//! reads waits at `publish_queue_bytes` instead of queueing without
//! limit or dropping.

mod common;

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use bytes::Bytes;
use common::handler::{Ctl, FakeHandler};
use common::{FakeAgent, ms, secs, spawn_driver};

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
    // 64 KiB each, 64 MiB in all: four times the default 16 MiB queue,
    // and far more than the socket buffers hold besides.
    const TOTAL: usize = 1024;
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<FakeHandler>(agent.config());
    let ctl = Ctl::new();

    agent.handshake(ctl.conf(), &[("1", "a")]).await;
    agent.wait_status("UP", secs(5)).await;

    // An agent that takes a long time over each read.
    agent.stats.read_delay_ms.store(1000, Ordering::SeqCst);
    tokio::time::sleep(ms(100)).await;
    let done = Arc::new(AtomicUsize::new(0));
    let handle = ctl.handle();
    let count = done.clone();
    tokio::spawn(async move {
        for i in 0..TOTAL {
            let mut p = vec![b'x'; 64 * 1024];
            p[..4].copy_from_slice(&(i as u32).to_be_bytes());
            handle.publish_wait("a".into(), Bytes::from(p)).await;
            count.fetch_add(1, Ordering::SeqCst);
        }
    });

    tokio::time::sleep(ms(1500)).await;
    let waiting = done.load(Ordering::SeqCst);
    assert!(
        waiting < TOTAL,
        "nothing waited: {waiting} sent to a slow agent"
    );

    agent.stats.read_delay_ms.store(0, Ordering::SeqCst);
    let data = agent.collect_data(TOTAL, secs(30)).await;
    assert_eq!(data.len(), TOTAL, "messages were lost");
    for (i, (_, p)) in data.iter().enumerate() {
        assert_eq!(
            &p[..4],
            &(i as u32).to_be_bytes(),
            "message {i} out of order"
        );
    }
    assert_eq!(done.load(Ordering::SeqCst), TOTAL);
    assert_eq!(agent.stats.connects(), 1, "the driver reconnected");
}

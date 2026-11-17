//! Gap 2: polls queued on the handler lock, the timeout counted the
//! wait for the lock, and batches ran one after another.

mod common;

use std::sync::atomic::Ordering;
use std::time::Instant;

use common::handler::{Ctl, FakeHandler};
use common::{FakeAgent, ms, secs, spawn_driver};

fn addrs(n: usize) -> Vec<(String, String)> {
    (0..n).map(|i| (i.to_string(), format!("a{i}"))).collect()
}

fn refs(a: &[(String, String)]) -> Vec<(&str, &str)> {
    a.iter().map(|(t, a)| (t.as_str(), a.as_str())).collect()
}

fn poll_msg(a: &[(String, String)]) -> String {
    a.iter()
        .map(|(t, _)| t.as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

/// A handler without a poller still polls one at a time, but a poll
/// waiting for the lock must not time out: the timeout starts once it
/// holds the lock.
#[tokio::test]
async fn timeout_starts_after_the_lock() {
    let mut agent = FakeAgent::start("Conn").await;
    let mut config = agent.config();
    config.poll_timeout = ms(500);
    let _driver = spawn_driver::<FakeHandler>(config);
    let ctl = Ctl::new();
    *ctl.poll_delay.lock().unwrap() = ms(100);

    let a = addrs(20);
    agent.handshake(ctl.conf(), &refs(&a)).await;
    agent.wait_status("UP", secs(5)).await;

    agent.send("poll", poll_msg(&a));
    let data = agent.collect_data(20, secs(6)).await;
    assert_eq!(data.len(), 20, "polls timed out while queued for the lock");
}

/// A handler that hands out a poller gets its polls run at once.
#[tokio::test]
async fn poller_polls_run_concurrently() {
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<FakeHandler>(agent.config());
    let ctl = Ctl::new();
    ctl.use_poller.store(true, Ordering::SeqCst);
    *ctl.poll_delay.lock().unwrap() = ms(500);

    let a = addrs(50);
    agent.handshake(ctl.conf(), &refs(&a)).await;
    agent.wait_status("UP", secs(5)).await;

    let start = Instant::now();
    agent.send("poll", poll_msg(&a));
    let data = agent.collect_data(50, secs(10)).await;
    assert_eq!(data.len(), 50);
    assert!(
        start.elapsed() < ms(2000),
        "50 polls of 500 ms took {:?}",
        start.elapsed()
    );
    assert!(Ctl::count(&ctl.max_in_flight) > 1);
}

/// Separate poll messages (one per device on the agent) don't wait
/// for each other.
#[tokio::test]
async fn batches_run_concurrently() {
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<FakeHandler>(agent.config());
    let ctl = Ctl::new();
    ctl.use_poller.store(true, Ordering::SeqCst);
    *ctl.poll_delay.lock().unwrap() = ms(600);

    let a = addrs(4);
    agent.handshake(ctl.conf(), &refs(&a)).await;
    agent.wait_status("UP", secs(5)).await;

    let start = Instant::now();
    for (t, _) in &a {
        agent.send("poll", t.clone());
    }
    let data = agent.collect_data(4, secs(10)).await;
    assert_eq!(data.len(), 4);
    assert!(
        start.elapsed() < ms(1500),
        "4 batches of one 600 ms poll took {:?}",
        start.elapsed()
    );
}

/// `serial_poll` still means one poll at a time, poller or not.
#[tokio::test]
async fn serial_poll_stays_serial() {
    let mut agent = FakeAgent::start("Conn").await;
    let mut config = agent.config();
    config.serial_poll = true;
    let _driver = spawn_driver::<FakeHandler>(config);
    let ctl = Ctl::new();
    ctl.use_poller.store(true, Ordering::SeqCst);
    *ctl.poll_delay.lock().unwrap() = ms(20);

    let a = addrs(10);
    agent.handshake(ctl.conf(), &refs(&a)).await;
    agent.wait_status("UP", secs(5)).await;

    agent.send("poll", poll_msg(&a[..5]));
    agent.send("poll", poll_msg(&a[5..]));
    let data = agent.collect_data(10, secs(5)).await;
    assert_eq!(data.len(), 10);
    assert_eq!(Ctl::count(&ctl.max_in_flight), 1);
}

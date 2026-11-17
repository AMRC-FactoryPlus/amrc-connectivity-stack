//! A burst of values a driver publishes back to back reaches the edge
//! agent together.
//!
//! With Nagle's algorithm on the driver's socket, the second and later
//! values of a burst wait for the agent to ACK the first. An agent that
//! has just sent the driver something, as the Edge Agent does with
//! `conf`, `addr` and `poll`, delays that ACK by about 40 ms on Linux,
//! so the rest of the burst arrives 40 ms late and misses the DDATA
//! the agent builds from the values that arrive together.

mod common;

use std::time::Duration;

use bytes::Bytes;
use common::handler::{Ctl, FakeHandler};
use common::{FakeAgent, ms, secs, spawn_driver};

/// Values in each burst. Small, so Nagle would hold them.
const BURST: usize = 20;
/// Bursts to send.
const BURSTS: usize = 8;

#[tokio::test]
async fn a_burst_arrives_together() {
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<FakeHandler>(agent.config());
    let ctl = Ctl::new();

    agent.handshake(ctl.conf(), &[("1", "a")]).await;
    agent.wait_status("UP", secs(5)).await;
    tokio::time::sleep(ms(300)).await;

    let handle = ctl.handle();
    let mut spreads = Vec::new();
    for b in 0..BURSTS {
        // A value, and the agent sending the driver something straight
        // back. Receiving and then replying puts the agent's end of
        // the link in the mode where it delays its ACKs.
        handle.publish("a".into(), Bytes::from(format!("{b}.lead")));
        assert_eq!(agent.collect_data(1, secs(5)).await.len(), 1);
        agent.send("poll", "");
        tokio::time::sleep(ms(5)).await;
        agent.stats.data_arrivals.lock().unwrap().clear();

        for i in 0..BURST {
            handle.publish("a".into(), Bytes::from(format!("{b}.{i}")));
        }
        let data = agent.collect_data(BURST, secs(5)).await;
        assert_eq!(data.len(), BURST, "burst {b} lost values");
        let arrivals = std::mem::take(&mut *agent.stats.data_arrivals.lock().unwrap());
        spreads.push(*arrivals.last().unwrap() - arrivals[0]);
        tokio::time::sleep(ms(100)).await;
    }

    eprintln!("first-to-last arrival per burst: {spreads:?}");
    // With Nagle every burst is spread over a delayed-ACK interval:
    // 40 ms on Linux, more on other systems. The fastest of several
    // bursts keeps a busy CI runner's scheduling out of the result.
    let best = *spreads.iter().min().unwrap();
    assert!(
        best < Duration::from_millis(15),
        "every burst was spread over 15 ms or more: {spreads:?}"
    );
}

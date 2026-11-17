//! A driver that publishes faster than the edge agent reads keeps its
//! MQTT stream intact. rumqttc's `EventLoop::poll` writes to the socket
//! inside the future it returns, so a driver loop that drops that
//! future part way through a write (by racing it in a `select!`) sends
//! some bytes twice and the agent can no longer parse the stream.

mod common;

use std::sync::atomic::Ordering;

use bytes::Bytes;
use common::handler::{Ctl, FakeHandler};
use common::{FakeAgent, FromDriver, ms, secs, spawn_driver};

#[tokio::test]
async fn stream_survives_an_agent_that_reads_slowly() {
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<FakeHandler>(agent.config());
    let ctl = Ctl::new();

    agent.handshake(ctl.conf(), &[("7", "push")]).await;
    agent.wait_status("UP", secs(5)).await;
    tokio::time::sleep(ms(200)).await;

    // 2,000 messages of 8 KiB, far more than the socket buffers hold,
    // so the driver's writes block while the agent dawdles.
    agent.stats.read_delay_ms.store(2, Ordering::SeqCst);
    let n = 2000u32;
    let handle = ctl.handle();
    for i in 0..n {
        let mut p = vec![(i % 251) as u8; 8192];
        p[..4].copy_from_slice(&i.to_be_bytes());
        handle.publish("push".into(), Bytes::from(p));
        if i % 50 == 0 {
            tokio::task::yield_now().await;
        }
    }

    let data = agent.collect_data(n as usize, secs(20)).await;
    assert_eq!(data.len(), n as usize, "the agent stopped receiving data");
    for (i, (_, p)) in data.iter().enumerate() {
        let i = i as u32;
        assert_eq!(&p[..4], &i.to_be_bytes(), "message {i} out of order");
        assert!(
            p[4..].iter().all(|b| *b == (i % 251) as u8),
            "message {i} corrupt"
        );
    }
    // The connection was never dropped and remade.
    assert_eq!(agent.stats.connects(), 1);
    assert!(
        !agent
            .drain(ms(100))
            .await
            .iter()
            .any(|e| matches!(e, FromDriver::Disconnected))
    );
}

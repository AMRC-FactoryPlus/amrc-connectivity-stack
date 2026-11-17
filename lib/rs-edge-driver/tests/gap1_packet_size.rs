//! Gap 1: the MQTT packet limit. rumqttc defaults to 10 KiB each way,
//! which ends the session on a big `addr` map or a big data payload.

mod common;

use bytes::Bytes;
use common::handler::{Ctl, FakeHandler};
use common::{FakeAgent, FromDriver, secs, spawn_driver, spawn_driver_with};
use rs_edge_driver::DriverOptions;

/// About 1 MiB of addresses: 20,000 entries of 40-odd bytes each.
fn big_addr_map() -> Vec<(String, String)> {
    (0..20_000)
        .map(|i| {
            (
                i.to_string(),
                format!("ns=2;s=Plant.Line.Machine.Tag{i:08}"),
            )
        })
        .collect()
}

#[tokio::test]
async fn one_mib_addr_map_is_accepted() {
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<FakeHandler>(agent.config());
    let ctl = Ctl::new();

    let addrs = big_addr_map();
    let refs: Vec<(&str, &str)> = addrs
        .iter()
        .map(|(t, a)| (t.as_str(), a.as_str()))
        .collect();
    agent.handshake(ctl.conf(), &refs).await;
    agent.wait_status("UP", secs(5)).await;

    agent.send("poll", "19999");
    let data = agent.collect_data(1, secs(5)).await;
    assert_eq!(
        data,
        vec![(
            "19999".to_owned(),
            Bytes::from("ns=2;s=Plant.Line.Machine.Tag00019999")
        )]
    );
    assert_eq!(agent.stats.connects(), 1, "the driver reconnected");
}

#[tokio::test]
async fn one_mib_data_payload_is_sent() {
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<FakeHandler>(agent.config());
    let ctl = Ctl::new();
    *ctl.poll_size.lock().unwrap() = Some(1024 * 1024);

    agent.handshake(ctl.conf(), &[("1", "a")]).await;
    agent.wait_status("UP", secs(5)).await;

    agent.send("poll", "1");
    let data = agent.collect_data(1, secs(5)).await;
    assert_eq!(data.len(), 1, "no data arrived");
    assert_eq!(data[0].1.len(), 1024 * 1024);
}

#[tokio::test]
async fn limit_is_configurable() {
    let mut agent = FakeAgent::start("Conn").await;
    let mut options = DriverOptions::default();
    options.max_packet_size = 64 * 1024;
    let _driver = spawn_driver_with::<FakeHandler>(agent.config(), options);
    let ctl = Ctl::new();

    let addrs = big_addr_map();
    let refs: Vec<(&str, &str)> = addrs
        .iter()
        .map(|(t, a)| (t.as_str(), a.as_str()))
        .collect();
    agent.handshake(ctl.conf(), &refs).await;

    // Over the configured limit, so rumqttc refuses the packet and the
    // session ends.
    let events = agent.drain(secs(2)).await;
    assert!(
        events.iter().any(|e| matches!(e, FromDriver::Disconnected)),
        "expected the driver to drop the oversized packet; saw {events:?}"
    );
}

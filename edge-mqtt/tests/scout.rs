// ACS MQTT driver
// Scans between a fake Edge Agent and a fake device broker
// Copyright 2026 University of Sheffield

//! A scan's own connection, its options, and how it reports a broker
//! that refuses it, against [`broker::FakeBroker`].

mod broker;
#[path = "../../lib/rs-edge-driver/tests/common/mod.rs"]
mod common;
mod scouting;

use broker::{FakeBroker, Seen};
use common::{ms, secs};
use rumqttc::mqttbytes::v4::ConnectReturnCode;
use scouting::*;
use serde_json::{Value, json};

/// The scan's CONNECT, skipping the driver's own.
async fn scout_connect(broker: &mut FakeBroker) -> (String, bool, Option<(String, String)>) {
    broker
        .wait(secs(5), |e| match e {
            Seen::Connect {
                client_id,
                clean_session,
                login,
                ..
            } if client_id != "edge-test" => {
                Some((client_id.clone(), *clean_session, login.clone()))
            }
            _ => None,
        })
        .await
}

/// Wait until the scan has subscribed, and return its filters.
async fn scout_subscribe(broker: &mut FakeBroker) -> Vec<String> {
    broker
        .wait(secs(5), |e| match e {
            Seen::Subscribe(f) => Some(f.iter().map(|(t, _)| t.clone()).collect()),
            _ => None,
        })
        .await
}

#[tokio::test]
async fn a_scan_uses_its_own_client_and_keeps_the_driver_connected() {
    let mut broker = FakeBroker::start().await;
    let mut conf = broker.conf();
    conf["username"] = "user".into();
    conf["password"] = "secret".into();
    conf["cleanSession"] = false.into();
    let (mut agent, _driver) = up(conf, &[("1", "plant/data")]).await;
    // The driver's own subscription.
    assert_eq!(scout_subscribe(&mut broker).await, ["plant/data"]);

    start(&agent, json!({"seconds": 1}), limits(100, 8, 30, true));
    let (id, clean, login) = scout_connect(&mut broker).await;
    assert!(id.starts_with("edge-test-scout-"), "{id}");
    assert_eq!(id.len(), "edge-test-scout-".len() + 6);
    assert!(clean, "a scan uses a clean session");
    assert_eq!(login, Some(("user".into(), "secret".into())));
    assert_eq!(scout_subscribe(&mut broker).await, ["#"]);

    broker.publish_to(&id, "plant/retained", r#"{"v": 1}"#, true);
    broker.publish_to(&id, "plant/live", "21.5", false);
    // The driver's connection still gets its data during the scan.
    broker.publish_to("edge-test", "plant/data", "x", false);

    let mut data = Vec::new();
    let msgs = until_end(&mut agent, secs(10), &mut data).await;
    assert_eq!(msgs[0]["type"], "accept");
    let end = end_of(&msgs);
    assert_eq!(end["exhaustive"], false);
    assert_eq!(end["truncated"], false);
    assert_eq!(end["reason"], Value::Null);

    let items = items_of(&msgs);
    assert_tree(&items);
    assert_eq!(
        ids(&items),
        [
            "plant/",
            "plant/live",
            "plant/retained",
            "plant/retained\0$.v"
        ]
    );
    let retained = find(&items, "plant/retained");
    assert_eq!(retained["detail"]["retained"], true);
    assert_eq!(retained["detail"]["format"], "json");
    assert_eq!(retained["sample"], r#"{"v": 1}"#);
    let live = find(&items, "plant/live");
    assert_eq!(live["type"], "Double");
    assert_eq!(live["detail"]["retained"], false);
    assert_eq!(find(&items, "plant/retained\0$.v")["type"], "Int64");

    assert_eq!(data.len(), 1, "data during the scan: {data:?}");
    // The scan's connection is closed, and the driver's is not.
    let closed = broker
        .wait(secs(2), |e| matches!(e, Seen::Disconnect).then_some(()))
        .await;
    assert_eq!(closed, ());
    assert!(broker.connected("edge-test"));
    assert!(!broker.connected(&id));
    assert_eq!(
        agent.stats.connects(),
        1,
        "the driver reconnected to the agent"
    );
}

#[tokio::test]
async fn a_long_client_id_gets_a_short_scout_id() {
    let mut broker = FakeBroker::start().await;
    let mut conf = broker.conf();
    conf["clientId"] = "".into();
    let (mut agent, _driver) = up(conf, &[("1", "a")]).await;
    let main = broker
        .wait(secs(5), |e| match e {
            Seen::Connect { client_id, .. } => Some(client_id.clone()),
            _ => None,
        })
        .await;
    assert!(main.starts_with("NO-ID-"));

    start(&agent, json!({"seconds": 1}), limits(100, 8, 30, false));
    let id = broker
        .wait(secs(5), |e| match e {
            Seen::Connect { client_id, .. } if *client_id != main => Some(client_id.clone()),
            _ => None,
        })
        .await;
    assert!(id.starts_with("fpscout-") && id.len() == 20, "{id}");
    scan(&mut agent, secs(10)).await;
}

#[tokio::test]
async fn the_options_can_set_the_client_id() {
    let mut broker = FakeBroker::start().await;
    let (mut agent, _driver) = up(broker.conf(), &[("1", "a")]).await;
    start(
        &agent,
        json!({"seconds": 1, "client_id": "my-scanner", "filters": ["a/#", "b"]}),
        limits(100, 8, 30, false),
    );
    let (id, _, _) = scout_connect(&mut broker).await;
    assert_eq!(id, "my-scanner");
    assert_eq!(scout_subscribe(&mut broker).await, ["a/#", "b"]);
    let msgs = scan(&mut agent, secs(10)).await;
    assert_eq!(error_code(&msgs), "none");
}

#[tokio::test]
async fn bad_options_end_with_options() {
    let broker = FakeBroker::start().await;
    let (mut agent, _driver) = up(broker.conf(), &[("1", "a")]).await;
    for options in [
        json!({"filters": ["a/#/b"]}),
        json!({"seconds": 500}),
        json!({"client_id": "edge-test"}),
    ] {
        start(&agent, options.clone(), limits(100, 8, 30, false));
        let msgs = scan(&mut agent, secs(5)).await;
        assert_eq!(error_code(&msgs), "OPTIONS", "{options}");
    }
}

#[tokio::test]
async fn some_refused_filters_truncate_with_partial_access() {
    let mut broker = FakeBroker::start().await;
    let (mut agent, _driver) = up(broker.conf(), &[("1", "a")]).await;
    broker.refuse_filters("secret");
    start(
        &agent,
        json!({"seconds": 1, "filters": ["open/#", "secret/#"]}),
        limits(100, 8, 30, false),
    );
    let (id, _, _) = scout_connect(&mut broker).await;
    scout_subscribe(&mut broker).await;
    broker.publish_to(&id, "open/x", "1", false);
    let msgs = scan(&mut agent, secs(10)).await;
    let end = end_of(&msgs);
    assert_eq!(end["truncated"], true);
    assert_eq!(end["reason"], "partial_access");
    assert_eq!(ids(&items_of(&msgs)), ["open/", "open/x"]);
}

#[tokio::test]
async fn every_refused_filter_ends_with_auth() {
    let broker = FakeBroker::start().await;
    let (mut agent, _driver) = up(broker.conf(), &[("1", "a")]).await;
    broker.refuse_filters("#");
    start(&agent, json!({"seconds": 5}), limits(100, 8, 30, false));
    let msgs = scan(&mut agent, secs(10)).await;
    assert_eq!(error_code(&msgs), "AUTH");
    assert_eq!(
        end_of(&msgs)["error"]["message"],
        "The broker refused every filter. Give narrower filters."
    );
}

#[tokio::test]
async fn a_refused_connection_ends_with_auth() {
    let broker = FakeBroker::start().await;
    let (mut agent, _driver) = up(broker.conf(), &[("1", "a")]).await;
    broker.refuse_client("edge-test-scout", ConnectReturnCode::NotAuthorized);
    start(&agent, json!({"seconds": 1}), limits(100, 8, 30, false));
    let msgs = scan(&mut agent, secs(10)).await;
    assert_eq!(error_code(&msgs), "AUTH");

    broker.refuse_client("edge-test-scout", ConnectReturnCode::ServiceUnavailable);
    start(&agent, json!({"seconds": 1}), limits(100, 8, 30, false));
    let msgs = scan(&mut agent, secs(10)).await;
    assert_eq!(error_code(&msgs), "CONN");
    // The driver itself stays up.
    assert!(broker.connected("edge-test"));
}

#[tokio::test]
async fn a_lost_scan_connection_ends_with_conn() {
    let mut broker = FakeBroker::start().await;
    let (mut agent, _driver) = up(broker.conf(), &[("1", "a")]).await;
    start(&agent, json!({"seconds": 20}), limits(100, 8, 60, false));
    scout_connect(&mut broker).await;
    scout_subscribe(&mut broker).await;
    // The scan's connection is the latest.
    broker.kick();
    let msgs = scan(&mut agent, secs(10)).await;
    assert_eq!(error_code(&msgs), "CONN");
    assert!(broker.connected("edge-test"));
}

#[tokio::test]
async fn losing_the_driver_connection_ends_the_scan_with_conn() {
    // A broker that sets the client id from the login gives the scan
    // the driver's client id and drops the driver's connection. The
    // scan must stop at once so the two don't take turns.
    let mut broker = FakeBroker::start().await;
    let (mut agent, _driver) = up(broker.conf(), &[("1", "a")]).await;
    start(&agent, json!({"seconds": 60}), limits(100, 8, 120, false));
    let (scan_id, _, _) = scout_connect(&mut broker).await;
    scout_subscribe(&mut broker).await;
    let t0 = std::time::Instant::now();
    broker.kick_client("edge-test");
    let msgs = scan(&mut agent, secs(5)).await;
    assert_eq!(error_code(&msgs), "CONN");
    let end = msgs.last().unwrap();
    let message = end["error"]["message"].as_str().unwrap_or_default();
    assert!(
        message.contains("use_username_as_clientid"),
        "the message names the broker setting: {end}"
    );
    assert!(
        t0.elapsed() < secs(3),
        "the scan took {:?} to stop",
        t0.elapsed()
    );
    // The scan's own connection is closed and the driver reconnects.
    let deadline = std::time::Instant::now() + secs(5);
    while broker.connected(&scan_id) || !broker.connected("edge-test") {
        assert!(
            std::time::Instant::now() < deadline,
            "scan connected {}, driver connected {}",
            broker.connected(&scan_id),
            broker.connected("edge-test")
        );
        tokio::time::sleep(ms(20)).await;
    }
    agent.wait_status("UP", secs(5)).await;
}

#[tokio::test]
async fn a_cancel_stops_listening() {
    let mut broker = FakeBroker::start().await;
    let (mut agent, _driver) = up(broker.conf(), &[("1", "a")]).await;
    start(&agent, json!({"seconds": 60}), limits(100, 8, 120, false));
    scout_connect(&mut broker).await;
    tokio::time::sleep(ms(300)).await;
    let t0 = std::time::Instant::now();
    agent.send(
        "scout",
        json!({"op": "cancel", "id": SCAN, "version": 1}).to_string(),
    );
    let msgs = scan(&mut agent, secs(5)).await;
    assert_eq!(error_code(&msgs), "CANCELLED");
    assert!(t0.elapsed() < secs(2), "cancel took {:?}", t0.elapsed());
}

#[tokio::test]
async fn the_item_cap_ends_listening_early() {
    let mut broker = FakeBroker::start().await;
    let (mut agent, _driver) = up(broker.conf(), &[("1", "a")]).await;
    start(&agent, json!({"seconds": 60}), limits(3, 8, 120, false));
    let (id, _, _) = scout_connect(&mut broker).await;
    scout_subscribe(&mut broker).await;
    let t0 = std::time::Instant::now();
    for i in 0..10 {
        broker.publish_to(&id, &format!("t{i}"), "1", false);
    }
    let msgs = scan(&mut agent, secs(10)).await;
    assert!(t0.elapsed() < secs(5), "the scan kept listening");
    let end = end_of(&msgs);
    assert_eq!(end["truncated"], true);
    assert_eq!(end["reason"], "items");
    assert_eq!(items_of(&msgs).len(), 3);
}

#[tokio::test]
async fn a_branch_scan_listens_on_its_root() {
    let mut broker = FakeBroker::start().await;
    let (mut agent, _driver) = up(broker.conf(), &[("1", "a")]).await;
    start_at(
        &agent,
        Some("plant/line1/#"),
        Some("plant/line1/"),
        json!({"seconds": 1, "filters": ["ignored"]}),
        limits(100, 8, 30, false),
    );
    let (id, _, _) = scout_connect(&mut broker).await;
    assert_eq!(scout_subscribe(&mut broker).await, ["plant/line1/#"]);
    broker.publish_to(&id, "plant/line1", "1", false);
    broker.publish_to(&id, "plant/line1/speed", "1", false);
    let msgs = scan(&mut agent, secs(10)).await;
    let items = items_of(&msgs);
    assert_eq!(ids(&items), ["plant/line1/", "plant/line1/speed"]);
    assert_eq!(items[0]["kind"], "folder");
    assert_eq!(items[0]["root"], "plant/line1/#");
}

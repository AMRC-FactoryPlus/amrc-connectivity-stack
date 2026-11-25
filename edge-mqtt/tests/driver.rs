// ACS MQTT driver
// Run the whole driver between a fake Edge Agent and a fake device broker
// Copyright 2026 University of Sheffield

//! The driver end to end: the fake Edge Agent from `rs-edge-driver`'s
//! tests on one side, and [`broker::FakeBroker`] standing in for the
//! device's broker on the other.

mod broker;
#[path = "../../lib/rs-edge-driver/tests/common/mod.rs"]
mod common;

use broker::{FakeBroker, Seen};
use bytes::Bytes;
use common::{FakeAgent, FromDriver, ms, secs, spawn_driver};
use edge_mqtt::MqttHandler;
use rumqttc::mqttbytes::QoS;
use rumqttc::mqttbytes::v4::ConnectReturnCode;

async fn up(conf: serde_json::Value, addrs: &[(&str, &str)]) -> (FakeAgent, common::RunningDriver) {
    let mut agent = FakeAgent::start("MQTT").await;
    let driver = spawn_driver::<MqttHandler>(agent.config());
    agent.handshake(conf, addrs).await;
    agent.wait_status("UP", secs(5)).await;
    (agent, driver)
}

fn subscribed(ev: &Seen) -> Option<Vec<String>> {
    match ev {
        Seen::Subscribe(f) => {
            assert!(
                f.iter().all(|(_, q)| *q == QoS::AtMostOnce),
                "not QoS 0: {f:?}"
            );
            Some(f.iter().map(|(t, _)| t.clone()).collect())
        }
        _ => None,
    }
}

#[tokio::test]
async fn connects_with_the_configured_options() {
    let mut broker = FakeBroker::start().await;
    let mut conf = broker.conf();
    conf["clientId"] = "my-client".into();
    conf["username"] = "user".into();
    conf["password"] = "secret".into();
    conf["cleanSession"] = false.into();
    conf["keepAlive"] = 30.into();
    conf["useSSL"] = true.into();
    let (_agent, _driver) = up(conf, &[("1", "a")]).await;

    let connect = broker
        .wait(secs(2), |e| {
            matches!(e, Seen::Connect { .. }).then(|| e.clone())
        })
        .await;
    assert_eq!(
        connect,
        Seen::Connect {
            client_id: "my-client".into(),
            clean_session: false,
            keep_alive: 30,
            login: Some(("user".into(), "secret".into())),
        }
    );
}

#[tokio::test]
async fn no_username_means_no_credentials_and_a_made_up_id() {
    let mut broker = FakeBroker::start().await;
    let mut conf = broker.conf();
    conf["clientId"] = "".into();
    conf["username"] = "".into();
    conf["password"] = "secret".into();
    let (_agent, _driver) = up(conf, &[("1", "a")]).await;

    let (id, login) = broker
        .wait(secs(2), |e| match e {
            Seen::Connect {
                client_id, login, ..
            } => Some((client_id.clone(), login.clone())),
            _ => None,
        })
        .await;
    assert!(id.starts_with("NO-ID-"), "{id}");
    assert_eq!(login, None);
}

#[tokio::test]
async fn subscribes_to_each_valid_address_once_at_qos_0() {
    let mut broker = FakeBroker::start().await;
    let (_agent, _driver) = up(
        broker.conf(),
        &[
            ("1", "site/a"),
            ("2", "site/+"),
            ("3", "site/a"),
            ("4", "plant/#"),
            ("5", ""),
            ("6", "bad/#/x"),
        ],
    )
    .await;

    let mut filters = broker.wait(secs(2), subscribed).await;
    filters.sort();
    assert_eq!(filters, ["plant/#", "site/+", "site/a"]);
    let more: Vec<_> = broker
        .drain(ms(300))
        .await
        .into_iter()
        .filter(|e| matches!(e, Seen::Subscribe(_)))
        .collect();
    assert!(more.is_empty(), "subscribed again: {more:?}");
}

#[tokio::test]
async fn payloads_pass_through_byte_for_byte() {
    let mut broker = FakeBroker::start().await;
    let (mut agent, _driver) = up(broker.conf(), &[("7", "dev/json"), ("8", "dev/bin")]).await;
    broker.wait(secs(2), subscribed).await;

    let json = br#"[{"v":1.5,"t":1},{"v":2,"t":2}]"#.to_vec();
    let bin: Vec<u8> = (0..=255).collect();
    broker.publish("dev/json", json.clone());
    broker.publish("dev/bin", bin.clone());
    broker.publish("dev/empty-topic-not-in-map", b"x".to_vec());

    let data = agent.collect_data(3, secs(2)).await;
    assert_eq!(
        data,
        [
            ("7".to_owned(), Bytes::from(json)),
            ("8".to_owned(), Bytes::from(bin)),
        ]
    );
}

/// A wildcard address subscribes, but only a metric whose address is
/// the message's own topic gets the message, as with the built-in.
#[tokio::test]
async fn wildcard_messages_reach_exact_addresses_only() {
    let mut broker = FakeBroker::start().await;
    let (mut agent, _driver) =
        up(broker.conf(), &[("1", "line/+/temp"), ("2", "line/3/temp")]).await;
    broker.wait(secs(2), subscribed).await;

    broker.publish("line/1/temp", b"10".to_vec());
    broker.publish("line/3/temp", b"30".to_vec());
    broker.publish("line/2/temp", b"20".to_vec());

    let data = agent.collect_data(3, secs(1)).await;
    assert_eq!(data, [("2".to_owned(), Bytes::from_static(b"30"))]);
}

/// Messages on one topic reach the agent in the order they were sent,
/// and so do messages across topics.
#[tokio::test]
async fn order_is_kept() {
    const N: usize = 5000;
    let mut broker = FakeBroker::start().await;
    let (mut agent, _driver) = up(broker.conf(), &[("1", "a"), ("2", "b")]).await;
    broker.wait(secs(2), subscribed).await;

    for i in 0..N {
        let t = if i % 3 == 0 { "b" } else { "a" };
        broker.publish(t, i.to_string());
    }
    let data = agent.collect_data(N, secs(10)).await;
    let got: Vec<usize> = data
        .iter()
        .map(|(_, p)| std::str::from_utf8(p).unwrap().parse().unwrap())
        .collect();
    assert_eq!(got, (0..N).collect::<Vec<_>>());
    assert!(
        data.iter().all(|(t, p)| (t == "2")
            == (std::str::from_utf8(p).unwrap().parse::<usize>().unwrap() % 3 == 0))
    );
}

#[tokio::test]
async fn refused_credentials_report_auth() {
    let broker = FakeBroker::start().await;
    broker.refuse_connect(ConnectReturnCode::BadUserNamePassword);
    let mut agent = FakeAgent::start("MQTT").await;
    let _driver = spawn_driver::<MqttHandler>(agent.config());
    agent.handshake(broker.conf(), &[("1", "a")]).await;
    agent.wait_status("AUTH", secs(5)).await;
}

#[tokio::test]
async fn unreachable_broker_reports_conn() {
    let broker = FakeBroker::start().await;
    let mut conf = broker.conf();
    drop(broker);
    conf["host"] = "127.0.0.1".into();
    let mut agent = FakeAgent::start("MQTT").await;
    let _driver = spawn_driver::<MqttHandler>(agent.config());
    agent.handshake(conf, &[("1", "a")]).await;
    agent.wait_status("CONN", secs(5)).await;
}

#[tokio::test]
async fn bad_config_reports_conf() {
    let mut agent = FakeAgent::start("MQTT").await;
    let _driver = spawn_driver::<MqttHandler>(agent.config());
    agent
        .handshake(
            serde_json::json!({ "protocol": "http", "host": "h", "port": 1 }),
            &[],
        )
        .await;
    agent.wait_status("CONF", secs(5)).await;
}

/// A lost broker connection reports CONN, so the agent marks the
/// devices dead, then reconnects and subscribes again.
#[tokio::test]
async fn reconnects_and_resubscribes_after_a_lost_connection() {
    let mut broker = FakeBroker::start().await;
    let (mut agent, _driver) = up(broker.conf(), &[("1", "a")]).await;
    assert_eq!(broker.wait(secs(2), subscribed).await, ["a"]);

    broker.kick();
    agent.wait_status("CONN", secs(5)).await;
    agent.wait_status("UP", secs(5)).await;
    assert_eq!(broker.wait(secs(2), subscribed).await, ["a"]);

    broker.publish("a", b"after".to_vec());
    let data = agent.collect_data(1, secs(2)).await;
    assert_eq!(data, [("1".to_owned(), Bytes::from_static(b"after"))]);
}

#[tokio::test]
async fn a_new_address_map_changes_only_the_difference() {
    let mut broker = FakeBroker::start().await;
    let (mut agent, _driver) = up(broker.conf(), &[("1", "keep"), ("2", "drop")]).await;
    broker.wait(secs(2), subscribed).await;

    agent.send_addrs(&[("1", "keep"), ("3", "new")]);
    let unsub = broker
        .wait(secs(2), |e| match e {
            Seen::Unsubscribe(t) => Some(t.clone()),
            _ => None,
        })
        .await;
    assert_eq!(unsub, ["drop"]);
    assert_eq!(broker.wait(secs(2), subscribed).await, ["new"]);

    broker.publish("new", b"n".to_vec());
    let data = agent.collect_data(1, secs(2)).await;
    assert_eq!(data, [("3".to_owned(), Bytes::from_static(b"n"))]);
}

#[tokio::test]
async fn a_refused_subscription_leaves_the_rest_working() {
    let mut broker = FakeBroker::start().await;
    broker.refuse_filters("secret");
    let (mut agent, _driver) = up(broker.conf(), &[("1", "open"), ("2", "secret")]).await;
    broker.wait(secs(2), subscribed).await;

    broker.publish("open", b"1".to_vec());
    let data = agent.collect_data(1, secs(2)).await;
    assert_eq!(data, [("1".to_owned(), Bytes::from_static(b"1"))]);
    let after = agent.drain(ms(200)).await;
    assert!(
        !after.iter().any(|e| matches!(e, FromDriver::Status(_))),
        "status changed: {after:?}"
    );
}

/// A write publishes the value as text, QoS 0 and not retained, and is
/// answered as written.
#[tokio::test]
async fn writes_publish_and_are_confirmed() {
    let mut broker = FakeBroker::start().await;
    let (mut agent, _driver) = up(broker.conf(), &[("1", "dev/setpoint")]).await;
    broker.wait(secs(2), subscribed).await;

    agent.send(
        "write/dev/setpoint",
        r#"{"type":"Double","value":21.5,"id":"w1"}"#,
    );
    let publish = broker
        .wait(secs(2), |e| {
            matches!(e, Seen::Publish { .. }).then(|| e.clone())
        })
        .await;
    assert_eq!(
        publish,
        Seen::Publish {
            topic: "dev/setpoint".into(),
            payload: Bytes::from_static(b"21.5"),
            qos: QoS::AtMostOnce,
            retain: false,
        }
    );

    let answer = loop {
        match agent.next(secs(2)).await {
            Some(FromDriver::Other { topic, payload }) if topic.ends_with("/result/w1") => {
                break payload;
            }
            Some(_) => {}
            None => panic!("write was not answered"),
        }
    };
    assert!(answer.is_empty(), "write failed: {answer:?}");
}

/// A message too large for the driver's link to the agent is dropped,
/// and the next one still arrives.
#[tokio::test]
async fn oversized_messages_are_dropped() {
    let mut broker = FakeBroker::start().await;
    let (mut agent, _driver) = up(broker.conf(), &[("1", "big")]).await;
    broker.wait(secs(2), subscribed).await;

    broker.publish("big", vec![b'x'; edge_mqtt::handler::FORWARD_MAX + 1]);
    broker.publish("big", b"small".to_vec());
    let data = agent.collect_data(1, secs(5)).await;
    assert_eq!(data, [("1".to_owned(), Bytes::from_static(b"small"))]);
}

/// A large message, such as an array of thousands of items, passes.
#[tokio::test]
async fn large_messages_pass() {
    let mut broker = FakeBroker::start().await;
    let (mut agent, _driver) = up(broker.conf(), &[("1", "big")]).await;
    broker.wait(secs(2), subscribed).await;

    let payload = vec![b'y'; 4 * 1024 * 1024];
    broker.publish("big", payload.clone());
    let data = agent.collect_data(1, secs(5)).await;
    assert_eq!(data, [("1".to_owned(), Bytes::from(payload))]);
}

/// With a blank client id, the made-up `NO-ID-<uuid>` is kept across
/// reconnects, as the built-in keeps it, so a persistent session on
/// the broker is resumed instead of a new one being left each time.
#[tokio::test]
async fn a_made_up_client_id_is_kept_across_reconnects() {
    let mut broker = FakeBroker::start().await;
    let mut conf = broker.conf();
    conf["clientId"] = "".into();
    conf["cleanSession"] = false.into();
    let (mut agent, _driver) = up(conf, &[("1", "a")]).await;

    let id = |e: &Seen| match e {
        Seen::Connect { client_id, .. } => Some(client_id.clone()),
        _ => None,
    };
    let first = broker.wait(secs(2), id).await;
    assert!(first.starts_with("NO-ID-"), "{first}");

    broker.kick();
    agent.wait_status("CONN", secs(5)).await;
    agent.wait_status("UP", secs(5)).await;
    let second = broker.wait(secs(2), id).await;
    assert_eq!(second, first, "a new id was made up on reconnect");
}

/// A broker that closes the connection straight after accepting it
/// must not leave the status UP with nothing connected: the driver
/// reports CONN and connects again.
///
/// The defect was that the read loop's report could reach the driver
/// before `connect` returned, when the driver ignores it, and then
/// nothing reconnected. That order is rare and this test can't force
/// it (it did not happen in 60 runs of the old code), so it checks
/// that the driver recovers, on several threads and a few times over.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_connection_closed_after_connack_is_retried() {
    for _ in 0..5 {
        let mut broker = FakeBroker::start().await;
        broker.drop_after_connack(1);
        // Not `up`: the loss can be seen while `connect` is still
        // running, and then the driver reports CONN without UP first,
        // which `up` would take as its own.
        let mut agent = FakeAgent::start("MQTT").await;
        let _driver = spawn_driver::<MqttHandler>(agent.config());
        agent.handshake(broker.conf(), &[("1", "a")]).await;

        agent.wait_status("CONN", secs(5)).await;
        agent.wait_status("UP", secs(5)).await;
        loop {
            if broker.wait(secs(2), subscribed).await == ["a"] {
                break;
            }
        }
        broker.publish("a", b"back".to_vec());
        let data = agent.collect_data(1, secs(2)).await;
        assert_eq!(data, [("1".to_owned(), Bytes::from_static(b"back"))]);
    }
}

/// `ws` and `wss` connect to the path `/`, as the built-in does: its
/// URL has no path, and mqtt.js then uses `/`. The listener reads the
/// WebSocket upgrade request and records the path it asks for.
#[tokio::test]
async fn websockets_use_the_root_path() {
    use tokio::io::{AsyncBufReadExt, BufReader};

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let request = tokio::spawn(async move {
        let (sock, _) = listener.accept().await.unwrap();
        let mut line = String::new();
        BufReader::new(sock).read_line(&mut line).await.unwrap();
        line
    });

    let mut agent = FakeAgent::start("MQTT").await;
    let _driver = spawn_driver::<MqttHandler>(agent.config());
    let conf = serde_json::json!({
        "protocol": "ws", "host": "127.0.0.1", "port": port,
        "clientId": "edge-ws", "cleanSession": true, "keepAlive": 60,
    });
    agent.handshake(conf, &[("1", "a")]).await;

    let line = tokio::time::timeout(secs(5), request)
        .await
        .expect("no WebSocket request")
        .unwrap();
    assert_eq!(line.trim_end(), "GET / HTTP/1.1");
}

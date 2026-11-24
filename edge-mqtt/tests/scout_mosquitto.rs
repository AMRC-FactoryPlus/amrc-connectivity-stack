// ACS MQTT driver
// Scans against a real broker: mosquitto, with and without ACLs
// Copyright 2026 University of Sheffield

//! See `real/mod.rs` for what these tests need. The dynamic security
//! tests also need mosquitto's dynamic security plugin, which the
//! Debian and Ubuntu packages include.
//!
//! What mosquitto 2 does with a filter a client may not read decides
//! what a scan can report:
//!
//! - with an `acl_file`, every SUBSCRIBE is granted, even for a filter
//!   that a `topic deny` line covers, and messages the client may not
//!   read are left out, so denied topics are absent.
//! - with the dynamic security plugin, the filter itself is checked,
//!   and a filter the client may not subscribe to gets a SUBACK
//!   failure, so the scan ends with `partial_access` or `AUTH`.

#[path = "../../lib/rs-edge-driver/tests/common/mod.rs"]
mod common;
mod real;
mod scouting;

use std::path::{Path, PathBuf};
use std::process::Command;

use common::{ms, secs};
use real::*;
use rumqttc::{AsyncClient, Event, Incoming, MqttOptions, QoS};
use scouting::*;
use serde_json::{Value, json};

fn conf(port: u16, login: Option<(&str, &str)>) -> Value {
    let mut c = json!({
        "protocol": "mqtt", "host": "127.0.0.1", "port": port,
        "clientId": "edge-main", "cleanSession": true, "keepAlive": 60,
    });
    if let Some((u, p)) = login {
        c["username"] = u.into();
        c["password"] = p.into();
    }
    c
}

/// The lines of mosquitto's log file that mention `text`.
fn log_lines(dir: &Path, text: &str) -> Vec<String> {
    std::fs::read_to_string(dir.join("mosquitto.log"))
        .unwrap_or_default()
        .lines()
        .filter(|l| l.contains(text))
        .map(str::to_owned)
        .collect()
}

fn log_conf(dir: &Path) -> String {
    format!(
        "log_dest file {}\nlog_type all\n",
        dir.join("mosquitto.log").display()
    )
}

/// Publish retained messages and wait until the broker holds the last.
/// `login` must be able to publish and to read the last topic.
async fn retain(port: u16, login: Option<(&str, &str)>, msgs: &[(String, Vec<u8>)]) {
    let mut opts = MqttOptions::new("retainer", "127.0.0.1", port);
    if let Some((u, p)) = login {
        opts.set_credentials(u, p);
    }
    let (publisher, mut ev) = AsyncClient::new(opts, 1000);
    // Keep polling through an error, so rumqttc reconnects and sends
    // again what the broker has not acknowledged.
    let task = tokio::spawn(async move {
        loop {
            if let Err(e) = ev.poll().await {
                eprintln!("retainer: {e}, reconnecting");
                tokio::time::sleep(ms(100)).await;
            }
        }
    });
    for (t, p) in msgs {
        publisher
            .publish(t.as_str(), QoS::AtLeastOnce, true, p.clone())
            .await
            .unwrap();
    }
    let (last, _) = msgs.last().unwrap();
    let mut opts = MqttOptions::new("checker", "127.0.0.1", port);
    if let Some((u, p)) = login {
        opts.set_credentials(u, p);
    }
    let (client, mut ev) = AsyncClient::new(opts, 10);
    client
        .subscribe(last.as_str(), QoS::AtMostOnce)
        .await
        .unwrap();
    let found = tokio::time::timeout(secs(30), async {
        loop {
            match ev.poll().await {
                Ok(Event::Incoming(Incoming::Publish(p))) if p.topic == *last => return,
                Ok(_) => {}
                Err(e) => panic!("checker: {e}"),
            }
        }
    })
    .await;
    assert!(found.is_ok(), "the broker never retained {last}");
    let _ = client.disconnect().await;
    let _ = publisher.disconnect().await;
    tokio::time::sleep(ms(100)).await;
    task.abort();
}

#[tokio::test]
async fn retained_and_live_topics_json_binary_and_sys() {
    if !tools() {
        return;
    }
    let dir = temp_dir("scout");
    let broker = mosquitto(
        dir.clone(),
        &format!("allow_anonymous true\nsys_interval 1\n{}", log_conf(&dir)),
    )
    .await;
    let device = device(broker.port, None).await;
    retain(
        broker.port,
        None,
        &[
            (
                "plant/line1".into(),
                br#"{"speed": 1, "ok": true}"#.to_vec(),
            ),
            ("plant/line1/temp".into(), b"21.5".to_vec()),
            ("plant/bin".into(), vec![0, 255, 1, 2]),
        ],
    )
    .await;

    let (mut agent, _driver) = up(conf(broker.port, None), &[("1", "plant/data")]).await;
    tokio::time::sleep(ms(300)).await;
    start(&agent, json!({"seconds": 2}), limits(1000, 8, 30, true));

    // Live traffic during the scan, for the scan and for the driver.
    let live = tokio::spawn({
        let device = device.clone();
        async move {
            for i in 0..40 {
                device
                    .publish(
                        "plant/live",
                        QoS::AtMostOnce,
                        false,
                        format!(r#"{{"a": [{i}, 2]}}"#),
                    )
                    .await
                    .unwrap();
                device
                    .publish("plant/data", QoS::AtMostOnce, false, i.to_string())
                    .await
                    .unwrap();
                tokio::time::sleep(ms(50)).await;
            }
        }
    });
    let mut data = Vec::new();
    let msgs = until_end(&mut agent, secs(15), &mut data).await;
    live.await.unwrap();
    let end = end_of(&msgs);
    assert_eq!(end["exhaustive"], false);
    assert_eq!(end["truncated"], false, "{end}");

    let items = items_of(&msgs);
    assert_tree(&items);
    // A topic that is also a folder.
    assert_eq!(find(&items, "plant/line1")["kind"], "value");
    assert_eq!(find(&items, "plant/line1/")["kind"], "folder");
    assert_eq!(find(&items, "plant/line1/temp")["parent"], "plant/line1/");
    assert_eq!(find(&items, "plant/line1/temp")["type"], "Double");
    assert_eq!(find(&items, "plant/line1/temp")["detail"]["retained"], true);
    // JSON leaves.
    let speed = find(&items, "plant/line1\0$.speed");
    assert_eq!(speed["type"], "Int64");
    assert_eq!(speed["path"], "$.speed");
    assert_eq!(speed["address"], "plant/line1");
    assert_eq!(speed["sample"], "1");
    assert_eq!(find(&items, "plant/line1\0$.ok")["type"], "Boolean");
    // Binary payloads.
    let bin = find(&items, "plant/bin");
    assert_eq!(bin["detail"]["format"], "binary");
    assert!(bin.get("type").is_none());
    assert!(bin.get("sample").is_none());
    // Live traffic.
    let live = find(&items, "plant/live");
    assert_eq!(live["detail"]["retained"], false);
    assert!(live["detail"]["rate_hz"].as_f64().unwrap() > 1.0, "{live}");
    assert_eq!(find(&items, "plant/live\0$.a[0]")["type"], "Int64");
    // $SYS is left out of #.
    assert!(
        !items
            .iter()
            .any(|i| i["id"].as_str().unwrap().starts_with('$'))
    );

    // The driver kept receiving and never reconnected to the broker,
    // and the scan used its own client.
    assert!(
        data.len() >= 20,
        "only {} data messages during the scan",
        data.len()
    );
    assert_eq!(
        log_lines(&dir, " as edge-main (").len(),
        1,
        "the driver reconnected"
    );
    let scouts = log_lines(&dir, " as edge-main-scout-");
    assert_eq!(scouts.len(), 1, "{scouts:?}");

    // A filter that names $SYS lists it.
    start(
        &agent,
        json!({"seconds": 2, "filters": ["plant/#", "$SYS/broker/#"]}),
        limits(1000, 8, 30, false),
    );
    let items = items_of(&scan(&mut agent, secs(15)).await);
    assert!(has(&items, "$SYS/"), "{:?}", ids(&items));
    assert!(has(&items, "$SYS/broker/uptime"), "{:?}", ids(&items));
    assert!(has(&items, "plant/bin"));
}

#[tokio::test]
async fn an_acl_file_leaves_denied_topics_out() {
    if !tools() {
        return;
    }
    let dir = temp_dir("scout-acl");
    let passwd = dir.join("passwd");
    for (i, (u, p)) in [("edge", "e"), ("dev", "d")].iter().enumerate() {
        let mut cmd = Command::new("mosquitto_passwd");
        if i == 0 {
            cmd.arg("-c");
        }
        run(cmd.arg("-b").arg(&passwd).args([u, p]));
    }
    let acl = dir.join("acl");
    std::fs::write(
        &acl,
        "user edge\ntopic read plant/allowed/#\ntopic deny plant/denied/#\n\nuser dev\ntopic readwrite #\n",
    )
    .unwrap();
    let broker = mosquitto(
        dir.clone(),
        &format!(
            "allow_anonymous false\npassword_file {}\nacl_file {}\n",
            passwd.display(),
            acl.display()
        ),
    )
    .await;
    retain(
        broker.port,
        Some(("dev", "d")),
        &[
            ("plant/denied/y".into(), b"2".to_vec()),
            ("plant/other".into(), b"3".to_vec()),
            ("plant/allowed/x".into(), b"1".to_vec()),
        ],
    )
    .await;

    let (mut agent, _driver) = up(
        conf(broker.port, Some(("edge", "e"))),
        &[("1", "plant/allowed/x")],
    )
    .await;
    // Every filter is granted, so nothing is truncated, and the denied
    // topics are not there.
    start(&agent, json!({"seconds": 1}), limits(100, 8, 30, false));
    let msgs = scan(&mut agent, secs(10)).await;
    let end = end_of(&msgs);
    assert_eq!(end["truncated"], false, "{end}");
    assert_eq!(
        ids(&items_of(&msgs)),
        ["plant/", "plant/allowed/", "plant/allowed/x"]
    );

    // Even a filter the user may not read at all is granted, and the
    // scan finds nothing.
    start(
        &agent,
        json!({"seconds": 1, "filters": ["plant/denied/#"]}),
        limits(100, 8, 30, false),
    );
    let msgs = scan(&mut agent, secs(10)).await;
    assert_eq!(error_code(&msgs), "none");
    assert_eq!(end_of(&msgs)["truncated"], false);
    assert!(items_of(&msgs).is_empty());
}

#[tokio::test]
async fn a_broker_that_takes_the_client_id_from_the_login_ends_the_scan() {
    if !tools() {
        return;
    }
    // With use_username_as_clientid, the scan's connection gets the
    // driver's client id, so mosquitto drops the driver's connection.
    // The scan must end with CONN straight away and the driver must
    // reconnect and keep running.
    let dir = temp_dir("scout-takeover");
    let passwd = dir.join("passwd");
    run(Command::new("mosquitto_passwd")
        .arg("-c")
        .arg("-b")
        .arg(&passwd)
        .args(["edge", "e"]));
    let broker = mosquitto(
        dir.clone(),
        &format!(
            "allow_anonymous false\npassword_file {}\nuse_username_as_clientid true\n{}",
            passwd.display(),
            log_conf(&dir)
        ),
    )
    .await;
    let (mut agent, _driver) = up(
        conf(broker.port, Some(("edge", "e"))),
        &[("1", "plant/data")],
    )
    .await;

    let t0 = std::time::Instant::now();
    start(&agent, json!({"seconds": 60}), limits(100, 8, 120, false));
    let msgs = scan(&mut agent, secs(10)).await;
    assert_eq!(error_code(&msgs), "CONN", "{:?}", msgs.last());
    assert!(
        end_of(&msgs)["error"]["message"]
            .as_str()
            .unwrap()
            .contains("use_username_as_clientid")
    );
    assert!(t0.elapsed() < secs(5), "the scan took {:?}", t0.elapsed());

    // The driver is back up, and no new connection replaces it.
    agent.wait_status("UP", secs(10)).await;
    tokio::time::sleep(secs(2)).await;
    let takeovers = log_lines(&dir, "already connected, closing old connection");
    assert!(
        takeovers.len() <= 2,
        "the driver and the scan took turns: {takeovers:?}"
    );
}

/// Where mosquitto's dynamic security plugin is, if it is installed.
fn dynsec_plugin() -> Option<PathBuf> {
    let mut dirs = vec![PathBuf::from("/usr/lib")];
    if let Ok(rd) = std::fs::read_dir("/usr/lib") {
        dirs.extend(rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()));
    }
    let found = dirs
        .into_iter()
        .map(|d| d.join("mosquitto_dynamic_security.so"))
        .find(|p| p.exists());
    if found.is_none() {
        assert!(
            std::env::var("EDGE_MQTT_MOSQUITTO").is_err(),
            "EDGE_MQTT_MOSQUITTO is set but mosquitto_dynamic_security.so is missing"
        );
        eprintln!("dynamic security tests skipped: mosquitto_dynamic_security.so not found");
    }
    found
}

#[tokio::test]
async fn dynamic_security_refusals_are_reported() {
    if !tools() {
        return;
    }
    let Some(plugin) = dynsec_plugin() else {
        return;
    };
    let dir = temp_dir("scout-dynsec");
    // Anonymous clients may publish anywhere but subscribe only to
    // plant/allowed/#.
    let config = dir.join("dynsec.json");
    std::fs::write(
        &config,
        json!({
            "defaultACLAccess": {
                "publishClientSend": false, "publishClientReceive": true,
                "subscribe": false, "unsubscribe": true,
            },
            "clients": [],
            "groups": [{"groupname": "anon", "roles": [{"rolename": "r"}]}],
            "roles": [{"rolename": "r", "acls": [
                {"acltype": "publishClientSend", "topic": "#", "priority": 0, "allow": true},
                {"acltype": "subscribePattern", "topic": "plant/allowed/#", "priority": 0, "allow": true},
            ]}],
            "anonymousGroup": "anon",
        })
        .to_string(),
    )
    .unwrap();
    let broker = mosquitto(
        dir.clone(),
        &format!(
            "allow_anonymous true\nplugin {}\nplugin_opt_config_file {}\n",
            plugin.display(),
            config.display()
        ),
    )
    .await;
    retain(
        broker.port,
        None,
        &[
            ("plant/denied/y".into(), b"2".to_vec()),
            ("plant/allowed/x".into(), b"1".to_vec()),
        ],
    )
    .await;

    let (mut agent, _driver) = up(conf(broker.port, None), &[("1", "plant/allowed/x")]).await;
    start(
        &agent,
        json!({"seconds": 1, "filters": ["#", "plant/allowed/#"]}),
        limits(100, 8, 30, false),
    );
    let msgs = scan(&mut agent, secs(10)).await;
    let end = end_of(&msgs);
    assert_eq!(end["truncated"], true, "{end}");
    assert_eq!(end["reason"], "partial_access");
    assert_eq!(
        ids(&items_of(&msgs)),
        ["plant/", "plant/allowed/", "plant/allowed/x"]
    );

    start(&agent, json!({"seconds": 1}), limits(100, 8, 30, false));
    let msgs = scan(&mut agent, secs(10)).await;
    assert_eq!(error_code(&msgs), "AUTH");
}

#[tokio::test]
async fn the_caps_against_a_real_broker() {
    if !tools() {
        return;
    }
    let broker = mosquitto(temp_dir("scout-caps"), "allow_anonymous true").await;
    let mut msgs: Vec<(String, Vec<u8>)> = (0..20)
        .map(|i| (format!("cap/{i}"), b"1".to_vec()))
        .collect();
    msgs.push(("deep/a/b/c".into(), b"1".to_vec()));
    retain(broker.port, None, &msgs).await;
    let (mut agent, _driver) = up(conf(broker.port, None), &[("1", "x")]).await;

    start(
        &agent,
        json!({"seconds": 5, "filters": ["cap/#"]}),
        limits(5, 8, 30, false),
    );
    let t0 = std::time::Instant::now();
    let msgs = scan(&mut agent, secs(10)).await;
    assert!(
        t0.elapsed() < secs(4),
        "the scan kept listening after the cap"
    );
    assert_eq!(end_of(&msgs)["reason"], "items");
    assert_eq!(items_of(&msgs).len(), 5);

    start(
        &agent,
        json!({"seconds": 1, "filters": ["deep/#"]}),
        limits(100, 2, 30, false),
    );
    let msgs = scan(&mut agent, secs(10)).await;
    assert_eq!(end_of(&msgs)["reason"], "depth");
    let items = items_of(&msgs);
    assert_eq!(ids(&items), ["deep/", "deep/a/"]);
    assert_eq!(find(&items, "deep/a/")["more"], true);
}

#[tokio::test]
async fn a_retained_burst_of_10000_topics_keeps_its_json_leaves() {
    if !tools() {
        return;
    }
    let broker = mosquitto(temp_dir("scout-burst"), "allow_anonymous true").await;
    let msgs: Vec<(String, Vec<u8>)> = (0..10_000)
        .map(|i| {
            (
                format!("burst/{i}"),
                format!(r#"{{"v": {i}}}"#).into_bytes(),
            )
        })
        .collect();
    retain(broker.port, None, &msgs).await;
    let (mut agent, _driver) = up(conf(broker.port, None), &[("1", "x")]).await;

    start(
        &agent,
        json!({"seconds": 3, "filters": ["burst/#"]}),
        limits(50_000, 8, 60, false),
    );
    let msgs = scan(&mut agent, secs(60)).await;
    assert_eq!(end_of(&msgs)["truncated"], false);
    let items = items_of(&msgs);
    assert_eq!(items.len(), 1 + 2 * 10_000);
    for i in [0, 4_321, 9_999] {
        let t = find(&items, &format!("burst/{i}"));
        assert_eq!(t["detail"]["retained"], true);
        assert_eq!(t["detail"]["format"], "json");
        assert_eq!(find(&items, &format!("burst/{i}\0$.v"))["type"], "Int64");
    }
    let leaves = items.iter().filter(|i| i["path"] == "$.v").count();
    assert_eq!(leaves, 10_000);
}

#[tokio::test]
async fn a_live_flood_stops_payload_analysis() {
    if !tools() {
        return;
    }
    let broker = mosquitto(temp_dir("scout-flood"), "allow_anonymous true").await;
    let device = device(broker.port, None).await;
    let (mut agent, _driver) = up(conf(broker.port, None), &[("1", "x")]).await;
    start(
        &agent,
        json!({"seconds": 4, "filters": ["flood/#"]}),
        limits(1000, 8, 60, false),
    );
    // Let the scan subscribe.
    tokio::time::sleep(ms(1500)).await;
    let before = r#"{"early": 1}"#;
    device
        .publish("flood/early", QoS::AtMostOnce, false, before)
        .await
        .unwrap();
    for _ in 0..30_000 {
        device
            .publish("flood/a", QoS::AtMostOnce, false, "1")
            .await
            .unwrap();
    }
    device
        .publish("flood/late", QoS::AtMostOnce, false, r#"{"x": 1}"#)
        .await
        .unwrap();
    let msgs = scan(&mut agent, secs(20)).await;
    let items = items_of(&msgs);
    // Topics are still recorded, but payloads after the flood are not
    // inspected.
    assert!(has(&items, "flood/early\0$.early"));
    let late = find(&items, "flood/late");
    assert!(late["detail"].get("format").is_none(), "{late}");
    assert!(!has(&items, "flood/late\0$.x"));
    assert!(find(&items, "flood/a")["detail"]["count"].as_u64().unwrap() > 5_000);
}

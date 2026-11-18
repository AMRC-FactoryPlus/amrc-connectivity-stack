// ACS OPC UA driver
// The whole driver against a real OPC UA server
// Copyright 2026 University of Sheffield

//! The driver end to end: a fake Edge Agent on one side (the one
//! `rs-edge-driver` tests itself with) and a node-opcua server on the
//! other (`tests/server/server.cjs`), covering what the golden-output
//! harness can't: every security mode and policy, credentials, the
//! values of every OPC UA type, typed writes of every Sparkplug type
//! with their answers, and reconnecting after the server restarts.
//!
//! These need Node.js and acs-edge's `node_modules`, so they only run
//! when `EDGE_OPCUA_SERVER_TESTS` is set, as the edge-opcua CI job
//! sets it. Run them from the repository with:
//!
//! ```sh
//! (cd acs-edge && npm install --save=false --install-links)
//! cd edge-opcua && EDGE_OPCUA_SERVER_TESTS=1 cargo test --test opcua
//! ```

mod support;

use serde_json::json;
use support::*;

use edge_opcua::OpcuaHandler;

#[tokio::test(flavor = "multi_thread")]
async fn every_security_mode_and_policy_with_and_without_credentials() {
    if !enabled() {
        return;
    }
    let server = Server::start().await;
    let mut cases = vec![("None", "None")];
    for mode in ["Sign", "SignAndEncrypt"] {
        for policy in [
            "Basic128Rsa15",
            "Basic256",
            "Basic256Sha256",
            "Aes128_Sha256",
            "Aes128_Sha256_RsaOaep",
            "Aes256_Sha256_RsaPss",
        ] {
            cases.push((mode, policy));
        }
    }
    for (mode, policy) in cases {
        for user in [None, Some(("test", "testpass"))] {
            eprintln!("case: {mode} {policy} {user:?}");
            let (mut agent, _driver) =
                driver(conf(&server, mode, policy, user), &[node("Double")]).await;
            let v = values(&mut agent, &["t0"], secs(10)).await;
            assert_eq!(v["t0"], json!(2.2), "{mode} {policy} {user:?}");
        }
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_wrong_password_is_auth() {
    if !enabled() {
        return;
    }
    let server = Server::start().await;
    let mut agent = FakeAgent::start("OPCUA").await;
    let _driver = spawn_driver::<OpcuaHandler>(agent.config());
    agent.wait_status("READY", secs(5)).await;
    let c = conf(
        &server,
        "SignAndEncrypt",
        "Basic256Sha256",
        Some(("test", "wrong")),
    );
    agent.send("conf", c.to_string());
    agent.send("addr", addr_packet(&[node("Double")]));
    agent.wait_status("AUTH", secs(40)).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn values_of_every_type() {
    if !enabled() {
        return;
    }
    let server = Server::start().await;
    let expect = [
        ("Boolean", json!(true)),
        ("SByte", json!(-5)),
        ("Byte", json!(200)),
        ("Int16", json!(-300)),
        ("UInt16", json!(60000)),
        ("Int32", json!(-70000)),
        ("UInt32", json!(4000000000u32)),
        ("Int64", json!(i64::MAX)),
        ("UInt64", json!(u64::MAX - 1)),
        // A Float widened to a double, as node-opcua gives it.
        ("Float", json!(1.100000023841858)),
        ("Double", json!(2.2)),
        ("String", json!("hello")),
        ("DateTime", json!(1763380800123i64)),
        ("Guid", json!("72962B91-FA75-4AE6-8D28-B404DC7DAF63")),
        ("ByteString", json!({ "type": "Buffer", "data": [1, 2, 3] })),
        ("LocalizedText", json!({ "locale": "en", "text": "txt" })),
        ("DoubleArray", json!([1.5, 2.5])),
        // Sent whatever its status, as the built-in did.
        ("Bad", json!(3.0)),
    ];
    let nodes: Vec<String> = expect.iter().map(|(n, _)| node(n)).collect();
    let (mut agent, _driver) = driver(conf(&server, "None", "None", None), &nodes).await;
    let topics: Vec<String> = (0..nodes.len()).map(|i| format!("t{i}")).collect();
    let topics: Vec<&str> = topics.iter().map(|s| s.as_str()).collect();
    let got = values(&mut agent, &topics, secs(10)).await;
    for (i, (name, want)) in expect.iter().enumerate() {
        assert_eq!(&got[&format!("t{i}")], want, "{name}");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn writes_of_every_type_are_answered_and_reported() {
    if !enabled() {
        return;
    }
    let server = Server::start().await;
    // Sparkplug type, value as the agent sends it, the node of the
    // OPC UA type the built-in wrote it as, and the value the
    // subscription then reports.
    let cases = [
        ("Boolean", json!(false), "Boolean", json!(false)),
        ("Int8", json!(-128), "SByte", json!(-128)),
        ("Int16", json!(-32768), "Int16", json!(-32768)),
        (
            "Int32",
            json!(-2147483648i64),
            "Int32",
            json!(-2147483648i64),
        ),
        (
            "Int64",
            json!("-9223372036854775808"),
            "Int64",
            json!(i64::MIN),
        ),
        ("UInt8", json!(255), "Byte", json!(255)),
        ("UInt16", json!(65535), "UInt16", json!(65535)),
        (
            "UInt32",
            json!(4294967295u32),
            "UInt32",
            json!(4294967295u32),
        ),
        (
            "UInt64",
            json!("18446744073709551615"),
            "UInt64",
            json!(u64::MAX),
        ),
        ("Float", json!(0.5), "Float", json!(0.5)),
        ("Double", json!("-Infinity"), "Double", json!("-Infinity")),
        ("String", json!("written ✓"), "String", json!("written ✓")),
        (
            "UUID",
            json!("0a1b2c3d-0000-4000-8000-000000000001"),
            "Guid",
            json!("0A1B2C3D-0000-4000-8000-000000000001"),
        ),
        (
            "DateTime",
            json!(1763380800456i64),
            "DateTime",
            json!(1763380800456i64),
        ),
    ];
    let mut nodes: Vec<String> = cases.iter().map(|c| node(c.2)).collect();
    nodes.dedup();
    nodes.extend([node("ReadOnly"), node("Nope")]);
    let (mut agent, _driver) = driver(
        conf(
            &server,
            "SignAndEncrypt",
            "Basic256Sha256",
            Some(("test", "testpass")),
        ),
        &nodes,
    )
    .await;
    // Let the starting values arrive first.
    values(&mut agent, &["t0"], secs(10)).await;

    for (ty, value, n, reported) in &cases {
        let answer = write(&mut agent, &node(n), ty, value.clone()).await;
        assert_eq!(answer, "", "write of {ty} {value} to {n}");
        let topic = format!("t{}", nodes.iter().position(|x| *x == node(n)).unwrap());
        wait_value(&mut agent, &topic, reported).await;
    }

    // Text goes to a String node too.
    assert_eq!(
        write(&mut agent, &node("String"), "Text", json!("text")).await,
        ""
    );

    let ro = write(&mut agent, &node("ReadOnly"), "Double", json!(1.0)).await;
    assert!(ro.starts_with("RO\n"), "{ro:?}");
    let mismatch = write(&mut agent, &node("Int16"), "Double", json!(1.0)).await;
    assert!(mismatch.starts_with("CMD\n"), "{mismatch:?}");
    let unknown = write(&mut agent, &node("Nope"), "Double", json!(1.0)).await;
    assert!(unknown.starts_with("ERR\n"), "{unknown:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_bad_address_does_not_stop_the_others() {
    if !enabled() {
        return;
    }
    let server = Server::start().await;
    let nodes = ["not a node id".to_string(), node("Nope"), node("Double")];
    let (mut agent, _driver) = driver(conf(&server, "None", "None", None), &nodes).await;
    let v = values(&mut agent, &["t2"], secs(10)).await;
    assert_eq!(v["t2"], json!(2.2));
    let answer = write(&mut agent, "not a node id", "Double", json!(1.0)).await;
    assert!(answer.starts_with("CMD\n"), "{answer:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn reconnects_after_the_server_restarts() {
    if !enabled() {
        return;
    }
    let mut server = Server::start().await;
    let nodes = [node("Counter"), node("Int32")];
    let (mut agent, _driver) = driver(
        conf(
            &server,
            "SignAndEncrypt",
            "Basic256Sha256",
            Some(("test", "testpass")),
        ),
        &nodes,
    )
    .await;
    values(&mut agent, &["t0"], secs(10)).await;

    server.stop().await;
    agent.wait_status("CONN", secs(30)).await;

    server.run().await;
    agent.wait_status("UP", secs(60)).await;
    // The subscription is back: the new server's counter starts again
    // from 0, so a small value proves it is the new one.
    let deadline = tokio::time::Instant::now() + secs(20);
    loop {
        let v = values(&mut agent, &["t0"], secs(20)).await;
        if v["t0"].as_u64().unwrap() < 300 {
            break;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "old counter values only"
        );
    }
    assert_eq!(
        write(&mut agent, &node("Int32"), "Int32", json!(7)).await,
        ""
    );
    wait_value(&mut agent, "t1", &json!(7)).await;
}

/// A server that comes back with a new certificate (renewed,
/// reinstalled or replaced) is connected to again without a driver
/// restart. async-opcua reconnects with the endpoint the driver found
/// at start, which holds the old certificate, so every attempt failed
/// until the pod was restarted. The driver now asks the server for its
/// endpoints again once reconnecting keeps failing.
#[tokio::test(flavor = "multi_thread")]
async fn reconnects_to_a_server_with_a_new_certificate() {
    if !enabled() {
        return;
    }
    let mut server = Server::start().await;
    let nodes = [node("Counter"), node("Int32")];
    let (mut agent, _driver) = driver(
        conf(&server, "SignAndEncrypt", "Basic256Sha256", None),
        &nodes,
    )
    .await;
    values(&mut agent, &["t0"], secs(10)).await;

    let old = server.certificate();
    server.reinstall().await;
    assert_ne!(server.certificate(), old, "the server kept its certificate");
    agent.wait_status("CONN", secs(30)).await;

    agent.wait_status("UP", secs(90)).await;
    let deadline = tokio::time::Instant::now() + secs(20);
    loop {
        let v = values(&mut agent, &["t0"], secs(20)).await;
        if v["t0"].as_u64().unwrap() < 300 {
            break;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "old counter values only"
        );
    }
    assert_eq!(
        write(&mut agent, &node("Int32"), "Int32", json!(7)).await,
        ""
    );
    wait_value(&mut agent, "t1", &json!(7)).await;
}

/// Two devices with different poll intervals get a subscription each,
/// and each device's values reach its own data topic. The built-in
/// connection read every subscription's notifications through the last
/// device's subscription, whose monitored items are also numbered from
/// 1, so on a connection with several devices all but the last device
/// got nothing and the last one got their values.
#[tokio::test(flavor = "multi_thread")]
async fn each_device_gets_its_own_values() {
    if !enabled() {
        return;
    }
    let server = Server::start().await;
    let mut agent = FakeAgent::start("OPCUA").await;
    let _driver = spawn_driver::<OpcuaHandler>(agent.config());
    agent.wait_status("READY", secs(5)).await;
    agent.send("conf", conf(&server, "None", "None", None).to_string());
    agent.send(
        "addr",
        json!({
            "version": 1,
            "addrs": {
                "a": node("Double"), "b": node("Int16"),
                "c": node("String"), "d": node("Boolean"),
            },
            "groups": {
                "First": { "poll": 100, "addrs": ["a", "b"] },
                "Second": { "poll": 250, "addrs": ["c", "d"] },
                "Third": { "poll": 500, "addrs": ["d"] },
            },
        })
        .to_string(),
    );
    agent.wait_status("UP", secs(30)).await;
    let v = values(&mut agent, &["a", "b", "c", "d"], secs(10)).await;
    assert_eq!(v["a"], json!(2.2));
    assert_eq!(v["b"], json!(-300));
    assert_eq!(v["c"], json!("hello"));
    assert_eq!(v["d"], json!(true));
}

/// A value that changes while the connection is down, and then stays
/// still, is reported once the driver is back. After a short drop
/// async-opcua has the session back within a second or so and the
/// server sends the change at once, while the driver library is still
/// waiting out its reconnect delay and drops data. Nothing sent it
/// again, so the metric kept its old value until it next changed.
#[tokio::test(flavor = "multi_thread")]
async fn a_value_changed_during_a_short_drop_is_reported() {
    if !enabled() {
        return;
    }
    let server = Server::start().await;
    let proxy = Proxy::start(server.port).await;
    let mut c = conf(&server, "None", "None", None);
    c["endpoint"] = json!(proxy.url());
    let (mut agent, _driver) = driver(c, &[node("Step")]).await;
    wait_value(&mut agent, "t0", &json!(0)).await;

    proxy.cut();
    server.signal("USR2");
    agent.wait_status("CONN", secs(30)).await;
    agent.wait_status("UP", secs(60)).await;
    wait_value(&mut agent, "t0", &json!(1)).await;
}

/// A node the server doesn't have yet, as on a PLC whose program loads
/// after its OPC UA server starts, is monitored once it appears, while
/// the rest of the connection works meanwhile.
#[tokio::test(flavor = "multi_thread")]
async fn an_address_the_server_refuses_is_retried() {
    if !enabled() {
        return;
    }
    let server = Server::start_with(&[("LATE_MS", "3000")]).await;
    let nodes = [node("Double"), node("Late")];
    let (mut agent, _driver) = driver(conf(&server, "None", "None", None), &nodes).await;
    let v = values(&mut agent, &["t0"], secs(10)).await;
    assert_eq!(v["t0"], json!(2.2));
    let v = values(&mut agent, &["t1"], secs(30)).await;
    assert_eq!(v["t1"], json!(42));
}

/// A server with a low MaxMonitoredItemsPerCall gets its items in
/// requests that size, and one that allows a single subscription gets
/// one: the other interval is refused and retried, the first works, and
/// the connection stays `UP` rather than failing and starting again.
#[tokio::test(flavor = "multi_thread")]
async fn low_server_limits_do_not_take_the_connection_down() {
    if !enabled() {
        return;
    }
    let server = Server::start_with(&[("ITEMS_PER_CALL", "3"), ("SUBS_PER_SESSION", "1")]).await;
    let names = [
        "Boolean", "SByte", "Byte", "Int16", "UInt16", "Int32", "UInt32", "Double",
    ];
    let mut agent = FakeAgent::start("OPCUA").await;
    let _driver = spawn_driver::<OpcuaHandler>(agent.config());
    agent.wait_status("READY", secs(5)).await;
    agent.send("conf", conf(&server, "None", "None", None).to_string());
    let mut addrs = serde_json::Map::new();
    for (i, n) in names.iter().enumerate() {
        addrs.insert(format!("t{i}"), json!(node(n)));
    }
    addrs.insert("slow".into(), json!(node("String")));
    let fast: Vec<String> = (0..names.len()).map(|i| format!("t{i}")).collect();
    agent.send(
        "addr",
        json!({
            "version": 1,
            "addrs": addrs,
            "groups": {
                "Fast": { "poll": 100, "addrs": fast },
                "Slow": { "poll": 500, "addrs": ["slow"] },
            },
        })
        .to_string(),
    );
    agent.wait_status("UP", secs(30)).await;
    let topics: Vec<&str> = fast.iter().map(|s| s.as_str()).collect();
    let v = values(&mut agent, &topics, secs(10)).await;
    assert_eq!(v["t7"], json!(2.2));
    // No status change for a while: it neither failed nor restarted.
    for ev in agent.drain(secs(8)).await {
        assert!(
            !matches!(ev, FromDriver::Status(_)),
            "status changed: {ev:?}"
        );
    }
}

/// While the agent can't keep up, the driver drops values rather than
/// queueing them without limit, counts them, and carries on once the
/// agent catches up.
#[tokio::test(flavor = "multi_thread")]
async fn a_stalled_agent_does_not_grow_the_driver() {
    if !enabled() {
        return;
    }
    use std::sync::atomic::Ordering;

    // 200 values of 1 KB ten times a second, 2 MB/s, so the socket
    // buffers between driver and agent fill within seconds.
    let server = Server::start_with(&[("BULK", "200"), ("BULK_BYTES", "1000")]).await;
    let nodes: Vec<String> = (0..200).map(|i| format!("ns=1;s=B/{i}")).collect();
    let mut agent = FakeAgent::start("OPCUA").await;
    let mut options = rs_edge_driver::DriverOptions::default();
    // Room for about two notifications of 200 values, so the queue
    // only fills when the agent stalls.
    options.publish_queue_bytes = 512 * 1024;
    let _driver = spawn_driver_with::<OpcuaHandler>(agent.config(), options);
    agent.wait_status("READY", secs(5)).await;
    agent.send("conf", conf(&server, "None", "None", None).to_string());
    agent.send("addr", addr_packet(&nodes));
    agent.wait_status("UP", secs(30)).await;
    values(&mut agent, &["t0"], secs(10)).await;

    let before = edge_opcua::dropped_total();
    agent.stats.read_delay_ms.store(500, Ordering::SeqCst);
    tokio::time::sleep(secs(10)).await;
    agent.stats.read_delay_ms.store(0, Ordering::SeqCst);
    assert!(
        edge_opcua::dropped_total() > before,
        "nothing was dropped while the agent was stalled"
    );

    // Back to normal: once the agent has read what was already sent
    // (the socket buffers hold a few seconds of it), fresh values
    // arrive for every address again.
    let v = values(&mut agent, &["t199"], secs(60)).await;
    assert!(v["t199"].as_str().unwrap().len() == 1000);
}

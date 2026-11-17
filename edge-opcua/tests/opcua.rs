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

#[path = "../../lib/rs-edge-driver/tests/common/mod.rs"]
mod common;

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use common::{FakeAgent, FromDriver, RunningDriver, secs, spawn_driver};
use edge_opcua::OpcuaHandler;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};

fn enabled() -> bool {
    let on = std::env::var_os("EDGE_OPCUA_SERVER_TESTS").is_some();
    if !on {
        eprintln!("skipped: set EDGE_OPCUA_SERVER_TESTS to run against a node-opcua server");
    }
    on
}

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

/// A node-opcua server process. It keeps its PKI directory across a
/// restart, so it comes back with the same certificate.
struct Server {
    port: u16,
    pki: PathBuf,
    child: Option<Child>,
}

impl Server {
    async fn start() -> Self {
        let port = free_port();
        let pki = std::env::temp_dir().join(format!("edge-opcua-test-{port}"));
        let mut s = Self {
            port,
            pki,
            child: None,
        };
        s.run().await;
        s
    }

    async fn run(&mut self) {
        let mut child = Command::new("node")
            .arg(repo().join("edge-opcua/tests/server/server.cjs"))
            .arg(self.port.to_string())
            .arg(&self.pki)
            .env("NODE_PATH", repo().join("acs-edge/node_modules"))
            .stdout(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .expect("can't run node");
        let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
        let ready = tokio::time::timeout(secs(60), async {
            while let Ok(Some(line)) = lines.next_line().await {
                if line.trim() == "READY" {
                    return true;
                }
            }
            false
        })
        .await;
        assert!(
            matches!(ready, Ok(true)),
            "the node-opcua server did not start"
        );
        // Keep reading so the server never blocks on a full pipe.
        tokio::spawn(async move { while let Ok(Some(_)) = lines.next_line().await {} });
        self.child = Some(child);
    }

    async fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
    }

    fn url(&self) -> String {
        format!("opc.tcp://127.0.0.1:{}", self.port)
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.pki);
    }
}

fn node(name: &str) -> String {
    format!("ns=1;s=T/{name}")
}

/// The connection details as the agent sends them in `conf`.
fn conf(server: &Server, mode: &str, policy: &str, user: Option<(&str, &str)>) -> Value {
    json!({
        "endpoint": server.url(),
        "securityMode": mode,
        "securityPolicy": policy,
        "useCredentials": user.is_some(),
        "username": user.map(|u| u.0).unwrap_or(""),
        "password": user.map(|u| u.1).unwrap_or(""),
    })
}

/// An address map in the agent's format: data topic `t<i>` for the
/// i-th node, all in one device polled every 100 ms.
fn addr_packet(nodes: &[String]) -> String {
    let addrs: serde_json::Map<String, Value> = nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (format!("t{i}"), json!(n)))
        .collect();
    let topics: Vec<String> = (0..nodes.len()).map(|i| format!("t{i}")).collect();
    json!({
        "version": 1,
        "addrs": addrs,
        "groups": { "Device": { "poll": 100, "addrs": topics } },
    })
    .to_string()
}

/// Start a driver against `server` and wait for it to be UP with
/// `nodes` as its addresses.
async fn driver(conf: Value, nodes: &[String]) -> (FakeAgent, RunningDriver) {
    let mut agent = FakeAgent::start("OPCUA").await;
    let driver = spawn_driver::<OpcuaHandler>(agent.config());
    agent.wait_status("READY", secs(5)).await;
    agent.send("conf", conf.to_string());
    agent.send("addr", addr_packet(nodes));
    agent.wait_status("UP", secs(30)).await;
    (agent, driver)
}

/// Collect data until every topic in `topics` has a value, and return
/// the latest `value` for each. The packets must be `{"value",
/// "timestamp"}` with a timestamp in milliseconds.
async fn values(
    agent: &mut FakeAgent,
    topics: &[&str],
    within: Duration,
) -> HashMap<String, Value> {
    let deadline = tokio::time::Instant::now() + within;
    let mut out = HashMap::new();
    while topics.iter().any(|t| !out.contains_key(*t)) {
        let left = deadline.saturating_duration_since(tokio::time::Instant::now());
        match agent.next(left).await {
            Some(FromDriver::Data { topic, payload }) => {
                let p: Value = serde_json::from_slice(&payload).unwrap();
                assert!(p["timestamp"].as_i64().unwrap() > 1_700_000_000_000, "{p}");
                out.insert(topic, p["value"].clone());
            }
            Some(_) => {}
            None => panic!("no data for all of {topics:?} within {within:?}: have {out:?}"),
        }
    }
    out
}

/// Wait for the data topic to report `want`.
async fn wait_value(agent: &mut FakeAgent, topic: &str, want: &Value) {
    let deadline = tokio::time::Instant::now() + secs(10);
    loop {
        let left = deadline.saturating_duration_since(tokio::time::Instant::now());
        match agent.next(left).await {
            Some(FromDriver::Data { topic: t, payload }) if t == topic => {
                let p: Value = serde_json::from_slice(&payload).unwrap();
                if &p["value"] == want {
                    return;
                }
            }
            Some(_) => {}
            None => panic!("{topic} never reported {want}"),
        }
    }
}

/// Send a typed write with an id, as an agent that waits for answers
/// does, and return the answer.
async fn write(agent: &mut FakeAgent, address: &str, ty: &str, value: Value) -> String {
    let id = format!("w{}", rand_id());
    agent.send(
        &format!("write/{address}"),
        json!({ "type": ty, "value": value, "id": id }).to_string(),
    );
    let want = format!("fpEdge1/OPCUA/result/{id}");
    let deadline = tokio::time::Instant::now() + secs(15);
    loop {
        let left = deadline.saturating_duration_since(tokio::time::Instant::now());
        match agent.next(left).await {
            Some(FromDriver::Other { topic, payload }) if topic == want => {
                return String::from_utf8(payload.to_vec()).unwrap();
            }
            Some(_) => {}
            None => panic!("no answer to the write of {ty} to {address}"),
        }
    }
}

fn rand_id() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(0);
    N.fetch_add(1, Ordering::Relaxed)
}

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

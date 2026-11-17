// ACS OPC UA driver
// Test support: a node-opcua server and a fake Edge Agent
// Copyright 2026 University of Sheffield

#![allow(dead_code)]

#[path = "../../../lib/rs-edge-driver/tests/common/mod.rs"]
pub mod common;

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

#[allow(unused_imports)]
pub use common::{FakeAgent, FromDriver, RunningDriver, ms, secs, spawn_driver, spawn_driver_with};
use edge_opcua::OpcuaHandler;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};

pub fn enabled() -> bool {
    let on = std::env::var_os("EDGE_OPCUA_SERVER_TESTS").is_some();
    if !on {
        eprintln!("skipped: set EDGE_OPCUA_SERVER_TESTS to run against a node-opcua server");
    }
    on
}

pub fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

pub fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

/// A node-opcua server process. It keeps its PKI directory across a
/// restart, so it comes back with the same certificate.
pub struct Server {
    pub port: u16,
    pki: PathBuf,
    env: Vec<(String, String)>,
    child: Option<Child>,
}

impl Server {
    pub async fn start() -> Self {
        Self::start_with(&[]).await
    }

    /// A server with settings from the environment (see server.cjs).
    pub async fn start_with(env: &[(&str, &str)]) -> Self {
        let port = free_port();
        let pki = std::env::temp_dir().join(format!("edge-opcua-test-{port}"));
        let mut s = Self {
            port,
            pki,
            env: env
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            child: None,
        };
        s.run().await;
        s
    }

    pub async fn run(&mut self) {
        let mut child = Command::new("node")
            .arg(repo().join("edge-opcua/tests/server/server.cjs"))
            .arg(self.port.to_string())
            .arg(&self.pki)
            .env("NODE_PATH", repo().join("acs-edge/node_modules"))
            .envs(self.env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
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

    pub async fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
    }

    /// Send the server a signal (SIGUSR2 steps ns=1;s=T/Step).
    pub fn signal(&self, sig: &str) {
        let pid = self
            .child
            .as_ref()
            .and_then(|c| c.id())
            .expect("server running");
        let ok = std::process::Command::new("kill")
            .args([&format!("-{sig}"), &pid.to_string()])
            .status()
            .expect("can't run kill")
            .success();
        assert!(ok, "kill -{sig} failed");
    }

    pub fn url(&self) -> String {
        format!("opc.tcp://127.0.0.1:{}", self.port)
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.pki);
    }
}

pub fn node(name: &str) -> String {
    format!("ns=1;s=T/{name}")
}

/// The connection details as the agent sends them in `conf`.
pub fn conf(server: &Server, mode: &str, policy: &str, user: Option<(&str, &str)>) -> Value {
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
pub fn addr_packet(nodes: &[String]) -> String {
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
pub async fn driver(conf: Value, nodes: &[String]) -> (FakeAgent, RunningDriver) {
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
pub async fn values(
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
pub async fn wait_value(agent: &mut FakeAgent, topic: &str, want: &Value) {
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
pub async fn write(agent: &mut FakeAgent, address: &str, ty: &str, value: Value) -> String {
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

pub fn rand_id() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(0);
    N.fetch_add(1, Ordering::Relaxed)
}

/// A TCP proxy in front of a server that can drop every connection
/// through it, as a network blip does, while the server stays up.
pub struct Proxy {
    pub port: u16,
    conns: std::sync::Arc<std::sync::Mutex<Vec<tokio::task::JoinHandle<()>>>>,
    accept: tokio::task::JoinHandle<()>,
}

impl Proxy {
    pub async fn start(to: u16) -> Self {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let conns: std::sync::Arc<std::sync::Mutex<Vec<tokio::task::JoinHandle<()>>>> =
            Default::default();
        let list = conns.clone();
        let accept = tokio::spawn(async move {
            while let Ok((mut down, _)) = listener.accept().await {
                let task = tokio::spawn(async move {
                    if let Ok(mut up) = tokio::net::TcpStream::connect(("127.0.0.1", to)).await {
                        let _ = tokio::io::copy_bidirectional(&mut down, &mut up).await;
                    }
                });
                list.lock().unwrap().push(task);
            }
        });
        Self {
            port,
            conns,
            accept,
        }
    }

    /// Drop every connection through the proxy. New ones still work.
    pub fn cut(&self) {
        for t in self.conns.lock().unwrap().drain(..) {
            t.abort();
        }
    }

    pub fn url(&self) -> String {
        format!("opc.tcp://127.0.0.1:{}", self.port)
    }
}

impl Drop for Proxy {
    fn drop(&mut self) {
        self.cut();
        self.accept.abort();
    }
}

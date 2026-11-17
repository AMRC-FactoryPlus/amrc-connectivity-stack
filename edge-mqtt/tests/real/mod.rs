// ACS MQTT driver
// A real mosquitto broker for the driver tests
// Copyright 2026 University of Sheffield

//! Runs mosquitto as the device's broker. The tests that use it need
//! `mosquitto`, `mosquitto_passwd` and `openssl` on the PATH, and are
//! skipped with a note when those are missing, unless
//! `EDGE_MQTT_MOSQUITTO=1` is set, which CI does, and then they fail.

#![allow(dead_code)]

use super::common::{self, FakeAgent, secs, spawn_driver};

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use edge_mqtt::MqttHandler;
use rumqttc::{AsyncClient, MqttOptions};

/// A mosquitto process, killed when dropped.
pub struct Mosquitto {
    child: Child,
    pub dir: PathBuf,
    pub port: u16,
}

impl Drop for Mosquitto {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

pub fn have(tool: &str) -> bool {
    Command::new("sh")
        .args(["-c", &format!("command -v {tool}")])
        .stdout(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

/// Whether the tools are here. Panics if CI asked for them and they
/// are not.
pub fn tools() -> bool {
    let ok = ["mosquitto", "mosquitto_passwd", "openssl"]
        .iter()
        .all(|t| have(t));
    if !ok {
        assert!(
            std::env::var("EDGE_MQTT_MOSQUITTO").is_err(),
            "EDGE_MQTT_MOSQUITTO is set but mosquitto, mosquitto_passwd or openssl is missing"
        );
        eprintln!("mosquitto tests skipped: mosquitto, mosquitto_passwd or openssl not found");
    }
    ok
}

pub fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

pub fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "edge-mqtt-{name}-{}-{}",
        std::process::id(),
        free_port()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

pub fn run(cmd: &mut Command) {
    let out = cmd.output().unwrap();
    assert!(
        out.status.success(),
        "{cmd:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

/// Start mosquitto with `extra` added to a one-listener config.
pub async fn mosquitto(dir: PathBuf, extra: &str) -> Mosquitto {
    let port = free_port();
    let conf = dir.join("mosquitto.conf");
    std::fs::write(
        &conf,
        // Run as root, mosquitto switches to its own user, which can't
        // read our files. It only switches when it is root, so `user
        // root` keeps it as it is either way.
        format!(
            "listener {port} 127.0.0.1\npersistence false\nlog_dest stderr\nuser root\n{extra}\n"
        ),
    )
    .unwrap();
    let child = Command::new("mosquitto")
        .arg("-c")
        .arg(&conf)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let broker = Mosquitto { child, dir, port };
    for _ in 0..100 {
        if tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .is_ok()
        {
            return broker;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    // Dropping the broker stops the process.
    drop(broker);
    panic!("mosquitto did not start");
}

/// A client that publishes to the broker, as a device would.
pub async fn device(port: u16, login: Option<(&str, &str)>) -> AsyncClient {
    let mut opts = MqttOptions::new("device", "127.0.0.1", port);
    if let Some((u, p)) = login {
        opts.set_credentials(u, p);
    }
    opts.set_max_packet_size(1 << 24, 1 << 24);
    let (client, mut eventloop) = AsyncClient::new(opts, 1000);
    tokio::spawn(async move { while eventloop.poll().await.is_ok() {} });
    client
}

pub async fn driver_up(
    conf: serde_json::Value,
    addrs: &[(&str, &str)],
) -> (FakeAgent, common::RunningDriver) {
    let mut agent = FakeAgent::start("MQTT").await;
    let driver = spawn_driver::<MqttHandler>(agent.config());
    agent.handshake(conf, addrs).await;
    agent.wait_status("UP", secs(5)).await;
    (agent, driver)
}

/// Make a CA and a server certificate for 127.0.0.1 signed by it.
pub fn certificates(dir: &std::path::Path) {
    let ossl = |args: &[&str]| run(Command::new("openssl").current_dir(dir).args(args));
    ossl(&[
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=edge-mqtt test CA",
        "-keyout",
        "ca.key",
        "-out",
        "ca.crt",
    ]);
    ossl(&[
        "req",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-subj",
        "/CN=127.0.0.1",
        "-keyout",
        "server.key",
        "-out",
        "server.csr",
    ]);
    std::fs::write(dir.join("ext.cnf"), "subjectAltName=IP:127.0.0.1\n").unwrap();
    ossl(&[
        "x509",
        "-req",
        "-in",
        "server.csr",
        "-CA",
        "ca.crt",
        "-CAkey",
        "ca.key",
        "-CAcreateserial",
        "-days",
        "1",
        "-extfile",
        "ext.cnf",
        "-out",
        "server.crt",
    ]);
}

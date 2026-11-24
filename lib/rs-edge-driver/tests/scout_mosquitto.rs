//! The scouting feature gate against a real broker. mosquitto plays
//! the Edge Agent's broker with an ACL file: first with scouting, then,
//! after a restart, with the ACL of an Edge Agent from before v6.8.0,
//! as after a rollback. The driver must subscribe to `scout` on the
//! first session and never ask for it on the second.
//!
//! mosquitto answers a refused subscription with a failure code
//! instead of dropping the client, as the Edge Agent's broker does, so
//! the test reads mosquitto's log to see what the driver asked for.
//! `tests/scout.rs` covers the dropping with the fake agent.
//!
//! The test needs `mosquitto` on the PATH, and is skipped with a note
//! when it is missing, unless `RS_EDGE_DRIVER_MOSQUITTO=1` is set, and
//! then it fails.

mod common;

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use common::handler::{Ctl, FakeHandler};
use common::{ms, secs, spawn_driver};
use rs_edge_driver::DriverConfig;
use rumqttc::{AsyncClient, Event, Incoming, MqttOptions, QoS};
use serde_json::{Value, json};
use tokio::sync::mpsc;
use tokio::time::Instant;

struct Mosquitto {
    child: Child,
}

impl Drop for Mosquitto {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn have_mosquitto() -> bool {
    let ok = Command::new("sh")
        .args(["-c", "command -v mosquitto"])
        .stdout(Stdio::null())
        .status()
        .is_ok_and(|s| s.success());
    if !ok {
        assert!(
            std::env::var("RS_EDGE_DRIVER_MOSQUITTO").is_err(),
            "RS_EDGE_DRIVER_MOSQUITTO is set but mosquitto is missing"
        );
        eprintln!("mosquitto test skipped: mosquitto not found");
    }
    ok
}

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

/// The Edge Agent's ACL for driver `Conn`, as mosquitto ACL lines.
fn acl(scout: bool) -> String {
    let mut lines = vec![
        "user agent",
        "topic readwrite #",
        "user Conn",
        "topic write fpEdge1/Conn/status",
        "topic write fpEdge1/Conn/data/+",
        "topic write fpEdge1/Conn/err/+",
        "topic read fpEdge1/Conn/active",
        "topic read fpEdge1/Conn/conf",
        "topic read fpEdge1/Conn/addr",
        "topic read fpEdge1/Conn/cmd/#",
        "topic read fpEdge1/Conn/poll",
    ];
    if scout {
        lines.extend([
            "topic write fpEdge1/Conn/found/+",
            "topic read fpEdge1/Conn/scout",
        ]);
    }
    lines.join("\n") + "\n"
}

async fn start_mosquitto(dir: &Path, name: &str, port: u16, scout: bool) -> (Mosquitto, PathBuf) {
    let acl_file = dir.join(format!("{name}.acl"));
    let log = dir.join(format!("{name}.log"));
    let conf = dir.join(format!("{name}.conf"));
    std::fs::write(&acl_file, acl(scout)).unwrap();
    std::fs::write(
        &conf,
        format!(
            "listener {port} 127.0.0.1\nallow_anonymous true\nacl_file {}\n\
             log_dest file {}\nlog_type all\npersistence false\nuser root\n",
            acl_file.display(),
            log.display()
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
    let broker = Mosquitto { child };
    for _ in 0..100 {
        if tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .is_ok()
        {
            return (broker, log);
        }
        tokio::time::sleep(ms(50)).await;
    }
    panic!("mosquitto did not start");
}

/// The agent's side: a client that sees everything under
/// `fpEdge1/Conn/` and can publish anywhere.
struct Agent {
    client: AsyncClient,
    rx: mpsc::UnboundedReceiver<(String, Vec<u8>)>,
}

impl Agent {
    fn start(port: u16) -> Self {
        let mut opts = MqttOptions::new("agent", "127.0.0.1", port);
        opts.set_credentials("agent", "x");
        let (client, mut eventloop) = AsyncClient::new(opts, 100);
        let (tx, rx) = mpsc::unbounded_channel();
        let sub = client.clone();
        tokio::spawn(async move {
            loop {
                match eventloop.poll().await {
                    Ok(Event::Incoming(Incoming::ConnAck(_))) => {
                        let _ = sub.try_subscribe("fpEdge1/Conn/#", QoS::AtMostOnce);
                    }
                    Ok(Event::Incoming(Incoming::Publish(p))) => {
                        let _ = tx.send((p.topic, p.payload.to_vec()));
                    }
                    Ok(_) => {}
                    Err(_) => tokio::time::sleep(ms(100)).await,
                }
            }
        });
        Self { client, rx }
    }

    async fn send(&self, msg: &str, payload: impl Into<Vec<u8>>) {
        self.client
            .publish(
                format!("fpEdge1/Conn/{msg}"),
                QoS::AtMostOnce,
                false,
                payload,
            )
            .await
            .unwrap();
    }

    /// Wait for a message on `fpEdge1/Conn/<msg>` with `payload`, or
    /// any payload if `None`.
    async fn wait(&mut self, msg: &str, payload: Option<&str>, within: Duration) -> Vec<u8> {
        let topic = format!("fpEdge1/Conn/{msg}");
        let deadline = Instant::now() + within;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match tokio::time::timeout(left, self.rx.recv()).await {
                Ok(Some((t, p))) if t == topic && payload.is_none_or(|w| w.as_bytes() == p) => {
                    return p;
                }
                Ok(Some(_)) => {}
                _ => panic!("nothing on {topic} matching {payload:?} within {within:?}"),
            }
        }
    }

    /// Everything that arrives within `within`.
    async fn drain(&mut self, within: Duration) -> Vec<(String, Vec<u8>)> {
        let deadline = Instant::now() + within;
        let mut out = Vec::new();
        while let Ok(Some(m)) = tokio::time::timeout(
            deadline.saturating_duration_since(Instant::now()),
            self.rx.recv(),
        )
        .await
        {
            out.push(m);
        }
        out
    }
}

/// Lines of a mosquitto log in which the driver asks for `scout`.
/// mosquitto logs each filter of a SUBSCRIBE it receives on its own
/// line, after a tab, before it checks the ACL.
fn scout_subscriptions(log: &Path) -> Vec<String> {
    std::fs::read_to_string(log)
        .unwrap_or_default()
        .lines()
        .filter(|l| l.contains("\tfpEdge1/Conn/scout"))
        .map(str::to_owned)
        .collect()
}

fn driver_connects(log: &Path) -> usize {
    std::fs::read_to_string(log)
        .unwrap_or_default()
        .lines()
        .filter(|l| l.contains("New client connected") && l.contains(" as Conn "))
        .count()
}

async fn up(agent: &mut Agent, features: Option<Value>) {
    agent.wait("status", Some("READY"), secs(10)).await;
    agent.send("conf", Ctl::new().conf().to_string()).await;
    let mut addr = json!({ "version": 1, "addrs": { "1": "a" }, "groups": {} });
    if let Some(f) = features {
        addr["features"] = f;
    }
    agent.send("addr", addr.to_string()).await;
    agent.wait("status", Some("UP"), secs(10)).await;
}

#[tokio::test]
async fn a_rollback_to_an_old_acl_never_sees_a_scout_subscription() {
    if !have_mosquitto() {
        return;
    }
    let dir = std::env::temp_dir().join(format!(
        "rs-edge-driver-scout-{}-{}",
        std::process::id(),
        free_port()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let port = free_port();

    // An Edge Agent with scouting.
    let (broker, new_log) = start_mosquitto(&dir, "new", port, true).await;
    let mut agent = Agent::start(port);
    tokio::time::sleep(ms(300)).await;
    let mut config = DriverConfig::new(format!("mqtt://127.0.0.1:{port}"), "Conn", "x");
    config.reconnect_delay = ms(200);
    let _driver = spawn_driver::<FakeHandler>(config);
    up(&mut agent, Some(json!({ "scout": 1 }))).await;

    // The subscription goes through the real broker: the hello is
    // answered, and a scan ends with UNSUPPORTED.
    let deadline = Instant::now() + secs(5);
    let hello = loop {
        agent.send("scout", r#"{"op":"hello","version":1}"#).await;
        let got = agent.drain(ms(200)).await;
        if let Some((_, p)) = got.iter().find(|(t, _)| t == "fpEdge1/Conn/found/hello") {
            break serde_json::from_slice::<Value>(p).unwrap();
        }
        assert!(
            Instant::now() < deadline,
            "no hello answer through mosquitto"
        );
    };
    assert_eq!(hello["supported"], false);
    agent
        .send(
            "scout",
            json!({
                "op": "start", "id": "s1", "version": 1, "root": null, "folder_id": null,
                "options": {},
                "limits": { "items": 10, "depth": 8, "seconds": 10, "pace_ms": 0, "samples": false },
            })
            .to_string(),
        )
        .await;
    let end: Value = serde_json::from_slice(&agent.wait("found/s1", None, secs(5)).await).unwrap();
    assert_eq!(end["error"]["code"], "UNSUPPORTED");
    assert_eq!(
        scout_subscriptions(&new_log).len(),
        1,
        "the log does not show the scout subscription once: {:?}",
        scout_subscriptions(&new_log)
    );

    // Roll back: the broker restarts with the old ACL, and the agent's
    // addr has no features.
    drop(broker);
    let (_broker, old_log) = start_mosquitto(&dir, "old", port, false).await;
    up(&mut agent, None).await;
    agent.send("scout", r#"{"op":"hello","version":1}"#).await;
    let got = agent.drain(secs(3)).await;
    assert!(
        !got.iter()
            .any(|(t, _)| t.starts_with("fpEdge1/Conn/found/")),
        "the driver answered on found: {got:?}"
    );
    assert!(
        scout_subscriptions(&old_log).is_empty(),
        "the driver asked the old broker for scout: {:?}",
        scout_subscriptions(&old_log)
    );
    assert_eq!(driver_connects(&old_log), 1, "the driver reconnected again");
    let log = std::fs::read_to_string(&old_log).unwrap();
    assert!(
        !log.lines()
            .any(|l| l.contains("Conn") && l.contains("isconnect")),
        "the driver was disconnected:\n{log}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

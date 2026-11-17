//! Typed writes: the agent sends each write as raw bytes on `cmd/` and
//! as JSON with its Sparkplug type on `write/`. A handler takes one or
//! the other, chosen by `Handler::TYPED_WRITES`.

mod common;

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use bytes::Bytes;
use common::handler::{Ctl, FakeHandler};
use common::{FakeAgent, FromDriver, lookup, ms, register, secs, spawn_driver};
use rs_edge_driver::{ConnectError, DriverHandle, Handler, HandlerError, WriteError, WriteValue};

/// What the typed handler has seen.
#[derive(Default)]
struct Seen {
    writes: Mutex<Vec<(String, WriteValue)>>,
    cmds: Mutex<Vec<(String, Bytes)>>,
}

struct TypedHandler {
    seen: Arc<Seen>,
}

#[async_trait]
impl Handler for TypedHandler {
    type Addr = String;
    const TYPED_WRITES: bool = true;

    fn create(_: DriverHandle<String>, config: serde_json::Value) -> Result<Self, HandlerError> {
        let seen = lookup(&config).ok_or_else(|| HandlerError::new("no ctl key"))?;
        Ok(Self { seen })
    }

    fn parse_addr(&self, addr: &str) -> Option<String> {
        Some(format!("parsed:{addr}"))
    }

    async fn connect(&mut self) -> Result<(), ConnectError> {
        Ok(())
    }

    async fn close(&mut self) {}

    async fn cmd(&mut self, command: &str, payload: Bytes) {
        self.seen
            .cmds
            .lock()
            .unwrap()
            .push((command.to_owned(), payload));
    }

    async fn write(&mut self, addr: &String, value: WriteValue) -> Result<(), WriteError> {
        match addr.as_str() {
            "parsed:ro" => Err(WriteError::ReadOnly("BadNotWritable".into())),
            "parsed:fails" => Err(WriteError::Failed("device said no".into())),
            _ => {
                self.seen.writes.lock().unwrap().push((addr.clone(), value));
                Ok(())
            }
        }
    }
}

/// Exactly what the agent sends for each scalar type (acs-edge
/// `writeValToJSON`), and what the handler should get.
fn scalars() -> Vec<(&'static str, WriteValue)> {
    use WriteValue::*;
    vec![
        (r#"{"type":"Boolean","value":false}"#, Boolean(false)),
        (r#"{"type":"Int8","value":-128}"#, Int8(-128)),
        (r#"{"type":"Int16","value":-2}"#, Int16(-2)),
        (r#"{"type":"Int32","value":-2147483648}"#, Int32(i32::MIN)),
        (
            r#"{"type":"Int64","value":"-9007199254740991"}"#,
            Int64(-9007199254740991),
        ),
        (r#"{"type":"UInt8","value":255}"#, UInt8(255)),
        (r#"{"type":"UInt16","value":65535}"#, UInt16(65535)),
        (r#"{"type":"UInt32","value":4294967295}"#, UInt32(u32::MAX)),
        (
            r#"{"type":"UInt64","value":"9007199254740991"}"#,
            UInt64(9007199254740991),
        ),
        (r#"{"type":"Float","value":1.5}"#, Float(1.5)),
        (r#"{"type":"Double","value":-0.1}"#, Double(-0.1)),
        (
            r#"{"type":"String","value":"héllo \"q\"/1"}"#,
            String("héllo \"q\"/1".into()),
        ),
        (r#"{"type":"Text","value":"a\nb"}"#, Text("a\nb".into())),
        (
            r#"{"type":"UUID","value":"2f0d6a0a-58e1-4f5a-9b0c-0d1e2f3a4b5c"}"#,
            Uuid("2f0d6a0a-58e1-4f5a-9b0c-0d1e2f3a4b5c".into()),
        ),
        (
            r#"{"type":"DateTime","value":1763380800123}"#,
            DateTime(1763380800123),
        ),
    ]
}

fn errors(events: &[FromDriver]) -> Vec<(String, String)> {
    events
        .iter()
        .filter_map(|e| match e {
            FromDriver::Other { topic, payload } if topic.contains("/err/") => Some((
                topic.clone(),
                std::string::String::from_utf8_lossy(payload).into_owned(),
            )),
            _ => None,
        })
        .collect()
}

#[tokio::test]
async fn typed_handler_gets_every_scalar_type() {
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<TypedHandler>(agent.config());
    let seen = Arc::new(Seen::default());

    agent
        .handshake(register(seen.clone()), &[("7", "ns=2;s=Motor/Speed")])
        .await;
    agent.wait_status("UP", secs(5)).await;

    let subs = agent.stats.subscriptions();
    assert!(
        subs.contains(&"fpEdge1/Conn/write/#".to_owned()),
        "{subs:?}"
    );
    assert!(!subs.iter().any(|s| s.contains("/cmd/")), "{subs:?}");

    for (json, _) in scalars() {
        // The agent sends both forms. The cmd one must be ignored.
        agent.send("cmd/ns=2;s=Motor/Speed", vec![0u8, 1]);
        agent.send("write/ns=2;s=Motor/Speed", json);
    }
    let events = agent.drain(ms(500)).await;
    assert_eq!(errors(&events), vec![]);

    let want: Vec<_> = scalars()
        .into_iter()
        .map(|(_, v)| ("parsed:ns=2;s=Motor/Speed".to_owned(), v))
        .collect();
    assert_eq!(*seen.writes.lock().unwrap(), want);
    assert!(
        seen.cmds.lock().unwrap().is_empty(),
        "cmd reached a typed handler"
    );
}

#[tokio::test]
async fn failed_writes_are_reported_on_err() {
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<TypedHandler>(agent.config());
    let seen = Arc::new(Seen::default());

    agent
        .handshake(
            register(seen.clone()),
            &[("1", "ro"), ("2", "fails"), ("3", "ok")],
        )
        .await;
    agent.wait_status("UP", secs(5)).await;

    let w = r#"{"type":"Int16","value":1}"#;
    agent.send("write/ro", w);
    agent.send("write/fails", w);
    agent.send("write/ok", r#"{"type":"Int16","value":70000}"#);
    agent.send("write/ok", "not json");
    // Not in the address map: no data topic, so nothing to report on.
    agent.send("write/missing", w);

    // A write the driver can't use is refused straight away, and a
    // handler's error comes back from its own task, so sort them.
    let events = agent.drain(ms(500)).await;
    let mut errs = errors(&events);
    errs.sort();
    assert_eq!(errs.len(), 4, "{errs:?}");
    assert_eq!(
        errs[0],
        ("fpEdge1/Conn/err/1".into(), "RO\nBadNotWritable".into())
    );
    assert_eq!(
        errs[1],
        ("fpEdge1/Conn/err/2".into(), "ERR\ndevice said no".into())
    );
    for (topic, payload) in &errs[2..] {
        assert_eq!(topic, "fpEdge1/Conn/err/3");
        assert!(payload.starts_with("CMD\n"), "{payload}");
    }
    assert!(seen.writes.lock().unwrap().is_empty());
}

/// A handler that doesn't opt in subscribes to cmd as before, gets the
/// cmd payload byte for byte, and never sees a typed write.
#[tokio::test]
async fn cmd_handler_is_unchanged() {
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<FakeHandler>(agent.config());
    let ctl = Ctl::new();

    agent
        .handshake(ctl.conf(), &[("1", "plant/line1/speed")])
        .await;
    agent.wait_status("UP", secs(5)).await;

    let subs = agent.stats.subscriptions();
    assert!(subs.contains(&"fpEdge1/Conn/cmd/#".to_owned()), "{subs:?}");
    assert!(!subs.iter().any(|s| s.contains("/write/")), "{subs:?}");

    let bytes: &[u8] = &[0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe];
    agent.send("cmd/plant/line1/speed", bytes.to_vec());
    agent.send(
        "write/plant/line1/speed",
        r#"{"type":"Int64","value":"-2"}"#,
    );
    let events = agent.drain(ms(500)).await;
    assert_eq!(errors(&events), vec![]);

    assert_eq!(
        *ctl.cmds.lock().unwrap(),
        vec![("plant/line1/speed".to_owned(), Bytes::from_static(bytes))]
    );
}

fn results(events: &[FromDriver]) -> Vec<(String, String)> {
    events
        .iter()
        .filter_map(|e| match e {
            FromDriver::Other { topic, payload } if topic.contains("/result/") => Some((
                topic.clone(),
                std::string::String::from_utf8_lossy(payload).into_owned(),
            )),
            _ => None,
        })
        .collect()
}

/// A write with an id is one the agent is waiting for, so the driver
/// answers it on `result/{id}`, empty if it was written, and reports
/// nothing on `err`. The handler doesn't change.
#[tokio::test]
async fn writes_with_an_id_are_answered_on_result() {
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<TypedHandler>(agent.config());
    let seen = Arc::new(Seen::default());

    agent
        .handshake(
            register(seen.clone()),
            &[("1", "ro"), ("2", "fails"), ("3", "ok")],
        )
        .await;
    agent.wait_status("UP", secs(5)).await;

    let w = |id: &str| format!(r#"{{"type":"Int16","value":1,"id":"{id}"}}"#);
    agent.send("write/ok", w("ab12_1"));
    agent.send("write/ro", w("ab12_2"));
    agent.send("write/fails", w("ab12_3"));
    agent.send("write/missing", w("ab12_4"));
    agent.send(
        "write/ok",
        r#"{"type":"Int16","value":70000,"id":"ab12_5"}"#,
    );
    agent.send("write/ok", w("ab12_6"));

    let events = agent.drain(ms(500)).await;
    assert_eq!(errors(&events), vec![]);
    let mut got = results(&events);
    got.sort();
    assert_eq!(
        got,
        vec![
            ("fpEdge1/Conn/result/ab12_1".into(), "".into()),
            (
                "fpEdge1/Conn/result/ab12_2".into(),
                "RO\nBadNotWritable".into()
            ),
            (
                "fpEdge1/Conn/result/ab12_3".into(),
                "ERR\ndevice said no".into()
            ),
            (
                "fpEdge1/Conn/result/ab12_4".into(),
                "CMD\naddress not in the address map".into()
            ),
            (
                "fpEdge1/Conn/result/ab12_5".into(),
                "CMD\nbad Int16 value 70000".into()
            ),
            ("fpEdge1/Conn/result/ab12_6".into(), "".into()),
        ]
    );
    // Successes come back in the order the handler wrote them.
    let ok: Vec<_> = results(&events)
        .into_iter()
        .filter(|(_, p)| p.is_empty())
        .map(|(t, _)| t)
        .collect();
    assert_eq!(
        ok,
        vec!["fpEdge1/Conn/result/ab12_1", "fpEdge1/Conn/result/ab12_6"]
    );
    assert_eq!(seen.writes.lock().unwrap().len(), 2);
}

/// Without an id, or with one that can't be a topic level, the agent
/// isn't waiting: nothing on success, `err` on failure, as before.
#[tokio::test]
async fn writes_without_an_id_are_not_answered() {
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<TypedHandler>(agent.config());
    let seen = Arc::new(Seen::default());

    agent
        .handshake(register(seen.clone()), &[("1", "ro"), ("3", "ok")])
        .await;
    agent.wait_status("UP", secs(5)).await;

    agent.send("write/ok", r#"{"type":"Int16","value":1}"#);
    agent.send("write/ok", r#"{"type":"Int16","value":1,"id":"x/#"}"#);
    agent.send("write/ok", r#"{"type":"Int16","value":1,"id":7}"#);
    agent.send("write/ro", r#"{"type":"Int16","value":1,"id":""}"#);

    let events = agent.drain(ms(500)).await;
    assert_eq!(results(&events), vec![]);
    assert_eq!(
        errors(&events),
        vec![("fpEdge1/Conn/err/1".into(), "RO\nBadNotWritable".into())]
    );
    assert_eq!(seen.writes.lock().unwrap().len(), 3);
}

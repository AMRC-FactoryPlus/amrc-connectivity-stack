// ACS REST driver
// Run the whole driver against a fake Edge Agent and a stub HTTP server
// Copyright 2026 University of Sheffield

//! The driver end to end: polls become GETs whose bodies come back as
//! data, Basic auth reaches the server, `401` gives `AUTH`, no server
//! gives `CONN`, both recover, and a typed write becomes a POST that is
//! answered once the server accepts it. The fake Edge Agent is the one
//! `rs-edge-driver` tests itself with.

#[path = "../../lib/rs-edge-driver/tests/common/mod.rs"]
mod common;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use bytes::Bytes;
use common::{FakeAgent, FromDriver, ms, secs, spawn_driver};
use edge_rest::RestHandler;
use rs_edge_driver::DriverConfig;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// A request the stub server got.
#[derive(Debug, Clone)]
struct Request {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

type Reply = (u16, Vec<u8>);
type Route = Arc<dyn Fn(&Request) -> Reply + Send + Sync>;

/// A small HTTP/1.1 server that answers each request from `route` and
/// closes the connection.
struct Stub {
    base: String,
    port: u16,
    seen: Arc<Mutex<Vec<Request>>>,
    route: Arc<Mutex<Route>>,
    task: tokio::task::JoinHandle<()>,
}

impl Stub {
    async fn start(route: impl Fn(&Request) -> Reply + Send + Sync + 'static) -> Self {
        Self::on(0, Arc::new(route)).await
    }

    async fn on(port: u16, route: Route) -> Self {
        let listener = TcpListener::bind(("127.0.0.1", port)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let route = Arc::new(Mutex::new(route));
        let (s, r) = (seen.clone(), route.clone());
        let task = tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    return;
                };
                let (s, r) = (s.clone(), r.clone());
                tokio::spawn(async move {
                    let Some(req) = read_request(&mut sock).await else {
                        return;
                    };
                    let route = r.lock().unwrap().clone();
                    let (status, body) = route(&req);
                    s.lock().unwrap().push(req);
                    let head = format!(
                        "HTTP/1.1 {status} X\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    );
                    let _ = sock.write_all(head.as_bytes()).await;
                    let _ = sock.write_all(&body).await;
                    let _ = sock.shutdown().await;
                });
            }
        });
        Self {
            base: format!("http://127.0.0.1:{port}"),
            port,
            seen,
            route,
            task,
        }
    }

    fn set_route(&self, route: impl Fn(&Request) -> Reply + Send + Sync + 'static) {
        *self.route.lock().unwrap() = Arc::new(route);
    }

    fn seen(&self) -> Vec<Request> {
        self.seen.lock().unwrap().clone()
    }
}

impl Drop for Stub {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn read_request(sock: &mut tokio::net::TcpStream) -> Option<Request> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    let head_end = loop {
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break i;
        }
        let n = sock.read(&mut chunk).await.ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).into_owned();
    let mut lines = head.split("\r\n");
    let mut first = lines.next()?.split(' ');
    let method = first.next()?.to_owned();
    let path = first.next()?.to_owned();
    let headers: HashMap<String, String> = lines
        .filter_map(|l| l.split_once(": "))
        .map(|(k, v)| (k.to_ascii_lowercase(), v.to_owned()))
        .collect();
    let len: usize = headers
        .get("content-length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let mut body = buf[head_end + 4..].to_vec();
    while body.len() < len {
        let n = sock.read(&mut chunk).await.ok()?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..n]);
    }
    Some(Request {
        method,
        path,
        headers,
        body,
    })
}

fn config(agent: &FakeAgent) -> DriverConfig {
    let mut config = agent.config();
    config.reconnect_delay = ms(200);
    config
}

#[tokio::test]
async fn polls_pass_bodies_through_with_basic_auth() {
    let stub = Stub::start(|req| match req.path.as_str() {
        "/api/json" => (200, br#"{"a": 1.50}"#.to_vec()),
        "/api/xml" => (200, b"<r><v>2</v></r>".to_vec()),
        "/api/p/0" => (200, b"[1]".to_vec()),
        "/api/p/1" => (200, b"[2, 3]".to_vec()),
        _ => (404, Vec::new()),
    })
    .await;
    let mut agent = FakeAgent::start("Rest").await;
    let _driver = spawn_driver::<RestHandler>(config(&agent));

    agent
        .handshake(
            serde_json::json!({
                "baseURL": format!("{}/api", stub.base),
                "authMethod": "Basic", "username": "Aladdin", "password": "open sesame",
            }),
            &[
                ("1", "/json"),
                ("2", "/xml"),
                ("3", "/missing"),
                ("4", "/p/${0:5}"),
            ],
        )
        .await;
    agent.wait_status("UP", secs(5)).await;

    agent.send("poll", "1\n2\n3\n4");
    let mut data = agent.collect_data(3, secs(5)).await;
    data.sort();
    assert_eq!(
        data,
        [
            ("1".to_owned(), Bytes::from_static(br#"{"a": 1.50}"#)),
            ("2".to_owned(), Bytes::from_static(b"<r><v>2</v></r>")),
            ("4".to_owned(), Bytes::from_static(b"[1,2,3]")),
        ]
    );
    // A 404 gives no data and leaves the connection up.
    let rest = agent.drain(ms(300)).await;
    assert!(
        !rest
            .iter()
            .any(|e| matches!(e, FromDriver::Data { .. } | FromDriver::Status(_))),
        "{rest:?}"
    );

    let seen = stub.seen();
    let mut paths: Vec<&str> = seen.iter().map(|r| r.path.as_str()).collect();
    paths.sort();
    assert_eq!(
        paths,
        [
            "/api/json",
            "/api/missing",
            "/api/p/0",
            "/api/p/1",
            "/api/p/2",
            "/api/xml"
        ]
    );
    for r in &seen {
        assert_eq!(r.method, "GET");
        assert_eq!(r.headers["accept"], "*/*");
        assert_eq!(
            r.headers["authorization"],
            "Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ=="
        );
    }
}

#[tokio::test]
async fn refused_credentials_report_auth_then_recover() {
    let stub = Stub::start(|_| (401, Vec::new())).await;
    let mut agent = FakeAgent::start("Rest").await;
    let _driver = spawn_driver::<RestHandler>(config(&agent));

    agent
        .handshake(serde_json::json!({"baseURL": stub.base}), &[("1", "/x")])
        .await;
    agent.wait_status("UP", secs(5)).await;

    agent.send("poll", "1");
    agent.wait_status("AUTH", secs(5)).await;

    stub.set_route(|_| (200, b"ok".to_vec()));
    agent.wait_status("UP", secs(5)).await;
    agent.send("poll", "1");
    assert_eq!(
        agent.collect_data(1, secs(5)).await,
        [("1".to_owned(), Bytes::from_static(b"ok"))]
    );
}

#[tokio::test]
async fn no_server_reports_conn_then_recovers() {
    // Find a free port, then leave it closed.
    let port = {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        l.local_addr().unwrap().port()
    };
    let mut agent = FakeAgent::start("Rest").await;
    let _driver = spawn_driver::<RestHandler>(config(&agent));

    agent
        .handshake(
            serde_json::json!({"baseURL": format!("http://127.0.0.1:{port}")}),
            &[("1", "/x")],
        )
        .await;
    agent.wait_status("UP", secs(5)).await;

    agent.send("poll", "1");
    agent.wait_status("CONN", secs(5)).await;

    let stub = Stub::on(port, Arc::new(|_| (200, b"back".to_vec()))).await;
    assert_eq!(stub.port, port);
    agent.wait_status("UP", secs(5)).await;
    agent.send("poll", "1");
    assert_eq!(
        agent.collect_data(1, secs(5)).await,
        [("1".to_owned(), Bytes::from_static(b"back"))]
    );
}

#[tokio::test]
async fn basic_auth_without_a_password_reports_conf() {
    let mut agent = FakeAgent::start("Rest").await;
    let _driver = spawn_driver::<RestHandler>(config(&agent));

    agent
        .handshake(
            serde_json::json!({"baseURL": "http://127.0.0.1:1", "authMethod": "Basic", "username": "u"}),
            &[("1", "/x")],
        )
        .await;
    agent.wait_status("CONF", secs(5)).await;
}

fn results(events: &[FromDriver]) -> Vec<(String, String)> {
    let mut out: Vec<_> = events
        .iter()
        .filter_map(|e| match e {
            FromDriver::Other { topic, payload } if topic.contains("/result/") => Some((
                topic.rsplit('/').next().unwrap().to_owned(),
                String::from_utf8_lossy(payload).into_owned(),
            )),
            _ => None,
        })
        .collect();
    out.sort();
    out
}

/// A typed write is a POST of the value as JSON, answered as written
/// only when the server gives 2xx.
#[tokio::test]
async fn typed_writes_post_and_are_confirmed() {
    let stub = Stub::start(|req| match req.path.as_str() {
        "/ok" => (204, Vec::new()),
        "/denied" => (403, Vec::new()),
        _ => (500, Vec::new()),
    })
    .await;
    let mut agent = FakeAgent::start("Rest").await;
    let _driver = spawn_driver::<RestHandler>(config(&agent));

    agent
        .handshake(
            serde_json::json!({"baseURL": stub.base}),
            &[("1", "/ok"), ("2", "/denied"), ("3", "/broken")],
        )
        .await;
    agent.wait_status("UP", secs(5)).await;
    let subs = agent.stats.subscriptions();
    assert!(
        subs.contains(&"fpEdge1/Rest/write/#".to_owned()),
        "{subs:?}"
    );

    agent.send(
        "write//ok",
        r#"{"type":"Int64","value":"-9007199254740993","id":"w_1"}"#,
    );
    agent.send(
        "write//denied",
        r#"{"type":"Boolean","value":true,"id":"w_2"}"#,
    );
    agent.send(
        "write//broken",
        r#"{"type":"String","value":"x","id":"w_3"}"#,
    );
    agent.send("write//ok", r#"{"type":"Double","value":"NaN","id":"w_4"}"#);

    let got = results(&agent.drain(ms(1000)).await);
    assert_eq!(
        got,
        [
            ("w_1".to_owned(), String::new()),
            (
                "w_2".to_owned(),
                "ERR\nHTTP 403: credentials refused".to_owned()
            ),
            ("w_3".to_owned(), "ERR\nHTTP 500".to_owned()),
            (
                "w_4".to_owned(),
                "CMD\nNaN can't be sent as JSON".to_owned()
            ),
        ]
    );

    let mut posts: Vec<(String, String, String)> = stub
        .seen()
        .into_iter()
        .map(|r| {
            assert_eq!(r.method, "POST");
            (
                r.path,
                r.headers["content-type"].clone(),
                String::from_utf8(r.body).unwrap(),
            )
        })
        .collect();
    posts.sort();
    let json = "application/json".to_owned();
    assert_eq!(
        posts,
        [
            ("/broken".into(), json.clone(), r#""x""#.into()),
            ("/denied".into(), json.clone(), "true".into()),
            ("/ok".into(), json, "-9007199254740993".into()),
        ]
    );
}

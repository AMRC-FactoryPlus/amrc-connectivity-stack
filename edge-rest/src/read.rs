// ACS REST driver
// Reading an address: one GET, or a run of pages, and what a reply means
// Copyright 2026 University of Sheffield

//! What a read gives the Edge Agent, kept apart from the HTTP client so
//! it can be tested without a server.
//!
//! - A `200` reply's body goes to the Edge Agent as it is, and the agent
//!   parses it with the device's payload format.
//! - `401` and `403` are an authentication failure.
//! - A request that gets no reply at all (refused, DNS, TLS, a timeout or
//!   a dropped connection) is a connection failure.
//! - Any other status gives no data, as the built-in connection did.
//!
//! What a failure does to the connection's status is decided in
//! [`health`](crate::health).

use std::future::Future;
use std::time::Duration;

use bytes::Bytes;
use rs_edge_driver::DEFAULT_MAX_PACKET_SIZE;
use serde_json::value::RawValue;
use tokio::time::{Instant, timeout_at};

use crate::addr::{Addr, url};

/// The most pages one read of a `${n:m}` address fetches. The built-in
/// connection had no limit and could loop forever.
pub const MAX_PAGES: u32 = 100;

/// The largest body sent to the Edge Agent: the driver library's MQTT
/// packet limit less 64 KiB for the topic and packet header. rumqttc
/// refuses a larger outgoing packet with an error that ends the MQTT
/// session, so a bigger body would drop the driver's connection to the
/// Edge Agent on every poll.
pub const BODY_LIMIT: usize = DEFAULT_MAX_PACKET_SIZE - 64 * 1024;

/// How long one read may take, all its pages included. It is under the
/// driver library's 30 second poll timeout, so a read always finishes
/// and is counted rather than being dropped by the library.
pub const READ_DEADLINE: Duration = Duration::from_secs(25);

/// The limits a read works within. [`Limits::default`] is what the
/// driver uses; tests make them smaller.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub deadline: Duration,
    pub body: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            deadline: READ_DEADLINE,
            body: BODY_LIMIT,
        }
    }
}

/// An HTTP reply: the status and, for a 200, the body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reply {
    pub status: u16,
    pub body: Bytes,
    /// The body was over [`BODY_LIMIT`] and was not read.
    pub too_large: bool,
}

/// What a read gave.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// The bytes to send to the Edge Agent.
    Data(Bytes),
    /// A reply other than 200, 401 or 403: nothing to send.
    Status(u16),
    /// Nothing to send for another reason, already logged.
    NoData,
    /// `baseURL + address` is not an http or https URL.
    BadUrl,
    /// A 200 body, or the pages joined, over this many bytes.
    TooLarge(usize),
    /// The server refused the credentials. `url` is what was asked for.
    Auth { url: String, status: u16 },
    /// The request got no reply.
    Conn { url: String, error: String },
}

/// Whether a status means the credentials were refused.
pub fn is_auth_failure(status: u16) -> bool {
    status == 401 || status == 403
}

/// Whether a string is an http or https URL the client can ask for.
pub fn is_http_url(url: &str) -> bool {
    reqwest::Url::parse(url).is_ok_and(|u| matches!(u.scheme(), "http" | "https") && u.has_host())
}

/// Read an address with `get`, which fetches a URL and returns the
/// reply, or an error message if there was no reply. The read, all its
/// pages included, ends within `limits.deadline`.
pub async fn read<F, Fut>(base: &str, addr: &Addr, limits: Limits, get: F) -> Outcome
where
    F: Fn(String) -> Fut,
    Fut: Future<Output = Result<Reply, String>>,
{
    let deadline = Instant::now() + limits.deadline;
    let fetch = |url: String| {
        let req = get(url);
        async move {
            timeout_at(deadline, req)
                .await
                .unwrap_or_else(|_| Err("no reply before the read's deadline".to_owned()))
        }
    };

    let Some(paging) = addr.paging() else {
        let url = url(base, addr.raw());
        if !is_http_url(&url) {
            return Outcome::BadUrl;
        }
        return match fetch(url.clone()).await {
            Err(error) => Outcome::Conn { url, error },
            Ok(r) if r.status == 200 && r.too_large => Outcome::TooLarge(limits.body),
            Ok(r) if r.status == 200 => Outcome::Data(r.body),
            Ok(r) if is_auth_failure(r.status) => Outcome::Auth {
                url,
                status: r.status,
            },
            Ok(r) => Outcome::Status(r.status),
        };
    };

    // Fetch pages from the start number until one doesn't give 200,
    // the stop number is reached, MAX_PAGES have been read or the
    // deadline passes. The first page is always fetched, as the
    // built-in's do-while did.
    let mut pages = Vec::new();
    let mut size = 0;
    let mut end = None;
    let mut n = paging.start;
    loop {
        let url = url(base, &paging.page(n));
        if !is_http_url(&url) {
            return Outcome::BadUrl;
        }
        match fetch(url.clone()).await {
            // No reply to a later page because time ran out: use the
            // pages there are.
            Err(_) if !pages.is_empty() && Instant::now() >= deadline => {
                tracing::debug!(address = addr.raw(), page = n, "deadline reached");
                break;
            }
            Err(error) => return Outcome::Conn { url, error },
            Ok(r) if r.status == 200 && r.too_large => return Outcome::TooLarge(limits.body),
            Ok(r) if r.status == 200 => {
                size += r.body.len();
                if size > limits.body {
                    return Outcome::TooLarge(limits.body);
                }
                pages.push(r.body);
            }
            Ok(r) if is_auth_failure(r.status) => {
                return Outcome::Auth {
                    url,
                    status: r.status,
                };
            }
            Ok(r) => {
                end = Some(r.status);
                tracing::debug!(
                    address = addr.raw(),
                    page = n,
                    status = r.status,
                    "last page"
                );
                break;
            }
        }
        n += 1;
        if paging.stop.is_some_and(|stop| n >= stop) {
            break;
        }
        if pages.len() as u32 >= MAX_PAGES {
            tracing::debug!(address = addr.raw(), "stopped after {MAX_PAGES} pages");
            break;
        }
    }

    if pages.is_empty() {
        return end.map_or(Outcome::NoData, Outcome::Status);
    }
    match join_pages(&pages) {
        Some(body) if body.len() > limits.body => Outcome::TooLarge(limits.body),
        Some(body) => Outcome::Data(body),
        None => {
            tracing::debug!(
                address = addr.raw(),
                "a page is not JSON, so pages can't be joined"
            );
            Outcome::NoData
        }
    }
}

/// Join JSON pages into one JSON array: the items of each page that is
/// an array, and any other page as one item. The values are copied as
/// the server wrote them, so numbers are not re-printed. `None` if a
/// page is not JSON.
pub fn join_pages(pages: &[Bytes]) -> Option<Bytes> {
    let mut items: Vec<&RawValue> = Vec::new();
    for page in pages {
        let value: &RawValue = serde_json::from_slice(page).ok()?;
        if value.get().starts_with('[') {
            let inner: Vec<&RawValue> = serde_json::from_str(value.get()).ok()?;
            items.extend(inner);
        } else {
            items.push(value);
        }
    }
    serde_json::to_vec(&items).ok().map(Bytes::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    type Replies = Box<dyn Fn(&str) -> Result<Reply, String> + Send + Sync>;

    /// A fake server: a reply for each URL, and a log of what was asked.
    struct Fake {
        replies: Replies,
        asked: Mutex<Vec<String>>,
        limits: Limits,
        /// How long each request takes.
        delay: Duration,
    }

    impl Fake {
        fn new(f: impl Fn(&str) -> Result<Reply, String> + Send + Sync + 'static) -> Self {
            Self {
                replies: Box::new(f),
                asked: Mutex::new(Vec::new()),
                limits: Limits::default(),
                delay: Duration::ZERO,
            }
        }

        async fn read(&self, base: &str, addr: &str) -> Outcome {
            let delay = self.delay;
            read(base, &Addr::parse(addr), self.limits, |url| {
                self.asked.lock().unwrap().push(url.clone());
                let r = (self.replies)(&url);
                async move {
                    if !delay.is_zero() {
                        tokio::time::sleep(delay).await;
                    }
                    r
                }
            })
            .await
        }

        fn asked(&self) -> Vec<String> {
            self.asked.lock().unwrap().clone()
        }
    }

    fn ok(body: &str) -> Result<Reply, String> {
        status(200, body)
    }

    fn status(status: u16, body: &str) -> Result<Reply, String> {
        Ok(Reply {
            status,
            body: Bytes::from(body.to_owned()),
            too_large: false,
        })
    }

    fn too_large() -> Result<Reply, String> {
        Ok(Reply {
            status: 200,
            body: Bytes::new(),
            too_large: true,
        })
    }

    fn data(s: &str) -> Outcome {
        Outcome::Data(Bytes::from(s.to_owned()))
    }

    #[tokio::test]
    async fn a_200_body_passes_through_unchanged() {
        let body = "<a x=\"1\">\u{e9}</a>\n";
        let f = Fake::new(move |_| ok(body));
        assert_eq!(f.read("http://h/api", "/x").await, data(body));
        assert_eq!(f.asked(), ["http://h/api/x"]);
    }

    #[tokio::test]
    async fn binary_bodies_pass_through_unchanged() {
        let f = Fake::new(|_| {
            Ok(Reply {
                status: 200,
                body: Bytes::from_static(&[0, 0xff, 0xfe, 1]),
                too_large: false,
            })
        });
        assert_eq!(
            f.read("http://h", "/b").await,
            Outcome::Data(Bytes::from_static(&[0, 0xff, 0xfe, 1]))
        );
    }

    #[tokio::test]
    async fn statuses_map_to_outcomes() {
        for (code, want) in [
            (401, "auth"),
            (403, "auth"),
            (201, "none"),
            (204, "none"),
            (301, "none"),
            (404, "none"),
            (500, "none"),
            (503, "none"),
        ] {
            let f = Fake::new(move |_| status(code, "{}"));
            let got = f.read("http://h", "/x").await;
            let kind = match got {
                Outcome::Auth { ref url, status } => {
                    assert_eq!((url.as_str(), status), ("http://h/x", code));
                    "auth"
                }
                Outcome::Status(s) => {
                    assert_eq!(s, code);
                    "none"
                }
                ref o => panic!("{code}: {o:?}"),
            };
            assert_eq!(kind, want, "{code}");
        }
    }

    #[tokio::test]
    async fn no_reply_is_a_connection_failure() {
        let f = Fake::new(|_| Err("connection refused".into()));
        assert_eq!(
            f.read("http://h", "/x").await,
            Outcome::Conn {
                url: "http://h/x".into(),
                error: "connection refused".into()
            }
        );
    }

    #[tokio::test]
    async fn pages_stop_at_the_first_failed_page() {
        let f = Fake::new(|url| {
            if url.ends_with("/2") {
                status(404, "")
            } else {
                ok(&format!("[\"{url}\"]"))
            }
        });
        assert_eq!(
            f.read("http://h", "/p/${0:5}").await,
            data(r#"["http://h/p/0","http://h/p/1"]"#)
        );
        assert_eq!(f.asked(), ["http://h/p/0", "http://h/p/1", "http://h/p/2"]);
    }

    #[tokio::test]
    async fn pages_stop_before_the_stop_number() {
        let f = Fake::new(|url| ok(&format!("[{}]", &url[url.len() - 1..])));
        assert_eq!(f.read("http://h", "/p/${2:5}").await, data("[2,3,4]"));
        assert_eq!(f.asked().len(), 3);
    }

    /// The first page is fetched even when the stop number is not
    /// after it, as the built-in's do-while loop did.
    #[tokio::test]
    async fn the_first_page_is_always_fetched() {
        let f = Fake::new(|_| ok("[1]"));
        assert_eq!(f.read("http://h", "/p/${5:3}").await, data("[1]"));
        assert_eq!(f.asked(), ["http://h/p/5"]);
    }

    /// The bug this driver fixes: with no stop number and pages that
    /// always succeed, the built-in never stopped.
    #[tokio::test]
    async fn pages_without_a_stop_are_bounded() {
        let f = Fake::new(|_| ok("[0]"));
        let Outcome::Data(body) = f.read("http://h", "/p?n=${0:n}").await else {
            panic!("no data");
        };
        let items: Vec<u32> = serde_json::from_slice(&body).unwrap();
        assert_eq!(items.len(), MAX_PAGES as usize);
        assert_eq!(f.asked().len(), MAX_PAGES as usize);
    }

    #[tokio::test]
    async fn pages_without_a_stop_end_at_a_failed_page() {
        let f = Fake::new(|url| {
            if url.ends_with('3') {
                status(204, "")
            } else {
                ok("[0]")
            }
        });
        assert_eq!(f.read("http://h", "/p?n=${1:n}").await, data("[0,0]"));
        assert_eq!(f.asked().len(), 3);
    }

    #[tokio::test]
    async fn a_failed_first_page_gives_no_data() {
        let f = Fake::new(|_| status(404, ""));
        assert_eq!(f.read("http://h", "/p/${0:5}").await, Outcome::Status(404));
    }

    #[tokio::test]
    async fn auth_and_connection_failures_end_paging() {
        let f = Fake::new(|url| {
            if url.ends_with('1') {
                status(401, "")
            } else {
                ok("[0]")
            }
        });
        assert!(matches!(
            f.read("http://h", "/p/${0:5}").await,
            Outcome::Auth { status: 401, .. }
        ));
        let f = Fake::new(|url| {
            if url.ends_with('1') {
                Err("reset".into())
            } else {
                ok("[0]")
            }
        });
        assert_eq!(
            f.read("http://h", "/p/${0:5}").await,
            Outcome::Conn {
                url: "http://h/p/1".into(),
                error: "reset".into()
            }
        );
    }

    #[tokio::test]
    async fn a_body_over_the_limit_gives_no_data() {
        let f = Fake::new(|_| too_large());
        assert_eq!(
            f.read("http://h", "/x").await,
            Outcome::TooLarge(BODY_LIMIT)
        );
    }

    /// Each page fits, but together they don't.
    #[tokio::test]
    async fn pages_over_the_limit_together_give_no_data() {
        let mut f = Fake::new(|_| ok("[1234567890]"));
        f.limits.body = 30;
        assert_eq!(f.read("http://h", "/p/${0:9}").await, Outcome::TooLarge(30));
        assert_eq!(f.asked().len(), 3);
        let mut f = Fake::new(|_| ok("[1234567890]"));
        f.limits.body = 30;
        assert_eq!(
            f.read("http://h", "/p/${0:2}").await,
            data("[1234567890,1234567890]")
        );
    }

    #[tokio::test]
    async fn a_page_over_the_limit_gives_no_data() {
        let f = Fake::new(|url| {
            if url.ends_with('1') {
                too_large()
            } else {
                ok("[0]")
            }
        });
        assert_eq!(
            f.read("http://h", "/p/${0:5}").await,
            Outcome::TooLarge(BODY_LIMIT)
        );
    }

    /// The pages that came back before the deadline are sent, so a slow
    /// server can't make a paged read outlast the library's poll
    /// timeout.
    #[tokio::test(start_paused = true)]
    async fn paging_stops_at_the_deadline_with_the_pages_it_has() {
        let mut f = Fake::new(|url| ok(&format!("[{}]", &url[url.len() - 1..])));
        f.delay = Duration::from_secs(2);
        f.limits.deadline = Duration::from_secs(7);
        let start = Instant::now();
        assert_eq!(f.read("http://h", "/p/${0:9}").await, data("[0,1,2]"));
        assert_eq!(start.elapsed(), Duration::from_secs(7));
        assert_eq!(f.asked().len(), 4);
    }

    #[tokio::test(start_paused = true)]
    async fn the_default_deadline_is_under_the_poll_timeout() {
        let mut f = Fake::new(|_| ok("[0]"));
        f.delay = Duration::from_secs(20);
        let start = Instant::now();
        assert_eq!(f.read("http://h", "/p?n=${0:n}").await, data("[0]"));
        assert!(start.elapsed() <= READ_DEADLINE);
        assert!(READ_DEADLINE < rs_edge_driver::DriverOptions::default().poll_timeout);
    }

    #[tokio::test(start_paused = true)]
    async fn no_reply_before_the_deadline_is_a_connection_failure() {
        let mut f = Fake::new(|_| ok("{}"));
        f.delay = Duration::from_secs(60);
        assert!(matches!(
            f.read("http://h", "/x").await,
            Outcome::Conn { .. }
        ));
        assert!(matches!(
            f.read("http://h", "/p/${0:5}").await,
            Outcome::Conn { .. }
        ));
    }

    #[tokio::test]
    async fn an_address_that_makes_no_url_is_not_asked_for() {
        let f = Fake::new(|_| ok("{}"));
        for (base, addr) in [
            ("foo", "/x"),
            ("", "/x"),
            ("host:8080", "/x"),
            ("ftp://h", "/x"),
            ("http://", ""),
        ] {
            assert_eq!(f.read(base, addr).await, Outcome::BadUrl, "{base}{addr}");
        }
        assert_eq!(f.read("", "http://h/x").await, data("{}"));
        assert_eq!(f.asked(), ["http://h/x"]);
    }

    #[test]
    fn the_body_limit_leaves_room_under_the_packet_limit() {
        assert_eq!(BODY_LIMIT, 16 * 1024 * 1024 - 64 * 1024);
    }

    #[test]
    fn join_pages_keeps_values_as_written() {
        let pages = [
            Bytes::from_static(b" [1.0, 1e3, {\"a\": \"\\u00e9\"}] "),
            Bytes::from_static(b"{\"b\":2}"),
            Bytes::from_static(b"[]"),
            Bytes::from_static(b"\"s\""),
        ];
        assert_eq!(
            join_pages(&pages).unwrap(),
            Bytes::from_static(b"[1.0,1e3,{\"a\": \"\\u00e9\"},{\"b\":2},\"s\"]")
        );
    }

    #[test]
    fn join_pages_needs_json() {
        assert_eq!(join_pages(&[Bytes::from_static(b"<a/>")]), None);
    }
}

// ACS REST driver
// Reading an address: one GET, or a run of pages, and what a reply means
// Copyright 2026 University of Sheffield

//! What a read gives the Edge Agent, kept apart from the HTTP client so
//! it can be tested without a server.
//!
//! - A `200` reply's body goes to the Edge Agent as it is, and the agent
//!   parses it with the device's payload format.
//! - `401` and `403` are an authentication failure, which the driver
//!   reports as `AUTH`.
//! - A request that gets no reply at all (refused, DNS, TLS, a timeout or
//!   a dropped connection) is a connection failure, reported as `CONN`.
//! - Any other status gives no data and is logged, as the built-in
//!   connection did.

use std::future::Future;

use bytes::Bytes;
use serde_json::value::RawValue;

use crate::addr::{Addr, url};

/// The most pages one read of a `${n:m}` address fetches. The built-in
/// connection had no limit and could loop forever.
pub const MAX_PAGES: u32 = 100;

/// An HTTP reply: the status and the body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reply {
    pub status: u16,
    pub body: Bytes,
}

/// What a read gave.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// The bytes to send to the Edge Agent.
    Data(Bytes),
    /// Nothing to send, and nothing wrong with the connection.
    NoData,
    /// The server refused the credentials. `url` is what was asked for.
    Auth { url: String, status: u16 },
    /// The request got no reply.
    Conn { url: String, error: String },
}

/// Whether a status means the credentials were refused.
pub fn is_auth_failure(status: u16) -> bool {
    status == 401 || status == 403
}

/// Read an address with `get`, which fetches a URL and returns the
/// reply, or an error message if there was no reply.
pub async fn read<F, Fut>(base: &str, addr: &Addr, get: F) -> Outcome
where
    F: Fn(String) -> Fut,
    Fut: Future<Output = Result<Reply, String>>,
{
    let Some(paging) = addr.paging() else {
        let url = url(base, addr.raw());
        return match get(url.clone()).await {
            Err(error) => Outcome::Conn { url, error },
            Ok(r) if r.status == 200 => Outcome::Data(r.body),
            Ok(r) if is_auth_failure(r.status) => Outcome::Auth {
                url,
                status: r.status,
            },
            Ok(r) => {
                tracing::warn!(address = addr.raw(), status = r.status, "GET gave no data");
                Outcome::NoData
            }
        };
    };

    // Fetch pages from the start number until one doesn't give 200,
    // the stop number is reached or MAX_PAGES have been read. The
    // first page is always fetched, as the built-in's do-while did.
    let mut pages = Vec::new();
    let mut n = paging.start;
    loop {
        let url = url(base, &paging.page(n));
        match get(url.clone()).await {
            Err(error) => return Outcome::Conn { url, error },
            Ok(r) if r.status == 200 => pages.push(r.body),
            Ok(r) if is_auth_failure(r.status) => {
                return Outcome::Auth {
                    url,
                    status: r.status,
                };
            }
            Ok(r) => {
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
            tracing::warn!(address = addr.raw(), "stopped after {MAX_PAGES} pages");
            break;
        }
    }

    if pages.is_empty() {
        tracing::warn!(address = addr.raw(), "the first page gave no data");
        return Outcome::NoData;
    }
    match join_pages(&pages) {
        Some(body) => Outcome::Data(body),
        None => {
            tracing::warn!(
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
    }

    impl Fake {
        fn new(f: impl Fn(&str) -> Result<Reply, String> + Send + Sync + 'static) -> Self {
            Self {
                replies: Box::new(f),
                asked: Mutex::new(Vec::new()),
            }
        }

        async fn read(&self, base: &str, addr: &str) -> Outcome {
            read(base, &Addr::parse(addr), |url| {
                self.asked.lock().unwrap().push(url.clone());
                let r = (self.replies)(&url);
                async move { r }
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
                Outcome::NoData => "none",
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
        assert_eq!(f.read("http://h", "/p/${0:5}").await, Outcome::NoData);
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

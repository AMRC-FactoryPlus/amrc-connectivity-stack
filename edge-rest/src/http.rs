// ACS REST driver
// The HTTP client: GET for reads, POST for writes
// Copyright 2026 University of Sheffield

//! A [`reqwest`] client set up to send what the built-in connection's
//! axios sent: `Accept: */*`, the `Authorization` header when the
//! connection uses Basic auth, redirects followed up to 21 times, and
//! gzip and deflate bodies decoded.
//!
//! The built-in connection set no timeout, so a server that never
//! answered held a request open for ever. Here a request gives up
//! after [`REQUEST_TIMEOUT`], which counts as a connection failure.

use std::time::Duration;

use bytes::{Bytes, BytesMut};
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderValue};

use crate::config::Conf;
use crate::read::{BODY_LIMIT, Reply};

/// How long one request may take, from sending it to the end of the
/// body. It is under the driver library's 30 second poll timeout, so a
/// slow server is reported as `CONN` rather than the poll being
/// dropped without a word.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(25);

/// axios follows up to 21 redirects, the follow-redirects default.
const MAX_REDIRECTS: usize = 21;

/// The HTTP side of a connection.
#[derive(Clone)]
pub struct Client {
    http: reqwest::Client,
    base_url: String,
    body_limit: usize,
}

impl Client {
    pub fn new(conf: &Conf) -> Result<Self, String> {
        let mut headers = HeaderMap::new();
        headers.insert(ACCEPT, HeaderValue::from_static("*/*"));
        if let Some(auth) = &conf.authorization {
            let mut value = HeaderValue::from_str(auth)
                .map_err(|_| "the username or password can't go in a header".to_owned())?;
            value.set_sensitive(true);
            headers.insert(AUTHORIZATION, value);
        }
        let http = reqwest::Client::builder()
            .default_headers(headers)
            .redirect(reqwest::redirect::Policy::limited(MAX_REDIRECTS))
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|e| format!("can't build the HTTP client: {e}"))?;
        Ok(Self {
            http,
            base_url: conf.base_url.clone(),
            body_limit: BODY_LIMIT,
        })
    }

    /// Use a smaller body limit than [`BODY_LIMIT`], for tests.
    pub fn with_body_limit(mut self, limit: usize) -> Self {
        self.body_limit = limit;
        self
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// GET a URL. `Err` means no reply, with a message that leaves the
    /// URL out, because a base URL can carry a key in its query.
    ///
    /// Only a 200 reply's body is read, because no other is used, and
    /// it is read in chunks and abandoned once it passes [`BODY_LIMIT`],
    /// so a huge reply costs no more than the limit in memory. A body
    /// over the limit gives a reply with `too_large` set and no body.
    pub async fn get(&self, url: String) -> Result<Reply, String> {
        let mut res = self.http.get(url).send().await.map_err(describe)?;
        let status = res.status().as_u16();
        let mut reply = Reply {
            status,
            body: Bytes::new(),
            too_large: false,
        };
        if status != 200 {
            return Ok(reply);
        }
        if res
            .content_length()
            .is_some_and(|n| n > self.body_limit as u64)
        {
            reply.too_large = true;
            return Ok(reply);
        }
        let mut body = BytesMut::new();
        while let Some(chunk) = res.chunk().await.map_err(describe)? {
            if body.len() + chunk.len() > self.body_limit {
                reply.too_large = true;
                return Ok(reply);
            }
            body.extend_from_slice(&chunk);
        }
        reply.body = body.freeze();
        Ok(reply)
    }

    /// POST a JSON body to a URL.
    pub async fn post_json(&self, url: String, body: Vec<u8>) -> Result<Reply, String> {
        let res = self
            .http
            .post(url)
            .header(CONTENT_TYPE, "application/json")
            .body(body)
            .send()
            .await
            .map_err(describe)?;
        let status = res.status().as_u16();
        Ok(Reply {
            status,
            body: Bytes::new(),
            too_large: false,
        })
    }
}

/// An error message with its causes, which hold the useful part
/// ("connection refused", "dns error"), and without the URL.
fn describe(e: reqwest::Error) -> String {
    let e = e.without_url();
    let mut msg = e.to_string();
    let mut source = std::error::Error::source(&e);
    while let Some(s) = source {
        msg.push_str(": ");
        msg.push_str(&s.to_string());
        source = s.source();
    }
    msg
}

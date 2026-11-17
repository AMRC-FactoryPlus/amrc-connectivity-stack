// ACS REST driver
// Connection details, the same fields as the built-in's RESTConnDetails
// Copyright 2026 University of Sheffield

//! The connection details are the built-in connection's
//! `RESTConnDetails` unchanged, so moving a connection to this driver
//! moves them as they are:
//!
//! Field|
//! ---|---
//! `baseURL`|Joined to the front of every address. Must be an `http` or `https` URL, or empty or just `http://` or `https://` when each address carries the rest of its URL.
//! `authMethod`|`Basic` sends HTTP Basic auth. Anything else, usually `None`, sends no auth.
//! `username`, `password`|For `Basic`. Both must be present, as the built-in required.

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use rs_edge_driver::HandlerError;
use serde_json::Value;

use crate::read::is_http_url;

/// The parsed connection details.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Conf {
    pub base_url: String,
    /// The `Authorization` header value, if the connection uses auth.
    pub authorization: Option<String>,
}

impl Conf {
    /// Read the connection details the Edge Agent sends. An error makes
    /// the driver report `CONF`.
    pub fn parse(conf: &Value) -> Result<Self, HandlerError> {
        let base_url = conf
            .get("baseURL")
            .and_then(Value::as_str)
            .ok_or_else(|| HandlerError::new("no baseURL in the connection details"))?
            .to_owned();
        if !base_url_usable(&base_url) {
            return Err(HandlerError::new(
                "baseURL is not an http or https URL, so no address can make one with it",
            ));
        }

        let authorization = match conf.get("authMethod").and_then(Value::as_str) {
            Some("Basic") => {
                let (Some(user), Some(pass)) = (text(conf, "username"), text(conf, "password"))
                else {
                    return Err(HandlerError::new(
                        "REST Auth Method 'Basic' Set but no Username or Password Provided",
                    ));
                };
                Some(basic_auth(&user, &pass))
            }
            _ => None,
        };

        Ok(Self {
            base_url,
            authorization,
        })
    }
}

/// Whether some address could join `base` to make an http or https
/// URL: `base` is one itself, or is empty or just the scheme, so each
/// address carries the rest. Anything else (`host:8080`, `api/v1`)
/// can't be completed by an address.
///
/// The built-in connection accepted any value, and axios then sent each
/// request without a host to `http://localhost:80`, the Edge Agent's own
/// pod, where it failed on every poll.
pub fn base_url_usable(base: &str) -> bool {
    let lower = base.to_ascii_lowercase();
    base.is_empty() || lower == "http://" || lower == "https://" || is_http_url(base)
}

/// A field as the built-in's template string would print it. Missing
/// and `null` are absent, as the built-in's `== null` check found.
fn text(conf: &Value, key: &str) -> Option<String> {
    match conf.get(key)? {
        Value::Null => None,
        Value::String(s) => Some(s.clone()),
        other => Some(other.to_string()),
    }
}

/// The `Authorization` value for HTTP Basic auth: `Basic` and the
/// base64 of `username:password` in UTF-8, as the built-in made it.
pub fn basic_auth(username: &str, password: &str) -> String {
    format!(
        "Basic {}",
        STANDARD.encode(format!("{username}:{password}"))
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn no_auth() {
        for auth in [json!("None"), json!(null), json!("basic"), json!(1)] {
            let c = Conf::parse(&json!({"baseURL": "http://h", "authMethod": auth})).unwrap();
            assert_eq!(c.base_url, "http://h");
            assert_eq!(c.authorization, None);
        }
        let c = Conf::parse(&json!({"baseURL": "http://h"})).unwrap();
        assert_eq!(c.authorization, None);
    }

    /// The RFC 7617 example, and the same as Node's
    /// `Buffer.from("user:pass").toString("base64")`.
    #[test]
    fn basic_auth_header() {
        assert_eq!(
            basic_auth("Aladdin", "open sesame"),
            "Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ=="
        );
        assert_eq!(basic_auth("", ""), "Basic Og==");
        assert_eq!(basic_auth("ü", "a:b"), "Basic w7w6YTpi");
    }

    #[test]
    fn basic_auth_from_conf() {
        let c = Conf::parse(&json!({
            "baseURL": "http://h", "authMethod": "Basic",
            "username": "Aladdin", "password": "open sesame",
        }))
        .unwrap();
        assert_eq!(
            c.authorization.as_deref(),
            Some("Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==")
        );
    }

    /// Empty strings are allowed, as `== null` let them through.
    #[test]
    fn basic_auth_with_empty_strings() {
        let c = Conf::parse(&json!({
            "baseURL": "http://h", "authMethod": "Basic", "username": "", "password": "",
        }))
        .unwrap();
        assert_eq!(c.authorization.as_deref(), Some("Basic Og=="));
    }

    #[test]
    fn basic_auth_needs_both_fields() {
        for conf in [
            json!({"baseURL": "http://h", "authMethod": "Basic", "username": "u"}),
            json!({"baseURL": "http://h", "authMethod": "Basic", "password": "p"}),
            json!({"baseURL": "http://h", "authMethod": "Basic", "username": "u", "password": null}),
        ] {
            assert!(Conf::parse(&conf).is_err(), "{conf}");
        }
    }

    #[test]
    fn base_url_must_be_able_to_make_a_url() {
        for ok in [
            "http://h",
            "https://h:8443/api/",
            "HTTP://H",
            "",
            "http://",
            "HTTPS://",
        ] {
            assert!(Conf::parse(&json!({"baseURL": ok})).is_ok(), "{ok:?}");
        }
        for bad in ["h", "host:8080", "/api", "//h/x", "ftp://h", "http//h"] {
            let e = Conf::parse(&json!({"baseURL": bad})).unwrap_err();
            assert!(e.reason.contains("not an http or https URL"), "{bad:?}");
        }
    }

    #[test]
    fn base_url_is_required() {
        for conf in [
            json!({}),
            json!({"baseURL": 1}),
            json!(null),
            json!("http://h"),
        ] {
            assert!(Conf::parse(&conf).is_err(), "{conf}");
        }
    }
}

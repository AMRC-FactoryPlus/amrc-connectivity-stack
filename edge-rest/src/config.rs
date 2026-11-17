// ACS REST driver
// Connection details, the same fields as the built-in's RESTConnDetails
// Copyright 2026 University of Sheffield

//! The connection details are the built-in connection's
//! `RESTConnDetails` unchanged, so moving a connection to this driver
//! moves them as they are:
//!
//! Field|
//! ---|---
//! `baseURL`|Joined to the front of every address.
//! `authMethod`|`Basic` sends HTTP Basic auth. Anything else, usually `None`, sends no auth.
//! `username`, `password`|For `Basic`. Both must be present, as the built-in required.

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use rs_edge_driver::HandlerError;
use serde_json::Value;

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

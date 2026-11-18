// ACS MQTT driver
// Connection details, read as the Edge Agent's built-in MQTT connection reads them
// Copyright 2026 University of Sheffield

//! The connection details a split MQTT connection is configured with.
//!
//! They are the built-in MQTT connection's `MQTTConnDetails`, field
//! for field, so moving a connection to this driver only moves them.
//! Each field is read the way `acs-edge/lib/devices/MQTT.ts` and the
//! npm `mqtt` package it uses read it.

use std::time::Duration;

use serde_json::Value;

/// How the driver reaches the broker, from the `protocol` field.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Protocol {
    /// `mqtt` or `tcp`: plain TCP.
    Tcp,
    /// `mqtts` or `tls`: TLS, with the server's certificate checked.
    Tls,
    /// `ws`: a WebSocket on the path `/mqtt`.
    Ws,
    /// `wss`: a WebSocket over TLS on the path `/mqtt`.
    Wss,
}

impl Protocol {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "mqtt" | "tcp" => Some(Self::Tcp),
            "mqtts" | "tls" => Some(Self::Tls),
            "ws" => Some(Self::Ws),
            "wss" => Some(Self::Wss),
            _ => None,
        }
    }

    /// Whether the connection uses TLS.
    pub fn tls(self) -> bool {
        matches!(self, Self::Tls | Self::Wss)
    }
}

/// The WebSocket path the built-in connects to. Its URL is
/// `ws://host:port` with no path, and mqtt.js 5 then uses `/`
/// (`setDefaultOpts` in `lib/connect/ws.ts`).
pub const WS_PATH: &str = "/";

/// mqtt.js's keep-alive when none is given.
const DEFAULT_KEEP_ALIVE: u64 = 60;

/// The connection details, checked and with the built-in's defaults
/// filled in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Conf {
    pub protocol: Protocol,
    pub host: String,
    pub port: u16,
    /// The client id, or `None` to make one up (`NO-ID-<uuid>`), as
    /// the built-in does.
    pub client_id: Option<String>,
    /// Username and password. The built-in sends them only when the
    /// username is set, and then the password only if it is set.
    pub credentials: Option<(String, String)>,
    pub clean_session: bool,
    /// Zero turns keep-alive off, as it does in mqtt.js.
    pub keep_alive: Duration,
}

impl Conf {
    /// Read the connection details the Edge Agent sends in `conf`.
    pub fn from_json(conf: &Value) -> Result<Self, String> {
        let protocol = match conf.get("protocol") {
            Some(Value::String(s)) => {
                Protocol::parse(s).ok_or_else(|| format!("unknown protocol {s:?}"))?
            }
            _ => return Err("protocol is missing".into()),
        };

        let host = match conf.get("host") {
            Some(Value::String(s)) if !s.is_empty() => s.clone(),
            _ => return Err("host is missing".into()),
        };

        let port = conf
            .get("port")
            .and_then(port_of)
            .ok_or("port is missing or not a port number")?;

        // `clientId || 'NO-ID-' + uuid`: an empty id counts as none.
        let client_id = match conf.get("clientId") {
            Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
            _ => None,
        };

        // `if (connDetails.username)`, so an empty username sends no
        // credentials, whatever the password.
        let credentials = match conf.get("username") {
            Some(Value::String(u)) if !u.is_empty() => {
                let p = match conf.get("password") {
                    Some(Value::String(p)) => p.clone(),
                    _ => String::new(),
                };
                Some((u.clone(), p))
            }
            _ => None,
        };

        // mqtt.js treats a missing `clean` as true. A value that is
        // not a boolean is taken as JavaScript would test it.
        let clean_session = conf.get("cleanSession").is_none_or(truthy);

        let keep_alive = match conf.get("keepAlive") {
            None | Some(Value::Null) => DEFAULT_KEEP_ALIVE,
            Some(v) => seconds_of(v).ok_or("keepAlive is not a number of seconds")?,
        };

        Ok(Self {
            protocol,
            host,
            port,
            client_id,
            credentials,
            clean_session,
            keep_alive: Duration::from_secs(keep_alive),
        })
    }

    /// The client id. A made-up one is new on each call, so call this
    /// once and keep the result: the built-in makes one when the
    /// connection is set up and keeps it across reconnects.
    pub fn client_id(&self) -> String {
        match &self.client_id {
            Some(id) => id.clone(),
            None => format!("NO-ID-{}", uuid::Uuid::new_v4()),
        }
    }

    /// The broker address as the built-in logs it.
    pub fn url(&self) -> String {
        let scheme = match self.protocol {
            Protocol::Tcp => "mqtt",
            Protocol::Tls => "mqtts",
            Protocol::Ws => "ws",
            Protocol::Wss => "wss",
        };
        format!("{scheme}://{}:{}", self.host, self.port)
    }
}

/// A port number, from a JSON number or a string of digits.
fn port_of(v: &Value) -> Option<u16> {
    match v {
        Value::Number(n) => n.as_u64().and_then(|p| u16::try_from(p).ok()),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

/// Whole seconds from a JSON number or numeric string. mqtt.js sends
/// the keep-alive as a 16-bit count of seconds, so a fraction is
/// dropped and anything outside 0 to 65535 is refused.
fn seconds_of(v: &Value) -> Option<u64> {
    let f = match v {
        Value::Number(n) => n.as_f64()?,
        Value::String(s) => s.trim().parse().ok()?,
        _ => return None,
    };
    (0.0..65536.0).contains(&f).then(|| f.trunc() as u64)
}

/// JavaScript truthiness.
fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Value::String(s) => !s.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn base() -> Value {
        json!({ "protocol": "mqtt", "host": "broker", "port": 1883 })
    }

    fn with(extra: Value) -> Value {
        let mut v = base();
        for (k, x) in extra.as_object().unwrap() {
            v[k] = x.clone();
        }
        v
    }

    #[test]
    fn minimal_config_takes_the_built_in_defaults() {
        let c = Conf::from_json(&base()).unwrap();
        assert_eq!(c.protocol, Protocol::Tcp);
        assert_eq!(c.host, "broker");
        assert_eq!(c.port, 1883);
        assert_eq!(c.client_id, None);
        assert_eq!(c.credentials, None);
        assert!(c.clean_session);
        assert_eq!(c.keep_alive, Duration::from_secs(60));
        assert_eq!(c.url(), "mqtt://broker:1883");
    }

    #[test]
    fn every_protocol_in_the_form() {
        for (p, want) in [
            ("mqtt", Protocol::Tcp),
            ("tcp", Protocol::Tcp),
            ("mqtts", Protocol::Tls),
            ("tls", Protocol::Tls),
            ("ws", Protocol::Ws),
            ("wss", Protocol::Wss),
        ] {
            let c = Conf::from_json(&with(json!({ "protocol": p }))).unwrap();
            assert_eq!(c.protocol, want, "{p}");
        }
        assert!(Conf::from_json(&with(json!({ "protocol": "http" }))).is_err());
        assert!(Conf::from_json(&with(json!({ "protocol": null }))).is_err());
    }

    #[test]
    fn host_and_port_are_required() {
        assert!(Conf::from_json(&with(json!({ "host": "" }))).is_err());
        assert!(Conf::from_json(&json!({ "protocol": "mqtt", "port": 1 })).is_err());
        assert!(Conf::from_json(&json!({ "protocol": "mqtt", "host": "h" })).is_err());
        assert!(Conf::from_json(&with(json!({ "port": 70000 }))).is_err());
        assert!(Conf::from_json(&with(json!({ "port": -1 }))).is_err());
        let c = Conf::from_json(&with(json!({ "port": "8883" }))).unwrap();
        assert_eq!(c.port, 8883);
    }

    #[test]
    fn client_id_is_kept_or_made_up() {
        let c = Conf::from_json(&with(json!({ "clientId": "edge-1" }))).unwrap();
        assert_eq!(c.client_id(), "edge-1");

        let c = Conf::from_json(&with(json!({ "clientId": "" }))).unwrap();
        let a = c.client_id();
        let b = c.client_id();
        assert!(a.starts_with("NO-ID-") && a.len() == 42, "{a}");
        assert_ne!(a, b, "a made-up id is new on each call");
    }

    #[test]
    fn credentials_only_with_a_username() {
        let c = Conf::from_json(&with(json!({ "username": "u", "password": "p" }))).unwrap();
        assert_eq!(c.credentials, Some(("u".into(), "p".into())));

        let c = Conf::from_json(&with(json!({ "username": "u" }))).unwrap();
        assert_eq!(c.credentials, Some(("u".into(), String::new())));

        // Real configs have a password with no username. The built-in
        // sends neither.
        for u in [json!(""), json!(null)] {
            let c = Conf::from_json(&with(json!({ "username": u, "password": "p" }))).unwrap();
            assert_eq!(c.credentials, None);
        }
    }

    #[test]
    fn clean_session_and_keep_alive() {
        let c = Conf::from_json(&with(json!({ "cleanSession": false, "keepAlive": 30 }))).unwrap();
        assert!(!c.clean_session);
        assert_eq!(c.keep_alive, Duration::from_secs(30));

        let c = Conf::from_json(&with(json!({ "cleanSession": "", "keepAlive": 0 }))).unwrap();
        assert!(!c.clean_session);
        assert_eq!(c.keep_alive, Duration::ZERO);

        let c = Conf::from_json(&with(json!({ "keepAlive": 2.9 }))).unwrap();
        assert_eq!(c.keep_alive, Duration::from_secs(2));
        let c = Conf::from_json(&with(json!({ "keepAlive": "15" }))).unwrap();
        assert_eq!(c.keep_alive, Duration::from_secs(15));

        assert!(Conf::from_json(&with(json!({ "keepAlive": -1 }))).is_err());
        assert!(Conf::from_json(&with(json!({ "keepAlive": 70000 }))).is_err());
        assert!(Conf::from_json(&with(json!({ "keepAlive": "soon" }))).is_err());
    }

    /// `useSSL` is in the form but the built-in never reads it: only
    /// `protocol` decides whether TLS is used.
    #[test]
    fn use_ssl_is_ignored() {
        let c = Conf::from_json(&with(json!({ "useSSL": true }))).unwrap();
        assert!(!c.protocol.tls());
        let c = Conf::from_json(&with(json!({ "protocol": "mqtts", "useSSL": false }))).unwrap();
        assert!(c.protocol.tls());
    }
}

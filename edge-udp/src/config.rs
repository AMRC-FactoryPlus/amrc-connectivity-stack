// ACS UDP driver
// The connection details, as the built-in connection reads them
// Copyright 2026 University of Sheffield

//! The connection details are the built-in connection's
//! `UDPConnDetails`, unchanged, so a connection moves to this driver
//! without editing them: `{"port": 50205}`.

use rs_edge_driver::HandlerError;

/// The connection details.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UdpConf {
    /// The UDP port to listen on, on every IPv4 address. 0 lets the
    /// system choose one.
    pub port: u16,
}

impl UdpConf {
    /// Read `{"port": n}`. The port may be a number or a string of
    /// digits, as Node's `socket.bind` takes either.
    ///
    /// The built-in connection binds a random port when `port` is
    /// missing, which no device can know to send to, so this refuses
    /// it instead. The driver then reports `CONF`.
    pub fn from_json(conf: &serde_json::Value) -> Result<Self, HandlerError> {
        let port = match conf.get("port") {
            Some(serde_json::Value::Number(n)) => n.as_u64(),
            Some(serde_json::Value::String(s)) => s.trim().parse::<u64>().ok(),
            None | Some(serde_json::Value::Null) => {
                return Err(HandlerError::new("the connection has no port"));
            }
            Some(_) => None,
        };
        match port.and_then(|p| u16::try_from(p).ok()) {
            Some(port) => Ok(Self { port }),
            None => Err(HandlerError::new(format!(
                "port {} is not a UDP port (0 to 65535)",
                conf["port"]
            ))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn port_as_number_or_string() {
        assert_eq!(
            UdpConf::from_json(&json!({"port": 50205})).unwrap().port,
            50205
        );
        assert_eq!(
            UdpConf::from_json(&json!({"port": "50205"})).unwrap().port,
            50205
        );
        assert_eq!(UdpConf::from_json(&json!({"port": 0})).unwrap().port, 0);
    }

    #[test]
    fn extra_fields_are_ignored() {
        let c = UdpConf::from_json(&json!({"port": 1234, "other": true})).unwrap();
        assert_eq!(c.port, 1234);
    }

    #[test]
    fn bad_ports_are_refused() {
        for conf in [
            json!({}),
            json!({"port": null}),
            json!({"port": -1}),
            json!({"port": 65536}),
            json!({"port": 1.5}),
            json!({"port": "fifty"}),
            json!({"port": true}),
            json!([]),
        ] {
            assert!(UdpConf::from_json(&conf).is_err(), "{conf} was accepted");
        }
    }
}

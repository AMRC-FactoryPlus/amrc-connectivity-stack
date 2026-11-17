// ACS OPC UA driver
// Connection details, as the built-in OPC UA connection takes them
// Copyright 2026 University of Sheffield

//! The connection details. They are the built-in connection's
//! `OPCUAConnDetails` unchanged, so moving a connection to this driver
//! only moves them from one key to another.

use opcua::crypto::SecurityPolicy;
use opcua::types::MessageSecurityMode;
use serde::Deserialize;

/// The details as the Edge Agent sends them in `conf`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnDetails {
    pub endpoint: String,
    #[serde(default)]
    pub security_mode: Option<String>,
    #[serde(default)]
    pub security_policy: Option<String>,
    #[serde(default)]
    pub use_credentials: bool,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
}

/// The details, checked and in the library's terms.
#[derive(Debug, Clone)]
pub struct Config {
    pub endpoint: String,
    pub mode: MessageSecurityMode,
    pub policy: SecurityPolicy,
    /// User name and password, if the connection uses credentials.
    pub credentials: Option<(String, String)>,
}

/// The security modes the DriverDef offers. An empty or missing mode
/// is `None`, the DriverDef's default.
fn security_mode(mode: &str) -> Option<MessageSecurityMode> {
    match mode {
        "" | "None" => Some(MessageSecurityMode::None),
        "Sign" => Some(MessageSecurityMode::Sign),
        "SignAndEncrypt" => Some(MessageSecurityMode::SignAndEncrypt),
        _ => None,
    }
}

/// The security policies the DriverDef offers that an OPC UA server
/// can use. The built-in connection maps `Aes128_Sha256` to
/// Aes128_Sha256_RsaOaep, and so does this.
///
/// The DriverDef also lists Basic128, Basic192, Basic192Rsa15,
/// Basic256Rsa15, PubSub_Aes128_CTR and PubSub_Aes256_CTR. No OPC UA
/// server offers these for a client connection and the built-in
/// connection can't connect with them either, so they are refused here
/// with a clear message instead.
fn security_policy(policy: &str) -> Result<SecurityPolicy, String> {
    match policy {
        "" | "None" => Ok(SecurityPolicy::None),
        "Basic128Rsa15" => Ok(SecurityPolicy::Basic128Rsa15),
        "Basic256" => Ok(SecurityPolicy::Basic256),
        "Basic256Sha256" => Ok(SecurityPolicy::Basic256Sha256),
        "Aes128_Sha256" | "Aes128_Sha256_RsaOaep" => Ok(SecurityPolicy::Aes128Sha256RsaOaep),
        "Aes256_Sha256_RsaPss" => Ok(SecurityPolicy::Aes256Sha256RsaPss),
        "Basic128" | "Basic192" | "Basic192Rsa15" | "Basic256Rsa15" | "PubSub_Aes128_CTR"
        | "PubSub_Aes256_CTR" => Err(format!(
            "security policy {policy} is not one an OPC UA server can offer for a connection"
        )),
        _ => Err(format!("unknown security policy {policy:?}")),
    }
}

impl Config {
    /// Check the details from `conf`.
    pub fn from_json(value: serde_json::Value) -> Result<Self, String> {
        let details: ConnDetails =
            serde_json::from_value(value).map_err(|e| format!("bad connection details: {e}"))?;

        let endpoint = details.endpoint.trim().to_owned();
        if !endpoint.starts_with("opc.tcp://") {
            return Err(format!("endpoint {endpoint:?} is not an opc.tcp:// URL"));
        }

        let mode_name = details.security_mode.unwrap_or_default();
        let mode = security_mode(&mode_name)
            .ok_or_else(|| format!("unknown security mode {mode_name:?}"))?;
        // No security has no policy, whatever the policy field says, so
        // it isn't read. (The built-in sent the policy anyway and the
        // server refused the channel.) A secure mode needs one.
        let policy = match mode {
            MessageSecurityMode::None => SecurityPolicy::None,
            m => match security_policy(&details.security_policy.unwrap_or_default())? {
                SecurityPolicy::None => {
                    return Err(format!("security mode {m:?} needs a security policy"));
                }
                p => p,
            },
        };

        let credentials = details.use_credentials.then(|| {
            (
                details.username.unwrap_or_default(),
                details.password.unwrap_or_default(),
            )
        });

        Ok(Self {
            endpoint,
            mode,
            policy,
            credentials,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn conf(mode: &str, policy: &str) -> serde_json::Value {
        json!({
            "endpoint": "opc.tcp://plc.example:4840",
            "securityMode": mode,
            "securityPolicy": policy,
            "useCredentials": false,
            "username": "",
            "password": "",
        })
    }

    #[test]
    fn takes_the_builtin_connection_details() {
        let c = Config::from_json(json!({
            "endpoint": " opc.tcp://plc.example:4840/path ",
            "securityMode": "SignAndEncrypt",
            "securityPolicy": "Basic256Sha256",
            "useCredentials": true,
            "username": "user",
            "password": "secret",
        }))
        .unwrap();
        assert_eq!(c.endpoint, "opc.tcp://plc.example:4840/path");
        assert_eq!(c.mode, MessageSecurityMode::SignAndEncrypt);
        assert_eq!(c.policy, SecurityPolicy::Basic256Sha256);
        assert_eq!(c.credentials, Some(("user".into(), "secret".into())));
    }

    #[test]
    fn credentials_only_when_asked_for() {
        let mut v = conf("None", "None");
        v["username"] = json!("user");
        assert_eq!(Config::from_json(v).unwrap().credentials, None);
    }

    #[test]
    fn missing_security_is_none() {
        let c = Config::from_json(json!({ "endpoint": "opc.tcp://plc.example:4840" })).unwrap();
        assert_eq!(c.mode, MessageSecurityMode::None);
        assert_eq!(c.policy, SecurityPolicy::None);
    }

    #[test]
    fn every_policy_a_server_can_offer() {
        for (name, policy) in [
            ("Basic128Rsa15", SecurityPolicy::Basic128Rsa15),
            ("Basic256", SecurityPolicy::Basic256),
            ("Basic256Sha256", SecurityPolicy::Basic256Sha256),
            ("Aes128_Sha256", SecurityPolicy::Aes128Sha256RsaOaep),
            ("Aes128_Sha256_RsaOaep", SecurityPolicy::Aes128Sha256RsaOaep),
            ("Aes256_Sha256_RsaPss", SecurityPolicy::Aes256Sha256RsaPss),
        ] {
            for mode in ["Sign", "SignAndEncrypt"] {
                let c = Config::from_json(conf(mode, name)).unwrap();
                assert_eq!(c.policy, policy, "{mode} {name}");
            }
        }
    }

    #[test]
    fn refuses_what_no_server_offers() {
        for name in [
            "Basic128",
            "Basic192",
            "Basic192Rsa15",
            "Basic256Rsa15",
            "PubSub_Aes128_CTR",
            "PubSub_Aes256_CTR",
            "Nonsense",
        ] {
            assert!(
                Config::from_json(conf("SignAndEncrypt", name)).is_err(),
                "{name}"
            );
        }
    }

    #[test]
    fn no_security_ignores_the_policy() {
        for policy in [
            "Basic256Sha256",
            "Basic192",
            "PubSub_Aes128_CTR",
            "Nonsense",
        ] {
            let c = Config::from_json(conf("None", policy)).unwrap();
            assert_eq!(c.policy, SecurityPolicy::None, "{policy}");
        }
    }

    #[test]
    fn refuses_a_secure_mode_without_a_policy() {
        assert!(Config::from_json(conf("Sign", "None")).is_err());
        assert!(Config::from_json(conf("Encrypt", "Basic256")).is_err());
    }

    #[test]
    fn refuses_a_non_opc_endpoint() {
        let mut v = conf("None", "None");
        v["endpoint"] = json!("http://plc.example:4840");
        assert!(Config::from_json(v).is_err());
        assert!(Config::from_json(json!({})).is_err());
    }
}

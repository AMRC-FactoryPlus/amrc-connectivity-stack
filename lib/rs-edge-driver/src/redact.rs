//! Redact secrets from values before they are logged.
//!
//! The edge agent substitutes secrets into the driver config before
//! sending it, so the config we receive can contain plaintext
//! credentials. We can't know every driver's field names, so match on
//! the key instead. This errs towards masking too much; it only affects
//! what is logged.

use serde_json::Value;

/// Key fragments that mark a value as sensitive (case-insensitive).
const SENSITIVE: &[&str] = &["pass", "pwd", "secret", "token", "key", "cred"];
const MASK: &str = "***";

fn is_sensitive(key: &str) -> bool {
    let key = key.to_lowercase();
    SENSITIVE.iter().any(|s| key.contains(s))
}

fn is_empty(v: &Value) -> bool {
    matches!(v, Value::Null) || v.as_str() == Some("")
}

/// Mask credentials embedded in a URL, e.g. `mqtt://user:pass@host`.
fn redact_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;

    while let Some(i) = rest.find("//") {
        let (head, tail) = rest.split_at(i + 2);
        out.push_str(head);

        let end = tail
            .find(|c: char| c == '/' || c.is_whitespace())
            .unwrap_or(tail.len());
        let authority = &tail[..end];

        match authority.rfind('@').and_then(|at| {
            let colon = authority[..at].find(':')?;
            (!authority[..colon].contains('@')).then_some((colon, at))
        }) {
            Some((colon, at)) => {
                out.push_str(&authority[..=colon]);
                out.push_str(MASK);
                out.push_str(&authority[at..]);
                rest = &tail[end..];
            }
            None => rest = tail,
        }
    }
    out.push_str(rest);
    out
}

/// Return a copy of `value` that is safe to log.
///
/// Values under sensitive keys are masked, recursively, but the keys
/// themselves are kept so the log still shows the config's shape.
pub fn redact(value: &Value) -> Value {
    match value {
        Value::String(s) => Value::String(redact_str(s)),
        Value::Array(a) => Value::Array(a.iter().map(redact).collect()),
        Value::Object(o) => Value::Object(
            o.iter()
                .map(|(k, v)| {
                    let v = if is_sensitive(k) && !is_empty(v) {
                        Value::String(MASK.into())
                    } else {
                        redact(v)
                    };
                    (k.clone(), v)
                })
                .collect(),
        ),
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn masks_sensitive_keys() {
        let conf = json!({
            "host": "10.0.0.1", "port": 502,
            "username": "operator", "password": "not-a-real-password",
        });
        assert_eq!(
            redact(&conf),
            json!({
                "host": "10.0.0.1", "port": 502,
                "username": "operator", "password": "***",
            })
        );
    }

    #[test]
    fn matches_case_insensitively() {
        let out = redact(&json!({
            "Password": "x", "clientSecret": "x", "API_TOKEN": "x",
            "apiKey": "x", "credentials": "x", "passwd": "x", "pwd": "x",
        }));
        for v in out.as_object().unwrap().values() {
            assert_eq!(v, "***");
        }
    }

    #[test]
    fn recurses_and_masks_subtrees() {
        let out = redact(&json!({
            "auth": { "user": "u", "password": "x" },
            "servers": [{ "host": "a", "token": "x" }, { "host": "b" }],
            "credentials": { "user": "u", "pass": "x" },
        }));
        assert_eq!(
            out,
            json!({
                "auth": { "user": "u", "password": "***" },
                "servers": [{ "host": "a", "token": "***" }, { "host": "b" }],
                "credentials": "***",
            })
        );
    }

    #[test]
    fn leaves_empty_values_visible() {
        let conf = json!({ "password": "", "secret": null });
        assert_eq!(redact(&conf), conf);
    }

    #[test]
    fn masks_url_credentials() {
        let out = redact(&json!({
            "url": "mqtt://user:pa@ss@broker:1883/path",
            "plain": "http://broker:8080/a@b",
        }));
        assert_eq!(out["url"], "mqtt://user:***@broker:1883/path");
        assert_eq!(out["plain"], "http://broker:8080/a@b");
    }

    #[test]
    fn passes_scalars_through() {
        assert_eq!(redact(&json!(null)), json!(null));
        assert_eq!(redact(&json!(42)), json!(42));
        assert_eq!(redact(&json!("plain")), json!("plain"));
    }
}

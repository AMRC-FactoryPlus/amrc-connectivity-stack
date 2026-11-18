//! Typed writes from the edge agent.
//!
//! The edge agent sends every write twice: the value as raw bytes on
//! `fpEdge1/{id}/cmd/{address}`, and as JSON with its Sparkplug type
//! on `fpEdge1/{id}/write/{address}`. A handler that sets
//! [`Handler::TYPED_WRITES`](crate::Handler::TYPED_WRITES) gets the
//! second form through [`Handler::write`](crate::Handler::write). See
//! "Typed writes" in `acs-edge/docs/edge-split.md`.

use std::fmt;

use serde::Deserialize;
use serde_json::Value;

/// The value of a typed write, with its Sparkplug type.
///
/// `#[non_exhaustive]`: Sparkplug has more types than these, and the
/// edge agent may send more of them in future, so match with a `_` arm.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub enum WriteValue {
    Boolean(bool),
    Int8(i8),
    Int16(i16),
    Int32(i32),
    Int64(i64),
    UInt8(u8),
    UInt16(u16),
    UInt32(u32),
    UInt64(u64),
    Float(f32),
    Double(f64),
    String(String),
    Text(String),
    Uuid(String),
    /// Milliseconds since the Unix epoch.
    DateTime(i64),
}

impl WriteValue {
    /// The Sparkplug type name, as the edge agent writes it
    /// (`"Int16"`, `"UUID"` and so on).
    pub fn type_name(&self) -> &'static str {
        match self {
            Self::Boolean(_) => "Boolean",
            Self::Int8(_) => "Int8",
            Self::Int16(_) => "Int16",
            Self::Int32(_) => "Int32",
            Self::Int64(_) => "Int64",
            Self::UInt8(_) => "UInt8",
            Self::UInt16(_) => "UInt16",
            Self::UInt32(_) => "UInt32",
            Self::UInt64(_) => "UInt64",
            Self::Float(_) => "Float",
            Self::Double(_) => "Double",
            Self::String(_) => "String",
            Self::Text(_) => "Text",
            Self::Uuid(_) => "UUID",
            Self::DateTime(_) => "DateTime",
        }
    }

    /// Parse the payload of a typed write:
    /// `{"type": <Sparkplug type>, "value": <value>}`. Int64 and
    /// UInt64 values are decimal strings, and Float and Double may be
    /// the strings `"NaN"`, `"Infinity"` and `"-Infinity"`. Keys other
    /// than `type` and `value` are ignored.
    pub fn from_json(payload: &[u8]) -> Result<Self, String> {
        #[derive(Deserialize)]
        struct Wire {
            #[serde(rename = "type")]
            ty: String,
            #[serde(default)]
            value: Value,
        }
        let w: Wire =
            serde_json::from_slice(payload).map_err(|e| format!("bad typed write: {e}"))?;
        Self::from_parts(&w.ty, &w.value).ok_or_else(|| format!("bad {} value {}", w.ty, w.value))
    }

    /// The id of a write the edge agent is waiting for an answer to,
    /// from the `id` key of the payload. `None` if there is none or it
    /// can't be a topic level (letters, digits and `_` only), so the
    /// agent isn't waiting. See "Write results" in
    /// `acs-edge/docs/edge-split.md`.
    pub(crate) fn id_of(payload: &[u8]) -> Option<String> {
        let w: serde_json::Map<String, Value> = serde_json::from_slice(payload).ok()?;
        let id = w.get("id")?.as_str()?;
        let ok = !id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_');
        ok.then(|| id.to_owned())
    }

    fn from_parts(ty: &str, v: &Value) -> Option<Self> {
        fn int<T: TryFrom<i64>>(v: &Value) -> Option<T> {
            v.as_i64().and_then(|n| T::try_from(n).ok())
        }
        fn uint<T: TryFrom<u64>>(v: &Value) -> Option<T> {
            v.as_u64().and_then(|n| T::try_from(n).ok())
        }
        fn float(v: &Value) -> Option<f64> {
            match v {
                Value::Number(n) => n.as_f64(),
                Value::String(s) => match s.as_str() {
                    "NaN" => Some(f64::NAN),
                    "Infinity" => Some(f64::INFINITY),
                    "-Infinity" => Some(f64::NEG_INFINITY),
                    _ => None,
                },
                _ => None,
            }
        }
        fn string(v: &Value) -> Option<String> {
            v.as_str().map(str::to_owned)
        }

        Some(match ty {
            "Boolean" => Self::Boolean(v.as_bool()?),
            "Int8" => Self::Int8(int(v)?),
            "Int16" => Self::Int16(int(v)?),
            "Int32" => Self::Int32(int(v)?),
            "Int64" => Self::Int64(match v {
                Value::String(s) => s.parse().ok()?,
                _ => v.as_i64()?,
            }),
            "UInt8" => Self::UInt8(uint(v)?),
            "UInt16" => Self::UInt16(uint(v)?),
            "UInt32" => Self::UInt32(uint(v)?),
            "UInt64" => Self::UInt64(match v {
                Value::String(s) => s.parse().ok()?,
                _ => v.as_u64()?,
            }),
            // `as f32` turns a finite value too big for f32 into
            // infinity, which is not what was asked for.
            "Float" => Self::Float(match float(v)? {
                f if f.is_finite() && f.abs() > f64::from(f32::MAX) => return None,
                f => f as f32,
            }),
            "Double" => Self::Double(float(v)?),
            "String" => Self::String(string(v)?),
            "Text" => Self::Text(string(v)?),
            "UUID" => Self::Uuid(string(v)?),
            "DateTime" => Self::DateTime(v.as_i64()?),
            _ => return None,
        })
    }
}

impl fmt::Display for WriteValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Boolean(v) => write!(f, "{v}"),
            Self::Int8(v) => write!(f, "{v}"),
            Self::Int16(v) => write!(f, "{v}"),
            Self::Int32(v) => write!(f, "{v}"),
            Self::Int64(v) => write!(f, "{v}"),
            Self::UInt8(v) => write!(f, "{v}"),
            Self::UInt16(v) => write!(f, "{v}"),
            Self::UInt32(v) => write!(f, "{v}"),
            Self::UInt64(v) => write!(f, "{v}"),
            Self::Float(v) => write!(f, "{v}"),
            Self::Double(v) => write!(f, "{v}"),
            Self::String(v) | Self::Text(v) | Self::Uuid(v) => write!(f, "{v:?}"),
            Self::DateTime(v) => write!(f, "{v}ms"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::WriteValue::{self, *};

    fn parse(s: &str) -> Result<WriteValue, std::string::String> {
        WriteValue::from_json(s.as_bytes())
    }

    /// Every scalar type, as the edge agent writes it (acs-edge
    /// `writeValToJSON`).
    #[test]
    fn parses_every_scalar_type() {
        let cases = [
            (r#"{"type":"Boolean","value":true}"#, Boolean(true)),
            (r#"{"type":"Int8","value":-128}"#, Int8(-128)),
            (r#"{"type":"Int16","value":-2}"#, Int16(-2)),
            (r#"{"type":"Int32","value":-2147483648}"#, Int32(i32::MIN)),
            (
                r#"{"type":"Int64","value":"-9223372036854775808"}"#,
                Int64(i64::MIN),
            ),
            (r#"{"type":"UInt8","value":255}"#, UInt8(255)),
            (r#"{"type":"UInt16","value":65535}"#, UInt16(65535)),
            (r#"{"type":"UInt32","value":4294967295}"#, UInt32(u32::MAX)),
            (
                r#"{"type":"UInt64","value":"18446744073709551615"}"#,
                UInt64(u64::MAX),
            ),
            (r#"{"type":"Float","value":1.5}"#, Float(1.5)),
            (r#"{"type":"Double","value":-0.1}"#, Double(-0.1)),
            (
                r#"{"type":"Float","value":"-Infinity"}"#,
                Float(f32::NEG_INFINITY),
            ),
            (
                r#"{"type":"String","value":"héllo \"q\"/1"}"#,
                String("héllo \"q\"/1".into()),
            ),
            (r#"{"type":"Text","value":"a\nb"}"#, Text("a\nb".into())),
            (
                r#"{"type":"UUID","value":"2f0d6a0a-58e1-4f5a-9b0c-0d1e2f3a4b5c"}"#,
                Uuid("2f0d6a0a-58e1-4f5a-9b0c-0d1e2f3a4b5c".into()),
            ),
            (
                r#"{"type":"DateTime","value":1763380800123}"#,
                DateTime(1763380800123),
            ),
        ];
        for (json, want) in cases {
            let got = parse(json).unwrap();
            assert_eq!(got, want, "{json}");
            assert!(json.contains(got.type_name()), "{json}");
        }
        match parse(r#"{"type":"Double","value":"NaN"}"#).unwrap() {
            Double(v) => assert!(v.is_nan()),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn float_keeps_values_that_fit_f32() {
        assert_eq!(
            parse(r#"{"type":"Float","value":3.4e38}"#).unwrap(),
            Float(3.4e38)
        );
        assert_eq!(
            parse(r#"{"type":"Float","value":"Infinity"}"#).unwrap(),
            Float(f32::INFINITY)
        );
        // Too big for f32 is fine as a Double.
        assert_eq!(
            parse(r#"{"type":"Double","value":1e39}"#).unwrap(),
            Double(1e39)
        );
    }

    #[test]
    fn ignores_unknown_keys() {
        assert_eq!(
            parse(r#"{"type":"Int16","value":3,"extra":1}"#).unwrap(),
            Int16(3)
        );
    }

    #[test]
    fn refuses_values_that_do_not_fit() {
        for bad in [
            "not json",
            r#"{"value":1}"#,
            r#"{"type":"Int8","value":128}"#,
            r#"{"type":"UInt16","value":-1}"#,
            r#"{"type":"Int16","value":1.5}"#,
            r#"{"type":"Int64","value":"12x"}"#,
            r#"{"type":"UInt64","value":"-1"}"#,
            r#"{"type":"Boolean","value":"true"}"#,
            r#"{"type":"Double","value":"nan"}"#,
            r#"{"type":"Float","value":1e39}"#,
            r#"{"type":"Float","value":-3.5e38}"#,
            r#"{"type":"String","value":5}"#,
            r#"{"type":"Bytes","value":"AA=="}"#,
            r#"{"type":"Int16"}"#,
        ] {
            assert!(parse(bad).is_err(), "{bad} was accepted");
        }
    }
}

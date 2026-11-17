// ACS OPC UA driver
// Values: OPC UA variants to data packets, and typed writes to variants
// Copyright 2026 University of Sheffield

//! Turning values into what goes over the driver protocol, both ways.
//!
//! **Reads.** The built-in connection handed the Edge Agent the value
//! node-opcua decoded, as a JS value, and the agent used it as it was.
//! This driver publishes `{"value": v, "timestamp": ms}` for each
//! address instead (see "Decoded-value drivers" in
//! `acs-edge/docs/edge-split.md`), and the device's payload format is
//! JSON with an empty path. The agent passes a JSON value that is not
//! a string through as it is, and parses a string for the metric's
//! type. So each value is written as the JSON form of what node-opcua
//! would have given, which decodes to the same JS value:
//!
//! OPC UA type | node-opcua gives | this sends
//! ---|---|---
//! Boolean | boolean | `true` / `false`
//! SByte to UInt32, Double | number | number
//! Float | the float widened to a double | the same number
//! Int64, UInt64 | `[high, low]` 32-bit words | the number, see below
//! String | string | string
//! DateTime | `Date` | milliseconds since the epoch
//! Guid | upper-case string | upper-case string
//! ByteString | `Buffer` | `{"type": "Buffer", "data": [...]}`
//! LocalizedText | `{locale, text}` | `{"locale", "text"}`
//! array | typed array or array | array
//!
//! Where JSON can't hold the value the result differs: NaN and the
//! infinities are sent as the strings `"NaN"`, `"Infinity"` and
//! `"-Infinity"`, which the agent parses for Float and Double metrics
//! (it drops NaN). A 64-bit integer is sent as a JSON number with every
//! digit; the agent reads it exactly up to 2^53. The built-in passed
//! node-opcua's `[high, low]` pair, which no metric type reads.
//!
//! **Writes.** The agent sends the metric's Sparkplug type with the
//! value, and the value is written as the OPC UA type the built-in
//! connection wrote for that Sparkplug type (`OPCUADataType` in
//! `acs-edge/lib/helpers/typeHandler.ts`).

use std::str::FromStr;

use opcua::types::{DateTime, Guid, StatusCode, UAString, Variant};
use rs_edge_driver::WriteValue;
use serde_json::{Value, json};

/// The JSON for a float, or the name of a value JSON can't hold.
fn float(v: f64) -> Value {
    if v.is_finite() {
        json!(v)
    } else if v.is_nan() {
        json!("NaN")
    } else if v > 0.0 {
        json!("Infinity")
    } else {
        json!("-Infinity")
    }
}

fn string(s: &UAString) -> Option<Value> {
    s.value().as_ref().map(|s| json!(s))
}

/// Milliseconds since the epoch, as JS `Date.getTime()` gives for the
/// same instant.
pub fn date_ms(d: &DateTime) -> i64 {
    d.as_chrono().timestamp_millis()
}

/// The JSON for a value, or `None` for no value. `None` is not
/// published, as the agent ignored the built-in's null.
pub fn to_json(v: &Variant) -> Option<Value> {
    Some(match v {
        Variant::Empty => return None,
        Variant::Boolean(b) => json!(b),
        Variant::SByte(n) => json!(n),
        Variant::Byte(n) => json!(n),
        Variant::Int16(n) => json!(n),
        Variant::UInt16(n) => json!(n),
        Variant::Int32(n) => json!(n),
        Variant::UInt32(n) => json!(n),
        Variant::Int64(n) => json!(n),
        Variant::UInt64(n) => json!(n),
        Variant::Float(f) => float(f64::from(*f)),
        Variant::Double(f) => float(*f),
        Variant::String(s) => return string(s),
        Variant::DateTime(d) => json!(date_ms(d)),
        Variant::Guid(g) => json!(g.to_string().to_uppercase()),
        Variant::StatusCode(s) => json!(s.bits()),
        Variant::ByteString(b) => {
            let data = b.value.as_ref()?;
            json!({ "type": "Buffer", "data": data })
        }
        Variant::XmlElement(x) => json!(x.to_string()),
        Variant::QualifiedName(q) => json!({
            "namespaceIndex": q.namespace_index,
            "name": q.name.value(),
        }),
        Variant::LocalizedText(t) => json!({
            "locale": t.locale.value(),
            "text": t.text.value(),
        }),
        Variant::NodeId(n) => json!(n.to_string()),
        Variant::ExpandedNodeId(n) => json!(n.to_string()),
        Variant::Variant(inner) => return to_json(inner),
        Variant::Array(a) => Value::Array(
            a.values
                .iter()
                .map(|v| to_json(v).unwrap_or(Value::Null))
                .collect(),
        ),
        // Structures and the rest have no JSON form the agent can use.
        // The built-in passed node-opcua's object, which no metric type
        // reads either.
        Variant::ExtensionObject(_) | Variant::DataValue(_) | Variant::DiagnosticInfo(_) => {
            return None;
        }
    })
}

/// A value with `offset` added back to every DateTime in it.
///
/// With `ignore_clock_skew` async-opcua takes the server's clock offset
/// off every DateTime it decodes, values included. The offset is only
/// meant for the protocol's own timestamps, so this undoes it for
/// values.
pub fn undo_clock_offset(v: Variant, offset: chrono::TimeDelta) -> Variant {
    if offset.is_zero() {
        return v;
    }
    match v {
        Variant::DateTime(d) => Variant::DateTime(Box::new(*d + offset)),
        Variant::Array(mut a) => {
            a.values = std::mem::take(&mut a.values)
                .into_iter()
                .map(|v| undo_clock_offset(v, offset))
                .collect();
            Variant::Array(a)
        }
        Variant::Variant(inner) => Variant::Variant(Box::new(undo_clock_offset(*inner, offset))),
        v => v,
    }
}

/// The data packet for a value received at `received_ms`. The
/// timestamp is when the driver received the value, not the server's
/// timestamp, because the built-in connection's values were stamped
/// when the agent received them.
pub fn packet(v: &Variant, received_ms: i64) -> Option<Vec<u8>> {
    let value = to_json(v)?;
    Some(
        serde_json::to_vec(&json!({ "value": value, "timestamp": received_ms }))
            .expect("JSON values always serialise"),
    )
}

/// The variant to write for a typed write, as the built-in wrote it.
pub fn to_variant(value: &WriteValue) -> Result<Variant, String> {
    Ok(match value {
        WriteValue::Boolean(b) => Variant::Boolean(*b),
        WriteValue::Int8(n) => Variant::SByte(*n),
        WriteValue::Int16(n) => Variant::Int16(*n),
        WriteValue::Int32(n) => Variant::Int32(*n),
        WriteValue::Int64(n) => Variant::Int64(*n),
        WriteValue::UInt8(n) => Variant::Byte(*n),
        WriteValue::UInt16(n) => Variant::UInt16(*n),
        WriteValue::UInt32(n) => Variant::UInt32(*n),
        WriteValue::UInt64(n) => Variant::UInt64(*n),
        WriteValue::Float(f) => Variant::Float(*f),
        WriteValue::Double(f) => Variant::Double(*f),
        WriteValue::String(s) | WriteValue::Text(s) => Variant::String(s.as_str().into()),
        WriteValue::Uuid(s) => Variant::Guid(Box::new(
            Guid::from_str(s.trim()).map_err(|_| format!("{s:?} is not a UUID"))?,
        )),
        WriteValue::DateTime(ms) => {
            let t = opcua::types::DateTimeUtc::from_timestamp_millis(*ms)
                .ok_or_else(|| format!("{ms} ms is out of range for a DateTime"))?;
            Variant::DateTime(Box::new(DateTime::from(t)))
        }
        #[allow(unreachable_patterns)]
        other => return Err(format!("{} can't be written", other.type_name())),
    })
}

/// How a bad write status is reported to the agent: `RO` for a node
/// that can't be written, `CMD` for a value it won't take, and `ERR`
/// otherwise.
pub enum WriteFailure {
    ReadOnly,
    BadValue,
    Failed,
}

pub fn write_failure(status: StatusCode) -> WriteFailure {
    if status == StatusCode::BadNotWritable
        || status == StatusCode::BadUserAccessDenied
        || status == StatusCode::BadWriteNotSupported
    {
        WriteFailure::ReadOnly
    } else if status == StatusCode::BadTypeMismatch
        || status == StatusCode::BadOutOfRange
        || status == StatusCode::BadDataEncodingInvalid
        || status == StatusCode::BadDataEncodingUnsupported
        || status == StatusCode::BadIndexRangeInvalid
    {
        WriteFailure::BadValue
    } else {
        WriteFailure::Failed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use opcua::types::{Array, ByteString, LocalizedText, VariantScalarTypeId};

    fn j(v: Variant) -> Option<Value> {
        to_json(&v)
    }

    #[test]
    fn scalars_as_node_opcua_gives_them() {
        assert_eq!(j(Variant::Boolean(false)), Some(json!(false)));
        assert_eq!(j(Variant::SByte(-128)), Some(json!(-128)));
        assert_eq!(j(Variant::Byte(255)), Some(json!(255)));
        assert_eq!(j(Variant::Int16(-300)), Some(json!(-300)));
        assert_eq!(j(Variant::UInt16(60000)), Some(json!(60000)));
        assert_eq!(j(Variant::Int32(i32::MIN)), Some(json!(i32::MIN)));
        assert_eq!(j(Variant::UInt32(u32::MAX)), Some(json!(u32::MAX)));
        assert_eq!(j(Variant::Double(2.2)), Some(json!(2.2)));
        assert_eq!(j(Variant::String("hello".into())), Some(json!("hello")));
        assert_eq!(j(Variant::String("".into())), Some(json!("")));
    }

    /// node-opcua widens a Float to the double with the same value, so
    /// 1.1f32 is 1.100000023841858, not 1.1.
    #[test]
    fn floats_are_widened_not_rounded() {
        let bytes = serde_json::to_string(&j(Variant::Float(1.1)).unwrap()).unwrap();
        assert_eq!(bytes, "1.100000023841858");
        assert_eq!(j(Variant::Float(0.5)), Some(json!(0.5)));
    }

    #[test]
    fn floats_json_cannot_hold() {
        assert_eq!(j(Variant::Double(f64::NAN)), Some(json!("NaN")));
        assert_eq!(j(Variant::Float(f32::INFINITY)), Some(json!("Infinity")));
        assert_eq!(
            j(Variant::Double(f64::NEG_INFINITY)),
            Some(json!("-Infinity"))
        );
    }

    #[test]
    fn sixty_four_bit_integers_keep_every_digit() {
        assert_eq!(
            serde_json::to_string(&j(Variant::Int64(i64::MIN)).unwrap()).unwrap(),
            "-9223372036854775808"
        );
        assert_eq!(
            serde_json::to_string(&j(Variant::UInt64(u64::MAX)).unwrap()).unwrap(),
            "18446744073709551615"
        );
    }

    #[test]
    fn dates_are_milliseconds() {
        let d = DateTime::from(
            opcua::types::DateTimeUtc::from_timestamp_millis(1_763_380_800_123).unwrap(),
        );
        assert_eq!(
            j(Variant::DateTime(Box::new(d))),
            Some(json!(1_763_380_800_123i64))
        );
    }

    #[test]
    fn guids_are_upper_case() {
        let g = Guid::from_str("72962b91-fa75-4ae6-8d28-b404dc7daf63").unwrap();
        assert_eq!(
            j(Variant::Guid(Box::new(g))),
            Some(json!("72962B91-FA75-4AE6-8D28-B404DC7DAF63"))
        );
    }

    #[test]
    fn other_types() {
        assert_eq!(
            j(Variant::ByteString(ByteString::from(vec![1u8, 2, 3]))),
            Some(json!({ "type": "Buffer", "data": [1, 2, 3] }))
        );
        assert_eq!(
            j(Variant::LocalizedText(Box::new(LocalizedText::new(
                "en", "txt"
            )))),
            Some(json!({ "locale": "en", "text": "txt" }))
        );
        let a = Array::new(
            VariantScalarTypeId::Double,
            vec![Variant::Double(1.5), Variant::Double(2.5)],
        )
        .unwrap();
        assert_eq!(j(Variant::Array(Box::new(a))), Some(json!([1.5, 2.5])));
    }

    #[test]
    fn clock_offset_is_undone_for_dates_only() {
        let t = DateTime::from(
            opcua::types::DateTimeUtc::from_timestamp_millis(1_763_380_800_123).unwrap(),
        );
        let hour = chrono::TimeDelta::hours(1);
        // As async-opcua decodes it from a server an hour fast.
        let shifted = Variant::DateTime(Box::new(t - hour));
        match undo_clock_offset(shifted, hour) {
            Variant::DateTime(d) => assert_eq!(date_ms(&d), 1_763_380_800_123),
            v => panic!("{v:?}"),
        }
        let a = Array::new(
            VariantScalarTypeId::DateTime,
            vec![Variant::DateTime(Box::new(t - hour))],
        )
        .unwrap();
        assert_eq!(
            j(undo_clock_offset(Variant::Array(Box::new(a)), hour)),
            Some(json!([1_763_380_800_123i64]))
        );
        assert_eq!(
            undo_clock_offset(Variant::Double(1.5), hour),
            Variant::Double(1.5)
        );
    }

    #[test]
    fn no_value_is_not_sent() {
        assert_eq!(j(Variant::Empty), None);
        assert_eq!(j(Variant::String(UAString::null())), None);
        assert_eq!(j(Variant::ByteString(ByteString::null())), None);
        assert!(packet(&Variant::Empty, 1).is_none());
    }

    #[test]
    fn packet_is_value_and_timestamp() {
        let p = packet(&Variant::Double(21.5), 1_763_380_800_123).unwrap();
        assert_eq!(
            std::str::from_utf8(&p).unwrap(),
            r#"{"timestamp":1763380800123,"value":21.5}"#
        );
    }

    #[test]
    fn writes_use_the_builtin_types() {
        use WriteValue as W;
        let cases = [
            (W::Boolean(true), Variant::Boolean(true)),
            (W::Int8(-128), Variant::SByte(-128)),
            (W::Int16(-2), Variant::Int16(-2)),
            (W::Int32(i32::MIN), Variant::Int32(i32::MIN)),
            (W::Int64(i64::MIN), Variant::Int64(i64::MIN)),
            (W::UInt8(255), Variant::Byte(255)),
            (W::UInt16(65535), Variant::UInt16(65535)),
            (W::UInt32(u32::MAX), Variant::UInt32(u32::MAX)),
            (W::UInt64(u64::MAX), Variant::UInt64(u64::MAX)),
            (W::Float(1.5), Variant::Float(1.5)),
            (W::Double(-2.25), Variant::Double(-2.25)),
            (W::String("s".into()), Variant::String("s".into())),
            (W::Text("t".into()), Variant::String("t".into())),
        ];
        for (w, v) in cases {
            assert_eq!(to_variant(&w).unwrap(), v, "{}", w.type_name());
        }
        let g = to_variant(&W::Uuid("72962B91-FA75-4AE6-8D28-B404DC7DAF63".into())).unwrap();
        assert_eq!(
            g,
            Variant::Guid(Box::new(
                Guid::from_str("72962b91-fa75-4ae6-8d28-b404dc7daf63").unwrap()
            ))
        );
        assert!(to_variant(&W::Uuid("not a uuid".into())).is_err());
        match to_variant(&W::DateTime(1_763_380_800_456)).unwrap() {
            Variant::DateTime(d) => assert_eq!(date_ms(&d), 1_763_380_800_456),
            v => panic!("{v:?}"),
        }
    }
}

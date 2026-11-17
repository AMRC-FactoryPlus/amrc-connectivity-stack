// ACS MQTT driver
// The payload published for a write
// Copyright 2026 University of Sheffield

//! A write publishes the value to the address's topic as text.
//!
//! The built-in builds a write's payload from the device's payload
//! format and each metric's path (a JSON object, delimited text or
//! packed bytes). A split driver is not sent the format or the paths,
//! only the value and its type, so it cannot do the same. Text is what
//! the built-in sends for a device in "Delimited String" format with
//! one metric written, and what a person would expect on a topic.

use bytes::Bytes;
use rs_edge_driver::WriteValue;

/// The payload for a written value.
pub fn payload(value: &WriteValue) -> Bytes {
    let text = match value {
        WriteValue::Boolean(b) => b.to_string(),
        WriteValue::Int8(n) => n.to_string(),
        WriteValue::Int16(n) => n.to_string(),
        WriteValue::Int32(n) => n.to_string(),
        WriteValue::Int64(n) => n.to_string(),
        WriteValue::UInt8(n) => n.to_string(),
        WriteValue::UInt16(n) => n.to_string(),
        WriteValue::UInt32(n) => n.to_string(),
        WriteValue::UInt64(n) => n.to_string(),
        WriteValue::Float(f) => float(f64::from(*f), f.to_string()),
        WriteValue::Double(f) => float(*f, f.to_string()),
        WriteValue::String(s) | WriteValue::Text(s) | WriteValue::Uuid(s) => s.clone(),
        WriteValue::DateTime(ms) => ms.to_string(),
    };
    Bytes::from(text)
}

/// A float as text, with JavaScript's names for the values that are
/// not numbers, and `0` for minus zero as JavaScript writes it.
fn float(f: f64, text: String) -> String {
    if f == 0.0 {
        "0".into()
    } else if f.is_nan() {
        "NaN".into()
    } else if f == f64::INFINITY {
        "Infinity".into()
    } else if f == f64::NEG_INFINITY {
        "-Infinity".into()
    } else {
        text
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(v: WriteValue) -> String {
        String::from_utf8(payload(&v).to_vec()).unwrap()
    }

    #[test]
    fn values_as_text() {
        assert_eq!(text(WriteValue::Boolean(true)), "true");
        assert_eq!(text(WriteValue::Boolean(false)), "false");
        assert_eq!(text(WriteValue::Int8(-5)), "-5");
        assert_eq!(text(WriteValue::Int64(i64::MIN)), "-9223372036854775808");
        assert_eq!(text(WriteValue::UInt64(u64::MAX)), "18446744073709551615");
        assert_eq!(text(WriteValue::Float(0.1)), "0.1");
        assert_eq!(text(WriteValue::Double(2.5)), "2.5");
        assert_eq!(text(WriteValue::Double(-0.0)), "0");
        assert_eq!(text(WriteValue::String("on".into())), "on");
        assert_eq!(
            text(WriteValue::DateTime(1_700_000_000_000)),
            "1700000000000"
        );
    }

    #[test]
    fn non_numbers_use_javascript_names() {
        assert_eq!(text(WriteValue::Double(f64::NAN)), "NaN");
        assert_eq!(text(WriteValue::Float(f32::INFINITY)), "Infinity");
        assert_eq!(text(WriteValue::Double(f64::NEG_INFINITY)), "-Infinity");
    }
}

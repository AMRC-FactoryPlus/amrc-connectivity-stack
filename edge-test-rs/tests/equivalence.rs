// ACS Rust test driver
// Check every value against the JS driver's output
// Copyright 2026 University of Sheffield

//! `equivalence/table.json` holds what the JS `edge-test` driver gives
//! for a set of addresses and times, made by `equivalence/gen-table.mjs`.
//! Every row must give the same bytes here.
//!
//! The one exception is NaN, from a period of 0. JS writes the NaN the
//! CPU makes, and amd64 and arm64 make NaNs with different sign bits,
//! so the JS driver's own output differs between the two. A NaN row
//! only has to give a NaN.

use edge_test_rs::{Addr, wave};
use serde_json::Value;

const TABLE: &str = include_str!("equivalence/table.json");

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}

fn is_nan(bytes: &[u8], le: bool) -> bool {
    match (bytes.len(), le) {
        (8, false) => f64::from_be_bytes(bytes.try_into().unwrap()).is_nan(),
        (8, true) => f64::from_le_bytes(bytes.try_into().unwrap()).is_nan(),
        (4, false) => f32::from_be_bytes(bytes.try_into().unwrap()).is_nan(),
        (4, true) => f32::from_le_bytes(bytes.try_into().unwrap()).is_nan(),
        _ => false,
    }
}

#[test]
fn matches_js_output() {
    let table: Value = serde_json::from_str(TABLE).unwrap();
    let rows = table["rows"].as_array().unwrap();
    assert!(rows.len() > 2000, "table looks truncated");

    let mut nans = 0;
    let mut wrong = Vec::new();
    for row in rows {
        let spec = row["addr"].as_str().unwrap();
        let t = f64::from_bits(u64::from_str_radix(row["tbits"].as_str().unwrap(), 16).unwrap());
        let want = unhex(row["out"].as_str().unwrap());

        let Some(addr) = Addr::parse(spec) else {
            wrong.push(format!("{spec:?}: rejected, JS accepts it"));
            continue;
        };
        let got = wave::value(&addr, t);

        let le = spec.ends_with("ld") || spec.ends_with("lf");
        if is_nan(&want, le) {
            nans += 1;
            if !is_nan(&got, le) || got.len() != want.len() {
                wrong.push(format!("{spec:?} at {t}: want NaN, got {got:02x?}"));
            }
        } else if got[..] != want[..] {
            wrong.push(format!("{spec:?} at {t}: want {want:02x?}, got {got:02x?}"));
        }
    }

    assert!(nans > 0, "the table should include NaN rows");
    assert!(
        wrong.is_empty(),
        "{} of {} rows differ:\n{}",
        wrong.len(),
        rows.len(),
        wrong.join("\n")
    );
}

#[test]
fn rejects_what_js_rejects() {
    let table: Value = serde_json::from_str(TABLE).unwrap();
    for spec in table["invalid"].as_array().unwrap() {
        let spec = spec.as_str().unwrap();
        assert_eq!(Addr::parse(spec), None, "{spec:?} should be rejected");
    }
}

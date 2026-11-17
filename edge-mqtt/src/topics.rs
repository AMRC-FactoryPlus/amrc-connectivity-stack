// ACS MQTT driver
// Which topic filters to subscribe to for an address map
// Copyright 2026 University of Sheffield

//! Addresses are MQTT topic filters on the device's broker.
//!
//! Each address is subscribed to as it stands, wildcards and all, as
//! the built-in does. A message is passed to the Edge Agent under its
//! own topic, so it only reaches metrics whose address is exactly that
//! topic. A metric with a wildcard address subscribes the driver to
//! every matching topic but never gets a value itself, which is what
//! the built-in does too: the agent looks each message up by its topic.
//!
//! The driver keeps one set of subscriptions for the whole connection
//! and changes only what an address map adds or removes. The built-in
//! subscribes once per device and unsubscribes a device's topics when
//! it goes, even if another device still uses them.

use std::collections::BTreeSet;

/// What to change to get from the current subscriptions to the ones an
/// address map needs.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Plan {
    /// Filters to subscribe to.
    pub subscribe: Vec<String>,
    /// Filters to unsubscribe from.
    pub unsubscribe: Vec<String>,
    /// Addresses that are not valid topic filters. They are left out
    /// and logged. The built-in skips empty addresses, and the broker
    /// refuses invalid ones.
    pub invalid: Vec<String>,
}

/// Plan the subscriptions for `addrs`, given the filters `current`ly
/// subscribed to.
pub fn plan<'a>(current: &BTreeSet<String>, addrs: impl IntoIterator<Item = &'a str>) -> Plan {
    let mut want = BTreeSet::new();
    let mut invalid = BTreeSet::new();
    for a in addrs {
        if a.is_empty() {
            continue;
        }
        if valid_filter(a) {
            want.insert(a);
        } else {
            invalid.insert(a);
        }
    }

    Plan {
        subscribe: want
            .iter()
            .filter(|f| !current.contains(**f))
            .map(|f| f.to_string())
            .collect(),
        unsubscribe: current
            .iter()
            .filter(|f| !want.contains(f.as_str()))
            .cloned()
            .collect(),
        invalid: invalid.into_iter().map(str::to_owned).collect(),
    }
}

/// Whether `filter` is a valid MQTT 3.1.1 topic filter: `#` only as
/// the whole last level, `+` only as a whole level, no NUL, and at most
/// 65535 bytes.
pub fn valid_filter(filter: &str) -> bool {
    if filter.is_empty() || filter.len() > 65535 || filter.contains('\0') {
        return false;
    }
    let levels: Vec<&str> = filter.split('/').collect();
    let last = levels.len() - 1;
    levels.iter().enumerate().all(|(i, l)| match *l {
        "#" => i == last,
        "+" => true,
        l => !l.contains(['#', '+']),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(v: &[&str]) -> BTreeSet<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn filters() {
        for ok in [
            "a",
            "a/b/c",
            "/leading",
            "trailing/",
            "a//b",
            "+",
            "#",
            "a/+/c",
            "a/#",
            "+/+/#",
            "spaces are fine",
            "ünïcode/✓",
        ] {
            assert!(valid_filter(ok), "{ok:?} should be valid");
        }
        for bad in ["", "a#", "a/#/b", "a/b+", "+a", "a/+b/c", "##", "a\0b"] {
            assert!(!valid_filter(bad), "{bad:?} should be invalid");
        }
        assert!(!valid_filter(&"x".repeat(65536)));
    }

    #[test]
    fn first_map_subscribes_everything_once() {
        let p = plan(&set(&[]), ["a/b", "a/+", "a/b", "c/#"]);
        assert_eq!(p.subscribe, ["a/+", "a/b", "c/#"]);
        assert!(p.unsubscribe.is_empty());
        assert!(p.invalid.is_empty());
    }

    #[test]
    fn empty_and_invalid_addresses_are_skipped() {
        let p = plan(&set(&[]), ["", "ok", "bad/#/x", "also+bad"]);
        assert_eq!(p.subscribe, ["ok"]);
        assert_eq!(p.invalid, ["also+bad", "bad/#/x"]);
    }

    #[test]
    fn a_new_map_changes_only_the_difference() {
        let p = plan(&set(&["a", "b", "c"]), ["b", "c", "d"]);
        assert_eq!(p.subscribe, ["d"]);
        assert_eq!(p.unsubscribe, ["a"]);
    }

    #[test]
    fn a_topic_two_devices_share_stays_subscribed() {
        // Device 1 had "shared" and "x"; device 1 goes and device 2
        // still reads "shared".
        let p = plan(&set(&["shared", "x"]), ["shared", "y"]);
        assert_eq!(p.subscribe, ["y"]);
        assert_eq!(p.unsubscribe, ["x"]);
    }

    #[test]
    fn an_empty_map_unsubscribes_everything() {
        let p = plan(&set(&["a", "b"]), std::iter::empty());
        assert!(p.subscribe.is_empty());
        assert_eq!(p.unsubscribe, ["a", "b"]);
    }
}

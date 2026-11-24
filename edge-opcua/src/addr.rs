// ACS OPC UA driver
// Addresses: OPC UA node ids, with an optional array index
// Copyright 2026 University of Sheffield

//! An address is an OPC UA node id in the standard string form, for
//! example `ns=2;s=Line1/Speed` or `ns=0;i=2258`, as the built-in
//! connection takes it.
//!
//! An address may also end in an array index: `[3]` for one element,
//! `[2:5]` for a slice, or `[1,2]` for one element of a
//! multi-dimensional array. The suffix is an OPC UA index range (a
//! `NumericRange`: `3`, `2:5` or `1,2`), so the server sends only that
//! part of the value. Many servers (Siemens and Beckhoff PLCs among
//! them) make each array element a node of its own whose id ends in
//! brackets, such as `ns=3;s="DB"."arr"[3]`. So an address that is a
//! node id as written is tried as that node first, and as the node
//! without the suffix plus the index range only if the server says the
//! node does not exist (see `subs.rs`).

use std::hash::{Hash, Hasher};
use std::str::FromStr;

use opcua::types::{NodeId, NumericRange};

/// An address and the node it names.
///
/// Two addresses are the same only if their strings are the same, so
/// `i=2258` and `ns=0;i=2258` stay two addresses with a data topic
/// each, as the Edge Agent sees them.
#[derive(Debug, Clone)]
pub struct Addr {
    pub raw: String,
    /// The node, or `None` if the string is not a node id. Such an
    /// address is accepted, so one mistyped address doesn't stop the
    /// rest of the connection, but it never gets data and every write
    /// to it fails, unless it is an array element (`element`).
    pub node: Option<NodeId>,
    /// For an address that ends in an array index, the node without the
    /// suffix and the index range the suffix gives.
    pub element: Option<Element>,
}

/// Part of an array node's value: the node and an OPC UA index range.
#[derive(Debug, Clone, PartialEq)]
pub struct Element {
    pub node: NodeId,
    pub range: NumericRange,
}

impl Element {
    /// Whether the range selects exactly one element (`3` or `1,2`),
    /// which is published as a scalar, rather than a slice.
    pub fn single(&self) -> bool {
        match &self.range {
            NumericRange::Index(_) => true,
            NumericRange::MultipleRanges(r) => {
                r.iter().all(|r| matches!(r, NumericRange::Index(_)))
            }
            _ => false,
        }
    }

    /// How many dimensions the range has.
    pub fn dimensions(&self) -> usize {
        match &self.range {
            NumericRange::MultipleRanges(r) => r.len(),
            _ => 1,
        }
    }
}

/// The node and index range of an address that ends in `[<range>]`,
/// where the range is an OPC UA numeric range (digits, `:` and `,`) and
/// what comes before it is a node id.
fn element(raw: &str) -> Option<Element> {
    let inner = raw.strip_suffix(']')?;
    let (node, range) = inner.rsplit_once('[')?;
    if range.is_empty()
        || !range
            .bytes()
            .all(|b| b.is_ascii_digit() || b == b':' || b == b',')
    {
        return None;
    }
    let range = NumericRange::from_str(range).ok()?;
    if !range.is_valid() {
        return None;
    }
    Some(Element {
        node: NodeId::from_str(node).ok()?,
        range,
    })
}

impl Addr {
    pub fn parse(raw: &str) -> Self {
        Self {
            raw: raw.to_owned(),
            node: NodeId::from_str(raw).ok(),
            element: element(raw),
        }
    }

    /// Whether the address names a node in either form, so it can be
    /// monitored and written.
    pub fn usable(&self) -> bool {
        self.node.is_some() || self.element.is_some()
    }
}

/// The canonical address of a node: the form a scan reports, and the
/// form the Admin UI's `opcua` normaliser turns a metric's address into
/// before it compares. Namespace 0 is written without `ns=0;`, so
/// `i=2258`, never `ns=0;i=2258`. [`Addr::parse`] reads it back as the
/// same node.
pub fn canonical(node: &NodeId) -> String {
    node.to_string()
}

impl PartialEq for Addr {
    fn eq(&self, other: &Self) -> bool {
        self.raw == other.raw
    }
}

impl Eq for Addr {}

impl Hash for Addr {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.raw.hash(state);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use opcua::types::{Guid, Identifier};

    fn node(raw: &str) -> NodeId {
        Addr::parse(raw)
            .node
            .unwrap_or_else(|| panic!("{raw} not parsed"))
    }

    #[test]
    fn string_ids_keep_everything_after_s() {
        let n = node("ns=2;s=Line 1/Speed;unit=m/s");
        assert_eq!(n.namespace, 2);
        assert_eq!(
            n.identifier,
            Identifier::String("Line 1/Speed;unit=m/s".into())
        );
    }

    #[test]
    fn numeric_guid_and_opaque_ids() {
        assert_eq!(node("ns=0;i=2258"), NodeId::new(0, 2258u32));
        assert_eq!(node("i=2258"), NodeId::new(0, 2258u32));
        assert_eq!(
            node("ns=3;g=72962B91-FA75-4AE6-8D28-B404DC7DAF63").identifier,
            Identifier::Guid(Guid::from_str("72962b91-fa75-4ae6-8d28-b404dc7daf63").unwrap())
        );
        assert!(matches!(
            node("ns=1;b=AQID").identifier,
            Identifier::ByteString(_)
        ));
    }

    #[test]
    fn same_node_different_strings_are_different_addresses() {
        assert_ne!(Addr::parse("i=2258"), Addr::parse("ns=0;i=2258"));
        assert_eq!(Addr::parse("ns=2;s=A"), Addr::parse("ns=2;s=A"));
        assert_ne!(Addr::parse("ns=2;s=A[1]"), Addr::parse("ns=2;s=A[01]"));
    }

    #[test]
    fn a_bad_address_has_no_node() {
        for raw in ["", "Line1/Speed", "ns=x;s=A", "ns=2;q=A", "Line1/Speed[3]"] {
            let a = Addr::parse(raw);
            assert!(a.node.is_none() && a.element.is_none(), "{raw}");
            assert!(!a.usable(), "{raw}");
        }
    }

    fn element_of(raw: &str) -> Option<(NodeId, String, bool)> {
        Addr::parse(raw)
            .element
            .map(|e| (e.node.clone(), e.range.to_string(), e.single()))
    }

    #[test]
    fn the_three_index_forms() {
        let temps = NodeId::new(2, "Line1/Temps");
        assert_eq!(
            element_of("ns=2;s=Line1/Temps[3]"),
            Some((temps.clone(), "3".into(), true))
        );
        assert_eq!(
            element_of("ns=2;s=Line1/Temps[2:5]"),
            Some((temps.clone(), "2:5".into(), false))
        );
        assert_eq!(
            element_of("ns=2;s=Line1/Temps[1,2]"),
            Some((temps.clone(), "1,2".into(), true))
        );
        assert_eq!(
            element_of("ns=2;s=Line1/Temps[0:1,2]"),
            Some((temps, "0:1,2".into(), false))
        );
        // A numeric id with the suffix is not a node id as written, so
        // only the element form names a node.
        let a = Addr::parse("ns=2;i=1001[4]");
        assert!(a.node.is_none() && a.usable());
        assert_eq!(a.element.unwrap().node, NodeId::new(2, 1001u32));
    }

    /// A string id that ends in an index is a node id as written too,
    /// which is tried first, because PLCs name array elements so.
    #[test]
    fn an_indexed_string_id_is_also_a_node_as_written() {
        let a = Addr::parse(r#"ns=3;s="DB"."arr"[3]"#);
        assert_eq!(a.node, Some(NodeId::new(3, r#""DB"."arr"[3]"#)));
        let e = a.element.unwrap();
        assert_eq!(e.node, NodeId::new(3, r#""DB"."arr""#));
        assert_eq!(e.range.to_string(), "3");
    }

    /// The canonical form drops `ns=0;` and reads back as the same
    /// node, for every kind of identifier.
    #[test]
    fn canonical_addresses_read_back_as_the_same_node() {
        let guid = Guid::from_str("72962b91-fa75-4ae6-8d28-b404dc7daf63").unwrap();
        let cases = [
            (NodeId::new(0, 2258u32), "i=2258"),
            (NodeId::new(0, "Name"), "s=Name"),
            (NodeId::new(2, 1001u32), "ns=2;i=1001"),
            (
                NodeId::new(2, "Line 1/Speed;x=y"),
                "ns=2;s=Line 1/Speed;x=y",
            ),
            (
                NodeId::new(3, r#""DB"."arr"[3]"#),
                r#"ns=3;s="DB"."arr"[3]"#,
            ),
            (
                NodeId::new(3, guid),
                "ns=3;g=72962b91-fa75-4ae6-8d28-b404dc7daf63",
            ),
            (
                NodeId::new(1, opcua::types::ByteString::from(vec![1u8, 2, 3])),
                "ns=1;b=AQID",
            ),
        ];
        for (node, want) in cases {
            let s = canonical(&node);
            assert_eq!(s, want);
            assert_eq!(Addr::parse(&s).node, Some(node), "{s}");
        }
        // A metric written the long way names the same node.
        assert_eq!(
            Addr::parse("ns=0;i=2258").node.map(|n| canonical(&n)),
            Some("i=2258".into())
        );
    }

    #[test]
    fn brackets_that_are_not_a_trailing_index() {
        // Brackets in the middle of the id.
        let a = Addr::parse("ns=2;s=Line1[2]/Speed");
        assert!(a.node.is_some() && a.element.is_none());
        // Only the last index is the range.
        assert_eq!(
            element_of("ns=2;s=Grid[1][2]"),
            Some((NodeId::new(2, "Grid[1]"), "2".into(), true))
        );
        // String ids that end in `]` without being an index.
        for raw in [
            "ns=2;s=Alarm[high]",
            "ns=2;s=Temps[]",
            "ns=2;s=Temps[-1]",
            "ns=2;s=Temps[ 3]",
            "ns=2;s=Temps[3:3]",
            "ns=2;s=Temps[5:2]",
            "ns=2;s=Temps[1,]",
            "ns=2;s=Temps]",
            "[3]",
        ] {
            assert!(Addr::parse(raw).element.is_none(), "{raw}");
        }
        assert!(Addr::parse("ns=2;s=Alarm[high]").node.is_some());
    }
}

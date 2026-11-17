// ACS OPC UA driver
// Addresses: OPC UA node ids
// Copyright 2026 University of Sheffield

//! An address is an OPC UA node id in the standard string form, for
//! example `ns=2;s=Line1/Speed` or `ns=0;i=2258`, as the built-in
//! connection takes it.

use std::hash::{Hash, Hasher};
use std::str::FromStr;

use opcua::types::NodeId;

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
    /// to it fails.
    pub node: Option<NodeId>,
}

impl Addr {
    pub fn parse(raw: &str) -> Self {
        Self {
            raw: raw.to_owned(),
            node: NodeId::from_str(raw).ok(),
        }
    }
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
    }

    #[test]
    fn a_bad_address_has_no_node() {
        for raw in ["", "Line1/Speed", "ns=x;s=A", "ns=2;q=A"] {
            assert!(Addr::parse(raw).node.is_none(), "{raw}");
        }
    }
}

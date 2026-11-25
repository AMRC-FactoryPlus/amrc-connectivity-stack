// ACS OPC UA driver
// Unit tests for the scouter, against a fake OPC UA server
// Copyright 2026 University of Sheffield

use std::collections::BTreeMap;
use std::sync::Mutex;

use opcua::types::{DataTypeId, ExtensionObject, LocalizedText, QualifiedName};
use rs_edge_driver::{ItemKind, ScoutCode};

use super::*;

/// A node of the fake server.
#[derive(Clone, Default)]
struct FakeNode {
    class: Option<NodeClass>,
    name: String,
    children: Vec<NodeId>,
    data_type: Option<NodeId>,
    rank: i32,
    dims: Option<Vec<u32>>,
    access: u8,
    description: Option<String>,
    value: Option<Variant>,
    denied: bool,
    supertype: Option<NodeId>,
}

#[derive(Default)]
struct FakeState {
    nodes: BTreeMap<String, (NodeId, FakeNode)>,
    /// Open continuation points: id to the references still to send
    /// and the most to send per request.
    points: HashMap<u32, (Vec<ReferenceDescription>, u32)>,
    next_point: u32,
    /// Every request, as "browse 50", "next 3", "release 3", "read 100".
    log: Vec<String>,
    /// Each Read of a Value, as "<node id> <index range>".
    value_reads: Vec<String>,
}

/// A fake OPC UA server with the services the walk uses. A clone shares
/// the address space, continuation points and log.
#[derive(Clone)]
struct Fake {
    state: Arc<Mutex<FakeState>>,
    /// The server refuses a Browse of more nodes than this, 0 for none.
    max_browse: usize,
    /// The server refuses a Read of more attributes than this.
    max_read: usize,
    /// What OperationLimits says, `None` for nothing.
    advertised: Option<(u32, u32)>,
    /// The most references the server sends per node per request.
    page: usize,
    /// Fail every request after this many with BadConnectionClosed.
    fail_after: Option<usize>,
    /// Cancel this token on the n-th BrowseNext, to cancel mid-page.
    cancel_on_next: Arc<Mutex<Option<(usize, CancellationToken)>>>,
    /// Answer a Browse or BrowseNext of more references than this, in
    /// all, with BadResponseTooLarge, as a server does when the answer
    /// is over the client's message size.
    max_answer_refs: usize,
    /// Answer a Read whose values hold more array elements than this,
    /// in all, with BadResponseTooLarge.
    max_answer_elements: usize,
    /// An answer holding one array of more than this many elements is
    /// one the client can't decode, which closes its connection: log
    /// "undecodable" and fail with BadConnectionClosed.
    max_array: usize,
    /// Answer each BrowseNext that doesn't release this late, after
    /// working it out.
    next_delay: Duration,
}

impl Fake {
    fn new() -> Self {
        let mut f = Self {
            state: Arc::default(),
            max_browse: 0,
            max_read: 0,
            advertised: None,
            page: usize::MAX,
            fail_after: None,
            cancel_on_next: Arc::default(),
            max_answer_refs: usize::MAX,
            max_answer_elements: usize::MAX,
            max_array: usize::MAX,
            next_delay: Duration::ZERO,
        };
        f.add(NodeId::new(0, OBJECTS), FakeNode::object("Objects"));
        f.add(NodeId::new(0, SERVER), FakeNode::object("Server"));
        f.add(
            NodeId::new(0, 2256u32),
            FakeNode::var("ServerStatus", 862u32),
        );
        f.link(NodeId::new(0, OBJECTS), NodeId::new(0, SERVER));
        f.link(NodeId::new(0, SERVER), NodeId::new(0, 2256u32));
        // A custom enumeration and structure, and their supertypes.
        f.add(
            NodeId::new(2, 3001u32),
            FakeNode::datatype("MyEnum", NodeId::new(0, 29u32)),
        );
        f.add(
            NodeId::new(2, 3002u32),
            FakeNode::datatype("MyStruct", NodeId::new(0, 22u32)),
        );
        f.add(
            NodeId::new(2, 3003u32),
            FakeNode::datatype("MySubEnum", NodeId::new(2, 3001u32)),
        );
        f.add(
            NodeId::new(2, 3004u32),
            FakeNode::datatype("Speed", NodeId::new(0, 11u32)),
        );
        f
    }

    fn add(&mut self, id: NodeId, node: FakeNode) {
        self.state
            .lock()
            .unwrap()
            .nodes
            .insert(canonical(&id), (id, node));
    }

    fn link(&mut self, parent: NodeId, child: NodeId) {
        let mut st = self.state.lock().unwrap();
        st.nodes
            .get_mut(&canonical(&parent))
            .expect("parent")
            .1
            .children
            .push(child);
    }

    fn with(mut self, f: impl FnOnce(&mut Self)) -> Self {
        f(&mut self);
        self
    }

    fn log(&self) -> Vec<String> {
        self.state.lock().unwrap().log.clone()
    }

    fn open_points(&self) -> usize {
        self.state.lock().unwrap().points.len()
    }

    fn count(&self) -> Result<(), StatusCode> {
        let n = self.state.lock().unwrap().log.len();
        if self.fail_after.is_some_and(|f| n > f) {
            return Err(StatusCode::BadConnectionClosed);
        }
        Ok(())
    }

    fn reference(&self, id: &NodeId) -> Option<ReferenceDescription> {
        let st = self.state.lock().unwrap();
        let (_, n) = st.nodes.get(&canonical(id))?;
        Some(ReferenceDescription {
            node_id: ExpandedNodeId::from(id.clone()),
            browse_name: QualifiedName::new(id.namespace, n.name.as_str()),
            display_name: LocalizedText::new("", n.name.as_str()),
            node_class: n.class.unwrap_or(NodeClass::Object),
            ..Default::default()
        })
    }

    /// Send up to a page of `refs`, keeping the rest behind a
    /// continuation point.
    fn page_out(&self, mut refs: Vec<ReferenceDescription>, max_refs: u32) -> BrowseResult {
        let page = if max_refs == 0 {
            self.page
        } else {
            self.page.min(max_refs as usize)
        };
        let mut point = ByteString::null();
        if refs.len() > page {
            let rest = refs.split_off(page);
            let mut st = self.state.lock().unwrap();
            st.next_point += 1;
            let id = st.next_point;
            st.points.insert(id, (rest, max_refs));
            point = ByteString::from(id.to_be_bytes().to_vec());
        }
        BrowseResult {
            status_code: StatusCode::Good,
            continuation_point: point,
            references: Some(refs),
        }
    }
}

impl FakeNode {
    fn object(name: &str) -> Self {
        Self {
            class: Some(NodeClass::Object),
            name: name.into(),
            rank: -1,
            ..Default::default()
        }
    }

    fn var(name: &str, data_type: impl Into<NodeId>) -> Self {
        Self {
            class: Some(NodeClass::Variable),
            name: name.into(),
            data_type: Some(data_type.into()),
            rank: -1,
            access: 3,
            ..Default::default()
        }
    }

    fn datatype(name: &str, supertype: NodeId) -> Self {
        Self {
            class: Some(NodeClass::DataType),
            name: name.into(),
            supertype: Some(supertype),
            ..Default::default()
        }
    }
}

#[async_trait]
impl Service for Fake {
    async fn browse(
        &self,
        nodes: &[BrowseDescription],
        max_refs: u32,
    ) -> Result<Vec<BrowseResult>, StatusCode> {
        let up = nodes
            .iter()
            .all(|d| d.browse_direction == BrowseDirection::Inverse);
        let word = if up { "up" } else { "browse" };
        self.state
            .lock()
            .unwrap()
            .log
            .push(format!("{word} {}", nodes.len()));
        self.count()?;
        if self.max_browse > 0 && nodes.len() > self.max_browse {
            return Err(StatusCode::BadTooManyOperations);
        }
        let mut out = Vec::new();
        for d in nodes {
            let node = {
                let st = self.state.lock().unwrap();
                st.nodes.get(&canonical(&d.node_id)).map(|(_, n)| n.clone())
            };
            let Some(node) = node else {
                out.push(BrowseResult {
                    status_code: StatusCode::BadNodeIdUnknown,
                    ..Default::default()
                });
                continue;
            };
            if d.browse_direction == BrowseDirection::Inverse {
                assert_eq!(d.reference_type_id, NodeId::new(0, HAS_SUBTYPE));
                let refs = node
                    .supertype
                    .iter()
                    .map(|s| ReferenceDescription {
                        node_id: ExpandedNodeId::from(s.clone()),
                        node_class: NodeClass::DataType,
                        ..Default::default()
                    })
                    .collect();
                out.push(self.page_out(refs, max_refs));
                continue;
            }
            assert_eq!(d.reference_type_id, NodeId::new(0, HIERARCHICAL));
            assert!(d.include_subtypes);
            if node.denied {
                out.push(BrowseResult {
                    status_code: StatusCode::BadUserAccessDenied,
                    ..Default::default()
                });
                continue;
            }
            let refs = node
                .children
                .iter()
                .filter_map(|c| self.reference(c))
                .collect();
            out.push(self.page_out(refs, max_refs));
        }
        self.check_refs(&out)?;
        Ok(out)
    }

    async fn browse_next(
        &self,
        release: bool,
        points: &[ByteString],
    ) -> Result<Vec<BrowseResult>, StatusCode> {
        let n = {
            let mut st = self.state.lock().unwrap();
            let word = if release { "release" } else { "next" };
            st.log.push(format!("{word} {}", points.len()));
            st.log.iter().filter(|l| l.starts_with("next")).count()
        };
        if let Some((at, token)) = &*self.cancel_on_next.lock().unwrap()
            && *at == n
        {
            token.cancel();
        }
        self.count()?;
        let mut out = Vec::new();
        for p in points {
            let id = u32::from_be_bytes(p.value.as_ref().unwrap()[..4].try_into().unwrap());
            let rest = self.state.lock().unwrap().points.remove(&id);
            match rest {
                None => out.push(BrowseResult {
                    status_code: StatusCode::BadContinuationPointInvalid,
                    ..Default::default()
                }),
                Some(_) if release => out.push(BrowseResult::default()),
                Some((rest, max_refs)) => out.push(self.page_out(rest, max_refs)),
            }
        }
        if !release && !self.next_delay.is_zero() {
            tokio::time::sleep(self.next_delay).await;
        }
        self.check_refs(&out)?;
        Ok(out)
    }

    async fn read(&self, ids: &[ReadValueId]) -> Result<Vec<DataValue>, StatusCode> {
        self.state
            .lock()
            .unwrap()
            .log
            .push(format!("read {}", ids.len()));
        self.count()?;
        if self.max_read > 0 && ids.len() > self.max_read {
            return Err(StatusCode::BadTooManyOperations);
        }
        let mut st = self.state.lock().unwrap();
        for r in ids {
            if r.attribute_id == AttributeId::Value as u32 {
                let read = format!("{} {}", canonical(&r.node_id), r.index_range);
                let read = read.trim_end().to_string();
                st.value_reads.push(read);
            }
        }
        let values: Vec<DataValue> = ids
            .iter()
            .map(|r| {
                let attr = AttributeId::from_u32(r.attribute_id).unwrap();
                if r.node_id == NodeId::new(0, NAMESPACE_ARRAY) {
                    let uris = vec![
                        "http://opcfoundation.org/UA/".to_string(),
                        "urn:test:one".to_string(),
                        "urn:test:two".to_string(),
                    ];
                    return DataValue::value_only(Variant::from(uris));
                }
                if r.node_id == NodeId::new(0, MAX_NODES_PER_BROWSE) {
                    return match self.advertised {
                        Some((b, _)) => DataValue::value_only(Variant::UInt32(b)),
                        None => bad(StatusCode::BadNodeIdUnknown),
                    };
                }
                if r.node_id == NodeId::new(0, MAX_NODES_PER_READ) {
                    return match self.advertised {
                        Some((_, rd)) => DataValue::value_only(Variant::UInt32(rd)),
                        None => bad(StatusCode::BadNodeIdUnknown),
                    };
                }
                let Some((_, n)) = st.nodes.get(&canonical(&r.node_id)) else {
                    return bad(StatusCode::BadNodeIdUnknown);
                };
                let var = n.class == Some(NodeClass::Variable);
                let v = match attr {
                    AttributeId::NodeClass => Variant::Int32(n.class.unwrap() as i32),
                    AttributeId::DisplayName => {
                        Variant::from(LocalizedText::new("", n.name.as_str()))
                    }
                    AttributeId::BrowseName => {
                        Variant::from(QualifiedName::new(r.node_id.namespace, n.name.as_str()))
                    }
                    AttributeId::Description => match &n.description {
                        Some(d) => Variant::from(LocalizedText::new("en", d.as_str())),
                        None => Variant::from(LocalizedText::null()),
                    },
                    AttributeId::DataType if var => Variant::from(n.data_type.clone().unwrap()),
                    AttributeId::ValueRank if var => Variant::Int32(n.rank),
                    AttributeId::ArrayDimensions if var => match &n.dims {
                        Some(d) => Variant::from(d.clone()),
                        None => return DataValue::null(),
                    },
                    AttributeId::UserAccessLevel if var => Variant::Byte(n.access),
                    AttributeId::Value if var => match &n.value {
                        Some(v) => match in_range(v, &r.index_range) {
                            Some(v) => v,
                            None => return bad(StatusCode::BadIndexRangeNoData),
                        },
                        None => return DataValue::null(),
                    },
                    _ => return bad(StatusCode::BadAttributeIdInvalid),
                };
                DataValue::value_only(v)
            })
            .collect();
        drop(st);
        let lengths: Vec<usize> = values
            .iter()
            .map(|v| match &v.value {
                Some(Variant::Array(a)) => a.values.len(),
                _ => 0,
            })
            .collect();
        if lengths.iter().any(|&n| n > self.max_array) {
            self.state.lock().unwrap().log.push("undecodable".into());
            return Err(StatusCode::BadConnectionClosed);
        }
        if lengths.iter().sum::<usize>() > self.max_answer_elements {
            return Err(StatusCode::BadResponseTooLarge);
        }
        Ok(values)
    }
}

impl Fake {
    fn check_refs(&self, out: &[BrowseResult]) -> Result<(), StatusCode> {
        let refs: usize = out
            .iter()
            .map(|r| r.references.as_ref().map_or(0, Vec::len))
            .sum();
        if refs > self.max_answer_refs {
            // The server has made no continuation points for an answer
            // it doesn't send.
            let mut st = self.state.lock().unwrap();
            for r in out {
                if !r.continuation_point.is_null_or_empty() {
                    let p = &r.continuation_point;
                    let id = u32::from_be_bytes(p.value.as_ref().unwrap()[..4].try_into().unwrap());
                    st.points.remove(&id);
                }
            }
            return Err(StatusCode::BadResponseTooLarge);
        }
        Ok(())
    }

    fn value_reads(&self) -> Vec<String> {
        self.state.lock().unwrap().value_reads.clone()
    }
}

/// A one-dimensional array value cut to an index range `a:b`, as a
/// server does. Other values and ranges are left as they are.
fn in_range(v: &Variant, range: &NumericRange) -> Option<Variant> {
    // One element, as a live read of `node[i]` asks for: an array of
    // one.
    if let (Variant::Array(a), NumericRange::Index(i)) = (v, range) {
        let e = a.values.get(*i as usize)?.clone();
        return Some(Variant::from((a.value_type, vec![e])));
    }
    let (Variant::Array(a), NumericRange::Range(lo, hi)) = (v, range) else {
        return Some(v.clone());
    };
    let (lo, hi) = (*lo as usize, *hi as usize);
    if lo >= a.values.len() {
        return None;
    }
    let values = a.values[lo..=hi.min(a.values.len() - 1)].to_vec();
    Some(Variant::from((a.value_type, values)))
}

fn bad(s: StatusCode) -> DataValue {
    DataValue {
        status: Some(s),
        ..Default::default()
    }
}

/// Collects a scan's items, with the sink's item cap.
struct Collect {
    items: Mutex<Vec<Item>>,
    cap: usize,
    token: CancellationToken,
    /// Cancel once this many items are in.
    cancel_after: Option<usize>,
}

impl Collect {
    fn new() -> Self {
        Self {
            items: Mutex::default(),
            cap: usize::MAX,
            token: CancellationToken::new(),
            cancel_after: None,
        }
    }

    fn items(&self) -> Vec<Item> {
        self.items.lock().unwrap().clone()
    }

    fn ids(&self) -> Vec<String> {
        self.items().into_iter().map(|i| i.id).collect()
    }

    fn get(&self, id: &str) -> Item {
        self.items()
            .into_iter()
            .find(|i| i.id == id)
            .unwrap_or_else(|| panic!("no item {id}"))
    }
}

#[async_trait]
impl Out for Collect {
    async fn add(&self, items: Vec<Item>) -> Result<(), Stop> {
        if self.token.is_cancelled() {
            return Err(Stop::Cancelled);
        }
        let mut have = self.items.lock().unwrap();
        for i in items {
            if have.len() >= self.cap {
                return Err(Stop::Items);
            }
            have.push(i);
        }
        if self.cancel_after.is_some_and(|n| have.len() >= n) {
            self.token.cancel();
        }
        Ok(())
    }

    fn progress(&self, _: Progress) {}

    fn token(&self) -> CancellationToken {
        self.token.clone()
    }
}

fn limits() -> ScoutLimits {
    let mut l = ScoutLimits::DEFAULT;
    l.pace_ms = 0;
    l
}

fn request(
    root: Option<&str>,
    folder: Option<&str>,
    options: Value,
    limits: ScoutLimits,
) -> ScoutRequest {
    let Value::Object(o) = options else {
        panic!("options must be an object")
    };
    ScoutRequest::new(root, folder, o, limits)
}

async fn run(fake: &Fake, req: ScoutRequest) -> (Collect, Result<ScoutEnd, ScoutError>) {
    let out = Collect::new();
    let r = scout(Arc::new(fake.clone()), &req, &out).await;
    (out, r)
}

fn s(ns: u16, name: &str) -> NodeId {
    NodeId::new(ns, name)
}

/// A plant: Objects/Plant/Line{1,2}/{Speed, Temps, Mode, Recipe,
/// Count}, a cycle Loop/A <-> Loop/B, and Shared under both lines.
fn plant() -> Fake {
    let mut f = Fake::new();
    let objects = NodeId::new(0, OBJECTS);
    let plant = s(1, "Plant");
    f.add(plant.clone(), FakeNode::object("Plant"));
    f.link(objects.clone(), plant.clone());
    let shared = s(1, "Shared");
    f.add(shared.clone(), FakeNode::var("Shared", DataTypeId::Int32));
    for line in ["Line1", "Line2"] {
        let l = s(1, line);
        f.add(l.clone(), FakeNode::object(line));
        f.link(plant.clone(), l.clone());
        let speed = s(1, &format!("{line}/Speed"));
        f.add(
            speed.clone(),
            FakeNode {
                description: Some("Spindle speed".into()),
                ..FakeNode::var("Speed", DataTypeId::Double)
            },
        );
        f.link(l.clone(), speed);
        let mode = s(1, &format!("{line}/Mode"));
        f.add(
            mode.clone(),
            FakeNode {
                access: 1,
                ..FakeNode::var("Mode", NodeId::new(2, 3003u32))
            },
        );
        f.link(l.clone(), mode);
        let recipe = s(2, &format!("{line}/Recipe"));
        f.add(
            recipe.clone(),
            FakeNode {
                access: 0,
                ..FakeNode::var("Recipe", NodeId::new(2, 3002u32))
            },
        );
        f.link(l.clone(), recipe);
        let count = s(1, &format!("{line}/Count"));
        f.add(count.clone(), FakeNode::var("Count", DataTypeId::UInt64));
        f.link(l.clone(), count);
        let temps = s(1, &format!("{line}/Temps"));
        f.add(
            temps.clone(),
            FakeNode {
                rank: 1,
                dims: Some(vec![3]),
                ..FakeNode::var("Temps", DataTypeId::Float)
            },
        );
        f.link(l.clone(), temps);
        f.link(l.clone(), shared.clone());
    }
    let lp = s(1, "Loop");
    let a = s(1, "Loop/A");
    let b = s(1, "Loop/B");
    f.add(lp.clone(), FakeNode::object("Loop"));
    f.add(a.clone(), FakeNode::object("A"));
    f.add(b.clone(), FakeNode::object("B"));
    f.link(plant.clone(), lp.clone());
    f.link(lp, a.clone());
    f.link(a.clone(), b.clone());
    f.link(b, a);
    f
}

#[tokio::test]
async fn a_full_scan_lists_every_node_once_and_skips_the_server_object() {
    let fake = plant();
    let (out, r) = run(&fake, request(None, None, json!({}), limits())).await;
    let end = r.unwrap();
    assert!(end.exhaustive);
    assert_eq!(end.truncated, None);
    assert_eq!(
        end.excluded,
        vec![Excluded::new("i=2253", "skipped").with_prefixes(["i="])]
    );
    let ids = out.ids();
    let mut sorted = ids.clone();
    sorted.sort();
    sorted.dedup();
    assert_eq!(sorted.len(), ids.len(), "duplicate ids: {ids:?}");
    let mut want = vec![
        "ns=1;s=Plant",
        "ns=1;s=Line1",
        "ns=1;s=Line2",
        "ns=1;s=Loop",
        "ns=1;s=Loop/A",
        "ns=1;s=Loop/B",
        "ns=1;s=Shared",
    ];
    let mut per_line = Vec::new();
    for line in ["Line1", "Line2"] {
        for v in ["Speed", "Mode", "Count", "Temps"] {
            per_line.push(format!("ns=1;s={line}/{v}"));
        }
        per_line.push(format!("ns=2;s={line}/Recipe"));
    }
    want.extend(per_line.iter().map(String::as_str));
    want.sort();
    assert_eq!(sorted, want);
    assert!(!ids.iter().any(|i| i.starts_with("i=")), "{ids:?}");

    // Parents come before children, and each node is under the first
    // parent the walk reached it from.
    for (n, item) in out.items().iter().enumerate() {
        if let Some(p) = &item.parent {
            let at = ids.iter().position(|i| i == p).expect("parent listed");
            assert!(at < n, "{} before its parent {p}", item.id);
        }
    }
    assert_eq!(out.get("ns=1;s=Plant").parent, None);
    assert_eq!(
        out.get("ns=1;s=Shared").parent.as_deref(),
        Some("ns=1;s=Line1")
    );
    assert_eq!(
        out.get("ns=1;s=Loop/B").parent.as_deref(),
        Some("ns=1;s=Loop/A")
    );
}

#[tokio::test]
async fn items_carry_types_access_and_namespaces() {
    let fake = plant();
    let (out, r) = run(&fake, request(None, None, json!({}), limits())).await;
    r.unwrap();

    let line = out.get("ns=1;s=Line1");
    assert_eq!(line.kind, ItemKind::Folder);
    assert_eq!(line.address, None);
    assert_eq!(
        line.detail,
        Some(json!({ "namespace_uri": "urn:test:one" }))
    );

    let speed = out.get("ns=1;s=Line1/Speed");
    assert_eq!(speed.kind, ItemKind::Value);
    assert_eq!(speed.address.as_deref(), Some("ns=1;s=Line1/Speed"));
    assert_eq!(speed.r#type, Some(ScoutType::Double));
    assert_eq!(speed.access, Some(Access::ReadWrite));
    assert_eq!(speed.description.as_deref(), Some("Spindle speed"));
    assert_eq!(speed.sample, None);

    // A subtype of a subtype of Enumeration.
    let mode = out.get("ns=1;s=Line1/Mode");
    assert_eq!(mode.r#type, Some(ScoutType::Int32));
    assert_eq!(mode.access, Some(Access::Read));

    // A structure: no type, its DataType in detail, namespace 2.
    let recipe = out.get("ns=2;s=Line1/Recipe");
    assert_eq!(recipe.r#type, None);
    assert_eq!(recipe.access, None);
    assert_eq!(
        recipe.detail,
        Some(json!({ "namespace_uri": "urn:test:two", "ua_type": "ns=2;i=3002" }))
    );

    assert_eq!(
        out.get("ns=1;s=Line1/Count").r#type,
        Some(ScoutType::UInt64)
    );

    // An array: no type, its dimensions and DataType in detail.
    let temps = out.get("ns=1;s=Line1/Temps");
    assert_eq!(temps.r#type, None);
    assert_eq!(
        temps.detail,
        Some(json!({ "namespace_uri": "urn:test:one", "dims": [3], "ua_type": "i=10" }))
    );
}

#[tokio::test]
async fn each_custom_type_is_looked_up_once() {
    let fake = plant();
    let (_, r) = run(&fake, request(None, None, json!({}), limits())).await;
    r.unwrap();
    // MySubEnum -> MyEnum -> Enumeration and MyStruct -> Structure:
    // three lookups, though both lines use both types.
    let up: usize = fake
        .log()
        .iter()
        .filter_map(|l| l.strip_prefix("up "))
        .map(|n| n.parse::<usize>().unwrap())
        .sum();
    assert_eq!(up, 3);
}

#[test]
fn namespace_0_types() {
    use ScoutType as T;
    let t = |n: u32| known_type(&NodeId::new(0, n));
    assert_eq!(t(1), Some(Some(T::Boolean)));
    assert_eq!(t(2), Some(Some(T::Int8)));
    assert_eq!(t(3), Some(Some(T::UInt8)));
    assert_eq!(t(9), Some(Some(T::UInt64)));
    assert_eq!(t(13), Some(Some(T::DateTime)));
    assert_eq!(t(14), Some(Some(T::Uuid)));
    assert_eq!(t(21), Some(Some(T::String)));
    assert_eq!(t(29), Some(Some(T::Int32)));
    assert_eq!(t(290), Some(Some(T::Double)));
    assert_eq!(t(294), Some(Some(T::DateTime)));
    for n in [15, 16, 17, 19, 20, 22, 24, 26] {
        assert_eq!(t(n), Some(None), "i={n}");
    }
    // Not known: look up the supertype.
    assert_eq!(t(852), None);
    assert_eq!(known_type(&NodeId::new(2, 1u32)), None);
    assert_eq!(known_type(&NodeId::new(0, "x")), None);
}

#[tokio::test]
async fn a_type_with_no_known_ancestor_has_no_type() {
    let fake = plant().with(|f| {
        // A loop of supertypes that never reaches a known type.
        f.add(
            NodeId::new(3, 1u32),
            FakeNode::datatype("X", NodeId::new(3, 2u32)),
        );
        f.add(
            NodeId::new(3, 2u32),
            FakeNode::datatype("Y", NodeId::new(3, 1u32)),
        );
        f.add(s(1, "Odd"), FakeNode::var("Odd", NodeId::new(3, 1u32)));
        f.link(s(1, "Plant"), s(1, "Odd"));
        f.add(
            s(1, "Orphan"),
            FakeNode::var("Orphan", NodeId::new(3, 9u32)),
        );
        f.link(s(1, "Plant"), s(1, "Orphan"));
        f.add(
            s(1, "Derived"),
            FakeNode::var("Derived", NodeId::new(2, 3004u32)),
        );
        f.link(s(1, "Plant"), s(1, "Derived"));
    });
    let (out, r) = run(&fake, request(None, None, json!({}), limits())).await;
    r.unwrap();
    assert_eq!(out.get("ns=1;s=Odd").r#type, None);
    assert_eq!(out.get("ns=1;s=Orphan").r#type, None);
    assert_eq!(out.get("ns=1;s=Derived").r#type, Some(ScoutType::Double));
}

#[tokio::test]
async fn include_server_lists_the_server_object() {
    let fake = plant();
    let (out, r) = run(
        &fake,
        request(None, None, json!({ "include_server": true }), limits()),
    )
    .await;
    let end = r.unwrap();
    assert!(end.excluded.is_empty());
    assert_eq!(out.get("i=2253").kind, ItemKind::Folder);
    let status = out.get("i=2256");
    assert_eq!(status.parent.as_deref(), Some("i=2253"));
    assert_eq!(status.address.as_deref(), Some("i=2256"));
    // ServerStatusDataType is a structure the fake doesn't define.
    assert_eq!(status.r#type, None);
}

#[tokio::test]
async fn a_root_inside_the_server_object_lists_it() {
    let fake = plant();
    let (out, r) = run(
        &fake,
        request(Some("ns=0;i=2253"), Some("i=2253"), json!({}), limits()),
    )
    .await;
    let end = r.unwrap();
    assert!(end.excluded.is_empty());
    assert_eq!(out.ids(), vec!["i=2253", "i=2256"]);
}

#[tokio::test]
async fn a_branch_scan_starts_with_its_folder() {
    let fake = plant();
    let (out, r) = run(
        &fake,
        request(
            Some("ns=1;s=Line2"),
            Some("ns=1;s=Line2"),
            json!({}),
            limits(),
        ),
    )
    .await;
    let end = r.unwrap();
    assert!(end.exhaustive);
    // The Server object is not under the root, so nothing is excluded.
    assert!(end.excluded.is_empty());
    let items = out.items();
    assert_eq!(items[0].id, "ns=1;s=Line2");
    assert_eq!(items[0].parent, None);
    assert_eq!(items[0].name, "Line2");
    assert_eq!(items[0].kind, ItemKind::Folder);
    // The same ids as a full scan gives, and Shared under Line2 now.
    assert_eq!(
        out.get("ns=1;s=Shared").parent.as_deref(),
        Some("ns=1;s=Line2")
    );
    assert_eq!(items.len(), 7);
}

#[tokio::test]
async fn a_root_on_a_variable() {
    let fake = plant();
    let (out, r) = run(
        &fake,
        request(Some("ns=1;s=Line1/Speed"), None, json!({}), limits()),
    )
    .await;
    r.unwrap();
    let items = out.items();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].kind, ItemKind::Value);
    assert_eq!(items[0].r#type, Some(ScoutType::Double));
}

#[tokio::test]
async fn bad_roots_and_options_are_options_errors() {
    let fake = plant();
    for (root, folder, options) in [
        (Some("not a node"), None, json!({})),
        (Some("ns=1;s=Nope"), None, json!({})),
        (None, Some("ns=1;s=Line1"), json!({})),
        (Some("ns=1;s=Line1"), Some("ns=1;s=Line2"), json!({})),
        // A DataType is not somewhere to scan from.
        (Some("ns=2;i=3001"), None, json!({})),
        (None, None, json!({ "include_server": "yes" })),
        (None, None, json!({ "units": 1 })),
    ] {
        let (out, r) = run(&fake, request(root, folder, options.clone(), limits())).await;
        let e = r.expect_err(&format!("{root:?} {folder:?} {options}"));
        assert_eq!(e.code, ScoutCode::Options, "{e}");
        assert!(out.items().is_empty());
    }
    // Unknown options are ignored.
    let (_, r) = run(
        &fake,
        request(None, None, json!({ "colour": "blue" }), limits()),
    )
    .await;
    r.unwrap();
}

#[tokio::test]
async fn continuation_points_are_followed_to_the_end() {
    let mut fake = plant().with(|f| {
        for i in 0..250 {
            let id = s(1, &format!("Big/{i}"));
            f.add(
                id.clone(),
                FakeNode::var(&format!("V{i}"), DataTypeId::UInt16),
            );
            f.link(s(1, "Plant"), id);
        }
    });
    fake.page = 7;
    let (out, r) = run(&fake, request(None, None, json!({}), limits())).await;
    r.unwrap();
    let ids = out.ids();
    for i in 0..250 {
        assert!(ids.contains(&format!("ns=1;s=Big/{i}")), "Big/{i}");
    }
    assert_eq!(fake.open_points(), 0);
    assert!(fake.log().iter().any(|l| l.starts_with("next")));
}

#[tokio::test]
async fn operation_limits_size_the_requests() {
    let mut fake = plant();
    fake.advertised = Some((2, 7));
    fake.max_browse = 2;
    fake.max_read = 7;
    let (_, r) = run(&fake, request(None, None, json!({}), limits())).await;
    r.unwrap();
    for l in fake.log() {
        let (what, n) = l.split_once(' ').unwrap();
        let n: usize = n.parse().unwrap();
        match what {
            "browse" | "up" | "next" | "release" => assert!(n <= 2, "{l}"),
            "read" => assert!(n <= 7, "{l}"),
            _ => unreachable!(),
        }
    }
    // Limits over the driver's own caps are capped.
    let mut fake = plant().with(|f| {
        for i in 0..120 {
            let id = s(1, &format!("Big/{i}"));
            f.add(
                id.clone(),
                FakeNode::var(&format!("V{i}"), DataTypeId::UInt16),
            );
            f.link(s(1, "Plant"), id);
        }
    });
    fake.advertised = Some((5000, 5000));
    let (_, r) = run(&fake, request(None, None, json!({}), limits())).await;
    r.unwrap();
    let log = fake.log();
    let most = |w: &str| {
        log.iter()
            .filter_map(|l| l.strip_prefix(w))
            .map(|n| n.trim().parse::<usize>().unwrap())
            .max()
            .unwrap()
    };
    assert_eq!(most("browse"), BROWSE_BATCH);
    assert_eq!(most("read"), READ_BATCH);
}

#[tokio::test]
async fn too_many_operations_halves_the_batch_and_slows_down() {
    let mut fake = plant().with(|f| {
        for i in 0..120 {
            let id = s(1, &format!("Big/{i}"));
            f.add(
                id.clone(),
                FakeNode::var(&format!("V{i}"), DataTypeId::UInt16),
            );
            f.link(s(1, "Plant"), id);
        }
    });
    // The server says nothing about its limits, and refuses more than 9
    // nodes per Browse and 60 attributes per Read.
    fake.max_browse = 9;
    fake.max_read = 60;
    let started = tokio::time::Instant::now();
    let (out, r) = run(&fake, request(None, None, json!({}), limits())).await;
    r.unwrap();
    assert_eq!(out.ids().len(), 17 + 120);
    let log = fake.log();
    let browses: Vec<usize> = log
        .iter()
        .filter_map(|l| l.strip_prefix("browse "))
        .map(|n| n.parse().unwrap())
        .collect();
    // 50 refused, then 25, 12 and 6, which is accepted from then on.
    assert!(
        browses.windows(4).any(|w| w == [50, 25, 12, 6]),
        "{browses:?}"
    );
    assert!(browses.iter().rev().take(5).all(|&n| n <= 6), "{browses:?}");
    let reads: Vec<usize> = log
        .iter()
        .filter_map(|l| l.strip_prefix("read "))
        .map(|n| n.parse().unwrap())
        .collect();
    assert!(reads.windows(2).any(|w| w == [100, 50]), "{reads:?}");
    assert!(reads.iter().rev().take(3).all(|&n| n <= 50), "{reads:?}");
    // Each back-off doubles the pace, from 0 to 20 ms at first, and
    // the requests after it wait.
    assert!(started.elapsed() >= Duration::from_millis(200));
}

#[tokio::test]
async fn a_server_that_refuses_one_node_ends_the_scan() {
    let mut fake = plant();
    fake.max_browse = 0;
    fake.max_read = 0;
    fake.advertised = None;
    // Read is fine but every Browse is refused.
    struct Refuse(Fake);
    #[async_trait]
    impl Service for Refuse {
        async fn browse(
            &self,
            _: &[BrowseDescription],
            _: u32,
        ) -> Result<Vec<BrowseResult>, StatusCode> {
            Err(StatusCode::BadTooManyOperations)
        }
        async fn browse_next(
            &self,
            r: bool,
            p: &[ByteString],
        ) -> Result<Vec<BrowseResult>, StatusCode> {
            self.0.browse_next(r, p).await
        }
        async fn read(&self, ids: &[ReadValueId]) -> Result<Vec<DataValue>, StatusCode> {
            self.0.read(ids).await
        }
    }
    let out = Collect::new();
    let r = scout(
        Arc::new(Refuse(fake)),
        &request(None, None, json!({}), limits()),
        &out,
    )
    .await;
    let e = r.unwrap_err();
    assert_eq!(e.code, ScoutCode::Err);
    assert!(e.message.contains("BadTooManyOperations"), "{e}");
}

#[tokio::test]
async fn a_cancel_while_paging_releases_the_continuation_points() {
    let mut fake = plant().with(|f| {
        for i in 0..100 {
            let id = s(1, &format!("Big/{i}"));
            f.add(
                id.clone(),
                FakeNode::var(&format!("V{i}"), DataTypeId::UInt16),
            );
            f.link(s(1, "Plant"), id);
        }
    });
    fake.page = 5;
    let out = Collect::new();
    *fake.cancel_on_next.lock().unwrap() = Some((3, out.token.clone()));
    let r = scout(
        Arc::new(fake.clone()),
        &request(None, None, json!({}), limits()),
        &out,
    )
    .await;
    let e = r.unwrap_err();
    assert_eq!(e.code, ScoutCode::Cancelled);
    assert_eq!(fake.open_points(), 0);
    assert_eq!(fake.log().last().map(String::as_str), Some("release 1"));
}

#[tokio::test]
async fn the_item_cap_truncates_and_keeps_the_excluded_scope() {
    let fake = plant();
    let mut out = Collect::new();
    out.cap = 5;
    let r = scout(
        Arc::new(fake.clone()),
        &request(None, None, json!({}), limits()),
        &out,
    )
    .await;
    let end = r.unwrap();
    assert_eq!(end.truncated, Some(Truncation::Items));
    assert_eq!(end.excluded.len(), 1);
    assert_eq!(out.items().len(), 5);
    assert_eq!(fake.open_points(), 0);
}

#[tokio::test]
async fn folders_at_the_depth_cap_say_there_is_more() {
    let fake = plant();
    let mut l = limits();
    l.depth = 2;
    let (out, r) = run(&fake, request(None, None, json!({}), l)).await;
    let end = r.unwrap();
    assert_eq!(end.truncated, Some(Truncation::Depth));
    let ids = out.ids();
    assert_eq!(
        ids,
        vec![
            "ns=1;s=Plant",
            "ns=1;s=Line1",
            "ns=1;s=Line2",
            "ns=1;s=Loop"
        ]
    );
    for id in &ids[1..] {
        assert!(out.get(id).more, "{id}");
    }
    assert!(!out.get("ns=1;s=Plant").more);
    assert_eq!(fake.open_points(), 0);

    // Leaves at the cap have nothing more.
    let mut l = limits();
    l.depth = 3;
    let (out, r) = run(&fake, request(None, None, json!({}), l)).await;
    let end = r.unwrap();
    assert!(!out.get("ns=1;s=Line1/Speed").more);
    assert!(out.get("ns=1;s=Loop/A").more);
    assert_eq!(end.truncated, Some(Truncation::Depth));
}

#[tokio::test]
async fn a_denied_branch_is_partial_access() {
    let fake = plant().with(|f| {
        let mut st = f.state.lock().unwrap();
        st.nodes.get_mut("ns=1;s=Line2").unwrap().1.denied = true;
    });
    let (out, r) = run(&fake, request(None, None, json!({}), limits())).await;
    let end = r.unwrap();
    assert_eq!(end.truncated, Some(Truncation::PartialAccess));
    assert!(end.exhaustive);
    let line = out.get("ns=1;s=Line2");
    assert!(line.more);
    assert_eq!(
        line.detail,
        Some(json!({ "namespace_uri": "urn:test:one", "denied": true }))
    );
    assert!(!out.ids().contains(&"ns=1;s=Line2/Speed".to_string()));
}

#[tokio::test]
async fn expand_arrays_lists_small_arrays_element_by_element() {
    let fake = plant().with(|f| {
        let plant = s(1, "Plant");
        let grid = s(1, "Grid");
        f.add(
            grid.clone(),
            FakeNode {
                rank: 2,
                dims: Some(vec![2, 3]),
                ..FakeNode::var("Grid", DataTypeId::Int32)
            },
        );
        f.link(plant.clone(), grid);
        // No declared length: the value says it.
        let open = s(1, "Open");
        f.add(
            open.clone(),
            FakeNode {
                rank: 1,
                value: Some(Variant::from(vec![1.5f64, 2.5])),
                ..FakeNode::var("Open", DataTypeId::Double)
            },
        );
        f.link(plant.clone(), open);
        let long = s(1, "Long");
        f.add(
            long.clone(),
            FakeNode {
                rank: 1,
                dims: Some(vec![65]),
                ..FakeNode::var("Long", DataTypeId::Double)
            },
        );
        f.link(plant.clone(), long);
        // A PLC's own node for element 1 of Elem.
        let elem = s(1, "Elem");
        f.add(
            elem.clone(),
            FakeNode {
                rank: 1,
                dims: Some(vec![2]),
                ..FakeNode::var("Elem", DataTypeId::Int16)
            },
        );
        f.link(plant.clone(), elem);
        let elem1 = s(1, "Elem[1]");
        f.add(elem1.clone(), FakeNode::var("Elem[1]", DataTypeId::Int16));
        f.link(plant, elem1);
    });
    let (out, r) = run(
        &fake,
        request(None, None, json!({ "expand_arrays": true }), limits()),
    )
    .await;
    r.unwrap();
    let ids = out.ids();
    let under = |p: &str| -> Vec<String> {
        out.items()
            .into_iter()
            .filter(|i| i.parent.as_deref() == Some(p))
            .map(|i| i.id)
            .collect()
    };
    assert_eq!(
        under("ns=1;s=Line1/Temps"),
        vec![
            "ns=1;s=Line1/Temps[0]",
            "ns=1;s=Line1/Temps[1]",
            "ns=1;s=Line1/Temps[2]"
        ]
    );
    let t0 = out.get("ns=1;s=Line1/Temps[0]");
    assert_eq!(t0.address.as_deref(), Some("ns=1;s=Line1/Temps[0]"));
    assert_eq!(t0.name, "[0]");
    assert_eq!(t0.r#type, Some(ScoutType::Float));
    assert_eq!(t0.kind, ItemKind::Value);
    assert_eq!(
        under("ns=1;s=Grid"),
        vec![
            "ns=1;s=Grid[0,0]",
            "ns=1;s=Grid[0,1]",
            "ns=1;s=Grid[0,2]",
            "ns=1;s=Grid[1,0]",
            "ns=1;s=Grid[1,1]",
            "ns=1;s=Grid[1,2]"
        ]
    );
    assert_eq!(
        under("ns=1;s=Open"),
        vec!["ns=1;s=Open[0]", "ns=1;s=Open[1]"]
    );
    assert!(under("ns=1;s=Long").is_empty());
    // The PLC's own element node is listed under Plant, once.
    assert_eq!(under("ns=1;s=Elem"), vec!["ns=1;s=Elem[0]"]);
    assert_eq!(ids.iter().filter(|i| *i == "ns=1;s=Elem[1]").count(), 1);
    assert_eq!(
        out.get("ns=1;s=Elem[1]").parent.as_deref(),
        Some("ns=1;s=Plant")
    );
    // Every element address parses as an element of its array.
    for id in ids.iter().filter(|i| i.ends_with(']')) {
        assert!(crate::addr::Addr::parse(id).usable(), "{id}");
    }

    // Without the option, no elements.
    let (out, r) = run(&fake, request(None, None, json!({}), limits())).await;
    r.unwrap();
    assert!(!out.ids().iter().any(|i| i.ends_with("[0]")));
}

#[tokio::test]
async fn units_come_from_the_engineering_units_property() {
    let fake = plant().with(|f| {
        let eu = s(1, "Line1/Speed/EngineeringUnits");
        let info = EUInformation {
            namespace_uri: "http://www.opcfoundation.org/UA/units/un/cefact".into(),
            unit_id: 5066068,
            display_name: LocalizedText::new("en", "rpm"),
            description: LocalizedText::new("en", "revolutions per minute"),
        };
        f.add(
            eu.clone(),
            FakeNode {
                name: ENGINEERING_UNITS.into(),
                value: Some(Variant::from(ExtensionObject::from_message(info))),
                ..FakeNode::var(ENGINEERING_UNITS, NodeId::new(0, 887u32))
            },
        );
        // The fake names a node's BrowseName from its own namespace, so
        // give the property a namespace 0 BrowseName by hand below.
        f.link(s(1, "Line1/Speed"), eu);
    });
    struct Ns0Names(Fake);
    #[async_trait]
    impl Service for Ns0Names {
        async fn browse(
            &self,
            n: &[BrowseDescription],
            m: u32,
        ) -> Result<Vec<BrowseResult>, StatusCode> {
            let mut r = self.0.browse(n, m).await?;
            for res in &mut r {
                for rd in res.references.iter_mut().flatten() {
                    if rd.browse_name.name.as_ref() == ENGINEERING_UNITS {
                        rd.browse_name.namespace_index = 0;
                    }
                }
            }
            Ok(r)
        }
        async fn browse_next(
            &self,
            r: bool,
            p: &[ByteString],
        ) -> Result<Vec<BrowseResult>, StatusCode> {
            self.0.browse_next(r, p).await
        }
        async fn read(&self, ids: &[ReadValueId]) -> Result<Vec<DataValue>, StatusCode> {
            self.0.read(ids).await
        }
    }
    let svc = Arc::new(Ns0Names(fake));
    let out = Collect::new();
    scout(
        svc.clone(),
        &request(None, None, json!({ "units": true }), limits()),
        &out,
    )
    .await
    .unwrap();
    assert_eq!(out.get("ns=1;s=Line1/Speed").unit.as_deref(), Some("rpm"));
    assert_eq!(out.get("ns=1;s=Line2/Speed").unit, None);
    // The property itself is listed under its variable.
    assert_eq!(
        out.get("ns=1;s=Line1/Speed/EngineeringUnits")
            .parent
            .as_deref(),
        Some("ns=1;s=Line1/Speed")
    );

    let out = Collect::new();
    scout(svc.clone(), &request(None, None, json!({}), limits()), &out)
        .await
        .unwrap();
    assert_eq!(out.get("ns=1;s=Line1/Speed").unit, None);
}

#[tokio::test]
async fn samples_only_when_asked() {
    let fake = plant().with(|f| {
        let mut st = f.state.lock().unwrap();
        st.nodes.get_mut("ns=1;s=Line1/Speed").unwrap().1.value = Some(Variant::Double(12.5));
        st.nodes.get_mut("ns=1;s=Line1/Count").unwrap().1.value =
            Some(Variant::String("ten".into()));
    });
    let mut l = limits();
    l.samples = true;
    let (out, r) = run(&fake, request(None, None, json!({}), l)).await;
    r.unwrap();
    assert_eq!(
        out.get("ns=1;s=Line1/Speed").sample.as_deref(),
        Some("12.5")
    );
    assert_eq!(out.get("ns=1;s=Line1/Count").sample.as_deref(), Some("ten"));
    assert_eq!(out.get("ns=1;s=Line2/Speed").sample, None);
}

#[tokio::test]
async fn a_lost_session_is_conn() {
    let mut fake = plant();
    fake.fail_after = Some(4);
    let (_, r) = run(&fake, request(None, None, json!({}), limits())).await;
    let e = r.unwrap_err();
    assert_eq!(e.code, ScoutCode::Conn);
    assert!(e.message.contains("BadConnectionClosed"), "{e}");
}

#[tokio::test]
async fn a_cancel_before_a_request_stops_at_once() {
    let fake = plant();
    let mut out = Collect::new();
    out.cancel_after = Some(1);
    let r = scout(
        Arc::new(fake.clone()),
        &request(None, None, json!({}), limits()),
        &out,
    )
    .await;
    assert_eq!(r.unwrap_err().code, ScoutCode::Cancelled);
    assert_eq!(out.items().len(), 1);
}

#[tokio::test]
async fn requests_are_paced() {
    let fake = plant();
    let mut l = limits();
    l.pace_ms = 30;
    let started = tokio::time::Instant::now();
    let (_, r) = run(&fake, request(None, None, json!({}), l)).await;
    r.unwrap();
    let requests = fake.log().len() as u32;
    assert!(requests > 5);
    assert!(started.elapsed() >= Duration::from_millis(30) * (requests - 1));
}

#[test]
fn array_shapes() {
    let v = |rank: i32, dims: Option<Vec<u32>>| Var {
        data_type: None,
        rank,
        dims,
        access: None,
    };
    assert!(!v(-1, None).array());
    assert!(!v(-3, None).array());
    assert!(!v(-2, None).array());
    assert!(v(0, None).array());
    assert_eq!(v(0, None).dims(), vec![0]);
    assert_eq!(v(1, None).dims(), vec![0]);
    assert_eq!(v(2, Some(vec![2, 3])).dims(), vec![2, 3]);
    // Dimensions that don't match the rank are not trusted.
    assert_eq!(v(2, Some(vec![6])).dims(), vec![0, 0]);
    assert_eq!(v(1, Some(vec![4])).known_dims(), Some(vec![4]));
    assert_eq!(v(1, Some(vec![0])).known_dims(), None);
}

/// A plant with `folders` more folders under Plant, each holding
/// `size` UInt16 variables with long string ids.
fn wide(folders: &[(&str, usize)]) -> Fake {
    plant().with(|f| {
        for (name, size) in folders {
            let folder = s(1, name);
            f.add(folder.clone(), FakeNode::object(name));
            f.link(s(1, "Plant"), folder.clone());
            for i in 0..*size {
                let id = s(1, &format!("{name}/a rather long PLC tag name {i:04}"));
                f.add(
                    id.clone(),
                    FakeNode::var(&format!("T{i}"), DataTypeId::UInt16),
                );
                f.link(folder.clone(), id);
            }
        }
    })
}

#[tokio::test]
async fn long_arrays_are_read_a_few_elements_at_a_time() {
    let mut fake = plant().with(|f| {
        let plant = s(1, "Plant");
        let array = |name: &str, rank: i32, n: usize| FakeNode {
            rank,
            value: Some(Variant::from((0..n).map(|i| i as f64).collect::<Vec<_>>())),
            ..FakeNode::var(name, DataTypeId::Double)
        };
        // No declared length, as many servers leave arrays.
        for (name, n) in [("Huge", 5000), ("Mid", 64), ("Over", 65), ("Tiny", 3)] {
            f.add(s(1, name), array(name, 1, n));
            f.link(plant.clone(), s(1, name));
        }
        // Three dimensions of unknown length: not read at all.
        f.add(s(1, "Cube"), array("Cube", 3, 8));
        f.link(plant, s(1, "Cube"));
    });
    // The client can't decode an array of more than 1000 elements,
    // which would close the handler's connection.
    fake.max_array = 1000;
    let mut l = limits();
    l.samples = true;
    let (out, r) = run(
        &fake,
        request(None, None, json!({ "expand_arrays": true }), l),
    )
    .await;
    let end = r.unwrap();
    assert!(end.exhaustive);
    assert!(!fake.log().contains(&"undecodable".to_string()));
    let under = |p: &str| {
        out.items()
            .into_iter()
            .filter(|i| i.parent.as_deref() == Some(p))
            .count()
    };
    assert_eq!(under("ns=1;s=Huge"), 0);
    assert_eq!(under("ns=1;s=Over"), 0);
    assert_eq!(under("ns=1;s=Mid"), 64);
    assert_eq!(under("ns=1;s=Tiny"), 3);
    assert_eq!(under("ns=1;s=Cube"), 0);
    let reads = fake.value_reads();
    assert!(reads.contains(&"ns=1;s=Huge 0:64".to_string()), "{reads:?}");
    assert!(
        !reads.iter().any(|r| r.starts_with("ns=1;s=Cube")),
        "{reads:?}"
    );
    // One read gives both the length and the sample.
    assert_eq!(
        reads
            .iter()
            .filter(|r| r.starts_with("ns=1;s=Huge"))
            .count(),
        1
    );
    assert!(
        out.get("ns=1;s=Huge")
            .sample
            .is_some_and(|s| s.starts_with("[0.0,1.0,2.0") && s.ends_with("64.0]")),
        "{:?}",
        out.get("ns=1;s=Huge").sample
    );
}

#[tokio::test]
async fn samples_read_values_of_known_types_only() {
    let fake = plant().with(|f| {
        let mut st = f.state.lock().unwrap();
        st.nodes.get_mut("ns=1;s=Line1/Speed").unwrap().1.value = Some(Variant::Double(1.0));
        st.nodes.get_mut("ns=2;s=Line1/Recipe").unwrap().1.value =
            Some(Variant::ByteString(ByteString::from(vec![0u8; 100_000])));
    });
    let mut l = limits();
    l.samples = true;
    let (out, r) = run(&fake, request(None, None, json!({}), l)).await;
    r.unwrap();
    let reads = fake.value_reads();
    // A structure has no Sparkplug type, so its value is never read.
    assert!(!reads.iter().any(|r| r.contains("Recipe")), "{reads:?}");
    assert_eq!(out.get("ns=2;s=Line1/Recipe").sample, None);
    assert_eq!(out.get("ns=1;s=Line1/Speed").sample.as_deref(), Some("1.0"));
    // Without samples or arrays to measure, no value is read.
    let fake = plant();
    let (_, r) = run(&fake, request(None, None, json!({}), limits())).await;
    r.unwrap();
    // Only the server's own NamespaceArray and operation limits.
    assert!(
        fake.value_reads().iter().all(|r| r.starts_with("i=")),
        "{:?}",
        fake.value_reads()
    );
}

#[tokio::test]
async fn an_answer_too_big_shrinks_the_batch_then_the_references() {
    let mut fake = wide(&[("Big0", 300), ("Big1", 300), ("Big2", 300), ("Wide", 1000)]);
    // A server whose answers fit in the client's message size up to
    // 400 references.
    fake.max_answer_refs = 400;
    let (out, r) = run(&fake, request(None, None, json!({}), limits())).await;
    let end = r.unwrap();
    assert!(end.exhaustive);
    let ids = out.ids();
    for (name, size) in [("Big0", 300), ("Big1", 300), ("Big2", 300), ("Wide", 1000)] {
        assert!(!out.get(&format!("ns=1;s={name}")).more, "{name}");
        let n = ids
            .iter()
            .filter(|i| i.starts_with(&format!("ns=1;s={name}/")))
            .count();
        assert_eq!(n, size, "{name}");
    }
    assert_eq!(fake.open_points(), 0);
    let browses: Vec<usize> = fake
        .log()
        .iter()
        .filter_map(|l| l.strip_prefix("browse "))
        .map(|n| n.parse().unwrap())
        .collect();
    assert!(browses.contains(&1), "{browses:?}");
}

#[tokio::test]
async fn a_node_too_big_to_browse_is_incomplete() {
    let mut fake = plant();
    // Even 10 references are too many.
    fake.max_answer_refs = 5;
    let (out, r) = run(&fake, request(None, None, json!({}), limits())).await;
    let end = r.unwrap();
    assert!(!end.exhaustive);
    assert!(out.get("ns=1;s=Line1").more);
    assert!(!out.get("ns=1;s=Loop").more);
    assert!(out.ids().contains(&"ns=1;s=Loop/A".to_string()));
    assert_eq!(fake.open_points(), 0);
}

#[tokio::test]
async fn an_attribute_too_big_to_read_is_left_out() {
    let mut fake = plant().with(|f| {
        f.add(
            s(1, "Wave"),
            FakeNode {
                rank: 1,
                dims: Some(vec![40]),
                value: Some(Variant::from(vec![0.5f64; 40])),
                ..FakeNode::var("Wave", DataTypeId::Double)
            },
        );
        f.link(s(1, "Plant"), s(1, "Wave"));
        let mut st = f.state.lock().unwrap();
        st.nodes.get_mut("ns=1;s=Line1/Speed").unwrap().1.value = Some(Variant::Double(3.0));
    });
    fake.max_answer_elements = 10;
    let mut l = limits();
    l.samples = true;
    let (out, r) = run(&fake, request(None, None, json!({}), l)).await;
    r.unwrap();
    assert_eq!(out.get("ns=1;s=Wave").sample, None);
    assert_eq!(out.get("ns=1;s=Line1/Speed").sample.as_deref(), Some("3.0"));
    assert!(fake.log().contains(&"read 1".to_string()));
}

/// Wait until the fake has had `n` BrowseNext requests.
async fn wait_for_next(fake: &Fake, n: usize) {
    for _ in 0..200 {
        if fake.log().iter().filter(|l| l.starts_with("next")).count() >= n {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("no BrowseNext {n}: {:?}", fake.log());
}

#[tokio::test]
async fn a_browse_next_abandoned_on_cancel_still_releases_its_points() {
    let mut fake = wide(&[("Big", 100)]);
    fake.page = 5;
    // Slower than the 1.5 s a cancel waits.
    fake.next_delay = Duration::from_millis(2500);
    let out = Collect::new();
    *fake.cancel_on_next.lock().unwrap() = Some((2, out.token.clone()));
    let started = tokio::time::Instant::now();
    let r = scout(
        Arc::new(fake.clone()),
        &request(None, None, json!({}), limits()),
        &out,
    )
    .await;
    assert_eq!(r.unwrap_err().code, ScoutCode::Cancelled);
    // The first BrowseNext took 2.5 s, then the cancel waited 1.5 s.
    assert!(started.elapsed() < Duration::from_millis(4500));
    // The abandoned BrowseNext made a point after the scan stopped,
    // and the task that took it over released it.
    tokio::time::sleep(Duration::from_millis(1500)).await;
    assert_eq!(fake.open_points(), 0);
    assert!(
        fake.log()
            .iter()
            .filter(|l| l.starts_with("release"))
            .count()
            >= 2
    );
}

#[tokio::test]
async fn an_aborted_scan_still_releases_its_points() {
    let mut fake = wide(&[("Big", 100)]);
    fake.page = 5;
    fake.next_delay = Duration::from_millis(500);
    let scan = {
        let fake = fake.clone();
        tokio::spawn(async move {
            let out = Collect::new();
            scout(
                Arc::new(fake),
                &request(None, None, json!({}), limits()),
                &out,
            )
            .await
        })
    };
    wait_for_next(&fake, 1).await;
    // As the library does after its stop grace, or when the agent's
    // session ends.
    scan.abort();
    assert!(scan.await.unwrap_err().is_cancelled());
    tokio::time::sleep(Duration::from_millis(1000)).await;
    assert_eq!(fake.open_points(), 0);
}

// ---------------------------------------------------------------
// Live values (src/read.rs), against the same fake server

mod live {
    use super::*;
    use crate::read::{NOT_A_NODE, OpcuaReader, entry};
    use opcua::types::DateTime;
    use rs_edge_driver::{ReadData, ReadValue, Reader};

    /// The plant with values on some of its variables, and an array.
    fn valued() -> Fake {
        plant().with(|f| {
            let arr = s(1, "Arr");
            f.add(
                arr,
                FakeNode {
                    rank: 1,
                    value: Some(Variant::from(vec![10i32, 20, 30])),
                    ..FakeNode::var("Arr", DataTypeId::Int32)
                },
            );
            let mut st = f.state.lock().unwrap();
            let mut set = |id: &str, v: Variant| {
                st.nodes.get_mut(id).unwrap().1.value = Some(v);
            };
            set("ns=1;s=Line1/Speed", Variant::Double(1450.5));
            set("ns=1;s=Line2/Speed", Variant::Double(f64::NAN));
            set("ns=1;s=Line1/Count", Variant::String("ten".into()));
            set("ns=1;s=Shared", Variant::Int32(-3));
        })
    }

    fn by_address(values: &[ReadValue], a: &str) -> ReadValue {
        values
            .iter()
            .find(|v| v.address == a)
            .unwrap_or_else(|| panic!("no entry for {a}"))
            .clone()
    }

    fn reads(fake: &Fake) -> Vec<String> {
        fake.log()
            .into_iter()
            .filter(|l| l.starts_with("read"))
            .collect()
    }

    #[tokio::test]
    async fn one_read_for_every_address() {
        let fake = valued();
        let reader = OpcuaReader::with_service(Arc::new(fake.clone()));
        let addresses: Vec<String> = [
            "ns=1;s=Line1/Speed",
            "ns=1;s=Line2/Speed",
            "ns=1;s=Line1/Count",
            "ns=1;s=Shared",
            "ns=1;s=Gone",
            "not a node",
        ]
        .map(String::from)
        .to_vec();
        let values = reader.read(addresses.clone()).await;
        assert_eq!(values.len(), 6);

        let speed = by_address(&values, "ns=1;s=Line1/Speed");
        assert_eq!(speed.value, Some(ReadData::Float(1450.5)));
        assert_eq!(speed.r#type, Some(ScoutType::Double));
        assert_eq!(speed.error, None);
        let nan = by_address(&values, "ns=1;s=Line2/Speed");
        assert!(matches!(nan.value, Some(ReadData::Float(f)) if f.is_nan()));
        let count = by_address(&values, "ns=1;s=Line1/Count");
        assert_eq!(count.value, Some(ReadData::Json(json!("ten"))));
        assert_eq!(count.r#type, Some(ScoutType::String));
        let shared = by_address(&values, "ns=1;s=Shared");
        assert_eq!(shared.value, Some(ReadData::Json(json!(-3))));
        assert_eq!(shared.r#type, Some(ScoutType::Int32));
        let gone = by_address(&values, "ns=1;s=Gone");
        assert_eq!(gone.value, None);
        assert_eq!(gone.error.as_deref(), Some("BadNodeIdUnknown"));
        assert_eq!(
            by_address(&values, "not a node").error.as_deref(),
            Some(NOT_A_NODE)
        );

        // OperationLimits once, then one Read of the five nodes.
        assert_eq!(reads(&fake), vec!["read 1", "read 5"]);
        reader.read(addresses).await;
        assert_eq!(reads(&fake), vec!["read 1", "read 5", "read 5"]);
    }

    /// Batches keep to MaxNodesPerRead, and halve on
    /// BadTooManyOperations when the server does not say.
    #[tokio::test]
    async fn batches_keep_to_the_servers_limits() {
        let addresses: Vec<String> = (0..5).map(|_| "ns=1;s=Shared".to_owned()).collect();

        let mut fake = valued();
        fake.advertised = Some((50, 2));
        let reader = OpcuaReader::with_service(Arc::new(fake.clone()));
        let values = reader.read(addresses.clone()).await;
        assert_eq!(values.len(), 5);
        assert_eq!(reads(&fake), vec!["read 1", "read 2", "read 2", "read 1"]);

        let mut fake = valued();
        fake.max_read = 2;
        let reader = OpcuaReader::with_service(Arc::new(fake.clone()));
        let values = reader.read(addresses).await;
        assert!(values.iter().all(|v| v.error.is_none()), "{values:?}");
        assert_eq!(
            reads(&fake),
            vec!["read 1", "read 5", "read 2", "read 2", "read 1"]
        );
    }

    /// An element address whose node does not exist is read again as
    /// the array node with the index range.
    #[tokio::test]
    async fn element_addresses_fall_back_to_the_index_range() {
        let fake = valued();
        let reader = OpcuaReader::with_service(Arc::new(fake.clone()));
        let values = reader
            .read(vec!["ns=1;s=Arr[1]".into(), "ns=1;s=Arr".into()])
            .await;
        let one = by_address(&values, "ns=1;s=Arr[1]");
        assert_eq!(one.value, Some(ReadData::Json(json!(20))));
        assert_eq!(one.r#type, Some(ScoutType::Int32));
        let all = by_address(&values, "ns=1;s=Arr");
        assert_eq!(all.value, Some(ReadData::Json(json!([10, 20, 30]))));
        assert_eq!(all.r#type, None, "an array has no Sparkplug type");
        assert_eq!(reads(&fake), vec!["read 1", "read 2", "read 1"]);
        let tail: Vec<_> = fake.value_reads().into_iter().rev().take(2).collect();
        assert!(tail.contains(&"ns=1;s=Arr 1".to_owned()), "{tail:?}");
    }

    /// A failed request gives every address in it the status.
    #[tokio::test]
    async fn a_failed_read_names_its_status() {
        let mut fake = valued();
        fake.fail_after = Some(1);
        let reader = OpcuaReader::with_service(Arc::new(fake));
        let values = reader
            .read(vec!["ns=1;s=Shared".into(), "ns=1;s=Line1/Speed".into()])
            .await;
        assert_eq!(values.len(), 2);
        for v in values {
            assert_eq!(v.error.as_deref(), Some("BadConnectionClosed"));
            assert_eq!(v.value, None);
        }
    }

    #[test]
    fn statuses_and_timestamps() {
        let ts =
            DateTime::from(chrono::DateTime::from_timestamp_millis(1_795_600_000_000).unwrap());
        let ok = entry(
            "a",
            DataValue {
                value: Some(Variant::Float(0.1)),
                source_timestamp: Some(ts),
                ..Default::default()
            },
            false,
        );
        assert_eq!(ok.value, Some(ReadData::Float32(0.1)));
        assert_eq!(ok.r#type, Some(ScoutType::Float));
        assert_eq!(ok.ts, Some(1_795_600_000_000));

        let uncertain = entry(
            "a",
            DataValue {
                value: Some(Variant::Int16(4)),
                status: Some(StatusCode::UncertainLastUsableValue),
                ..Default::default()
            },
            false,
        );
        assert_eq!(uncertain.value, Some(ReadData::Json(json!(4))));
        assert_eq!(uncertain.error.as_deref(), Some("UncertainLastUsableValue"));

        let bad = entry("a", super::bad(StatusCode::BadNotReadable), false);
        assert_eq!(bad.value, None);
        assert_eq!(bad.error.as_deref(), Some("BadNotReadable"));

        let empty = entry("a", DataValue::null(), false);
        assert_eq!(empty.error.as_deref(), Some("No value"));
    }
}

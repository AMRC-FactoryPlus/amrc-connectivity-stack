// ACS OPC UA driver
// Scouting: list the server's address space for the Edge Scout panel
// Copyright 2026 University of Sheffield

//! The OPC UA [`Scouter`], which lists the nodes a server offers so an
//! operator can pick addresses in the Admin UI instead of typing them.
//! The protocol is the "Scouting" section of `acs-edge/docs/edge-split.md`
//! and the design is "edge-opcua" in
//! `docs/architecture/edge-management/edge-scout.md`.
//!
//! The scan uses the handler's own session, because many PLC servers
//! have few session slots. It walks the address space breadth first:
//!
//! - **Browse.** Forward `HierarchicalReferences` (`i=33`) and their
//!   subtypes, Objects and Variables only, at most 1000 references per
//!   node, and every continuation point followed with BrowseNext. Any
//!   continuation point still open when the scan stops (cancel, a cap
//!   or an error) is released. A request the scan stops waiting for,
//!   or that is still running when the library aborts the scan, is
//!   handed to a task of its own, which waits for the answer and
//!   releases the continuation points in it, because they belong to
//!   the handler's session and that lasts far longer than the scan.
//! - **One request at a time**, with `pace_ms` between requests. Each
//!   request names at most `MaxNodesPerBrowse` or `MaxNodesPerRead`
//!   nodes, read from the server's OperationLimits and capped at 50 and
//!   100. When the server answers `BadTooManyOperations` the batch
//!   halves and the pace doubles. When an answer is too big for the
//!   message limits (`BadResponseTooLarge`, `BadEncodingLimitsExceeded`
//!   or `BadTcpMessageTooLarge`) the batch halves, then a Browse of one
//!   node asks for fewer references a request, and a single node or
//!   attribute that is still too big is reported as failed, so one big
//!   node never ends the scan.
//! - **Values** are read only where needed, with a large `maxAge` so a
//!   gateway answers from its cache rather than asking the device.
//!   Arrays are read with the index range `0:64` in each dimension, so
//!   the answer holds at most 65 elements a dimension whatever the
//!   array's length, and arrays of more than two dimensions are not
//!   read.
//! - **Visited set.** Each node is listed once, under the first parent
//!   the walk reaches it from, which also ends `Organizes` cycles.
//! - **The Server object** (`i=2253`) is skipped unless the option
//!   `include_server` is set, and the end reports it as excluded with
//!   the prefix `i=`, so the Admin UI never calls a mapped
//!   `ServerStatus` metric missing.
//! - **Items.** An Object is a folder and a Variable a value, with its
//!   canonical node id (see [`canonical`]) as both `id` and `address`.
//!   Variables carry their type, access and description, and with the
//!   option `units` their EngineeringUnits. Nodes outside namespace 0
//!   carry `detail.namespace_uri`, because a namespace index can change
//!   when a server is rebuilt.
//!
//! The walk talks to the server through [`Service`] and sends items
//! through [`Out`], so the unit tests can run it against a fake server.

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::pin::Pin;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use opcua::client::Session;
use opcua::types::{
    AttributeId, BrowseDescription, BrowseDirection, BrowseResult, ByteString, DataValue,
    EUInformation, ExpandedNodeId, Identifier, NodeClass, NodeClassMask, NodeId, NumericRange,
    ReadValueId, ReferenceDescription, StatusCode, TimestampsToReturn, Variant,
};
use rs_edge_driver::{
    Access, CancellationToken, Excluded, Item, Progress, ScoutEnd, ScoutError, ScoutLimits,
    ScoutRequest, ScoutSink, ScoutType, Scouter, Stop, Truncation,
};
use serde_json::{Map, Value, json};

use crate::addr::canonical;
use crate::value;

/// The Objects folder, where a scan with no root starts.
const OBJECTS: u32 = 85;
/// The Server object, skipped unless `include_server` is set.
const SERVER: u32 = 2253;
/// `Server_NamespaceArray`.
const NAMESPACE_ARRAY: u32 = 2255;
/// `Server_ServerCapabilities_OperationLimits_MaxNodesPerRead`.
const MAX_NODES_PER_READ: u32 = 11705;
/// `Server_ServerCapabilities_OperationLimits_MaxNodesPerBrowse`.
const MAX_NODES_PER_BROWSE: u32 = 11710;
/// `HierarchicalReferences`.
const HIERARCHICAL: u32 = 33;
/// `HasSubtype`.
const HAS_SUBTYPE: u32 = 45;

/// Most nodes in one Browse or BrowseNext, whatever the server allows.
pub const BROWSE_BATCH: usize = 50;
/// Most attributes in one Read, whatever the server allows.
pub const READ_BATCH: usize = 100;
/// `requestedMaxReferencesPerNode` for every Browse, until an answer
/// is too big.
pub const MAX_REFS: u32 = 1000;
/// The fewest references per node a Browse asks for after answers that
/// were too big. Each step divides the number by 4.
pub const MIN_REFS: u32 = 10;
/// The longest one request may take, as for the handler's own requests.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
/// How long a request already sent may still take after a cancel, so
/// the continuation points it makes can be released. With
/// `RELEASE_WAIT` it stays inside the 3 s the library gives a scouter
/// to stop, and the protocol's 5 s for a cancel.
const CANCEL_WAIT: Duration = Duration::from_millis(1500);
/// How long releasing the open continuation points may take.
const RELEASE_WAIT: Duration = Duration::from_secs(1);
/// How long the task that takes over an abandoned request waits for
/// its answer.
const ABANDON_WAIT: Duration = Duration::from_secs(30);
/// How long that task, or the release after an abort, may take to
/// release the continuation points.
const ABANDON_RELEASE_WAIT: Duration = Duration::from_secs(10);
/// The `maxAge` of every Read, in ms. `Int32` max asks the server for a
/// cached value (OPC UA Part 4, 5.10.2), so a gateway server doesn't
/// read the device for a scan.
const MAX_AGE: f64 = i32::MAX as f64;
/// The least pace after a `BadTooManyOperations`, when `pace_ms` is 0:
/// the default `pace_ms`.
const BACKOFF_PACE: Duration = Duration::from_millis(20);
/// The most the pace grows to through back-off.
const MAX_PACE: Duration = Duration::from_secs(2);
/// Arrays with at most this many elements get element items with the
/// option `expand_arrays`.
pub const MAX_ELEMENTS: usize = 64;
/// The most dimensions an array may have for the scan to read its
/// value. Two dimensions of 65 elements are 4,225 elements, and a
/// third would make it 274,625.
const MAX_READ_RANK: usize = 2;
/// How many supertypes up from a DataType the scan looks for one it
/// knows.
const MAX_SUPERTYPE_HOPS: usize = 8;
/// The BrowseName of the EngineeringUnits property, in namespace 0.
const ENGINEERING_UNITS: &str = "EngineeringUnits";

/// The server side of a scan: the three services the walk uses. A
/// failed request gives the service result.
#[async_trait]
pub trait Service: Send + Sync {
    async fn browse(
        &self,
        nodes: &[BrowseDescription],
        max_refs: u32,
    ) -> Result<Vec<BrowseResult>, StatusCode>;
    async fn browse_next(
        &self,
        release: bool,
        points: &[ByteString],
    ) -> Result<Vec<BrowseResult>, StatusCode>;
    async fn read(&self, ids: &[ReadValueId]) -> Result<Vec<DataValue>, StatusCode>;
    /// A Read for live values: current values with their source
    /// timestamps. A fake server answers it as `read`.
    async fn read_live(&self, ids: &[ReadValueId]) -> Result<Vec<DataValue>, StatusCode> {
        self.read(ids).await
    }
}

/// The `maxAge` of a live read, in ms. Live values are read every 5 s
/// by default, so a server may answer from a cache up to a second old
/// rather than ask the device each time.
const LIVE_MAX_AGE: f64 = 1000.0;

/// `MaxNodesPerRead` from the server's OperationLimits, at most
/// [`READ_BATCH`], as a scan reads it. A server that does not say, or
/// says 0, gets [`READ_BATCH`].
pub async fn max_nodes_per_read(service: &dyn Service) -> usize {
    let id = read_id(&NodeId::new(0, MAX_NODES_PER_READ), AttributeId::Value);
    match service.read(&[id]).await {
        Ok(v) if v.len() == 1 => op_limit(&v[0], READ_BATCH),
        _ => READ_BATCH,
    }
}

/// An OperationLimits value as a batch size, at most `most`. Missing
/// or 0 means no limit, so `most`.
fn op_limit(v: &DataValue, most: usize) -> usize {
    match good(v).and_then(as_u64) {
        Some(n) if n > 0 => (n as usize).min(most),
        _ => most,
    }
}

/// A live session as a [`Service`].
pub struct SessionService(pub Arc<Session>);

#[async_trait]
impl Service for SessionService {
    async fn browse(
        &self,
        nodes: &[BrowseDescription],
        max_refs: u32,
    ) -> Result<Vec<BrowseResult>, StatusCode> {
        self.0
            .browse(nodes, max_refs, None)
            .await
            .map_err(|e| e.status())
    }

    async fn browse_next(
        &self,
        release: bool,
        points: &[ByteString],
    ) -> Result<Vec<BrowseResult>, StatusCode> {
        self.0
            .browse_next(release, points)
            .await
            .map_err(|e| e.status())
    }

    async fn read(&self, ids: &[ReadValueId]) -> Result<Vec<DataValue>, StatusCode> {
        self.0
            .read(ids, TimestampsToReturn::Neither, MAX_AGE)
            .await
            .map_err(|e| e.status())
    }

    async fn read_live(&self, ids: &[ReadValueId]) -> Result<Vec<DataValue>, StatusCode> {
        let values = self
            .0
            .read(ids, TimestampsToReturn::Source, LIVE_MAX_AGE)
            .await
            .map_err(|e| e.status())?;
        // async-opcua moves every DateTime it decodes onto our clock
        // when it allows for a server clock that is out, so put values
        // and their timestamps back as the server sent them, as the
        // subscriptions do.
        let offset = self.0.context().read().options().client_offset;
        Ok(values
            .into_iter()
            .map(|mut dv| {
                dv.value = dv.value.map(|v| value::undo_clock_offset(v, offset));
                dv.source_timestamp = dv.source_timestamp.map(|t| t + offset);
                dv
            })
            .collect())
    }
}

/// Where a scan's items go: a [`ScoutSink`], or a collector in tests.
#[async_trait]
pub trait Out: Send + Sync {
    async fn add(&self, items: Vec<Item>) -> Result<(), Stop>;
    fn progress(&self, p: Progress);
    fn token(&self) -> CancellationToken;
}

#[async_trait]
impl Out for ScoutSink {
    async fn add(&self, items: Vec<Item>) -> Result<(), Stop> {
        ScoutSink::add(self, items).await
    }

    fn progress(&self, p: Progress) {
        ScoutSink::progress(self, p);
    }

    fn token(&self) -> CancellationToken {
        self.cancelled()
    }
}

/// The scouter the handler hands out, holding a clone of its session.
pub struct OpcuaScouter {
    service: Arc<dyn Service>,
}

impl OpcuaScouter {
    pub fn new(session: Arc<Session>) -> Self {
        Self {
            service: Arc::new(SessionService(session)),
        }
    }
}

#[async_trait]
impl Scouter for OpcuaScouter {
    async fn scout(&self, req: ScoutRequest, sink: ScoutSink) -> Result<ScoutEnd, ScoutError> {
        scout(self.service.clone(), &req, &sink).await
    }
}

/// The scan's options, from the DriverDef's `scout.options` form.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Options {
    /// List the Server object (`i=2253`) too.
    pub include_server: bool,
    /// Give arrays of up to 64 elements an item per element.
    pub expand_arrays: bool,
    /// Read each variable's EngineeringUnits property into `unit`.
    pub units: bool,
}

impl Options {
    const KNOWN: [&str; 3] = ["include_server", "expand_arrays", "units"];

    /// Read the options. A known option of the wrong type is `OPTIONS`.
    /// Unknown ones are logged and ignored, as protocol readers ignore
    /// keys they don't know.
    pub fn from_json(o: &Map<String, Value>) -> Result<Self, ScoutError> {
        let flag = |key: &str| match o.get(key) {
            None | Some(Value::Null) => Ok(false),
            Some(Value::Bool(b)) => Ok(*b),
            Some(v) => Err(ScoutError::options(format!(
                "The option {key} must be true or false, not {v}"
            ))),
        };
        for key in o.keys().filter(|k| !Self::KNOWN.contains(&k.as_str())) {
            tracing::info!("ignoring the unknown scan option {key:?}");
        }
        Ok(Self {
            include_server: flag("include_server")?,
            expand_arrays: flag("expand_arrays")?,
            units: flag("units")?,
        })
    }
}

/// The Sparkplug type of a namespace 0 DataType the walk knows without
/// asking the server: `Some(Some(t))` maps to `t`, `Some(None)` has no
/// Sparkplug type (structures, ByteString, the abstract types), and
/// `None` is not known, so the walk looks up its supertypes.
pub fn known_type(id: &NodeId) -> Option<Option<ScoutType>> {
    use ScoutType as T;
    let Identifier::Numeric(n) = id.identifier else {
        return None;
    };
    if id.namespace != 0 {
        return None;
    }
    Some(match n {
        1 => Some(T::Boolean),
        2 => Some(T::Int8),
        3 => Some(T::UInt8),
        4 => Some(T::Int16),
        5 => Some(T::UInt16),
        6 => Some(T::Int32),
        7 => Some(T::UInt32),
        8 => Some(T::Int64),
        9 => Some(T::UInt64),
        10 => Some(T::Float),
        11 => Some(T::Double),
        12 => Some(T::String),
        13 => Some(T::DateTime),
        14 => Some(T::Uuid),
        // LocalizedText is sent as {locale, text}, and its text is the
        // string a metric wants.
        21 => Some(T::String),
        // Enumerations are Int32 on the wire.
        29 => Some(T::Int32),
        // Common subtypes, to save a lookup: IntegerId, Counter,
        // Duration, UtcTime and LocaleId.
        288 | 289 => Some(T::UInt32),
        290 => Some(T::Double),
        294 => Some(T::DateTime),
        295 => Some(T::String),
        // ByteString, XmlElement, NodeId, ExpandedNodeId, StatusCode,
        // QualifiedName, Structure, DataValue, BaseDataType,
        // DiagnosticInfo, Number, Integer, UInteger.
        15..=20 | 22..=28 => None,
        _ => return None,
    })
}

/// Why the walk stopped before the end.
enum Halt {
    Stop(Stop),
    Error(ScoutError),
    /// The server answered `BadTooManyOperations`. Never leaves the
    /// request loops.
    TooMany,
    /// The request or its answer was too big for the message limits.
    /// Never leaves the request loops.
    TooLarge(StatusCode),
}

impl From<Stop> for Halt {
    fn from(s: Stop) -> Self {
        Self::Stop(s)
    }
}

impl From<ScoutError> for Halt {
    fn from(e: ScoutError) -> Self {
        Self::Error(e)
    }
}

/// A node the walk has found and not yet sent.
struct Node {
    id: NodeId,
    key: String,
    depth: u32,
    class: NodeClass,
    /// `None` for the Objects folder of a scan with no root, which is
    /// browsed but not listed.
    item: Option<Item>,
    /// Element items of an array, sent after the node's own item.
    elements: Vec<Item>,
    /// The node's EngineeringUnits property, found when browsing it.
    units: Option<NodeId>,
}

/// What a Browse found for one node.
#[derive(Default)]
struct Browsed {
    refs: Vec<ReferenceDescription>,
    status: StatusCode,
    /// Some references were not listed: a peek, or a continuation
    /// point the server lost.
    more: bool,
}

/// A request the walk has sent, as a future the walk owns, so that a
/// task of its own can take it over.
type Request<T> = Pin<Box<dyn Future<Output = Result<T, StatusCode>> + Send>>;

/// The continuation points in an answer, for a request that makes them.
type Points<T> = fn(&T) -> Vec<ByteString>;

/// A request in flight. If it is dropped before the answer came, as
/// when the walk stops waiting or the library aborts the scan, a task
/// of its own waits for the answer and releases the continuation
/// points in it. Otherwise the server would keep them as long as the
/// session lasts, and servers allow few per session.
struct InFlight<T: Send + 'static> {
    request: Option<Request<T>>,
    service: Arc<dyn Service>,
    points: Option<Points<T>>,
}

impl<T: Send + 'static> Drop for InFlight<T> {
    fn drop(&mut self) {
        let (Some(request), Some(points)) = (self.request.take(), self.points) else {
            return;
        };
        let Ok(rt) = tokio::runtime::Handle::try_current() else {
            return;
        };
        let service = self.service.clone();
        rt.spawn(async move {
            let Ok(Ok(answer)) = tokio::time::timeout(ABANDON_WAIT, request).await else {
                return;
            };
            let open = points(&answer);
            if !open.is_empty() {
                tracing::debug!(
                    "releasing {} continuation points from an abandoned request",
                    open.len()
                );
                release_all(&*service, open, ABANDON_RELEASE_WAIT).await;
            }
        });
    }
}

/// The continuation points in a Browse or BrowseNext answer. It takes
/// a `&Vec` because it is a [`Points`] of the answer's own type.
#[allow(clippy::ptr_arg)]
fn browse_points(results: &Vec<BrowseResult>) -> Vec<ByteString> {
    results
        .iter()
        .filter(|r| !r.continuation_point.is_null_or_empty())
        .map(|r| r.continuation_point.clone())
        .collect()
}

/// Release continuation points, waiting at most `wait` for each batch.
/// Errors are only logged.
async fn release_all(service: &dyn Service, points: Vec<ByteString>, wait: Duration) {
    for chunk in points.chunks(BROWSE_BATCH) {
        match tokio::time::timeout(wait, service.browse_next(true, chunk)).await {
            Ok(Ok(_)) => {}
            Ok(Err(s)) => tracing::debug!("releasing continuation points: {s}"),
            Err(_) => tracing::debug!("releasing continuation points: no answer"),
        }
    }
}

/// Whether a request failed because it or its answer was too big for
/// the message limits of the server or this client. node-opcua says
/// `BadTcpMessageTooLarge` where the standard says
/// `BadResponseTooLarge`.
fn too_large(s: StatusCode) -> bool {
    s == StatusCode::BadResponseTooLarge
        || s == StatusCode::BadRequestTooLarge
        || s == StatusCode::BadEncodingLimitsExceeded
        || s == StatusCode::BadTcpMessageTooLarge
}

/// Run one scan.
pub async fn scout(
    service: Arc<dyn Service>,
    req: &ScoutRequest,
    out: &dyn Out,
) -> Result<ScoutEnd, ScoutError> {
    let options = Options::from_json(&req.options)?;
    tracing::info!(
        root = req.root.as_deref().unwrap_or("Objects"),
        "OPC UA scan starting: {options:?}, {:?}",
        req.limits
    );
    let mut walk = Walk::new(service, out, options, req.limits);
    let result = walk.run(req).await;
    walk.release().await;
    let result = match result {
        Ok(()) => Ok(walk.end()),
        Err(Halt::Stop(Stop::Items)) => {
            let mut end = walk.end();
            end.truncated = Some(Truncation::Items);
            Ok(end)
        }
        Err(Halt::Stop(stop)) => Err(stop.into()),
        Err(Halt::Error(e)) => Err(e),
        Err(Halt::TooMany) => Err(ScoutError::err("BadTooManyOperations")),
        Err(Halt::TooLarge(s)) => Err(ScoutError::err(s.to_string())),
    };
    match &result {
        Ok(end) => tracing::info!(
            requests = walk.requests,
            "OPC UA scan finished: {} nodes browsed, truncated {:?}",
            walk.browsed,
            end.truncated
        ),
        Err(e) => tracing::info!(requests = walk.requests, "OPC UA scan ended: {e}"),
    }
    result
}

struct Walk<'a> {
    service: Arc<dyn Service>,
    out: &'a dyn Out,
    options: Options,
    limits: ScoutLimits,
    token: CancellationToken,
    browse_batch: usize,
    read_batch: usize,
    /// `requestedMaxReferencesPerNode`, lowered when an answer for one
    /// node is too big.
    max_refs: u32,
    pace: Duration,
    /// Requests sent so far.
    requests: u64,
    /// Nodes browsed so far, for progress.
    browsed: u64,
    note: Option<String>,
    visited: HashSet<String>,
    namespaces: Vec<String>,
    types: HashMap<NodeId, Option<ScoutType>>,
    /// Continuation points the server holds for this scan.
    open: Vec<ByteString>,
    skipped_server: bool,
    denied: bool,
    depth_capped: bool,
    incomplete: bool,
}

/// A walk the library aborts mid-request never reaches its own
/// `release`, so release its open continuation points from a task of
/// their own.
impl Drop for Walk<'_> {
    fn drop(&mut self) {
        if self.open.is_empty() {
            return;
        }
        let Ok(rt) = tokio::runtime::Handle::try_current() else {
            return;
        };
        let points = std::mem::take(&mut self.open);
        let service = self.service.clone();
        tracing::debug!(
            "releasing {} continuation points after an abort",
            points.len()
        );
        rt.spawn(async move { release_all(&*service, points, ABANDON_RELEASE_WAIT).await });
    }
}

impl<'a> Walk<'a> {
    fn new(
        service: Arc<dyn Service>,
        out: &'a dyn Out,
        options: Options,
        limits: ScoutLimits,
    ) -> Self {
        Self {
            service,
            out,
            options,
            limits,
            token: out.token(),
            browse_batch: BROWSE_BATCH,
            read_batch: READ_BATCH,
            max_refs: MAX_REFS,
            pace: limits.pace(),
            requests: 0,
            browsed: 0,
            note: None,
            visited: HashSet::new(),
            namespaces: Vec::new(),
            types: HashMap::new(),
            open: Vec::new(),
            skipped_server: false,
            denied: false,
            depth_capped: false,
            incomplete: false,
        }
    }

    fn end(&self) -> ScoutEnd {
        let mut end = ScoutEnd::new(!self.incomplete);
        if self.denied {
            end = end.truncated(Truncation::PartialAccess);
        } else if self.depth_capped {
            end = end.truncated(Truncation::Depth);
        }
        if self.skipped_server {
            // Almost every namespace 0 node under Objects sits inside
            // the Server object, so `i=` places them.
            end = end.exclude(Excluded::new("i=2253", "skipped").with_prefixes(["i="]));
        }
        end
    }

    fn check(&self) -> Result<(), Halt> {
        if self.token.is_cancelled() {
            return Err(Stop::Cancelled.into());
        }
        Ok(())
    }

    /// Send one request: wait the pace first (except before the first
    /// request), then wait for the answer. A cancel during a request
    /// still waits up to `CANCEL_WAIT` for the answer, so the
    /// continuation points it makes can be released. A request the
    /// walk stops waiting for is handed to [`InFlight`], which releases
    /// the points in `points` once the answer comes.
    async fn call<T: Send + 'static>(
        &mut self,
        what: &str,
        request: Request<T>,
        points: Option<Points<T>>,
    ) -> Result<T, Halt> {
        if self.requests > 0 && !self.pace.is_zero() {
            tokio::select! {
                _ = self.token.cancelled() => return Err(Stop::Cancelled.into()),
                _ = tokio::time::sleep(self.pace) => {}
            }
        }
        self.check()?;
        self.requests += 1;
        let mut flight = InFlight {
            request: Some(request),
            service: self.service.clone(),
            points,
        };
        let answer = {
            let request = flight.request.as_mut().expect("a request");
            let deadline = tokio::time::sleep(REQUEST_TIMEOUT);
            tokio::pin!(deadline);
            tokio::select! {
                a = request.as_mut() => Some(a),
                _ = &mut deadline => None,
                _ = self.token.cancelled() => {
                    match tokio::time::timeout(CANCEL_WAIT, request.as_mut()).await {
                        Ok(a) => Some(a),
                        Err(_) => return Err(Stop::Cancelled.into()),
                    }
                }
            }
        };
        let Some(answer) = answer else {
            return Err(ScoutError::conn(format!(
                "The OPC UA server did not answer a {what} within {} s",
                REQUEST_TIMEOUT.as_secs()
            ))
            .into());
        };
        // The answer is here, so the walk deals with its points.
        flight.request = None;
        match answer {
            Ok(v) => Ok(v),
            Err(s) if s == StatusCode::BadTooManyOperations => Err(Halt::TooMany),
            Err(s) if too_large(s) => Err(Halt::TooLarge(s)),
            Err(s) => Err(ScoutError::conn(format!("The OPC UA {what} failed: {s}")).into()),
        }
    }

    /// After `BadTooManyOperations`: halve the batch and double the
    /// pace. A server that refuses one node at a time ends the scan.
    fn back_off(&mut self, batch: usize, what: &str) -> Result<usize, Halt> {
        if batch <= 1 {
            return Err(ScoutError::err(format!(
                "The OPC UA server refused a {what} of one node (BadTooManyOperations)"
            ))
            .into());
        }
        self.pace = (self.pace * 2).max(BACKOFF_PACE).min(MAX_PACE);
        let batch = batch / 2;
        tracing::warn!(
            "the OPC UA server answered BadTooManyOperations, so {what} batches are now {batch} \
             and the pace {:?}",
            self.pace
        );
        Ok(batch)
    }

    /// After an answer too big for the message limits: halve the
    /// batch, which must be more than one.
    fn shrink(&self, batch: usize, what: &str, s: StatusCode) -> usize {
        let batch = batch / 2;
        tracing::warn!("an OPC UA {what} was too big ({s}), so {what} batches are now {batch}");
        batch
    }

    /// Read attributes, in batches. An attribute too big to read on its
    /// own comes back with the status that said so.
    async fn read(&mut self, ids: &[ReadValueId]) -> Result<Vec<DataValue>, Halt> {
        let mut out = Vec::with_capacity(ids.len());
        let mut at = 0;
        while at < ids.len() {
            let end = (at + self.read_batch).min(ids.len());
            let chunk = ids[at..end].to_vec();
            let n = chunk.len();
            let service = self.service.clone();
            let request: Request<Vec<DataValue>> =
                Box::pin(async move { service.read(&chunk).await });
            match self.call("Read", request, None).await {
                Ok(values) => {
                    if values.len() != n {
                        return Err(ScoutError::err(format!(
                            "The OPC UA server answered a Read of {n} attributes with {}",
                            values.len()
                        ))
                        .into());
                    }
                    out.extend(values);
                    at = end;
                }
                Err(Halt::TooMany) => self.read_batch = self.back_off(n, "Read")?,
                Err(Halt::TooLarge(s)) if n > 1 => self.read_batch = self.shrink(n, "Read", s),
                Err(Halt::TooLarge(s)) => {
                    tracing::warn!(node = %ids[at].node_id, "an attribute is too big to read: {s}");
                    out.push(DataValue {
                        status: Some(s),
                        ..Default::default()
                    });
                    at = end;
                }
                Err(e) => return Err(e),
            }
        }
        Ok(out)
    }

    /// Browse nodes, following every continuation point, in batches.
    /// With `peek`, only find out whether each node has any references,
    /// and release the continuation points at once.
    async fn browse(
        &mut self,
        nodes: &[BrowseDescription],
        peek: bool,
    ) -> Result<Vec<Browsed>, Halt> {
        let mut out: Vec<Browsed> = Vec::with_capacity(nodes.len());
        let mut at = 0;
        while at < nodes.len() {
            let end = (at + self.browse_batch).min(nodes.len());
            let chunk = nodes[at..end].to_vec();
            let n = chunk.len();
            let max_refs = if peek { 1 } else { self.max_refs };
            let service = self.service.clone();
            let request: Request<Vec<BrowseResult>> =
                Box::pin(async move { service.browse(&chunk, max_refs).await });
            let results = match self.call("Browse", request, Some(browse_points)).await {
                Ok(r) => r,
                Err(Halt::TooMany) => {
                    self.browse_batch = self.back_off(n, "Browse")?;
                    continue;
                }
                Err(Halt::TooLarge(s)) if n > 1 => {
                    self.browse_batch = self.shrink(n, "Browse", s);
                    continue;
                }
                Err(Halt::TooLarge(s)) if max_refs > MIN_REFS => {
                    self.max_refs = (max_refs / 4).max(MIN_REFS);
                    tracing::warn!(
                        "an OPC UA Browse of one node was too big ({s}), so each Browse now \
                         asks for {} references a node",
                        self.max_refs
                    );
                    continue;
                }
                Err(Halt::TooLarge(s)) => {
                    // Too big even a few references at a time: the
                    // node's Browse failed.
                    vec![BrowseResult {
                        status_code: s,
                        ..Default::default()
                    }]
                }
                Err(e) => return Err(e),
            };
            if results.len() != n {
                return Err(ScoutError::err(format!(
                    "The OPC UA server answered a Browse of {n} nodes with {}",
                    results.len()
                ))
                .into());
            }
            let base = out.len();
            let mut pending: Vec<(usize, ByteString)> = Vec::new();
            for (i, r) in results.into_iter().enumerate() {
                if !r.continuation_point.is_null_or_empty() {
                    self.open.push(r.continuation_point.clone());
                    pending.push((base + i, r.continuation_point));
                }
                out.push(Browsed {
                    refs: r.references.unwrap_or_default(),
                    status: r.status_code,
                    more: false,
                });
            }
            at = end;
            self.browsed += n as u64;
            if peek {
                for (i, _) in &pending {
                    out[*i].more = true;
                }
                let points: Vec<ByteString> = pending.into_iter().map(|(_, p)| p).collect();
                self.release_points(&points).await?;
            } else {
                self.follow(&mut out, pending).await?;
            }
            self.check()?;
            self.out.progress(self.progress());
        }
        Ok(out)
    }

    /// Follow continuation points with BrowseNext until every node is
    /// complete.
    async fn follow(
        &mut self,
        out: &mut [Browsed],
        mut pending: Vec<(usize, ByteString)>,
    ) -> Result<(), Halt> {
        while !pending.is_empty() {
            self.check()?;
            let n = self.browse_batch.min(pending.len());
            let points: Vec<ByteString> = pending[..n].iter().map(|(_, p)| p.clone()).collect();
            let service = self.service.clone();
            let request: Request<Vec<BrowseResult>> =
                Box::pin(async move { service.browse_next(false, &points).await });
            let results = match self.call("BrowseNext", request, Some(browse_points)).await {
                Ok(r) => r,
                Err(Halt::TooMany) => {
                    self.browse_batch = self.back_off(n, "BrowseNext")?;
                    continue;
                }
                Err(Halt::TooLarge(s)) if n > 1 => {
                    self.browse_batch = self.shrink(n, "BrowseNext", s);
                    continue;
                }
                Err(Halt::TooLarge(s)) => {
                    // One page of one node is too big, and a
                    // BrowseNext can't ask for fewer references, so
                    // that node's list ends here.
                    let (i, point) = pending.remove(0);
                    tracing::warn!("BrowseNext failed: {s}");
                    out[i].more = true;
                    self.incomplete = true;
                    self.release_points(&[point]).await?;
                    continue;
                }
                Err(e) => return Err(e),
            };
            if results.len() != n {
                return Err(ScoutError::err(format!(
                    "The OPC UA server answered a BrowseNext of {n} points with {}",
                    results.len()
                ))
                .into());
            }
            let done: Vec<(usize, ByteString)> = pending.drain(..n).collect();
            for ((i, point), r) in done.into_iter().zip(results) {
                self.open.retain(|p| p != &point);
                if r.status_code.is_bad() {
                    // The server has forgotten the point (it may have
                    // run out), so this node's list is incomplete.
                    tracing::warn!("BrowseNext failed: {}", r.status_code);
                    out[i].more = true;
                    self.incomplete = true;
                    continue;
                }
                out[i].refs.extend(r.references.unwrap_or_default());
                if !r.continuation_point.is_null_or_empty() {
                    self.open.push(r.continuation_point.clone());
                    pending.push((i, r.continuation_point));
                }
            }
        }
        Ok(())
    }

    /// Release continuation points, as part of the walk.
    async fn release_points(&mut self, points: &[ByteString]) -> Result<(), Halt> {
        for chunk in points.chunks(self.browse_batch.max(1)) {
            let service = self.service.clone();
            let owned = chunk.to_vec();
            let request: Request<Vec<BrowseResult>> =
                Box::pin(async move { service.browse_next(true, &owned).await });
            match self.call("BrowseNext", request, None).await {
                Ok(_) | Err(Halt::TooMany) | Err(Halt::TooLarge(_)) => {}
                Err(e) => return Err(e),
            }
            self.open.retain(|p| !chunk.contains(p));
        }
        Ok(())
    }

    /// Release every continuation point still open when the walk
    /// stops, whatever stopped it. Errors are only logged.
    async fn release(&mut self) {
        if self.open.is_empty() {
            return;
        }
        let points = std::mem::take(&mut self.open);
        tracing::debug!("releasing {} continuation points", points.len());
        release_all(&*self.service, points, RELEASE_WAIT).await;
    }

    fn progress(&self) -> Progress {
        let p = Progress::new(self.browsed);
        match &self.note {
            Some(n) => p.with_note(n.clone()),
            None => p,
        }
    }

    /// The namespace URIs and the operation limits.
    async fn server_info(&mut self) -> Result<(), Halt> {
        let ids: Vec<ReadValueId> = [NAMESPACE_ARRAY, MAX_NODES_PER_BROWSE, MAX_NODES_PER_READ]
            .into_iter()
            .map(|n| read_id(&NodeId::new(0, n), AttributeId::Value))
            .collect();
        let values = self.read(&ids).await?;
        if let Some(Variant::Array(a)) = good(&values[0]) {
            self.namespaces = a
                .values
                .iter()
                .map(|v| match v {
                    Variant::String(s) => s.value().clone().unwrap_or_default(),
                    _ => String::new(),
                })
                .collect();
        }
        self.browse_batch = op_limit(&values[1], BROWSE_BATCH);
        self.read_batch = op_limit(&values[2], READ_BATCH);
        tracing::debug!(
            browse = self.browse_batch,
            read = self.read_batch,
            "OPC UA scan batch sizes"
        );
        Ok(())
    }

    /// The node the walk starts from.
    async fn root(&mut self, req: &ScoutRequest) -> Result<Node, Halt> {
        let Some(raw) = &req.root else {
            if req.folder_id.is_some() {
                return Err(ScoutError::options("A branch scan needs a root").into());
            }
            let id = NodeId::new(0, OBJECTS);
            let key = canonical(&id);
            self.visited.insert(key.clone());
            return Ok(Node {
                id,
                key,
                depth: 0,
                class: NodeClass::Object,
                item: None,
                elements: Vec::new(),
                units: None,
            });
        };
        let Ok(id) = NodeId::from_str(raw) else {
            return Err(ScoutError::options(format!("Root {raw} is not an OPC UA node id")).into());
        };
        let key = canonical(&id);
        if let Some(folder) = &req.folder_id
            && folder != &key
        {
            return Err(ScoutError::options(format!(
                "Folder {folder} is not the node {key} the root names"
            ))
            .into());
        }
        let ids = [
            read_id(&id, AttributeId::NodeClass),
            read_id(&id, AttributeId::DisplayName),
            read_id(&id, AttributeId::BrowseName),
        ];
        let values = self.read(&ids).await?;
        let class = match good(&values[0]) {
            Some(Variant::Int32(c)) => node_class(*c),
            _ => {
                let status = values[0].status.unwrap_or(StatusCode::BadNodeIdUnknown);
                return Err(ScoutError::options(format!(
                    "Root {raw} does not exist on the server ({status})"
                ))
                .into());
            }
        };
        if !matches!(class, NodeClass::Object | NodeClass::Variable) {
            return Err(ScoutError::options(format!(
                "Root {raw} is a {class:?}; a scan starts from an Object or a Variable"
            ))
            .into());
        }
        let name = match (good(&values[1]), good(&values[2])) {
            (Some(Variant::LocalizedText(t)), _) if !t.text.is_null() && !t.text.is_empty() => {
                t.text.to_string()
            }
            (_, Some(Variant::QualifiedName(q))) if !q.name.is_empty() => q.name.to_string(),
            _ => key.clone(),
        };
        self.visited.insert(key.clone());
        let mut node = self.node(id, key, None, name, class, 0);
        self.describe(std::slice::from_mut(&mut node)).await?;
        Ok(node)
    }

    /// A node and its item.
    fn node(
        &self,
        id: NodeId,
        key: String,
        parent: Option<&str>,
        name: String,
        class: NodeClass,
        depth: u32,
    ) -> Node {
        let mut item = match class {
            NodeClass::Variable => Item::value(key.clone(), parent, name, key.clone()),
            _ => Item::folder(key.clone(), parent, name),
        };
        if id.namespace != 0
            && let Some(uri) = self.namespaces.get(id.namespace as usize)
            && !uri.is_empty()
        {
            item = item.with_detail(json!({ "namespace_uri": uri }));
        }
        Node {
            id,
            key,
            depth,
            class,
            item: Some(item),
            elements: Vec::new(),
            units: None,
        }
    }

    /// The node a reference leads to, in this server, or `None`.
    fn local(&self, n: &ExpandedNodeId) -> Option<NodeId> {
        if n.server_index != 0 {
            return None;
        }
        let mut id = n.node_id.clone();
        if let Some(uri) = n.namespace_uri.value() {
            id.namespace = self.namespaces.iter().position(|u| u == uri)? as u16;
        }
        Some(id)
    }

    /// The child a reference leads to, unless it is skipped or already
    /// listed.
    fn child(&mut self, parent: &Node, r: &ReferenceDescription) -> Option<Node> {
        if !matches!(r.node_class, NodeClass::Object | NodeClass::Variable) {
            return None;
        }
        let id = self.local(&r.node_id)?;
        if id == NodeId::new(0, SERVER) && !self.options.include_server {
            self.skipped_server = true;
            return None;
        }
        let key = canonical(&id);
        if !self.visited.insert(key.clone()) {
            return None;
        }
        let name = if !r.display_name.text.is_empty() {
            r.display_name.text.to_string()
        } else if !r.browse_name.name.is_empty() {
            r.browse_name.name.to_string()
        } else {
            key.clone()
        };
        let parent = parent.item.as_ref().map(|_| parent.key.as_str());
        Some(self.node(id, key, parent, name, r.node_class, 0))
    }

    async fn run(&mut self, req: &ScoutRequest) -> Result<(), Halt> {
        self.server_info().await?;
        let mut frontier = vec![self.root(req).await?];
        while !frontier.is_empty() {
            self.check()?;
            let children = self.expand(&mut frontier).await?;
            if self.options.units {
                self.read_units(&mut frontier).await?;
            }
            let mut items = Vec::with_capacity(frontier.len());
            for node in frontier {
                items.extend(node.item);
                items.extend(node.elements);
            }
            if !items.is_empty() {
                self.out.add(items).await?;
            }
            frontier = children;
            self.describe(&mut frontier).await?;
        }
        Ok(())
    }

    /// Browse the frontier and return its children. Nodes at the depth
    /// cap are only peeked at: one with children gets `more: true`.
    async fn expand(&mut self, frontier: &mut [Node]) -> Result<Vec<Node>, Halt> {
        let cap = self.limits.depth;
        let (deep, peek): (Vec<usize>, Vec<usize>) =
            (0..frontier.len()).partition(|&i| frontier[i].depth < cap);
        let mut children = Vec::new();
        for (indexes, peeking) in [(deep, false), (peek, true)] {
            if indexes.is_empty() {
                continue;
            }
            let descs: Vec<BrowseDescription> = indexes
                .iter()
                .map(|&i| browse_down(&frontier[i].id))
                .collect();
            self.note = frontier.get(indexes[0]).map(|n| n.key.clone());
            let browsed = self.browse(&descs, peeking).await?;
            for (&i, b) in indexes.iter().zip(browsed) {
                let node = &mut frontier[i];
                if b.status == StatusCode::BadUserAccessDenied {
                    self.denied = true;
                    if let Some(item) = &mut node.item {
                        item.more = true;
                        let mut detail = item.detail.take().unwrap_or_else(|| json!({}));
                        detail["denied"] = json!(true);
                        item.detail = Some(detail);
                    }
                    continue;
                }
                if b.status.is_bad() {
                    tracing::warn!(node = %node.key, "Browse failed: {}", b.status);
                    if let Some(item) = &mut node.item {
                        item.more = true;
                    }
                    self.incomplete = true;
                    continue;
                }
                if peeking {
                    let has = b.more
                        || b.refs.iter().any(|r| {
                            matches!(r.node_class, NodeClass::Object | NodeClass::Variable)
                        });
                    if has && let Some(item) = &mut node.item {
                        item.more = true;
                        self.depth_capped = true;
                    }
                    continue;
                }
                if b.more
                    && let Some(item) = &mut node.item
                {
                    item.more = true;
                }
                if node.class == NodeClass::Variable {
                    node.units = b
                        .refs
                        .iter()
                        .find(|r| {
                            r.browse_name.namespace_index == 0
                                && r.browse_name.name.as_ref() == ENGINEERING_UNITS
                        })
                        .and_then(|r| self.local(&r.node_id));
                }
                let parent = &frontier[i];
                for r in &b.refs {
                    if let Some(mut c) = self.child(parent, r) {
                        c.depth = parent.depth + 1;
                        children.push(c);
                    }
                }
            }
        }
        Ok(children)
    }

    /// Read each node's EngineeringUnits property into its `unit`.
    async fn read_units(&mut self, frontier: &mut [Node]) -> Result<(), Halt> {
        let which: Vec<usize> = (0..frontier.len())
            .filter(|&i| frontier[i].units.is_some())
            .collect();
        if which.is_empty() {
            return Ok(());
        }
        let ids: Vec<ReadValueId> = which
            .iter()
            .map(|&i| read_id(frontier[i].units.as_ref().unwrap(), AttributeId::Value))
            .collect();
        let values = self.read(&ids).await?;
        for (&i, v) in which.iter().zip(&values) {
            if let Some(Variant::ExtensionObject(eo)) = good(v)
                && let Some(eu) = eo.inner_as::<EUInformation>()
                && let Some(text) = eu.display_name.text.value()
                && !text.is_empty()
                && let Some(item) = &mut frontier[i].item
            {
                item.unit = Some(text.clone());
            }
        }
        Ok(())
    }

    /// Read each node's attributes into its item.
    async fn describe(&mut self, nodes: &mut [Node]) -> Result<(), Halt> {
        const VAR_ATTRS: [AttributeId; 5] = [
            AttributeId::Description,
            AttributeId::DataType,
            AttributeId::ValueRank,
            AttributeId::ArrayDimensions,
            AttributeId::UserAccessLevel,
        ];
        let mut ids = Vec::new();
        for n in nodes.iter() {
            let attrs: &[AttributeId] = if n.class == NodeClass::Variable {
                &VAR_ATTRS
            } else {
                &[AttributeId::Description]
            };
            ids.extend(attrs.iter().map(|a| read_id(&n.id, *a)));
        }
        if ids.is_empty() {
            return Ok(());
        }
        let values = self.read(&ids).await?;
        let mut at = 0;
        let mut vars: Vec<(usize, Var)> = Vec::new();
        for (i, n) in nodes.iter_mut().enumerate() {
            let description = good(&values[at]).and_then(|v| match v {
                Variant::LocalizedText(t) => t.text.value().clone().filter(|s| !s.is_empty()),
                _ => None,
            });
            at += 1;
            if let (Some(d), Some(item)) = (description, &mut n.item) {
                item.description = Some(d);
            }
            if n.class != NodeClass::Variable {
                continue;
            }
            let v = &values[at..at + VAR_ATTRS.len() - 1];
            at += VAR_ATTRS.len() - 1;
            vars.push((i, Var::read(v)));
        }

        let types: Vec<NodeId> = vars
            .iter()
            .filter_map(|(_, v)| v.data_type.clone())
            .collect();
        self.resolve_types(types).await?;

        // Variables whose value the scan reads: arrays whose length the
        // server doesn't declare, to see how long they are, and with
        // `samples` each variable of a known type, for its sample.
        let mut value_reads: Vec<(usize, ReadValueId, bool, bool)> = Vec::new();
        for (j, (i, var)) in vars.iter().enumerate() {
            let t = var
                .data_type
                .as_ref()
                .and_then(|d| self.types.get(d).copied().flatten());
            let node = &mut nodes[*i];
            let Some(item) = &mut node.item else { continue };
            item.access = var.access;
            let mut detail = item.detail.take().unwrap_or_else(|| json!({}));
            let mut length = false;
            if var.array() {
                detail["dims"] = json!(var.dims());
                if let Some(d) = &var.data_type {
                    detail["ua_type"] = json!(canonical(d));
                }
                if self.options.expand_arrays {
                    match var.known_dims() {
                        Some(dims) => {
                            node.elements = self.elements(&node.key, &dims, t, var.access)
                        }
                        None => length = true,
                    }
                }
            } else if let Some(t) = t {
                item.r#type = Some(t);
            } else if let Some(d) = &var.data_type {
                detail["ua_type"] = json!(canonical(d));
            }
            if detail.as_object().is_some_and(|o| !o.is_empty()) {
                item.detail = Some(detail);
            }
            let sample = self.limits.samples && t.is_some();
            if !(length || sample) {
                continue;
            }
            let mut id = read_id(&node.id, AttributeId::Value);
            if var.array() {
                let Some(range) = var.element_range() else {
                    continue;
                };
                id.index_range = range;
            }
            value_reads.push((j, id, length, sample));
        }
        if value_reads.is_empty() {
            return Ok(());
        }

        let ids: Vec<ReadValueId> = value_reads.iter().map(|(_, id, ..)| id.clone()).collect();
        let values = self.read(&ids).await?;
        for ((j, _, length, sample), v) in value_reads.into_iter().zip(&values) {
            let (i, var) = &vars[j];
            let Some(value) = good(v) else { continue };
            if sample
                && let Some(text) = sample_text(value)
                && let Some(item) = &mut nodes[*i].item
            {
                item.sample = Some(text);
            }
            if !length {
                continue;
            }
            // At most 65 elements a dimension came back, so an array
            // of more than 64 gets no elements.
            let Variant::Array(a) = value else { continue };
            let dims = match &a.dimensions {
                Some(d) if !d.is_empty() => d.clone(),
                _ => vec![a.values.len() as u32],
            };
            let t = var
                .data_type
                .as_ref()
                .and_then(|d| self.types.get(d).copied().flatten());
            let key = nodes[*i].key.clone();
            nodes[*i].elements = self.elements(&key, &dims, t, var.access);
        }
        Ok(())
    }

    /// Element items for an array of up to `MAX_ELEMENTS` elements,
    /// addressed `node[i]` or `node[i,j]`, as `addr.rs` parses them. An
    /// element whose id is already listed, as a PLC's own element node
    /// `node[3]` is, is left out.
    fn elements(
        &mut self,
        key: &str,
        dims: &[u32],
        t: Option<ScoutType>,
        access: Option<Access>,
    ) -> Vec<Item> {
        let count: usize = dims.iter().map(|&d| d as usize).product();
        if dims.is_empty() || count == 0 || count > MAX_ELEMENTS {
            return Vec::new();
        }
        let mut out = Vec::with_capacity(count);
        let mut index = vec![0u32; dims.len()];
        for _ in 0..count {
            let suffix = index
                .iter()
                .map(u32::to_string)
                .collect::<Vec<_>>()
                .join(",");
            let id = format!("{key}[{suffix}]");
            if self.visited.insert(id.clone()) {
                let mut item = Item::value(id.clone(), Some(key), format!("[{suffix}]"), id);
                item.r#type = t;
                item.access = access;
                out.push(item);
            }
            // Row-major: the last index moves fastest.
            for d in (0..dims.len()).rev() {
                index[d] += 1;
                if index[d] < dims[d] {
                    break;
                }
                index[d] = 0;
            }
        }
        out
    }

    /// Work out the Sparkplug type of each DataType, looking up the
    /// supertypes of those it doesn't know.
    async fn resolve_types(&mut self, ids: Vec<NodeId>) -> Result<(), Halt> {
        // Each chain is the types met so far, the last one to look up.
        let mut chains: Vec<Vec<NodeId>> = Vec::new();
        let mut seen = HashSet::new();
        for id in ids {
            if self.types.contains_key(&id) || !seen.insert(id.clone()) {
                continue;
            }
            match known_type(&id) {
                Some(t) => {
                    self.types.insert(id, t);
                }
                None => chains.push(vec![id]),
            }
        }
        for _ in 0..MAX_SUPERTYPE_HOPS {
            if chains.is_empty() {
                break;
            }
            let descs: Vec<BrowseDescription> = chains
                .iter()
                .map(|c| browse_up(c.last().unwrap()))
                .collect();
            let browsed = self.browse(&descs, false).await?;
            let mut next = Vec::new();
            for (mut chain, b) in chains.into_iter().zip(browsed) {
                let parent = b
                    .refs
                    .iter()
                    .find(|r| r.node_class == NodeClass::DataType)
                    .and_then(|r| self.local(&r.node_id));
                let found = match &parent {
                    None => Some(None),
                    Some(p) => self.types.get(p).copied().or_else(|| known_type(p)),
                };
                match (found, parent) {
                    (Some(t), _) => {
                        for id in chain {
                            self.types.insert(id, t);
                        }
                    }
                    (None, Some(p)) => {
                        chain.push(p);
                        next.push(chain);
                    }
                    (None, None) => unreachable!(),
                }
            }
            chains = next;
        }
        for chain in chains {
            for id in chain {
                self.types.insert(id, None);
            }
        }
        Ok(())
    }
}

/// A Variable's attributes, in the order `describe` reads them after
/// the Description.
struct Var {
    data_type: Option<NodeId>,
    rank: i32,
    dims: Option<Vec<u32>>,
    access: Option<Access>,
}

impl Var {
    fn read(v: &[DataValue]) -> Self {
        let data_type = match good(&v[0]) {
            Some(Variant::NodeId(n)) => Some((**n).clone()),
            _ => None,
        };
        let rank = match good(&v[1]) {
            Some(Variant::Int32(r)) => *r,
            _ => -1,
        };
        let dims = match good(&v[2]) {
            Some(Variant::Array(a)) => Some(
                a.values
                    .iter()
                    .filter_map(as_u64)
                    .map(|d| d as u32)
                    .collect(),
            ),
            _ => None,
        };
        let access = match good(&v[3]).and_then(as_u64) {
            Some(a) => match (a & 1 != 0, a & 2 != 0) {
                (true, true) => Some(Access::ReadWrite),
                (true, false) => Some(Access::Read),
                (false, true) => Some(Access::Write),
                (false, false) => None,
            },
            None => None,
        };
        Self {
            data_type,
            rank,
            dims,
            access,
        }
    }

    /// ValueRank 0 (one or more dimensions) or more is an array.
    fn array(&self) -> bool {
        self.rank >= 0
    }

    /// The declared dimensions, 0 for a length the server doesn't
    /// give.
    fn dims(&self) -> Vec<u32> {
        let rank = self.rank.max(1) as usize;
        match &self.dims {
            Some(d) if !d.is_empty() && (self.rank == 0 || d.len() == rank) => d.clone(),
            _ => vec![0; rank],
        }
    }

    /// The dimensions, if every one is declared.
    fn known_dims(&self) -> Option<Vec<u32>> {
        let d = self.dims();
        (d.iter().all(|&n| n > 0)).then_some(d)
    }

    /// The index range that reads the first `MAX_ELEMENTS + 1`
    /// elements of each dimension of an array, which is enough to tell
    /// whether it has more than `MAX_ELEMENTS`, or `None` for an array
    /// of too many dimensions to read.
    fn element_range(&self) -> Option<NumericRange> {
        let rank = self.rank.max(1) as usize;
        if rank > MAX_READ_RANK {
            return None;
        }
        NumericRange::from_str(&vec![format!("0:{MAX_ELEMENTS}"); rank].join(",")).ok()
    }
}

/// A value as text for `sample`: a string as it is, anything else as
/// the JSON the driver publishes.
fn sample_text(v: &Variant) -> Option<String> {
    match value::to_json(v)? {
        Value::String(s) => Some(s),
        other => Some(other.to_string()),
    }
}

/// The value of a DataValue whose status is good.
fn good(v: &DataValue) -> Option<&Variant> {
    if v.status.is_some_and(|s| s.is_bad()) {
        return None;
    }
    v.value.as_ref()
}

fn as_u64(v: &Variant) -> Option<u64> {
    match v {
        Variant::Byte(n) => Some(u64::from(*n)),
        Variant::UInt16(n) => Some(u64::from(*n)),
        Variant::UInt32(n) => Some(u64::from(*n)),
        Variant::UInt64(n) => Some(*n),
        Variant::Int32(n) => u64::try_from(*n).ok(),
        _ => None,
    }
}

fn node_class(c: i32) -> NodeClass {
    match c {
        1 => NodeClass::Object,
        2 => NodeClass::Variable,
        4 => NodeClass::Method,
        8 => NodeClass::ObjectType,
        16 => NodeClass::VariableType,
        32 => NodeClass::ReferenceType,
        64 => NodeClass::DataType,
        128 => NodeClass::View,
        _ => NodeClass::Unspecified,
    }
}

fn read_id(node: &NodeId, attr: AttributeId) -> ReadValueId {
    ReadValueId {
        node_id: node.clone(),
        attribute_id: attr as u32,
        ..Default::default()
    }
}

/// Every BrowseResult field.
const RESULT_MASK: u32 = 0x3f;

/// Browse a node's hierarchical children that are Objects or Variables.
fn browse_down(node: &NodeId) -> BrowseDescription {
    BrowseDescription {
        node_id: node.clone(),
        browse_direction: BrowseDirection::Forward,
        reference_type_id: NodeId::new(0, HIERARCHICAL),
        include_subtypes: true,
        node_class_mask: (NodeClassMask::OBJECT | NodeClassMask::VARIABLE).bits(),
        result_mask: RESULT_MASK,
    }
}

/// Browse a DataType's supertype.
fn browse_up(node: &NodeId) -> BrowseDescription {
    BrowseDescription {
        node_id: node.clone(),
        browse_direction: BrowseDirection::Inverse,
        reference_type_id: NodeId::new(0, HAS_SUBTYPE),
        include_subtypes: false,
        node_class_mask: NodeClassMask::DATA_TYPE.bits(),
        result_mask: RESULT_MASK,
    }
}

#[cfg(test)]
mod tests;

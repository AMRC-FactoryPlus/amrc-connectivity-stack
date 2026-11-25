//! Scouting: listing the addresses a device offers, so an operator can
//! pick them in the Admin UI instead of typing them.
//!
//! The protocol is the "Scouting" section of `acs-edge/docs/edge-split.md`.
//! The library does all of it: the feature gate, the hello, `seq`,
//! batching, the limits, the watchdog, cancel and error handling. A
//! handler only produces items, through a [`Scouter`] it hands out from
//! [`Handler::scouter`](crate::Handler::scouter).

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use bytes::Bytes;
use rumqttc::QoS;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use tokio::sync::{Notify, mpsc};
use tokio::task::JoinHandle;
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

use crate::config::PUBLISH_QUEUE_OVERHEAD;
use crate::driver::{Outbound, PublishQueue};

/// The version of `features.scout`, and of the scouting messages, that
/// this library speaks.
pub const SCOUT_VERSION: u64 = 1;

/// The library's name and version, sent in the hello answer.
pub const LIBRARY: &str = concat!("rs-edge-driver ", env!("CARGO_PKG_VERSION"));

/// Most items in one `items` message.
const BATCH_ITEMS: usize = 500;

/// Most bytes in one `items` message.
const BATCH_BYTES: usize = 256 * 1024;

/// The largest `window` the library keeps to. A bigger one from the
/// Edge Agent is cut to this.
const MAX_WINDOW: u64 = 64;

/// A `progress` message goes out at least this often.
const PROGRESS_EVERY: Duration = Duration::from_secs(4);

/// A handler's own progress reports are sent at most this often.
const PROGRESS_GAP: Duration = Duration::from_secs(1);

/// How long a scouter has to finish after it is told to stop, before
/// its task is aborted. The protocol allows 5 s for a cancel.
const STOP_GRACE: Duration = Duration::from_secs(3);

/// Lengths the protocol allows, in characters. Longer display strings
/// are cut. An address, path or root is never cut, see [`Item::fit`].
const MAX_ID: usize = 512;
const MAX_NAME: usize = 256;
const MAX_ADDRESS: usize = 1024;
const MAX_DESCRIPTION: usize = 1024;
const MAX_UNIT: usize = 64;
const MAX_SAMPLE: usize = 256;
const MAX_DETAIL_BYTES: usize = 2048;
const MAX_NOTE: usize = 512;
const MAX_MESSAGE: usize = 512;
const MAX_EXCLUDED: usize = 8;
const MAX_PREFIXES: usize = 4;
const MAX_SCOPE: usize = 256;
const MAX_SCOPE_REASON: usize = 32;

/// The caps on one scan. The Edge Agent clamps them before it sends
/// them, and the library clamps them again to the same ceilings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub struct ScoutLimits {
    /// Most items in the scan. Default 20,000, ceiling 50,000.
    pub items: usize,
    /// Most levels below the root. Default 8, ceiling 32. The library
    /// cannot see the device's structure, so the scouter keeps to this
    /// one, giving a folder at the cap `more: true`.
    pub depth: u32,
    /// Longest the scan may run, in seconds. Default 120, ceiling 600.
    /// The library ends the scan at this point whatever the scouter is
    /// doing.
    pub seconds: u64,
    /// Pause between two southbound requests, in milliseconds. Default
    /// 20. See [`ScoutSink::pace`].
    pub pace_ms: u64,
    /// Whether to read each value's current value into
    /// [`Item::sample`]. Default false. The library removes samples
    /// when it is false.
    pub samples: bool,
}

impl ScoutLimits {
    /// The defaults from the protocol.
    pub const DEFAULT: Self = Self {
        items: 20_000,
        depth: 8,
        seconds: 120,
        pace_ms: 20,
        samples: false,
    };

    /// The ceilings from the protocol. `pace_ms` has no ceiling.
    pub const CEILING: Self = Self {
        items: 50_000,
        depth: 32,
        seconds: 600,
        pace_ms: u64::MAX,
        samples: true,
    };

    /// Read the limits from a `start` message, using the default for
    /// any that is missing or not a number, and clamping each to its
    /// ceiling and to at least 1 (0 for `pace_ms`).
    pub(crate) fn from_json(v: Option<&Value>) -> Self {
        let get = |key: &str| v.and_then(|v| v.get(key)).and_then(Value::as_u64);
        let d = Self::DEFAULT;
        let c = Self::CEILING;
        Self {
            items: get("items").map_or(d.items, |n| {
                usize::try_from(n).unwrap_or(c.items).clamp(1, c.items)
            }),
            depth: get("depth").map_or(d.depth, |n| {
                u32::try_from(n).unwrap_or(c.depth).clamp(1, c.depth)
            }),
            seconds: get("seconds").map_or(d.seconds, |n| n.clamp(1, c.seconds)),
            pace_ms: get("pace_ms").unwrap_or(d.pace_ms),
            samples: v
                .and_then(|v| v.get("samples"))
                .and_then(Value::as_bool)
                .unwrap_or(d.samples),
        }
    }

    /// `pace_ms` as a duration.
    pub fn pace(&self) -> Duration {
        Duration::from_millis(self.pace_ms)
    }
}

impl Default for ScoutLimits {
    fn default() -> Self {
        Self::DEFAULT
    }
}

/// One scan request, as the Edge Agent sent it.
#[derive(Debug, Clone, PartialEq)]
#[non_exhaustive]
pub struct ScoutRequest {
    /// The scan's id on the driver topics.
    pub id: String,
    /// Where to start, in the driver's own terms, or `None` for the
    /// device's natural top.
    pub root: Option<String>,
    /// For a branch scan, the `id` of the folder it replaces. The first
    /// item the scouter adds MUST have this id.
    pub folder_id: Option<String>,
    /// Driver-specific options, which the scouter validates. Refuse bad
    /// ones with [`ScoutError::options`].
    pub options: Map<String, Value>,
    /// The caps on this scan.
    pub limits: ScoutLimits,
}

impl ScoutRequest {
    /// A request, for a handler's own tests.
    pub fn new(
        root: Option<&str>,
        folder_id: Option<&str>,
        options: Map<String, Value>,
        limits: ScoutLimits,
    ) -> Self {
        Self {
            id: "test".into(),
            root: root.map(str::to_owned),
            folder_id: folder_id.map(str::to_owned),
            options,
            limits,
        }
    }
}

/// Whether an item is structure only or something a metric can read.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemKind {
    /// Structure only, such as an OPC UA folder or an MQTT topic level.
    Folder,
    /// Something a metric can be bound to. It may also have children.
    Value,
}

/// Whether an address can be read, written or both.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Access {
    #[serde(rename = "r")]
    Read,
    #[serde(rename = "w")]
    Write,
    #[serde(rename = "rw")]
    ReadWrite,
}

/// A Sparkplug B type name, without a byte order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[allow(missing_docs)]
pub enum ScoutType {
    Int8,
    Int16,
    Int32,
    Int64,
    UInt8,
    UInt16,
    UInt32,
    UInt64,
    Float,
    Double,
    Boolean,
    String,
    Text,
    DateTime,
    #[serde(rename = "UUID")]
    Uuid,
    Bytes,
    File,
    DataSet,
    Template,
}

/// One discovered entry. See "Items" in the protocol.
///
/// Build one with [`Item::folder`] or [`Item::value`] and the `with_`
/// methods. The library cuts strings that are too long, removes
/// `sample` unless the scan asked for samples, removes a `detail` over
/// 2 KiB, and drops an item whose `id` is empty or over 512 characters.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[non_exhaustive]
pub struct Item {
    /// Unique within the scan, and derived from the device alone, never
    /// from the scan's root, so a node has the same id in every scan.
    pub id: String,
    /// The parent's `id`, or `None` at the top.
    pub parent: Option<String>,
    /// What the operator sees.
    pub name: String,
    pub kind: ItemKind,
    /// Required for a value, in the driver's canonical form: the form
    /// the driver prints from a parsed address.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    /// The metric path within the address's data packet.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(rename = "type", default, skip_serializing_if = "Option::is_none")]
    pub r#type: Option<ScoutType>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access: Option<Access>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// The current value as text, only when the scan asked for samples.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sample: Option<String>,
    /// On a folder: it has children the scan did not list.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub more: bool,
    /// What to send as `root` to scan this folder on its own, if not
    /// its `id`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root: Option<String>,
    /// Driver-specific facts, at most 2 KiB as JSON.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<Value>,
}

impl Item {
    fn new(id: String, parent: Option<&str>, name: String, kind: ItemKind) -> Self {
        Self {
            id,
            parent: parent.map(str::to_owned),
            name,
            kind,
            address: None,
            path: None,
            r#type: None,
            access: None,
            unit: None,
            description: None,
            sample: None,
            more: false,
            root: None,
            detail: None,
        }
    }

    /// A folder.
    pub fn folder(id: impl Into<String>, parent: Option<&str>, name: impl Into<String>) -> Self {
        Self::new(id.into(), parent, name.into(), ItemKind::Folder)
    }

    /// A value at `address`.
    pub fn value(
        id: impl Into<String>,
        parent: Option<&str>,
        name: impl Into<String>,
        address: impl Into<String>,
    ) -> Self {
        let mut item = Self::new(id.into(), parent, name.into(), ItemKind::Value);
        item.address = Some(address.into());
        item
    }

    pub fn with_path(mut self, path: impl Into<String>) -> Self {
        self.path = Some(path.into());
        self
    }

    pub fn with_type(mut self, t: ScoutType) -> Self {
        self.r#type = Some(t);
        self
    }

    pub fn with_access(mut self, access: Access) -> Self {
        self.access = Some(access);
        self
    }

    pub fn with_unit(mut self, unit: impl Into<String>) -> Self {
        self.unit = Some(unit.into());
        self
    }

    pub fn with_description(mut self, description: impl Into<String>) -> Self {
        self.description = Some(description.into());
        self
    }

    pub fn with_sample(mut self, sample: impl Into<String>) -> Self {
        self.sample = Some(sample.into());
        self
    }

    pub fn with_more(mut self, more: bool) -> Self {
        self.more = more;
        self
    }

    pub fn with_root(mut self, root: impl Into<String>) -> Self {
        self.root = Some(root.into());
        self
    }

    pub fn with_detail(mut self, detail: Value) -> Self {
        self.detail = Some(detail);
        self
    }

    /// Bring the item within the protocol's limits, or `None` if it
    /// can't be sent at all.
    fn fit(mut self, samples: bool) -> Option<Self> {
        if self.id.is_empty() || self.id.chars().count() > MAX_ID {
            tracing::warn!(id = %cut(&self.id, 80), "scout item id is empty or too long, dropping");
            return None;
        }
        if self
            .parent
            .as_ref()
            .is_some_and(|p| p.is_empty() || p.chars().count() > MAX_ID)
        {
            self.parent = None;
        }
        if self.kind == ItemKind::Value && self.address.as_deref().is_none_or(str::is_empty) {
            tracing::warn!(id = %self.id, "scout value item has no address, dropping");
            return None;
        }
        // A cut address, path or root names a different place on the
        // device, so these are never cut. A root that is too long would
        // send a branch scan somewhere else, so the item is dropped.
        let too_long =
            |s: &Option<String>| s.as_ref().is_some_and(|s| s.chars().count() > MAX_ADDRESS);
        if too_long(&self.root) {
            tracing::warn!(id = %self.id, "scout item root is too long, dropping");
            return None;
        }
        // A value whose address or path is too long is kept as a folder
        // with nothing to bind, so its children still have a parent.
        if too_long(&self.address) || too_long(&self.path) {
            tracing::warn!(id = %self.id, "scout item address or path is too long, sending it as a folder");
            self.kind = ItemKind::Folder;
            self.address = None;
            self.path = None;
            self.r#type = None;
            self.access = None;
            self.unit = None;
            self.sample = None;
        }
        cut_in(&mut self.name, MAX_NAME);
        for (s, max) in [
            (&mut self.description, MAX_DESCRIPTION),
            (&mut self.unit, MAX_UNIT),
            (&mut self.sample, MAX_SAMPLE),
        ] {
            if let Some(s) = s {
                cut_in(s, max);
            }
        }
        if !samples {
            self.sample = None;
        }
        if let Some(d) = &self.detail {
            let size = serde_json::to_vec(d).map_or(usize::MAX, |v| v.len());
            if !d.is_object() || size > MAX_DETAIL_BYTES {
                tracing::debug!(id = %self.id, size, "scout item detail is not an object or too big, removing it");
                self.detail = None;
            }
        }
        Some(self)
    }
}

/// Why a scan stopped early. A truncated scan is not an error.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Truncation {
    /// The item cap.
    Items,
    /// The depth cap.
    Depth,
    /// The time cap.
    Seconds,
    /// A size cap of the driver's own.
    Size,
    /// Part of the device refused access.
    PartialAccess,
}

/// A part of the device the scan did not visit on purpose, such as the
/// OPC UA Server object.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[non_exhaustive]
pub struct Excluded {
    /// What the scope is, at most 256 characters.
    pub id: String,
    /// Why it was left out, such as `skipped`, at most 32 characters.
    pub reason: String,
    /// Up to 4 canonical address prefixes that fall inside the scope,
    /// so the Admin UI can place an address the scan did not find.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub prefixes: Vec<String>,
}

impl Excluded {
    pub fn new(id: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            reason: reason.into(),
            prefixes: Vec::new(),
        }
    }

    pub fn with_prefixes<S: Into<String>>(mut self, prefixes: impl IntoIterator<Item = S>) -> Self {
        self.prefixes = prefixes.into_iter().map(Into::into).collect();
        self
    }
}

/// How a scan finished, returned by [`Scouter::scout`].
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub struct ScoutEnd {
    /// Whether the driver's discovery is complete by nature within its
    /// caps. An OPC UA browse is, and an MQTT listen never is.
    pub exhaustive: bool,
    /// Set when a cap stopped the scan.
    pub truncated: Option<Truncation>,
    /// Parts of the device the scan did not visit on purpose, at most
    /// 8, each with at most 4 prefixes.
    pub excluded: Vec<Excluded>,
}

impl ScoutEnd {
    /// A scan that ran to the end.
    pub fn new(exhaustive: bool) -> Self {
        Self {
            exhaustive,
            truncated: None,
            excluded: Vec::new(),
        }
    }

    /// Mark the scan as stopped early by a cap.
    pub fn truncated(mut self, reason: Truncation) -> Self {
        self.truncated = Some(reason);
        self
    }

    /// Add a scope the scan did not visit.
    pub fn exclude(mut self, scope: Excluded) -> Self {
        self.excluded.push(scope);
        self
    }

    fn to_json(&self) -> Value {
        let mut excluded = self.excluded.clone();
        if excluded.len() > MAX_EXCLUDED {
            tracing::warn!(
                count = excluded.len(),
                "scan reported more than {MAX_EXCLUDED} excluded scopes, keeping the first"
            );
            excluded.truncate(MAX_EXCLUDED);
        }
        excluded.retain(|e| !e.id.is_empty() && !e.reason.is_empty());
        for e in &mut excluded {
            cut_in(&mut e.id, MAX_SCOPE);
            cut_in(&mut e.reason, MAX_SCOPE_REASON);
            e.prefixes.retain(|p| !p.is_empty());
            e.prefixes.truncate(MAX_PREFIXES);
            for p in &mut e.prefixes {
                cut_in(p, MAX_SCOPE);
            }
        }
        json!({
            "type": "end",
            "exhaustive": self.exhaustive,
            "truncated": self.truncated.is_some(),
            "reason": self.truncated,
            "excluded": excluded,
        })
    }
}

/// The codes a driver can end a scan with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScoutCode {
    /// The driver does not implement scouting.
    Unsupported,
    /// Bad `root`, `folder_id` or options. The message says which.
    Options,
    /// The driver cannot reach its device.
    Conn,
    /// The device refused the driver.
    Auth,
    /// Stopped by a cancel or a new configuration.
    Cancelled,
    /// Any other failure.
    Err,
}

impl ScoutCode {
    /// The code as the protocol writes it.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Unsupported => "UNSUPPORTED",
            Self::Options => "OPTIONS",
            Self::Conn => "CONN",
            Self::Auth => "AUTH",
            Self::Cancelled => "CANCELLED",
            Self::Err => "ERR",
        }
    }
}

impl std::fmt::Display for ScoutCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Why [`ScoutSink`] refused more output. Turn it into a
/// [`ScoutError`] with `?`, and the library ends the scan correctly:
/// truncated at the item cap, `CANCELLED` after a cancel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[non_exhaustive]
pub enum Stop {
    /// The scan was cancelled, timed out, or the driver is closing.
    #[error("the scan was stopped")]
    Cancelled,
    /// The scan reached its item cap.
    #[error("the scan reached its item cap")]
    Items,
}

/// A scan that failed, returned by [`Scouter::scout`].
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{code}: {message}")]
pub struct ScoutError {
    pub code: ScoutCode,
    pub message: String,
    /// Set when the error came from a [`Stop`].
    stop: Option<Stop>,
}

impl ScoutError {
    pub fn new(code: ScoutCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            stop: None,
        }
    }

    /// Bad `root`, `folder_id` or options.
    pub fn options(message: impl Into<String>) -> Self {
        Self::new(ScoutCode::Options, message)
    }

    /// The device can't be reached.
    pub fn conn(message: impl Into<String>) -> Self {
        Self::new(ScoutCode::Conn, message)
    }

    /// The device refused the driver.
    pub fn auth(message: impl Into<String>) -> Self {
        Self::new(ScoutCode::Auth, message)
    }

    /// Any other failure.
    pub fn err(message: impl Into<String>) -> Self {
        Self::new(ScoutCode::Err, message)
    }

    /// The driver does not implement scouting.
    pub fn unsupported() -> Self {
        Self::new(
            ScoutCode::Unsupported,
            "this driver can't list its addresses",
        )
    }

    fn to_json(&self) -> Value {
        json!({
            "type": "end",
            "error": { "code": self.code.as_str(), "message": cut(&self.message, MAX_MESSAGE) },
        })
    }
}

impl From<Stop> for ScoutError {
    fn from(stop: Stop) -> Self {
        let code = match stop {
            Stop::Cancelled => ScoutCode::Cancelled,
            Stop::Items => ScoutCode::Err,
        };
        Self {
            code,
            message: stop.to_string(),
            stop: Some(stop),
        }
    }
}

/// A progress report. `found` defaults to the number of items the
/// scouter has added.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[non_exhaustive]
pub struct Progress {
    /// How many nodes, topics or other entries the scan has looked at.
    pub visited: u64,
    /// How many items the scan has found, if not the number added.
    pub found: Option<u64>,
    /// A few words on where the scan has got to.
    pub note: Option<String>,
}

impl Progress {
    pub fn new(visited: u64) -> Self {
        Self {
            visited,
            found: None,
            note: None,
        }
    }

    pub fn with_found(mut self, found: u64) -> Self {
        self.found = Some(found);
        self
    }

    pub fn with_note(mut self, note: impl Into<String>) -> Self {
        self.note = Some(note.into());
        self
    }
}

/// Lists a device's addresses. See [`Handler::scouter`](crate::Handler::scouter).
///
/// A `Scouter` is usually a small struct holding a clone of the
/// handler's device client, as a [`Poller`](crate::Poller) is. The
/// library calls it on its own task without the handler's lock, so
/// polls and writes carry on during a scan.
#[async_trait]
pub trait Scouter: Send + Sync {
    /// Run one scan. Send items with [`ScoutSink::add`], and call
    /// [`ScoutSink::pace`] between southbound requests.
    ///
    /// Return how the scan finished, or an error with its code. When
    /// `add` or `pace` returns a [`Stop`], return it with `?`. The
    /// library ends the scan at `limits.seconds`, and after a cancel,
    /// even if this never returns, and turns a panic into `ERR`.
    async fn scout(&self, req: ScoutRequest, sink: ScoutSink) -> Result<ScoutEnd, ScoutError>;
}

/// Publishes one scan's messages on `found/<id>`, numbering them, and
/// sends nothing after the `end`.
///
/// When the Edge Agent's `start` gave a `window`, at most that many
/// `items` messages may be sent ahead of the agent's last `ack`, so a
/// scan goes at the agent's pace.
pub(crate) struct Wire {
    topic: String,
    outbound: mpsc::UnboundedSender<Outbound>,
    state: Mutex<WireState>,
    acked: Notify,
}

#[derive(Default)]
struct WireState {
    seq: u64,
    closed: bool,
    window: Option<usize>,
    /// The seq of each `items` message the agent has not yet acked.
    unacked: VecDeque<u64>,
    /// The highest seq the agent has acked.
    acked: Option<u64>,
}

impl Wire {
    pub(crate) fn new(topic: String, outbound: mpsc::UnboundedSender<Outbound>) -> Arc<Self> {
        Arc::new(Self {
            topic,
            outbound,
            state: Mutex::new(WireState::default()),
            acked: Notify::new(),
        })
    }

    /// Keep to the agent's window, cut to [`MAX_WINDOW`]. A window of
    /// 0 is no window.
    pub(crate) fn set_window(&self, window: Option<u64>) {
        let w = window
            .filter(|w| *w > 0)
            .map(|w| w.min(MAX_WINDOW) as usize);
        self.state.lock().unwrap().window = w;
    }

    pub(crate) fn window(&self) -> Option<usize> {
        self.state.lock().unwrap().window
    }

    /// The agent has handled every message up to `seq`.
    pub(crate) fn ack(&self, seq: u64) {
        let mut st = self.state.lock().unwrap();
        st.acked = st.acked.max(Some(seq));
        while st.unacked.front().is_some_and(|s| *s <= seq) {
            st.unacked.pop_front();
        }
        drop(st);
        self.acked.notify_waiters();
    }

    /// Wait until another `items` message fits in the window, or the
    /// token is cancelled.
    async fn room(&self, token: &CancellationToken) -> Result<(), Stop> {
        loop {
            // Made before the check, so an ack between the two still
            // wakes it.
            let acked = self.acked.notified();
            {
                let st = self.state.lock().unwrap();
                if st.closed {
                    return Err(Stop::Cancelled);
                }
                match st.window {
                    Some(w) if st.unacked.len() >= w => {}
                    _ => return Ok(()),
                }
            }
            tokio::select! {
                _ = token.cancelled() => return Err(Stop::Cancelled),
                _ = acked => {}
            }
        }
    }

    /// Send a message, `body` being the JSON object after the `seq`
    /// key, such as `"type":"accept"`. `end` closes the wire.
    fn send(
        &self,
        body: &str,
        queued: Option<crate::driver::Queued>,
        end: bool,
    ) -> Result<(), Stop> {
        let mut st = self.state.lock().unwrap();
        if st.closed {
            return Err(Stop::Cancelled);
        }
        let payload = format!("{{\"seq\":{},{}}}", st.seq, body);
        if queued.is_some() && st.window.is_some() && st.acked.is_none_or(|a| st.seq > a) {
            let seq = st.seq;
            st.unacked.push_back(seq);
        }
        st.seq += 1;
        st.closed = end;
        self.outbound
            .send((
                self.topic.clone(),
                QoS::AtMostOnce,
                Bytes::from(payload),
                queued,
                None,
            ))
            .map_err(|_| Stop::Cancelled)
    }

    pub(crate) fn send_json(&self, v: &Value, end: bool) -> Result<(), Stop> {
        // Every message is a JSON object: strip its braces so `seq`
        // can go first.
        let s = v.to_string();
        let body = &s[1..s.len() - 1];
        self.send(body, None, end)
    }

    /// Send the `end` message, unless one has gone already.
    pub(crate) fn end(&self, end: Result<ScoutEnd, ScoutError>) {
        let v = match &end {
            Ok(e) => e.to_json(),
            Err(e) => e.to_json(),
        };
        let _ = self.send_json(&v, true);
    }

    pub(crate) fn is_closed(&self) -> bool {
        self.state.lock().unwrap().closed
    }
}

/// Where a [`Scouter`] sends what it finds.
///
/// Cloning gives another handle on the same scan.
#[derive(Clone)]
pub struct ScoutSink {
    inner: Arc<SinkInner>,
}

struct SinkInner {
    wire: Arc<Wire>,
    limits: ScoutLimits,
    token: CancellationToken,
    queue: Arc<PublishQueue>,
    state: Mutex<SinkState>,
}

struct SinkState {
    added: usize,
    capped: bool,
    visited: u64,
    found: Option<u64>,
    note: Option<String>,
    last_progress: Instant,
}

impl ScoutSink {
    pub(crate) fn new(
        wire: Arc<Wire>,
        limits: ScoutLimits,
        token: CancellationToken,
        queue: Arc<PublishQueue>,
    ) -> Self {
        Self {
            inner: Arc::new(SinkInner {
                wire,
                limits,
                token,
                queue,
                state: Mutex::new(SinkState {
                    added: 0,
                    capped: false,
                    visited: 0,
                    found: None,
                    note: None,
                    // The scouter's first report goes out at once.
                    last_progress: Instant::now()
                        .checked_sub(PROGRESS_GAP)
                        .unwrap_or_else(Instant::now),
                }),
            }),
        }
    }

    /// The caps on this scan.
    pub fn limits(&self) -> ScoutLimits {
        self.inner.limits
    }

    /// How many items have been accepted so far.
    pub fn added(&self) -> usize {
        self.inner.state.lock().unwrap().added
    }

    /// Cancelled when the scan must stop: a cancel from the Edge Agent,
    /// a new configuration, the time cap, or the driver closing.
    pub fn cancelled(&self) -> CancellationToken {
        self.inner.token.clone()
    }

    fn check(&self) -> Result<(), Stop> {
        if self.inner.token.is_cancelled() || self.inner.wire.is_closed() {
            return Err(Stop::Cancelled);
        }
        Ok(())
    }

    /// Send items to the Edge Agent, in batches the library splits.
    ///
    /// It returns once the items are queued. While the data waiting to
    /// go to the Edge Agent is over half the publish queue, it waits
    /// first, so a scan gives way to data. It also waits while the
    /// Edge Agent's window is full, so the scan goes at the agent's
    /// pace.
    ///
    /// At the item cap it sends what fits and returns
    /// [`Stop::Items`], and the library ends the scan as truncated.
    /// After a cancel it returns [`Stop::Cancelled`].
    pub async fn add(&self, items: Vec<Item>) -> Result<(), Stop> {
        self.check()?;
        let samples = self.inner.limits.samples;
        let mut batch: Vec<String> = Vec::new();
        let mut bytes = 0;
        let mut capped = false;
        for item in items {
            {
                let mut st = self.inner.state.lock().unwrap();
                if st.added >= self.inner.limits.items {
                    st.capped = true;
                    capped = true;
                    break;
                }
            }
            let Some(item) = item.fit(samples) else {
                continue;
            };
            let Ok(s) = serde_json::to_string(&item) else {
                continue;
            };
            if !batch.is_empty()
                && (batch.len() >= BATCH_ITEMS || bytes + s.len() + 64 > BATCH_BYTES)
            {
                self.flush(&mut batch).await?;
                bytes = 0;
            }
            bytes += s.len() + 1;
            batch.push(s);
            self.inner.state.lock().unwrap().added += 1;
        }
        if !batch.is_empty() {
            self.flush(&mut batch).await?;
        }
        if capped { Err(Stop::Items) } else { Ok(()) }
    }

    async fn flush(&self, batch: &mut Vec<String>) -> Result<(), Stop> {
        tokio::select! {
            _ = self.inner.token.cancelled() => return Err(Stop::Cancelled),
            _ = self.inner.queue.wait_below_half() => {}
        }
        self.inner.wire.room(&self.inner.token).await?;
        self.check()?;
        let body = format!("\"type\":\"items\",\"items\":[{}]", batch.join(","));
        batch.clear();
        let queued = self.inner.queue.force(body.len() + PUBLISH_QUEUE_OVERHEAD);
        self.inner.wire.send(&body, Some(queued), false)
    }

    /// Wait `limits.pace_ms`. Call it between southbound requests.
    /// Returns [`Stop::Cancelled`] at once if the scan is stopped.
    pub async fn pace(&self) -> Result<(), Stop> {
        self.check()?;
        tokio::select! {
            _ = self.inner.token.cancelled() => Err(Stop::Cancelled),
            _ = tokio::time::sleep(self.inner.limits.pace()) => Ok(()),
        }
    }

    /// Report progress. The library sends it at most once a second,
    /// and on its own at least every 5 s.
    pub fn progress(&self, p: Progress) {
        let due = {
            let mut st = self.inner.state.lock().unwrap();
            st.visited = p.visited;
            st.found = p.found;
            st.note = p.note;
            st.last_progress.elapsed() >= PROGRESS_GAP
        };
        if due {
            self.send_progress();
        }
    }

    /// Send a progress message if none has gone for a while.
    pub(crate) fn keep_alive(&self) {
        let due = self.inner.state.lock().unwrap().last_progress.elapsed() >= PROGRESS_EVERY;
        if due {
            self.send_progress();
        }
    }

    fn send_progress(&self) {
        let v = {
            let mut st = self.inner.state.lock().unwrap();
            st.last_progress = Instant::now();
            let found = st.found.unwrap_or(st.added as u64);
            let mut v =
                json!({ "type": "progress", "visited": st.visited.max(found), "found": found });
            if let Some(note) = &st.note {
                v["note"] = Value::from(cut(note, MAX_NOTE));
            }
            v
        };
        let _ = self.inner.wire.send_json(&v, false);
    }

    fn capped(&self) -> bool {
        self.inner.state.lock().unwrap().capped
    }
}

/// Cut `s` to at most `max` characters.
pub(crate) fn cut(s: &str, max: usize) -> String {
    match s.char_indices().nth(max) {
        Some((i, _)) => s[..i].to_owned(),
        None => s.to_owned(),
    }
}

fn cut_in(s: &mut String, max: usize) {
    if let Some((i, _)) = s.char_indices().nth(max) {
        s.truncate(i);
    }
}

/// Whether an `addr` packet carries a version of `features.scout` this
/// library speaks.
pub(crate) fn scout_feature(addr: &Value) -> bool {
    addr.get("features")
        .and_then(|f| f.get("scout"))
        .and_then(Value::as_u64)
        == Some(SCOUT_VERSION)
}

/// Whether `id` can be a scan id: 1 to 64 word characters, and not
/// `hello`. Anything else would make a bad topic.
pub(crate) fn valid_scan_id(id: &str) -> bool {
    (1..=64).contains(&id.len())
        && id != "hello"
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

/// The answer to a hello. `supported` says whether the handler scans
/// and `reads` whether it reads values.
pub(crate) fn hello_answer(supported: bool, reads: bool) -> String {
    json!({
        "seq": 0,
        "type": "hello",
        "versions": [SCOUT_VERSION],
        "supported": supported,
        "reads": reads,
        "library": LIBRARY,
    })
    .to_string()
}

/// A message on the `scout` topic.
#[derive(Debug, PartialEq)]
pub(crate) enum ScoutOp {
    Hello,
    Start {
        version: Option<u64>,
        req: ScoutRequest,
        window: Option<u64>,
    },
    Cancel {
        id: String,
    },
    Ack {
        id: String,
        seq: u64,
    },
    Read {
        id: String,
        version: Option<u64>,
        addresses: Vec<String>,
    },
}

/// Read a message from the `scout` topic. `Err` says why it can't be
/// used, and carries the scan id if there is a usable one to answer on.
pub(crate) fn parse_op(payload: &[u8]) -> Result<ScoutOp, (Option<String>, String)> {
    let v: Value =
        serde_json::from_slice(payload).map_err(|e| (None, format!("bad scout JSON: {e}")))?;
    let op = v.get("op").and_then(Value::as_str).unwrap_or_default();
    if op == "hello" {
        return Ok(ScoutOp::Hello);
    }
    let id = v.get("id").and_then(Value::as_str).unwrap_or_default();
    if !valid_scan_id(id) {
        return Err((
            None,
            format!("scout {op:?} with a bad id {:?}", cut(id, 80)),
        ));
    }
    let id = id.to_owned();
    match op {
        "cancel" => Ok(ScoutOp::Cancel { id }),
        "ack" => match v.get("seq").and_then(Value::as_u64) {
            Some(seq) => Ok(ScoutOp::Ack { id, seq }),
            None => Err((None, "scout ack without a seq".into())),
        },
        "start" => {
            let text = |key: &str| v.get(key).and_then(Value::as_str).map(str::to_owned);
            let options = match v.get("options") {
                None | Some(Value::Null) => Map::new(),
                Some(Value::Object(m)) => m.clone(),
                Some(_) => return Err((Some(id), "options is not an object".into())),
            };
            Ok(ScoutOp::Start {
                window: v.get("window").and_then(Value::as_u64),
                version: v.get("version").and_then(Value::as_u64),
                req: ScoutRequest {
                    id,
                    root: text("root"),
                    folder_id: text("folder_id"),
                    options,
                    limits: ScoutLimits::from_json(v.get("limits")),
                },
            })
        }
        "read" => match crate::read::read_addresses(v.get("addresses")) {
            Ok(addresses) => Ok(ScoutOp::Read {
                version: v.get("version").and_then(Value::as_u64),
                id,
                addresses,
            }),
            Err(why) => Err((Some(id), why)),
        },
        other => Err((Some(id), format!("unknown scout op {other:?}"))),
    }
}

/// Aborts a task when dropped.
struct AbortOnDrop<T>(JoinHandle<T>);

impl<T> Drop for AbortOnDrop<T> {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// Run one scan to its `end`: send `accept`, run the scouter on its own
/// task, keep progress flowing, and end the scan at the time cap, on
/// cancel, or when the scouter returns or panics.
pub(crate) async fn run_scan(
    scouter: Arc<dyn Scouter>,
    req: ScoutRequest,
    wire: Arc<Wire>,
    cancel: CancellationToken,
    queue: Arc<PublishQueue>,
) {
    let id = req.id.clone();
    let limits = req.limits;
    let accept = match wire.window() {
        Some(w) => json!({ "type": "accept", "window": w }),
        None => json!({ "type": "accept" }),
    };
    if wire.send_json(&accept, false).is_err() {
        return;
    }
    tracing::info!(id, root = ?req.root, "scan started");

    let token = cancel.child_token();
    let sink = ScoutSink::new(wire.clone(), limits, token.clone(), queue);
    let mut task = AbortOnDrop(tokio::spawn({
        let sink = sink.clone();
        async move { scouter.scout(req, sink).await }
    }));

    enum Why {
        Done(Result<Result<ScoutEnd, ScoutError>, tokio::task::JoinError>),
        Deadline,
        Cancelled,
    }

    let deadline = tokio::time::sleep(Duration::from_secs(limits.seconds));
    tokio::pin!(deadline);
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let why = loop {
        tokio::select! {
            biased;
            r = &mut task.0 => break Why::Done(r),
            _ = cancel.cancelled() => break Why::Cancelled,
            _ = &mut deadline => break Why::Deadline,
            _ = tick.tick() => sink.keep_alive(),
        }
    };

    // Give a scouter that was told to stop a moment to tidy up, such as
    // releasing OPC UA continuation points, then abort it.
    let late = match why {
        Why::Done(_) => None,
        _ => {
            token.cancel();
            match tokio::time::timeout(STOP_GRACE, &mut task.0).await {
                Ok(r) => Some(r),
                Err(_) => {
                    tracing::warn!(
                        id,
                        "scouter did not stop within {STOP_GRACE:?}, aborting it"
                    );
                    task.0.abort();
                    None
                }
            }
        }
    };

    let end = match why {
        Why::Cancelled => Err(ScoutError::new(
            ScoutCode::Cancelled,
            "the scan was cancelled",
        )),
        Why::Deadline => {
            let mut end = match late {
                Some(Ok(Ok(end))) => end,
                _ => ScoutEnd::new(false),
            };
            if end.truncated.is_none() {
                end.truncated = Some(Truncation::Seconds);
            }
            Ok(end)
        }
        Why::Done(r) => finish(r, sink.capped(), cancel.is_cancelled()),
    };
    match &end {
        Ok(e) => {
            tracing::info!(id, items = sink.added(), truncated = ?e.truncated, "scan finished")
        }
        Err(e) => tracing::warn!(id, items = sink.added(), %e, "scan failed"),
    }
    wire.end(end);
}

/// The `end` for a scouter that returned or panicked.
fn finish(
    r: Result<Result<ScoutEnd, ScoutError>, tokio::task::JoinError>,
    capped: bool,
    cancelled: bool,
) -> Result<ScoutEnd, ScoutError> {
    match r {
        Ok(Ok(mut end)) => {
            if capped && end.truncated.is_none() {
                end.truncated = Some(Truncation::Items);
            }
            Ok(end)
        }
        Ok(Err(e)) if e.stop == Some(Stop::Items) || (capped && e.stop.is_some()) => {
            Ok(ScoutEnd::new(false).truncated(Truncation::Items))
        }
        Ok(Err(e)) if cancelled || e.stop == Some(Stop::Cancelled) => Err(ScoutError::new(
            ScoutCode::Cancelled,
            "the scan was cancelled",
        )),
        Ok(Err(e)) => Err(e),
        Err(join) if join.is_panic() => Err(ScoutError::err(format!(
            "the scouter panicked: {}",
            panic_message(join)
        ))),
        Err(_) => Err(ScoutError::new(
            ScoutCode::Cancelled,
            "the scan was cancelled",
        )),
    }
}

/// What a task that failed said: the panic message, or that it was
/// cancelled.
pub(crate) fn panic_message(join: tokio::task::JoinError) -> String {
    if !join.is_panic() {
        return "it was cancelled".into();
    }
    let panic = join.into_panic();
    panic
        .downcast_ref::<&str>()
        .map(|s| (*s).to_owned())
        .or_else(|| panic.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "unknown panic".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_default_and_clamp() {
        assert_eq!(ScoutLimits::from_json(None), ScoutLimits::DEFAULT);
        let l = ScoutLimits::from_json(Some(&json!({
            "items": 900000, "depth": 0, "seconds": 10000, "pace_ms": 0, "samples": true
        })));
        assert_eq!(l.items, 50_000);
        assert_eq!(l.depth, 1);
        assert_eq!(l.seconds, 600);
        assert_eq!(l.pace_ms, 0);
        assert!(l.samples);
        let l = ScoutLimits::from_json(Some(&json!({ "items": "lots", "seconds": 5 })));
        assert_eq!(l.items, 20_000);
        assert_eq!(l.seconds, 5);
    }

    #[test]
    fn scan_ids() {
        assert!(valid_scan_id("3f9c1a2b44e04d0c9a7e5b1f2c3d4e5f"));
        assert!(valid_scan_id("a_1"));
        assert!(!valid_scan_id(""));
        assert!(!valid_scan_id("hello"));
        assert!(!valid_scan_id("3f9c1a2b-44e0"));
        assert!(!valid_scan_id("a/#"));
        assert!(!valid_scan_id(&"a".repeat(65)));
    }

    #[test]
    fn features() {
        assert!(scout_feature(&json!({ "features": { "scout": 1 } })));
        assert!(!scout_feature(&json!({ "features": { "scout": 2 } })));
        assert!(!scout_feature(&json!({ "features": { "scout": "1" } })));
        assert!(!scout_feature(&json!({ "features": {} })));
        assert!(!scout_feature(&json!({ "version": 1 })));
    }

    #[test]
    fn parse_ops() {
        assert_eq!(
            parse_op(br#"{"op":"hello","version":1}"#),
            Ok(ScoutOp::Hello)
        );
        assert_eq!(
            parse_op(br#"{"op":"cancel","id":"abc","version":1}"#),
            Ok(ScoutOp::Cancel { id: "abc".into() })
        );
        let Ok(ScoutOp::Start {
            version,
            req,
            window,
        }) = parse_op(
            br#"{"op":"start","id":"abc","version":1,"root":"r","folder_id":"f",
                 "options":{"x":1},"limits":{"items":10},"window":4}"#,
        )
        else {
            panic!("start not parsed");
        };
        assert_eq!(version, Some(1));
        assert_eq!(window, Some(4));
        assert_eq!(req.root.as_deref(), Some("r"));
        assert_eq!(req.folder_id.as_deref(), Some("f"));
        assert_eq!(req.options["x"], 1);
        assert_eq!(req.limits.items, 10);
        assert_eq!(req.limits.depth, 8);
        assert!(
            parse_op(br#"{"op":"start","id":"a-b"}"#)
                .unwrap_err()
                .0
                .is_none()
        );
        assert_eq!(
            parse_op(br#"{"op":"start","id":"ab","options":[]}"#)
                .unwrap_err()
                .0
                .as_deref(),
            Some("ab")
        );
        assert!(parse_op(b"not json").is_err());
    }

    #[test]
    fn parse_reads() {
        assert_eq!(
            parse_op(br#"{"op":"read","id":"r1","version":1,"addresses":["a","b"]}"#),
            Ok(ScoutOp::Read {
                id: "r1".into(),
                version: Some(1),
                addresses: vec!["a".into(), "b".into()],
            })
        );
        // A read with bad addresses is answered on its own topic.
        assert_eq!(
            parse_op(br#"{"op":"read","id":"r1","version":1,"addresses":[3]}"#)
                .unwrap_err()
                .0
                .as_deref(),
            Some("r1")
        );
        // A read with a bad id has nowhere to be answered.
        assert!(
            parse_op(br#"{"op":"read","id":"r/1","addresses":["a"]}"#)
                .unwrap_err()
                .0
                .is_none()
        );
    }

    #[test]
    fn items_are_fitted() {
        let long = "x".repeat(5000);
        let item = Item::value("a", None, long.clone(), "addr")
            .with_description(long.clone())
            .with_unit(long.clone())
            .with_sample(long.clone())
            .with_detail(json!({ "big": long }))
            .fit(true)
            .unwrap();
        assert_eq!(item.name.len(), MAX_NAME);
        assert_eq!(item.address.as_deref(), Some("addr"));
        assert_eq!(item.description.as_ref().unwrap().len(), MAX_DESCRIPTION);
        assert_eq!(item.unit.as_ref().unwrap().len(), MAX_UNIT);
        assert_eq!(item.sample.as_ref().unwrap().len(), MAX_SAMPLE);
        assert!(item.detail.is_none());

        let item = Item::value("a", None, "n", "addr")
            .with_sample("1")
            .fit(false)
            .unwrap();
        assert!(item.sample.is_none(), "samples were not asked for");

        assert!(Item::folder("", None, "n").fit(false).is_none());
        assert!(
            Item::folder("x".repeat(513), None, "n")
                .fit(false)
                .is_none()
        );
        let mut v = Item::value("a", None, "n", "x");
        v.address = None;
        assert!(v.fit(false).is_none(), "a value needs an address");

        // An address, path or root at the limit is sent whole.
        let edge = "x".repeat(MAX_ADDRESS);
        let item = Item::value("a", None, "n", edge.clone())
            .with_path(edge.clone())
            .with_root(edge.clone())
            .fit(false)
            .unwrap();
        assert_eq!(item.kind, ItemKind::Value);
        assert_eq!(item.address.as_deref(), Some(edge.as_str()));
        assert_eq!(item.path.as_deref(), Some(edge.as_str()));
        assert_eq!(item.root.as_deref(), Some(edge.as_str()));

        // An address or path over the limit is never cut. The value is
        // sent as a folder with nothing to bind.
        let over = "x".repeat(MAX_ADDRESS + 1);
        for item in [
            Item::value("a", Some("p"), "n", over.clone()),
            Item::value("a", Some("p"), "n", "addr").with_path(over.clone()),
        ] {
            let item = item
                .with_type(ScoutType::Double)
                .with_access(Access::Read)
                .with_unit("degC")
                .with_sample("1.5")
                .with_description("kept")
                .fit(true)
                .unwrap();
            assert_eq!(item.kind, ItemKind::Folder);
            assert_eq!(item.parent.as_deref(), Some("p"));
            assert!(item.address.is_none() && item.path.is_none());
            assert!(item.r#type.is_none() && item.access.is_none());
            assert!(item.unit.is_none() && item.sample.is_none());
            assert_eq!(item.description.as_deref(), Some("kept"));
        }
        // Multibyte characters count as one each.
        let item = Item::value("a", None, "n", "é".repeat(MAX_ADDRESS))
            .fit(false)
            .unwrap();
        assert_eq!(item.kind, ItemKind::Value);

        // A root over the limit drops the item.
        assert!(
            Item::folder("a", None, "n")
                .with_root(over.clone())
                .fit(false)
                .is_none()
        );

        // Cutting counts characters, not bytes.
        let item = Item::folder("a", None, "é".repeat(300)).fit(false).unwrap();
        assert_eq!(item.name.chars().count(), MAX_NAME);
    }

    #[test]
    fn item_json_leaves_out_empty_keys() {
        let v = serde_json::to_value(Item::folder("a", None, "A")).unwrap();
        assert_eq!(
            v,
            json!({ "id": "a", "parent": null, "name": "A", "kind": "folder" })
        );
        let v = serde_json::to_value(
            Item::value("a/b", Some("a"), "B", "a/b")
                .with_type(ScoutType::Uuid)
                .with_access(Access::ReadWrite)
                .with_more(true),
        )
        .unwrap();
        assert_eq!(v["type"], "UUID");
        assert_eq!(v["access"], "rw");
        assert_eq!(v["more"], true);
        assert_eq!(v["parent"], "a");
    }

    #[test]
    fn end_json_is_bounded() {
        let mut end = ScoutEnd::new(true).truncated(Truncation::PartialAccess);
        for i in 0..12 {
            end = end.exclude(
                Excluded::new(format!("s{i}"), "skipped").with_prefixes(["a", "b", "c", "d", "e"]),
            );
        }
        let v = end.to_json();
        assert_eq!(v["truncated"], true);
        assert_eq!(v["reason"], "partial_access");
        assert_eq!(v["excluded"].as_array().unwrap().len(), 8);
        assert_eq!(v["excluded"][0]["prefixes"].as_array().unwrap().len(), 4);
        let v = ScoutEnd::new(false).to_json();
        assert_eq!(v["reason"], Value::Null);
        assert!(v["excluded"].as_array().unwrap().is_empty());
    }

    fn wire() -> (Arc<Wire>, mpsc::UnboundedReceiver<Outbound>) {
        let (tx, rx) = mpsc::unbounded_channel();
        (Wire::new("fpEdge1/C/found/x".into(), tx), rx)
    }

    fn payloads(rx: &mut mpsc::UnboundedReceiver<Outbound>) -> Vec<Value> {
        let mut out = Vec::new();
        while let Ok((_, _, p, _, _)) = rx.try_recv() {
            out.push(serde_json::from_slice(&p).unwrap());
        }
        out
    }

    #[test]
    fn wire_numbers_and_closes() {
        let (w, mut rx) = wire();
        w.send_json(&json!({ "type": "accept" }), false).unwrap();
        w.end(Ok(ScoutEnd::new(true)));
        assert!(w.is_closed());
        assert_eq!(
            w.send_json(&json!({ "type": "accept" }), false),
            Err(Stop::Cancelled)
        );
        w.end(Err(ScoutError::err("again")));
        let got = payloads(&mut rx);
        assert_eq!(got.len(), 2, "nothing after the end: {got:?}");
        assert_eq!(got[0]["seq"], 0);
        assert_eq!(got[1]["seq"], 1);
        assert_eq!(got[1]["type"], "end");
    }

    #[tokio::test]
    async fn sink_splits_batches_and_caps() {
        let (w, mut rx) = wire();
        let mut limits = ScoutLimits::DEFAULT;
        limits.items = 1100;
        let sink = ScoutSink::new(
            w,
            limits,
            CancellationToken::new(),
            PublishQueue::new(1 << 30),
        );
        let items: Vec<_> = (0..1000)
            .map(|i| Item::folder(format!("f{i}"), None, "F"))
            .collect();
        sink.add(items).await.unwrap();
        let got = payloads(&mut rx);
        let sizes: Vec<_> = got
            .iter()
            .map(|m| m["items"].as_array().unwrap().len())
            .collect();
        assert_eq!(sizes, vec![500, 500]);

        // Big items split by bytes.
        let items: Vec<_> = (0..90)
            .map(|i| {
                Item::value(format!("v{i}"), None, "V", "a".repeat(1000))
                    .with_description("d".repeat(1000))
                    .with_path("p".repeat(1000))
            })
            .collect();
        sink.add(items).await.unwrap();
        let got = payloads(&mut rx);
        assert!(got.len() >= 2, "90 items of 3 KB need two messages");
        for m in &got {
            assert!(
                m.to_string().len() <= BATCH_BYTES,
                "a batch is over 256 KiB"
            );
        }
        let n: usize = got
            .iter()
            .map(|m| m["items"].as_array().unwrap().len())
            .sum();
        assert_eq!(n, 90, "all 90 fit under the cap of 1100");
        assert_eq!(sink.added(), 1090);
        assert!(!sink.capped());

        // The cap: 10 more fit, then Items.
        let items: Vec<_> = (0..20)
            .map(|i| Item::folder(format!("g{i}"), None, "G"))
            .collect();
        assert_eq!(sink.add(items).await, Err(Stop::Items));
        assert!(sink.capped());
        let got = payloads(&mut rx);
        assert_eq!(got[0]["items"].as_array().unwrap().len(), 10);
        assert_eq!(
            sink.add(vec![Item::folder("h", None, "H")]).await,
            Err(Stop::Items)
        );
    }

    #[test]
    fn parse_ack() {
        assert_eq!(
            parse_op(br#"{"op":"ack","id":"abc","seq":7}"#),
            Ok(ScoutOp::Ack {
                id: "abc".into(),
                seq: 7
            })
        );
        // An ack that can't be used is ignored, never answered with an
        // end on the scan's topic.
        assert!(
            parse_op(br#"{"op":"ack","id":"abc"}"#)
                .unwrap_err()
                .0
                .is_none()
        );
        let Ok(ScoutOp::Start { window, .. }) =
            parse_op(br#"{"op":"start","id":"abc","version":1}"#)
        else {
            panic!("start not parsed");
        };
        assert_eq!(window, None);
    }

    #[tokio::test]
    async fn sink_keeps_to_the_window() {
        let (w, mut rx) = wire();
        w.set_window(Some(2));
        let sink = ScoutSink::new(
            w.clone(),
            ScoutLimits::DEFAULT,
            CancellationToken::new(),
            PublishQueue::new(1 << 20),
        );
        let add = tokio::spawn({
            let sink = sink.clone();
            async move {
                for i in 0..4 {
                    sink.add(vec![Item::folder(format!("g{i}"), None, "G")])
                        .await?;
                }
                Ok::<_, Stop>(())
            }
        });
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(!add.is_finished(), "the window is full");
        let got = payloads(&mut rx);
        assert_eq!(got.len(), 2);
        let seqs: Vec<_> = got.iter().map(|m| m["seq"].as_u64().unwrap()).collect();
        assert_eq!(seqs, vec![0, 1]);

        // Acking the first lets one more through.
        w.ack(0);
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(payloads(&mut rx).len(), 1);
        assert!(!add.is_finished());

        // An ack covers every message up to its seq.
        w.ack(2);
        add.await.unwrap().unwrap();
        assert_eq!(payloads(&mut rx).len(), 1);
    }

    #[tokio::test]
    async fn sink_window_wait_stops_on_cancel() {
        let (w, _rx) = wire();
        w.set_window(Some(1));
        let token = CancellationToken::new();
        let sink = ScoutSink::new(
            w,
            ScoutLimits::DEFAULT,
            token.clone(),
            PublishQueue::new(1 << 20),
        );
        sink.add(vec![Item::folder("a", None, "A")]).await.unwrap();
        let add = tokio::spawn({
            let sink = sink.clone();
            async move { sink.add(vec![Item::folder("b", None, "B")]).await }
        });
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(!add.is_finished());
        token.cancel();
        assert_eq!(add.await.unwrap(), Err(Stop::Cancelled));
    }

    #[test]
    fn window_is_cut_and_zero_is_none() {
        let (w, _rx) = wire();
        w.set_window(Some(1000));
        assert_eq!(w.window(), Some(MAX_WINDOW as usize));
        w.set_window(Some(0));
        assert_eq!(w.window(), None);
        w.set_window(None);
        assert_eq!(w.window(), None);
    }

    #[tokio::test]
    async fn sink_gives_way_to_data() {
        let (w, mut rx) = wire();
        let queue = PublishQueue::new(1000);
        let data = queue.force(600);
        let sink = ScoutSink::new(w, ScoutLimits::DEFAULT, CancellationToken::new(), queue);
        let add = tokio::spawn({
            let sink = sink.clone();
            async move { sink.add(vec![Item::folder("a", None, "A")]).await }
        });
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(!add.is_finished(), "the queue is over half full");
        assert!(payloads(&mut rx).is_empty());
        drop(data);
        add.await.unwrap().unwrap();
        assert_eq!(payloads(&mut rx).len(), 1);
    }

    #[tokio::test]
    async fn sink_stops_on_cancel() {
        let (w, _rx) = wire();
        let token = CancellationToken::new();
        let mut limits = ScoutLimits::DEFAULT;
        limits.pace_ms = 60_000;
        let sink = ScoutSink::new(w, limits, token.clone(), PublishQueue::new(1000));
        let pace = tokio::spawn({
            let sink = sink.clone();
            async move { sink.pace().await }
        });
        tokio::time::sleep(Duration::from_millis(20)).await;
        token.cancel();
        assert_eq!(pace.await.unwrap(), Err(Stop::Cancelled));
        assert_eq!(
            sink.add(vec![Item::folder("a", None, "A")]).await,
            Err(Stop::Cancelled)
        );
    }

    #[tokio::test]
    async fn pace_waits() {
        let (w, _rx) = wire();
        let mut limits = ScoutLimits::DEFAULT;
        limits.pace_ms = 30;
        let sink = ScoutSink::new(w, limits, CancellationToken::new(), PublishQueue::new(1000));
        let start = std::time::Instant::now();
        for _ in 0..5 {
            sink.pace().await.unwrap();
        }
        assert!(start.elapsed() >= Duration::from_millis(150));
    }

    #[tokio::test]
    async fn progress_is_throttled() {
        let (w, mut rx) = wire();
        let sink = ScoutSink::new(
            w,
            ScoutLimits::DEFAULT,
            CancellationToken::new(),
            PublishQueue::new(1000),
        );
        // The first report goes out at once, the next not within a
        // second.
        sink.progress(Progress::new(5).with_note("n".repeat(600)));
        sink.progress(Progress::new(6));
        let got = payloads(&mut rx);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0]["type"], "progress");
        assert_eq!(got[0]["visited"], 5);
        assert_eq!(got[0]["found"], 0);
        assert_eq!(got[0]["note"].as_str().unwrap().len(), MAX_NOTE);

        sink.keep_alive();
        assert!(payloads(&mut rx).is_empty(), "one went out just now");
        sink.inner.state.lock().unwrap().last_progress -= PROGRESS_EVERY;
        sink.keep_alive();
        let got = payloads(&mut rx);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0]["visited"], 6, "the latest report is sent");
    }

    #[test]
    fn finish_rules() {
        let ok = |e: ScoutEnd| Ok(Ok(e));
        assert_eq!(
            finish(ok(ScoutEnd::new(true)), true, false),
            Ok(ScoutEnd::new(true).truncated(Truncation::Items))
        );
        assert_eq!(
            finish(Ok(Err(Stop::Items.into())), true, false),
            Ok(ScoutEnd::new(false).truncated(Truncation::Items))
        );
        assert_eq!(
            finish(Ok(Err(Stop::Cancelled.into())), false, false)
                .unwrap_err()
                .code,
            ScoutCode::Cancelled
        );
        assert_eq!(
            finish(Ok(Err(ScoutError::options("bad root"))), false, false),
            Err(ScoutError::options("bad root"))
        );
        assert_eq!(
            finish(Ok(Err(ScoutError::conn("gone"))), false, true)
                .unwrap_err()
                .code,
            ScoutCode::Cancelled,
            "an error after a cancel is the cancel"
        );
    }
}

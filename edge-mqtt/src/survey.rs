// ACS MQTT driver
// What a scan heard: topics, folders and JSON leaves, turned into scout items
// Copyright 2026 University of Sheffield

//! The part of a scan that does not touch the network.
//!
//! [`ScanOptions`] reads a scan request. [`Survey`] records each
//! message the scan's client hears and turns what it heard into scout
//! items, using the ids from the Edge Scout design:
//!
//! - a folder for the topic level `a/b` has the id `a/b/` and the root
//!   `a/b/#`, so a branch scan listens on that filter.
//! - a topic `a/b` is a value with the id `a/b` and the address `a/b`.
//! - a JSON leaf of that topic has the id `a/b`, a NUL character, then
//!   its JSONPath (`$.speed`), the address `a/b` and that path.
//!
//! A topic that carries messages and also has child topics is
//! therefore both a value `a/b` and a folder `a/b/`, and its children
//! hang off the folder. A topic whose name ends in `/`, such as `a/`,
//! would have the same id as the folder for `a`, so the two are one
//! item: a value that also has children.

use std::collections::{BTreeMap, HashMap};
use std::time::{Duration, Instant};

use rs_edge_driver::{Item, ScoutType};
use serde_json::{Map, Value, json};

use crate::topics::valid_filter;

/// The listening window when the options don't give one, in seconds.
pub const DEFAULT_SECONDS: u64 = 10;
/// The longest listening window the options may ask for, in seconds.
pub const MAX_SECONDS: u64 = 120;
/// The most of one payload that is inspected, when the options don't
/// say.
pub const DEFAULT_INSPECT_BYTES: usize = 64 * 1024;
/// The largest `inspect_bytes` the options may ask for.
pub const MAX_INSPECT_BYTES: usize = 1024 * 1024;
/// The most bytes of payload one scan inspects, in all.
pub const INSPECT_BUDGET: usize = 32 * 1024 * 1024;
/// The most filters one scan subscribes to.
pub const MAX_FILTERS: usize = 32;
/// Above this many live messages in one second, the scan stops
/// inspecting payloads for the rest of its window.
pub const FLOOD_PER_SECOND: u32 = 5_000;
/// The most messages inspected on one topic. Later messages are only
/// counted.
pub const INSPECT_PER_TOPIC: u32 = 16;
/// The most JSON leaves listed for one topic.
pub const MAX_LEAVES: usize = 200;
/// How deep into a JSON payload leaves are looked for.
pub const MAX_JSON_DEPTH: usize = 8;
/// The longest item id the protocol allows, in characters.
const MAX_ID: usize = 512;
/// The longest sample the protocol allows, in characters.
const MAX_SAMPLE: usize = 256;

/// A scan request, read and checked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanOptions {
    /// The filters to subscribe to.
    pub filters: Vec<String>,
    /// How long to listen, before the caps the Edge Agent set.
    pub seconds: u64,
    /// The most of one payload to inspect. Larger payloads are not
    /// inspected at all.
    pub inspect_bytes: usize,
    /// Whether to list the leaves of JSON payloads.
    pub json_leaves: bool,
    /// The scan's own client id, if the options set one.
    pub client_id: Option<String>,
    /// For a branch scan, the folder it replaces. Only topics under it
    /// are listed.
    pub folder_id: Option<String>,
}

impl ScanOptions {
    /// Read a request's `root`, `folder_id` and `options`. The error is
    /// the message for an `OPTIONS` end.
    ///
    /// A `root` is a topic filter to listen on in place of the
    /// `filters` option. Keys the driver does not know are ignored.
    pub fn from_request(
        root: Option<&str>,
        folder_id: Option<&str>,
        options: &Map<String, Value>,
    ) -> Result<Self, String> {
        let filters = match root {
            Some(r) => {
                if !valid_filter(r) {
                    return Err(format!("root {r:?} is not a valid MQTT topic filter"));
                }
                vec![r.to_owned()]
            }
            None => match options.get("filters") {
                None | Some(Value::Null) => vec!["#".to_owned()],
                Some(Value::Array(a)) => {
                    if a.is_empty() || a.len() > MAX_FILTERS {
                        return Err(format!(
                            "filters must list 1 to {MAX_FILTERS} topic filters"
                        ));
                    }
                    let mut out: Vec<String> = Vec::new();
                    for f in a {
                        let Some(f) = f.as_str().filter(|f| valid_filter(f)) else {
                            return Err(format!("filter {f} is not a valid MQTT topic filter"));
                        };
                        if !out.iter().any(|o| o == f) {
                            out.push(f.to_owned());
                        }
                    }
                    out
                }
                Some(_) => return Err("filters must be a list of topic filters".into()),
            },
        };

        let folder_id = match folder_id {
            None => None,
            Some(_) if root.is_none() => {
                return Err("folder_id needs a root".into());
            }
            Some(f) if !f.ends_with('/') => {
                return Err(format!("folder_id {f:?} is not an MQTT folder"));
            }
            Some(f) => Some(f.to_owned()),
        };

        let seconds = match options.get("seconds") {
            None | Some(Value::Null) => DEFAULT_SECONDS,
            Some(v) => v
                .as_u64()
                .filter(|s| (1..=MAX_SECONDS).contains(s))
                .ok_or(format!(
                    "seconds must be a whole number from 1 to {MAX_SECONDS}"
                ))?,
        };

        let inspect_bytes = match options.get("inspect_bytes") {
            None | Some(Value::Null) => DEFAULT_INSPECT_BYTES,
            Some(v) => v
                .as_u64()
                .and_then(|n| usize::try_from(n).ok())
                .filter(|n| *n <= MAX_INSPECT_BYTES)
                .ok_or(format!(
                    "inspect_bytes must be a whole number from 0 to {MAX_INSPECT_BYTES}"
                ))?,
        };

        let json_leaves = match options.get("json_leaves") {
            None | Some(Value::Null) => true,
            Some(Value::Bool(b)) => *b,
            Some(_) => return Err("json_leaves must be true or false".into()),
        };

        let client_id = match options.get("client_id") {
            None | Some(Value::Null) => None,
            Some(Value::String(s)) if !s.is_empty() && s.len() <= 65535 && !s.contains('\0') => {
                Some(s.clone())
            }
            Some(_) => return Err("client_id must be a non-empty string".into()),
        };

        Ok(Self {
            filters,
            seconds,
            inspect_bytes,
            json_leaves,
            client_id,
            folder_id,
        })
    }
}

/// The scan's client id. `base` is the driver's own client id and
/// `hex` is at least 12 random hex digits.
///
/// It is `<base>-scout-<6 hex>`, or `fpscout-<12 hex>` when that would
/// pass the 23 characters every MQTT 3.1.1 broker must accept.
pub fn scout_client_id(base: &str, hex: &str) -> String {
    let short = format!("{base}-scout-{}", &hex[..6]);
    if short.chars().count() <= 23 {
        short
    } else {
        format!("fpscout-{}", &hex[..12])
    }
}

/// Whether `filter` matches `topic` by the MQTT rules. A filter
/// starting with a wildcard does not match a topic starting with `$`.
pub fn filter_matches(filter: &str, topic: &str) -> bool {
    if topic.starts_with('$') && filter.starts_with(['+', '#']) {
        return false;
    }
    let mut f = filter.split('/');
    let mut t = topic.split('/');
    loop {
        match (f.next(), t.next()) {
            (Some("#"), _) => return true,
            (Some("+"), Some(_)) => {}
            (Some(a), Some(b)) if a == b => {}
            (None, None) => return true,
            _ => return false,
        }
    }
}

/// The MQTT kind of a payload, as `detail.format` reports it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Empty,
    Json,
    Xml,
    Text,
    Binary,
    /// Payloads of more than one kind.
    Mixed,
}

impl Format {
    fn as_str(self) -> &'static str {
        match self {
            Self::Empty => "empty",
            Self::Json => "json",
            Self::Xml => "xml",
            Self::Text => "text",
            Self::Binary => "binary",
            Self::Mixed => "mixed",
        }
    }
}

/// The kinds of value seen at one place, so a type can be inferred.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct Seen {
    int: bool,
    float: bool,
    boolean: bool,
    string: bool,
    other: bool,
}

impl Seen {
    fn add(&mut self, v: &Value) {
        match v {
            Value::Null => {}
            Value::Bool(_) => self.boolean = true,
            Value::Number(n) if n.is_i64() || n.is_u64() => self.int = true,
            Value::Number(_) => self.float = true,
            Value::String(_) => self.string = true,
            Value::Array(_) | Value::Object(_) => self.other = true,
        }
    }

    /// Int64 when every sample was an integer, Double when every
    /// sample was a number, then Boolean and String. Anything else, or
    /// a mixture, has no type.
    fn infer(self) -> Option<ScoutType> {
        let Seen {
            int,
            float,
            boolean,
            string,
            other,
        } = self;
        match (int, float, boolean, string, other) {
            (true, false, false, false, false) => Some(ScoutType::Int64),
            (_, true, false, false, false) => Some(ScoutType::Double),
            (false, false, true, false, false) => Some(ScoutType::Boolean),
            (false, false, false, true, false) => Some(ScoutType::String),
            _ => None,
        }
    }
}

/// One JSON leaf of a topic.
#[derive(Debug, Clone, Default)]
struct Leaf {
    seen: Seen,
    sample: Option<String>,
}

/// What the scan heard on one topic.
#[derive(Debug, Clone, Default)]
struct Topic {
    /// Every message, retained or live.
    count: u64,
    /// Live messages only.
    live: u64,
    retained: bool,
    format: Option<Format>,
    inspected: u32,
    seen: Seen,
    sample: Option<String>,
    /// JSON leaves in the order first seen, by path.
    leaves: Vec<(String, Leaf)>,
    leaf_index: HashMap<String, usize>,
    /// Some leaves were left out.
    more_leaves: bool,
}

/// One entry in the tree, keyed by its item id.
#[derive(Debug, Default)]
struct Node {
    /// Set when the id is a topic that carried messages.
    topic: Option<Topic>,
    /// The node is a folder, with child topics.
    folder: bool,
    /// A folder at the depth cap, with children not listed.
    more: bool,
}

/// What one call to [`Survey::record`] did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Recorded {
    /// The message was counted.
    Kept,
    /// The topic is outside the scan, such as a `$` topic or one
    /// outside a branch.
    Skipped,
    /// The item cap stopped the scan recording more.
    Full,
}

/// Everything a scan heard.
pub struct Survey {
    opts: ScanOptions,
    /// The item cap.
    max_items: usize,
    /// Most topic levels below the root.
    depth: usize,
    /// Topic levels above the root of a branch scan.
    base_levels: usize,
    samples: bool,
    nodes: BTreeMap<String, Node>,
    /// Items the nodes and leaves will make.
    items: usize,
    full: bool,
    depth_hit: bool,
    messages: u64,
    inspected_bytes: usize,
    flood_window: Option<Instant>,
    flood_count: u32,
    flooded: bool,
}

impl Survey {
    /// A survey for a scan with these options and caps.
    pub fn new(opts: ScanOptions, max_items: usize, depth: u32, samples: bool) -> Self {
        let base_levels = opts
            .folder_id
            .as_deref()
            .map_or(0, |f| f.split('/').count() - 1);
        let mut s = Self {
            opts,
            max_items,
            depth: depth as usize,
            base_levels,
            samples,
            nodes: BTreeMap::new(),
            items: 0,
            full: false,
            depth_hit: false,
            messages: 0,
            inspected_bytes: 0,
            flood_window: None,
            flood_count: 0,
            flooded: false,
        };
        // A branch scan's first item is the folder it replaces, even
        // when nothing is heard under it.
        if let Some(f) = s.opts.folder_id.clone() {
            s.nodes.insert(
                f,
                Node {
                    folder: true,
                    ..Default::default()
                },
            );
            s.items = 1;
        }
        s
    }

    /// Messages heard, retained or live.
    pub fn messages(&self) -> u64 {
        self.messages
    }

    /// Items the scan will list.
    pub fn items(&self) -> usize {
        self.items
    }

    /// Topics heard.
    pub fn topics(&self) -> usize {
        self.nodes.values().filter(|n| n.topic.is_some()).count()
    }

    /// The item cap stopped the scan.
    pub fn full(&self) -> bool {
        self.full
    }

    /// Some topics were deeper than the depth cap.
    pub fn depth_hit(&self) -> bool {
        self.depth_hit
    }

    /// Live traffic passed the flood cutoff, so payloads stopped being
    /// inspected.
    pub fn flooded(&self) -> bool {
        self.flooded
    }

    /// Bytes of payload inspected so far.
    pub fn inspected_bytes(&self) -> usize {
        self.inspected_bytes
    }

    /// Whether the scan lists `topic`.
    fn wanted(&self, topic: &str) -> bool {
        if topic.is_empty() || topic.chars().count() > MAX_ID {
            return false;
        }
        if topic.starts_with('$')
            && !self
                .opts
                .filters
                .iter()
                .any(|f| f.starts_with('$') && filter_matches(f, topic))
        {
            return false;
        }
        match &self.opts.folder_id {
            Some(f) => topic.starts_with(f.as_str()),
            None => true,
        }
    }

    /// Record one message. `retained` is the flag the broker set,
    /// which it sets only for messages sent because of the new
    /// subscription, so live traffic can be told apart.
    pub fn record(
        &mut self,
        topic: &str,
        payload: &[u8],
        retained: bool,
        now: Instant,
    ) -> Recorded {
        if !self.wanted(topic) {
            return Recorded::Skipped;
        }
        self.messages += 1;

        // The flood cutoff counts live messages only, so a burst of
        // retained messages after the SUBACK is analysed in full.
        if !retained && !self.flooded {
            match self.flood_window {
                Some(start) if now.duration_since(start) < Duration::from_secs(1) => {
                    self.flood_count += 1;
                }
                _ => {
                    self.flood_window = Some(now);
                    self.flood_count = 1;
                }
            }
            if self.flood_count > FLOOD_PER_SECOND {
                tracing::info!(
                    "more than {FLOOD_PER_SECOND} messages a second, no longer inspecting payloads"
                );
                self.flooded = true;
            }
        }

        if !self.nodes.get(topic).is_some_and(|n| n.topic.is_some()) && !self.add_topic(topic) {
            return if self.full {
                Recorded::Full
            } else {
                Recorded::Kept
            };
        }

        let inspect = !self.flooded
            && payload.len() <= self.opts.inspect_bytes
            && self.inspected_bytes + payload.len() <= INSPECT_BUDGET;
        let (json_leaves, samples) = (self.opts.json_leaves, self.samples);
        let node = self
            .nodes
            .get_mut(topic)
            .expect("the topic was added above");
        let t = node.topic.as_mut().expect("the topic was added above");
        t.count += 1;
        if retained {
            t.retained = true;
        } else {
            t.live += 1;
        }
        if !inspect || t.inspected >= INSPECT_PER_TOPIC {
            return Recorded::Kept;
        }
        t.inspected += 1;
        self.inspected_bytes += payload.len();

        let (format, json) = classify(payload);
        t.format = Some(match t.format {
            None => format,
            Some(f) if f == format => f,
            Some(_) => Format::Mixed,
        });
        match &json {
            Some(v) => t.seen.add(v),
            None if format == Format::Text => t.seen.string = true,
            None if format == Format::Empty => {}
            None => t.seen.other = true,
        }
        if samples
            && t.sample.is_none()
            && let Ok(s) = std::str::from_utf8(payload)
        {
            t.sample = Some(cut(s, MAX_SAMPLE));
        }

        let Some(v) = json.filter(|v| json_leaves && (v.is_object() || v.is_array())) else {
            return Recorded::Kept;
        };
        let mut found = Vec::new();
        leaves(&v, "$".to_owned(), 0, &mut found);
        for (path, value) in found {
            let id_len = topic.chars().count() + 1 + path.chars().count();
            let t = self.nodes.get_mut(topic).unwrap().topic.as_mut().unwrap();
            let i = match t.leaf_index.get(&path) {
                Some(i) => *i,
                None => {
                    if t.leaves.len() >= MAX_LEAVES || id_len > MAX_ID {
                        t.more_leaves = true;
                        continue;
                    }
                    if self.items >= self.max_items {
                        self.full = true;
                        return Recorded::Full;
                    }
                    self.items += 1;
                    t.leaf_index.insert(path.clone(), t.leaves.len());
                    t.leaves.push((path, Leaf::default()));
                    t.leaves.len() - 1
                }
            };
            let leaf = &mut t.leaves[i].1;
            leaf.seen.add(value);
            if samples && leaf.sample.is_none() && !value.is_null() {
                leaf.sample = Some(cut(&text_of(value), MAX_SAMPLE));
            }
        }
        Recorded::Kept
    }

    /// Add a topic and the folders above it. Returns false when the
    /// topic is not listed: deeper than the depth cap, or past the
    /// item cap.
    fn add_topic(&mut self, topic: &str) -> bool {
        let levels: Vec<&str> = topic.split('/').collect();
        let n = levels.len();
        // A topic ending in `/` is the folder of the level before it.
        let own_folder = topic.ends_with('/');
        let topic_depth = if own_folder { n - 1 } else { n };

        // Folders from the level below the root down to the topic's parent,
        // stopping at the depth cap.
        let mut new_nodes = Vec::new();
        let mut capped_at = None;
        for k in (self.base_levels.max(1))..n {
            let id = folder_id(&levels[..k]);
            if k - self.base_levels > self.depth {
                capped_at = Some(folder_id(&levels[..k - 1]));
                break;
            }
            if !self.nodes.get(&id).is_some_and(|n| n.folder) {
                new_nodes.push(id);
            }
        }
        if topic_depth - self.base_levels > self.depth && capped_at.is_none() {
            capped_at = Some(folder_id(&levels[..n - 1]));
        }
        let listed = capped_at.is_none();
        if listed && !own_folder {
            new_nodes.push(topic.to_owned());
        }
        let adds = new_nodes
            .iter()
            .filter(|id| !self.nodes.contains_key(*id))
            .count();
        if self.items + adds > self.max_items {
            self.full = true;
            return false;
        }
        self.items += adds;
        for id in new_nodes {
            let is_topic = id == topic;
            let node = self.nodes.entry(id).or_default();
            if is_topic {
                node.topic = Some(Topic::default());
            } else {
                node.folder = true;
            }
        }
        if let Some(f) = capped_at {
            self.depth_hit = true;
            if let Some(node) = self.nodes.get_mut(&f) {
                node.more = true;
            }
            return false;
        }
        if own_folder {
            let node = self
                .nodes
                .get_mut(topic)
                .expect("its folder was added above");
            node.topic = Some(Topic::default());
        }
        true
    }

    /// The items the scan found, each after its parent. `listened` is
    /// how long the scan listened, for the message rates.
    pub fn into_items(self, listened: Duration) -> Vec<Item> {
        let secs = listened.as_secs_f64().max(0.001);
        let mut out = Vec::with_capacity(self.items);
        let mut nodes = self.nodes;
        // A branch scan's folder goes first.
        let first = self
            .opts
            .folder_id
            .as_ref()
            .and_then(|f| nodes.remove_entry(f));
        for (id, node) in first.into_iter().chain(nodes) {
            let parent = parent_of(&id);
            let name = name_of(&id).to_owned();
            let is_folder = node.folder || id.ends_with('/');
            let Some(t) = node.topic else {
                out.push(
                    Item::folder(id.clone(), parent.as_deref(), name)
                        .with_root(format!("{id}#"))
                        .with_more(node.more),
                );
                continue;
            };
            let mut detail = json!({
                "count": t.count,
                "rate_hz": (t.live as f64 / secs * 100.0).round() / 100.0,
                "retained": t.retained,
            });
            if let Some(f) = t.format {
                detail["format"] = f.as_str().into();
            }
            let mut item = Item::value(id.clone(), parent.as_deref(), name, id.clone())
                .with_detail(detail)
                .with_more(node.more || t.more_leaves);
            if let Some(ty) = t.seen.infer() {
                item = item.with_type(ty);
            }
            if let Some(s) = t.sample {
                item = item.with_sample(s);
            }
            if is_folder {
                item = item.with_root(format!("{id}#"));
            }
            out.push(item);
            for (path, leaf) in t.leaves {
                let leaf_name = path
                    .strip_prefix("$.")
                    .or_else(|| path.strip_prefix('$'))
                    .unwrap_or(&path)
                    .to_owned();
                let mut item =
                    Item::value(format!("{id}\0{path}"), Some(&id), leaf_name, id.clone())
                        .with_path(path);
                if let Some(ty) = leaf.seen.infer() {
                    item = item.with_type(ty);
                }
                if let Some(s) = leaf.sample {
                    item = item.with_sample(s);
                }
                out.push(item);
            }
        }
        out
    }
}

/// The folder id for these topic levels.
fn folder_id(levels: &[&str]) -> String {
    let mut s = levels.join("/");
    s.push('/');
    s
}

/// The parent of an item id: the folder one level up, or none at the
/// top. A topic's parent is the folder of its level, unless the topic
/// ends in `/` and is that folder.
fn parent_of(id: &str) -> Option<String> {
    let body = id.strip_suffix('/').unwrap_or(id);
    body.rfind('/').map(|i| id[..=i].to_owned())
}

/// What the operator sees: the last topic level.
fn name_of(id: &str) -> &str {
    let body = id.strip_suffix('/').unwrap_or(id);
    match body.rfind('/') {
        Some(i) => &body[i + 1..],
        None => body,
    }
}

/// What kind of payload this is, and its JSON if it is JSON.
fn classify(payload: &[u8]) -> (Format, Option<Value>) {
    if payload.is_empty() {
        return (Format::Empty, None);
    }
    let Ok(text) = std::str::from_utf8(payload) else {
        return (Format::Binary, None);
    };
    if let Ok(v) = serde_json::from_str::<Value>(text) {
        return (Format::Json, Some(v));
    }
    if text.trim_start().starts_with('<') {
        return (Format::Xml, None);
    }
    if text.chars().any(|c| c.is_control() && !c.is_whitespace()) {
        return (Format::Binary, None);
    }
    (Format::Text, None)
}

/// Collect the leaves of a JSON value with their JSONPaths, at most
/// [`MAX_JSON_DEPTH`] containers deep. It stops one past
/// [`MAX_LEAVES`], so the caller can tell some were left out.
fn leaves<'a>(v: &'a Value, path: String, depth: usize, out: &mut Vec<(String, &'a Value)>) {
    if out.len() > MAX_LEAVES {
        return;
    }
    match v {
        Value::Object(m) => {
            if depth >= MAX_JSON_DEPTH {
                return;
            }
            for (k, v) in m {
                if let Some(p) = member_path(&path, k) {
                    leaves(v, p, depth + 1, out);
                }
            }
        }
        Value::Array(a) => {
            if depth >= MAX_JSON_DEPTH {
                return;
            }
            for (i, v) in a.iter().enumerate() {
                leaves(v, format!("{path}[{i}]"), depth + 1, out);
            }
        }
        _ => out.push((path, v)),
    }
}

/// The JSONPath of member `key` of the object at `path`: `$.key` for a
/// plain name, `$['key']` otherwise. A key the Edge Agent's JSONPath
/// library could misread, such as one with a quote, bracket or
/// wildcard character in it, has no path and is left out.
fn member_path(path: &str, key: &str) -> Option<String> {
    let plain = key
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    if plain {
        return Some(format!("{path}.{key}"));
    }
    if key.is_empty()
        || key
            .chars()
            .any(|c| "'\"[]()*?@$~^\\`,;".contains(c) || c.is_control())
    {
        return None;
    }
    Some(format!("{path}['{key}']"))
}

/// A JSON value as text: strings without their quotes.
fn text_of(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        v => v.to_string(),
    }
}

/// `s` cut to at most `max` characters.
fn cut(s: &str, max: usize) -> String {
    match s.char_indices().nth(max) {
        Some((i, _)) => s[..i].to_owned(),
        None => s.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::to_value;

    fn opts(v: Value) -> Result<ScanOptions, String> {
        ScanOptions::from_request(None, None, v.as_object().unwrap())
    }

    fn survey(o: Value) -> Survey {
        Survey::new(opts(o).unwrap(), 20_000, 8, true)
    }

    fn items(s: Survey) -> Vec<Value> {
        s.into_items(Duration::from_secs(10))
            .into_iter()
            .map(|i| to_value(i).unwrap())
            .collect()
    }

    fn find<'a>(items: &'a [Value], id: &str) -> &'a Value {
        items
            .iter()
            .find(|i| i["id"] == id)
            .unwrap_or_else(|| panic!("no item {id:?} in {items:#?}"))
    }

    fn ids(items: &[Value]) -> Vec<&str> {
        items.iter().map(|i| i["id"].as_str().unwrap()).collect()
    }

    /// Every item's parent comes before it.
    fn assert_parents_first(items: &[Value]) {
        let mut seen = std::collections::HashSet::new();
        for i in items {
            if let Some(p) = i["parent"].as_str() {
                assert!(seen.contains(p), "{} comes before its parent {p}", i["id"]);
            }
            assert!(
                seen.insert(i["id"].as_str().unwrap()),
                "duplicate {}",
                i["id"]
            );
        }
    }

    #[test]
    fn default_options() {
        let o = opts(json!({})).unwrap();
        assert_eq!(o.filters, ["#"]);
        assert_eq!(o.seconds, 10);
        assert_eq!(o.inspect_bytes, 64 * 1024);
        assert!(o.json_leaves);
        assert_eq!(o.client_id, None);
        assert_eq!(o.folder_id, None);
    }

    #[test]
    fn options_are_checked() {
        let o = opts(json!({
            "filters": ["a/#", "b/+/c", "a/#"], "seconds": 120, "inspect_bytes": 0,
            "json_leaves": false, "client_id": "mine", "unknown": 1,
        }))
        .unwrap();
        assert_eq!(o.filters, ["a/#", "b/+/c"]);
        assert_eq!(o.seconds, 120);
        assert_eq!(o.inspect_bytes, 0);
        assert!(!o.json_leaves);
        assert_eq!(o.client_id.as_deref(), Some("mine"));

        for bad in [
            json!({"filters": []}),
            json!({"filters": "#"}),
            json!({"filters": ["a/#/b"]}),
            json!({"filters": [1]}),
            json!({"filters": vec!["a"; 33]}),
            json!({"seconds": 0}),
            json!({"seconds": 121}),
            json!({"seconds": 1.5}),
            json!({"inspect_bytes": -1}),
            json!({"inspect_bytes": 2 * 1024 * 1024}),
            json!({"json_leaves": "yes"}),
            json!({"client_id": ""}),
            json!({"client_id": 3}),
        ] {
            assert!(opts(bad.clone()).is_err(), "{bad} should be refused");
        }
    }

    #[test]
    fn a_root_replaces_the_filters() {
        let m = json!({"filters": ["x"]});
        let o =
            ScanOptions::from_request(Some("a/b/#"), Some("a/b/"), m.as_object().unwrap()).unwrap();
        assert_eq!(o.filters, ["a/b/#"]);
        assert_eq!(o.folder_id.as_deref(), Some("a/b/"));

        let empty = Map::new();
        assert!(ScanOptions::from_request(Some("a/#/b"), None, &empty).is_err());
        assert!(ScanOptions::from_request(None, Some("a/"), &empty).is_err());
        assert!(ScanOptions::from_request(Some("a/b"), Some("a/b"), &empty).is_err());
    }

    #[test]
    fn scout_client_ids() {
        let hex = "0123456789abcdef";
        assert_eq!(scout_client_id("edge", hex), "edge-scout-012345");
        // 23 characters exactly.
        assert_eq!(
            scout_client_id("edge-main1", hex),
            "edge-main1-scout-012345"
        );
        assert_eq!(scout_client_id("edge-main12", hex), "fpscout-0123456789ab");
        let made_up = format!("NO-ID-{}", uuid::Uuid::new_v4());
        assert_eq!(scout_client_id(&made_up, hex), "fpscout-0123456789ab");
    }

    #[test]
    fn filters_match_topics() {
        assert!(filter_matches("#", "a/b"));
        assert!(filter_matches("a/#", "a"));
        assert!(filter_matches("a/#", "a/b/c"));
        assert!(filter_matches("a/+/c", "a/b/c"));
        assert!(filter_matches("+", "a"));
        assert!(!filter_matches("+", "a/b"));
        assert!(!filter_matches("a/b", "a/b/c"));
        assert!(!filter_matches("#", "$SYS/x"));
        assert!(!filter_matches("+/x", "$SYS/x"));
        assert!(filter_matches("$SYS/#", "$SYS/x"));
    }

    #[test]
    fn the_id_scheme() {
        let now = Instant::now();
        let mut s = survey(json!({}));
        s.record("plant/line1", b"{\"speed\": 1}", true, now);
        s.record("plant/line1/temp", b"21.5", false, now);
        s.record("top", b"x", false, now);
        let items = items(s);
        assert_parents_first(&items);
        assert_eq!(
            ids(&items),
            [
                "plant/",
                "plant/line1",
                "plant/line1\0$.speed",
                "plant/line1/",
                "plant/line1/temp",
                "top"
            ]
        );

        let plant = find(&items, "plant/");
        assert_eq!(plant["kind"], "folder");
        assert_eq!(plant["parent"], Value::Null);
        assert_eq!(plant["name"], "plant");
        assert_eq!(plant["root"], "plant/#");

        // A topic that also has children is a value and a folder.
        let line1 = find(&items, "plant/line1");
        assert_eq!(line1["kind"], "value");
        assert_eq!(line1["parent"], "plant/");
        assert_eq!(line1["address"], "plant/line1");
        assert!(line1.get("path").is_none());
        assert!(line1.get("root").is_none());
        assert_eq!(find(&items, "plant/line1/")["kind"], "folder");
        assert_eq!(find(&items, "plant/line1/")["parent"], "plant/");
        assert_eq!(find(&items, "plant/line1/temp")["parent"], "plant/line1/");

        let leaf = find(&items, "plant/line1\0$.speed");
        assert_eq!(leaf["parent"], "plant/line1");
        assert_eq!(leaf["address"], "plant/line1");
        assert_eq!(leaf["path"], "$.speed");
        assert_eq!(leaf["name"], "speed");
        assert_eq!(leaf["type"], "Int64");

        assert_eq!(find(&items, "top")["parent"], Value::Null);
    }

    #[test]
    fn a_topic_ending_in_a_slash_is_its_folder() {
        let now = Instant::now();
        let mut s = survey(json!({}));
        s.record("a/", b"1", false, now);
        s.record("a/b", b"2", false, now);
        s.record("c//", b"3", false, now);
        let items = items(s);
        assert_parents_first(&items);
        assert_eq!(ids(&items), ["a/", "a/b", "c/", "c//"]);
        let a = find(&items, "a/");
        assert_eq!(a["kind"], "value");
        assert_eq!(a["address"], "a/");
        assert_eq!(a["root"], "a/#");
        assert_eq!(a["parent"], Value::Null);
        assert_eq!(find(&items, "a/b")["parent"], "a/");
        assert_eq!(find(&items, "c//")["parent"], "c/");
        assert_eq!(find(&items, "c//")["kind"], "value");
    }

    #[test]
    fn json_leaf_paths() {
        let now = Instant::now();
        let mut s = survey(json!({}));
        let payload = json!({
            "a": {"b": [10, {"c": true}]},
            "with space": "x",
            "bad'quote": 1,
            "_ok9": null,
            "": 2,
            // Eight containers deep, counting the payload itself.
            "deep": {"1": {"2": {"3": {"4": {"5": {"6": {"7": 1}}}}}}},
            // Nine, so left out.
            "deeper": {"1": {"2": {"3": {"4": {"5": {"6": {"7": {"8": 1}}}}}}}},
        });
        s.record("t", payload.to_string().as_bytes(), false, now);
        let items = items(s);
        let mut paths: Vec<&str> = items
            .iter()
            .filter_map(|i| i.get("path").and_then(Value::as_str))
            .collect();
        paths.sort();
        assert_eq!(
            paths,
            [
                "$._ok9",
                "$.a.b[0]",
                "$.a.b[1].c",
                "$.deep['1']['2']['3']['4']['5']['6']['7']",
                "$['with space']",
            ]
        );
        assert_eq!(find(&items, "t\0$.a.b[1].c")["type"], "Boolean");
        assert_eq!(find(&items, "t\0$.a.b[1].c")["name"], "a.b[1].c");
        assert_eq!(find(&items, "t\0$['with space']")["type"], "String");
        assert!(find(&items, "t\0$._ok9").get("type").is_none());
        // A JSON object has no type of its own.
        assert!(find(&items, "t").get("type").is_none());
        assert_eq!(find(&items, "t")["detail"]["format"], "json");
    }

    #[test]
    fn json_leaves_can_be_turned_off() {
        let mut s = survey(json!({"json_leaves": false}));
        s.record("t", b"{\"a\": 1}", false, Instant::now());
        assert_eq!(ids(&items(s)), ["t"]);
    }

    #[test]
    fn leaves_per_topic_are_capped() {
        let mut s = survey(json!({}));
        let big: Map<String, Value> = (0..300).map(|i| (format!("k{i}"), json!(i))).collect();
        s.record(
            "t",
            Value::Object(big).to_string().as_bytes(),
            false,
            Instant::now(),
        );
        let items = items(s);
        assert_eq!(items.len(), 1 + MAX_LEAVES);
        assert_eq!(find(&items, "t")["more"], true);
    }

    #[test]
    fn type_inference() {
        let now = Instant::now();
        let mut s = survey(json!({}));
        for p in ["1", "2"] {
            s.record("int", p.as_bytes(), false, now);
        }
        for p in ["1", "2.5"] {
            s.record("double", p.as_bytes(), false, now);
        }
        for p in ["true", "false"] {
            s.record("bool", p.as_bytes(), false, now);
        }
        for p in ["on", "\"off\""] {
            s.record("string", p.as_bytes(), false, now);
        }
        for p in ["1", "on"] {
            s.record("mixed", p.as_bytes(), false, now);
        }
        s.record("binary", &[0xff, 0x00, 0x01], false, now);
        s.record("xml", b"<a>1</a>", false, now);
        s.record("empty", b"", false, now);
        for p in [r#"{"v": 1}"#, r#"{"v": 1.5}"#] {
            s.record("leaf", p.as_bytes(), false, now);
        }
        let items = items(s);
        let ty = |id: &str| find(&items, id).get("type").cloned().unwrap_or(Value::Null);
        assert_eq!(ty("int"), "Int64");
        assert_eq!(ty("double"), "Double");
        assert_eq!(ty("bool"), "Boolean");
        assert_eq!(ty("string"), "String");
        assert_eq!(ty("mixed"), Value::Null);
        assert_eq!(ty("binary"), Value::Null);
        assert_eq!(ty("xml"), Value::Null);
        assert_eq!(ty("empty"), Value::Null);
        assert_eq!(ty("leaf\0$.v"), "Double");
        let format = |id: &str| find(&items, id)["detail"]["format"].clone();
        assert_eq!(format("binary"), "binary");
        assert_eq!(format("xml"), "xml");
        assert_eq!(format("empty"), "empty");
        assert_eq!(format("string"), "mixed");
        assert_eq!(format("int"), "json");
    }

    #[test]
    fn samples_only_when_asked_for() {
        let mut s = Survey::new(opts(json!({})).unwrap(), 100, 8, false);
        s.record("t", b"{\"a\": 1}", false, Instant::now());
        assert!(items(s).iter().all(|i| i.get("sample").is_none()));

        let mut s = survey(json!({}));
        s.record("t", b"{\"a\": \"x\"}", false, Instant::now());
        s.record("t", b"{\"a\": \"y\"}", false, Instant::now());
        let items = items(s);
        assert_eq!(find(&items, "t")["sample"], "{\"a\": \"x\"}");
        assert_eq!(find(&items, "t\0$.a")["sample"], "x");
    }

    #[test]
    fn dollar_topics_are_skipped_unless_a_filter_names_them() {
        let now = Instant::now();
        let mut s = survey(json!({}));
        assert_eq!(
            s.record("$SYS/broker/uptime", b"1", true, now),
            Recorded::Skipped
        );
        assert_eq!(s.topics(), 0);

        let mut s = survey(json!({"filters": ["#", "$SYS/broker/#"]}));
        assert_eq!(
            s.record("$SYS/broker/uptime", b"1", true, now),
            Recorded::Kept
        );
        assert_eq!(s.record("$other/x", b"1", true, now), Recorded::Skipped);
        assert_eq!(
            ids(&items(s)),
            ["$SYS/", "$SYS/broker/", "$SYS/broker/uptime"]
        );
    }

    #[test]
    fn counts_rates_and_retained() {
        let now = Instant::now();
        let mut s = survey(json!({}));
        s.record("t", b"1", true, now);
        for _ in 0..20 {
            s.record("t", b"2", false, now);
        }
        let items = items(s);
        let d = &find(&items, "t")["detail"];
        assert_eq!(d["count"], 21);
        assert_eq!(d["retained"], true);
        // 20 live messages over the 10 s the test says it listened.
        assert_eq!(d["rate_hz"], 2.0);
    }

    #[test]
    fn retained_messages_do_not_count_toward_the_flood_cutoff() {
        let now = Instant::now();
        let mut s = survey(json!({}));
        for i in 0..(FLOOD_PER_SECOND + 1000) {
            s.record(&format!("burst/{i}"), b"{\"v\": 1}", true, now);
        }
        assert!(!s.flooded());
        // Every retained topic kept its leaf.
        assert_eq!(s.items(), 1 + 2 * (FLOOD_PER_SECOND as usize + 1000));

        // Live messages past the cutoff stop payload analysis, but
        // topics are still recorded.
        for _ in 0..=FLOOD_PER_SECOND {
            s.record("live/a", b"{\"v\": 1}", false, now);
        }
        assert!(s.flooded());
        s.record("live/late", b"{\"w\": 1}", false, now);
        let items = items(s);
        let late = find(&items, "live/late");
        assert!(late["detail"].get("format").is_none());
        assert!(!items.iter().any(|i| i["id"] == "live/late\0$.w"));
    }

    #[test]
    fn the_flood_window_moves_on() {
        let t0 = Instant::now();
        let mut s = survey(json!({}));
        for i in 0..(FLOOD_PER_SECOND * 3) {
            // 4,000 a second for 3.75 s.
            let at = t0 + Duration::from_micros(250 * u64::from(i));
            s.record("t", b"1", false, at);
        }
        assert!(!s.flooded());
    }

    #[test]
    fn large_payloads_are_not_inspected() {
        let mut s = survey(json!({"inspect_bytes": 10}));
        s.record("small", b"{\"a\": 1}", false, Instant::now());
        s.record("large", b"{\"a\": 12345678}", false, Instant::now());
        let items = items(s);
        assert_eq!(find(&items, "small")["detail"]["format"], "json");
        assert!(find(&items, "large")["detail"].get("format").is_none());
        assert!(!items.iter().any(|i| i["id"] == "large\0$.a"));
    }

    #[test]
    fn the_inspect_budget_is_shared_by_the_scan() {
        let payload = format!("[{}]", "1,".repeat(500_000) + "1");
        let mut s = survey(json!({"inspect_bytes": MAX_INSPECT_BYTES, "json_leaves": false}));
        let mut n = 0;
        while s.inspected_bytes() + payload.len() <= INSPECT_BUDGET {
            s.record(
                &format!("t/{n}"),
                payload.as_bytes(),
                false,
                Instant::now() + Duration::from_secs(n),
            );
            n += 1;
        }
        s.record(
            "t/last",
            payload.as_bytes(),
            false,
            Instant::now() + Duration::from_secs(n),
        );
        assert!(s.inspected_bytes() <= INSPECT_BUDGET);
        let items = items(s);
        assert!(find(&items, "t/last")["detail"].get("format").is_none());
        assert_eq!(find(&items, "t/0")["detail"]["format"], "json");
    }

    #[test]
    fn the_item_cap_stops_the_scan() {
        let now = Instant::now();
        let mut s = Survey::new(opts(json!({})).unwrap(), 5, 8, false);
        assert_eq!(s.record("a/1", b"1", false, now), Recorded::Kept);
        assert_eq!(s.record("a/2", b"1", false, now), Recorded::Kept);
        assert_eq!(s.record("b/1", b"1", false, now), Recorded::Kept);
        assert_eq!(s.record("b/2", b"1", false, now), Recorded::Full);
        assert!(s.full());
        let items = items(s);
        assert_eq!(items.len(), 5);
        assert_parents_first(&items);
    }

    #[test]
    fn leaves_count_toward_the_item_cap() {
        let mut s = Survey::new(opts(json!({})).unwrap(), 3, 8, false);
        assert_eq!(
            s.record("t", b"{\"a\":1,\"b\":2,\"c\":3}", false, Instant::now()),
            Recorded::Full
        );
        assert_eq!(items(s).len(), 3);
    }

    #[test]
    fn the_depth_cap_marks_folders() {
        let now = Instant::now();
        let mut s = Survey::new(opts(json!({})).unwrap(), 100, 2, false);
        s.record("a/b", b"1", false, now);
        s.record("a/b/c", b"1", false, now);
        s.record("a/b/c/d", b"1", false, now);
        s.record("x/y/z/w", b"1", false, now);
        assert!(s.depth_hit());
        let items = items(s);
        assert_parents_first(&items);
        assert_eq!(ids(&items), ["a/", "a/b", "a/b/", "x/", "x/y/"]);
        assert_eq!(find(&items, "a/b/")["more"], true);
        assert_eq!(find(&items, "x/y/")["more"], true);
        assert!(find(&items, "a/").get("more").is_none());
    }

    #[test]
    fn a_branch_scan_lists_only_its_folder() {
        let now = Instant::now();
        let o = ScanOptions::from_request(Some("a/b/#"), Some("a/b/"), &Map::new()).unwrap();
        let mut s = Survey::new(o, 100, 1, false);
        // The filter a/b/# also matches a/b, which is outside the folder.
        assert_eq!(s.record("a/b", b"1", false, now), Recorded::Skipped);
        s.record("a/b/c", b"1", false, now);
        s.record("a/b/d/e", b"1", false, now);
        let items = items(s);
        assert_eq!(ids(&items), ["a/b/", "a/b/c", "a/b/d/"]);
        assert_eq!(items[0]["parent"], "a/");
        assert_eq!(items[0]["root"], "a/b/#");
        // Depth counts from the branch's folder.
        assert_eq!(find(&items, "a/b/d/")["more"], true);
    }

    #[test]
    fn an_empty_branch_scan_still_lists_its_folder() {
        let o = ScanOptions::from_request(Some("a/#"), Some("a/"), &Map::new()).unwrap();
        let items = items(Survey::new(o, 100, 8, false));
        assert_eq!(ids(&items), ["a/"]);
        assert_eq!(items[0]["kind"], "folder");
        assert_eq!(items[0]["parent"], Value::Null);
    }

    #[test]
    fn long_topics_are_left_out() {
        let mut s = survey(json!({}));
        let long = "x".repeat(600);
        assert_eq!(
            s.record(&long, b"1", false, Instant::now()),
            Recorded::Skipped
        );
        // A leaf whose id would be too long is left out.
        let topic = "y".repeat(505);
        s.record(&topic, b"{\"abcdefgh\": 1}", false, Instant::now());
        let items = items(s);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["more"], true);
    }
}

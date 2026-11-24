// ACS Rust test driver
// Edge Scout: a made-up address tree for testing scans
// Copyright 2026 University of Sheffield

//! The scouter. It lists a made-up tree of folders and values that
//! depends only on the scan's options, so tests of the Edge Agent and
//! the Admin UI get the same items every time. The options can also
//! make a scan fail, hang, slow down or repeat items.
//!
//! # The tree
//!
//! The device has `size` values, numbered from 0, under `depth` levels
//! of folders. The bottom level of folders holds up to 10 values each,
//! and each level above holds up to 10 folders of the level below,
//! except the top level, which holds as many folders as it needs.
//!
//! - A folder at level `k` (1 at the top) has the index of its first
//!   value divided by 10 to the power of `depth - k + 1`. Its id is
//!   `f<k>.<index>` and its name `Group <index>`, so with `depth` 2,
//!   value 1234 sits in `f2.123`, which sits in `f1.12`.
//! - Value `n` has the id `v<n>` and the name `Value <n>`. Its address
//!   is `<func>:1000:<n>:<packing>`, where the function cycles through
//!   `const`, `sin` and `saw` and the packing changes every 3 values
//!   through `bd`, `ld`, `bf` and `lf`. It is a `Double` or a `Float`,
//!   read only, with `detail` `{"index": n}`.
//! - With `depth` 0 the values sit at the top with no folders.
//!
//! Items come in depth-first order, each folder before what it holds.
//! The ids depend on `size` and `depth` only, never on the scan's
//! root, so a branch scan lists the same ids as a full scan.
//!
//! # Options
//!
//! Option|Default|Meaning
//! ---|---|---
//! `size`|100|How many values, at most 1,000,000
//! `depth`|2|How many levels of folders, at most 16
//! `fail`|null|`OPTIONS`, `CONN`, `AUTH` or `ERR` to end the scan with that code, or `PANIC` to panic, after the first request
//! `hang`|false|After the first request, wait forever and ignore a cancel, to test the library's watchdog
//! `delay_ms`|0|How long each request to the device takes, at most 60,000
//! `duplicates`|false|List every value whose index ends in 0 twice
//!
//! A request lists up to 100 items, and the scouter waits `pace_ms`
//! between two requests. An unknown option, or a value of the wrong
//! type or out of range, ends the scan with `OPTIONS`. Null means the
//! default.
//!
//! # Roots
//!
//! `root` is null for the whole tree, or a folder id. A scan with a
//! root lists what the folder holds. A branch scan, with `folder_id`
//! equal to `root`, lists the folder itself first. A root that is not
//! a folder in the tree, or a `folder_id` that differs from the root,
//! ends the scan with `OPTIONS`.
//!
//! `limits.depth` counts levels below the root. A folder at that
//! level is listed with `more: true` and nothing under it, and the
//! scan ends truncated with reason `depth`.

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use rs_edge_driver::{
    Access, Item, Progress, ScoutEnd, ScoutError, ScoutRequest, ScoutSink, ScoutType, Scouter,
    Stop, Truncation,
};
use serde_json::{Map, Value, json};

use crate::addr::{Addr, Func, Packing};
use crate::handler::clock;

/// Most items in one request to the made-up device.
pub const REQUEST_ITEMS: usize = 100;

/// The largest `size` option.
pub const MAX_SIZE: u64 = 1_000_000;

/// The largest `depth` option. 10 to the power of 17 still fits in a
/// u64, so the arithmetic below never overflows.
pub const MAX_DEPTH: u32 = 16;

/// The largest `delay_ms` option.
pub const MAX_DELAY_MS: u64 = 60_000;

const FUNCS: [Func; 3] = [Func::Const, Func::Sin, Func::Saw];
const PACKINGS: [Packing; 4] = [
    Packing::DoubleBE,
    Packing::DoubleLE,
    Packing::FloatBE,
    Packing::FloatLE,
];

/// How the `fail` option ends a scan.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fail {
    Options,
    Conn,
    Auth,
    Err,
    Panic,
}

impl Fail {
    fn from_name(name: &str) -> Option<Self> {
        match name {
            "OPTIONS" => Some(Self::Options),
            "CONN" => Some(Self::Conn),
            "AUTH" => Some(Self::Auth),
            "ERR" => Some(Self::Err),
            "PANIC" => Some(Self::Panic),
            _ => None,
        }
    }
}

/// A scan's options.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Options {
    pub size: u64,
    pub depth: u32,
    pub fail: Option<Fail>,
    pub hang: bool,
    pub delay_ms: u64,
    pub duplicates: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            size: 100,
            depth: 2,
            fail: None,
            hang: false,
            delay_ms: 0,
            duplicates: false,
        }
    }
}

fn int_option(name: &str, v: &Value, max: u64) -> Result<u64, String> {
    match v.as_u64() {
        Some(n) if n <= max => Ok(n),
        _ => Err(format!(
            "The option {name} must be a whole number from 0 to {max}."
        )),
    }
}

fn bool_option(name: &str, v: &Value) -> Result<bool, String> {
    v.as_bool()
        .ok_or_else(|| format!("The option {name} must be true or false."))
}

impl Options {
    /// Read the options from a `start` message. The error is the
    /// message for an `OPTIONS` end.
    pub fn parse(options: &Map<String, Value>) -> Result<Self, String> {
        let mut o = Self::default();
        for (name, v) in options {
            if v.is_null() {
                continue;
            }
            match name.as_str() {
                "size" => o.size = int_option(name, v, MAX_SIZE)?,
                "depth" => o.depth = int_option(name, v, MAX_DEPTH as u64)? as u32,
                "fail" => {
                    let fail = v.as_str().and_then(Fail::from_name).ok_or_else(|| {
                        "The option fail must be OPTIONS, CONN, AUTH, ERR or PANIC.".to_owned()
                    })?;
                    o.fail = Some(fail);
                }
                "hang" => o.hang = bool_option(name, v)?,
                "delay_ms" => o.delay_ms = int_option(name, v, MAX_DELAY_MS)?,
                "duplicates" => o.duplicates = bool_option(name, v)?,
                _ => {
                    return Err(format!(
                        "Unknown option {name}. The options are size, depth, fail, hang, delay_ms and duplicates."
                    ));
                }
            }
        }
        Ok(o)
    }
}

/// A folder in the tree: its level, 1 at the top, and its index.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Folder {
    pub level: u32,
    pub index: u64,
}

/// The made-up device: `size` values under `depth` levels of folders.
#[derive(Clone, Copy, Debug)]
pub struct Tree {
    pub size: u64,
    pub depth: u32,
}

impl Tree {
    pub fn new(size: u64, depth: u32) -> Self {
        Self {
            size,
            depth: depth.min(MAX_DEPTH),
        }
    }

    /// How many values a folder at `level` can hold.
    fn span(&self, level: u32) -> u64 {
        10u64.pow(self.depth - level + 1)
    }

    /// The folder at `level` that holds value `n`.
    fn folder_of(&self, level: u32, n: u64) -> Folder {
        Folder {
            level,
            index: n / self.span(level),
        }
    }

    pub fn folder_id(f: Folder) -> String {
        format!("f{}.{}", f.level, f.index)
    }

    pub fn value_id(n: u64) -> String {
        format!("v{n}")
    }

    /// The folder that holds `f`, if it is not at the top.
    fn parent_of_folder(f: Folder) -> Option<Folder> {
        (f.level > 1).then(|| Folder {
            level: f.level - 1,
            index: f.index / 10,
        })
    }

    /// The folder that holds value `n`, if there are folders.
    fn parent_of_value(&self, n: u64) -> Option<Folder> {
        (self.depth > 0).then(|| self.folder_of(self.depth, n))
    }

    /// The folder with this id, if the tree has it. Only the form
    /// [`folder_id`](Self::folder_id) prints is accepted, so `f01.2`
    /// is not `f1.2`.
    pub fn find_folder(&self, id: &str) -> Option<Folder> {
        let (level, index) = id.strip_prefix('f')?.split_once('.')?;
        let f = Folder {
            level: level.parse().ok()?,
            index: index.parse().ok()?,
        };
        let exists = (1..=self.depth).contains(&f.level)
            && f.index.checked_mul(self.span(f.level))? < self.size;
        (exists && Self::folder_id(f) == id).then_some(f)
    }

    /// The address of value `n`, in its canonical form.
    pub fn address(n: u64) -> Addr {
        Addr {
            func: FUNCS[(n % 3) as usize],
            period: 1000.0,
            amplitude: n as f64,
            packing: PACKINGS[((n / 3) % 4) as usize],
        }
    }

    fn folder_item(f: Folder) -> Item {
        let parent = Self::parent_of_folder(f).map(Self::folder_id);
        Item::folder(
            Self::folder_id(f),
            parent.as_deref(),
            format!("Group {}", f.index),
        )
    }

    fn value_item(&self, n: u64, samples: bool) -> Item {
        let addr = Self::address(n);
        let parent = self.parent_of_value(n).map(Self::folder_id);
        let (t, packed) = match addr.packing {
            Packing::DoubleBE => (ScoutType::Double, "a big-endian double"),
            Packing::DoubleLE => (ScoutType::Double, "a little-endian double"),
            Packing::FloatBE => (ScoutType::Float, "a big-endian float"),
            Packing::FloatLE => (ScoutType::Float, "a little-endian float"),
        };
        let wave = match addr.func {
            Func::Const => "Constant",
            Func::Sin => "Sine wave",
            Func::Saw => "Sawtooth",
        };
        let mut item = Item::value(
            Self::value_id(n),
            parent.as_deref(),
            format!("Value {n}"),
            addr.to_string(),
        )
        .with_type(t)
        .with_access(Access::Read)
        .with_description(format!(
            "{wave} with amplitude {n} and period 1000 ms, sent as {packed}"
        ))
        .with_detail(json!({ "index": n }));
        if samples {
            item = item.with_sample(sample(&addr));
        }
        item
    }

    /// Walk the tree, or the part under `root`.
    ///
    /// `with_root` lists the root folder itself first, as a branch
    /// scan does. `max_depth` is `limits.depth`, counted from the root.
    pub fn walk(
        &self,
        root: Option<Folder>,
        with_root: bool,
        max_depth: u32,
        duplicates: bool,
        samples: bool,
    ) -> Walk {
        let (base, lo, hi) = match root {
            None => (0, 0, self.size),
            Some(f) => {
                let span = self.span(f.level);
                let lo = f.index * span;
                (f.level, lo, lo.saturating_add(span).min(self.size))
            }
        };
        let mut pending = std::collections::VecDeque::new();
        if let (Some(f), true) = (root, with_root) {
            pending.push_back(Self::folder_item(f));
        }
        Walk {
            tree: *self,
            base,
            max_depth: max_depth.max(1),
            n: lo,
            hi,
            duplicates,
            samples,
            pending,
            depth_capped: false,
        }
    }
}

/// The current value of an address, as text.
fn sample(addr: &Addr) -> String {
    let v = addr.func.eval(addr.period, addr.amplitude, clock::now_ms());
    match addr.packing {
        Packing::FloatBE | Packing::FloatLE => (v as f32).to_string(),
        Packing::DoubleBE | Packing::DoubleLE => v.to_string(),
    }
}

/// The items of a walk over the tree, in depth-first order.
pub struct Walk {
    tree: Tree,
    /// The root's level, 0 for the whole tree.
    base: u32,
    max_depth: u32,
    /// The next value to list.
    n: u64,
    /// One past the last value under the root.
    hi: u64,
    duplicates: bool,
    samples: bool,
    pending: std::collections::VecDeque<Item>,
    /// Set once a folder was cut off at the depth cap.
    pub depth_capped: bool,
}

impl Walk {
    /// Queue the items that come with value `n`: the folders that
    /// start at it, then the value itself. A folder at the depth cap
    /// is queued with `more: true`, and the walk skips what it holds.
    /// Values are never cut off on their own: a tree with folders
    /// reaches the cap at a folder first, and a tree without them
    /// puts its values at level 1, and the cap is at least 1.
    fn step(&mut self) {
        let tree = self.tree;
        let n = self.n;
        for level in self.base + 1..=tree.depth {
            if !n.is_multiple_of(tree.span(level)) {
                continue;
            }
            let f = tree.folder_of(level, n);
            if level - self.base >= self.max_depth {
                self.pending.push_back(Tree::folder_item(f).with_more(true));
                self.depth_capped = true;
                self.n = (f.index + 1).saturating_mul(tree.span(level)).min(self.hi);
                return;
            }
            self.pending.push_back(Tree::folder_item(f));
        }
        let item = tree.value_item(n, self.samples);
        if self.duplicates && n.is_multiple_of(10) {
            self.pending.push_back(item.clone());
        }
        self.pending.push_back(item);
        self.n += 1;
    }
}

impl Iterator for Walk {
    type Item = Item;

    fn next(&mut self) -> Option<Item> {
        while self.pending.is_empty() && self.n < self.hi {
            self.step();
        }
        self.pending.pop_front()
    }
}

/// The scouter. It holds nothing: the tree comes from the options.
pub struct TestScouter;

impl TestScouter {
    pub fn new() -> Arc<Self> {
        Arc::new(Self)
    }
}

/// Wait `ms`, or until the scan is stopped.
async fn delay(sink: &ScoutSink, ms: u64) -> Result<(), Stop> {
    if ms == 0 {
        return Ok(());
    }
    let token = sink.cancelled();
    tokio::select! {
        _ = token.cancelled() => Err(Stop::Cancelled),
        _ = tokio::time::sleep(Duration::from_millis(ms)) => Ok(()),
    }
}

/// Work out where a scan starts from its `root` and `folder_id`.
fn find_root(tree: &Tree, req: &ScoutRequest) -> Result<(Option<Folder>, bool), ScoutError> {
    let root = match &req.root {
        None => None,
        Some(id) => Some(
            tree.find_folder(id)
                .ok_or_else(|| ScoutError::options(format!("Root {id} is not a folder.")))?,
        ),
    };
    match (&req.folder_id, &req.root) {
        (None, _) => Ok((root, false)),
        (Some(folder), Some(id)) if folder == id => Ok((root, true)),
        (Some(folder), _) => Err(ScoutError::options(format!(
            "folder_id {folder} does not match the root."
        ))),
    }
}

#[async_trait]
impl Scouter for TestScouter {
    async fn scout(&self, req: ScoutRequest, sink: ScoutSink) -> Result<ScoutEnd, ScoutError> {
        let opts = Options::parse(&req.options).map_err(ScoutError::options)?;
        let tree = Tree::new(opts.size, opts.depth);
        let (root, with_root) = find_root(&tree, &req)?;
        let mut walk = tree.walk(
            root,
            with_root,
            req.limits.depth,
            opts.duplicates,
            req.limits.samples,
        );

        let mut visited = 0u64;
        let mut first = true;
        loop {
            if !first {
                sink.pace().await?;
            }
            delay(&sink, opts.delay_ms).await?;
            let request: Vec<Item> = walk.by_ref().take(REQUEST_ITEMS).collect();
            let last = request.len() < REQUEST_ITEMS;
            visited += request.len() as u64;
            let note = request.last().map(|i| i.id.clone());
            if !request.is_empty() {
                sink.add(request).await?;
            }
            let mut p = Progress::new(visited);
            if let Some(note) = note {
                p = p.with_note(note);
            }
            sink.progress(p);

            if first {
                if opts.hang {
                    tracing::info!("scan {} hangs, as its options ask", req.id);
                    std::future::pending::<()>().await;
                }
                match opts.fail {
                    None => {}
                    Some(Fail::Panic) => panic!("the scan's options asked for a panic"),
                    Some(Fail::Options) => {
                        return Err(ScoutError::options("The scan's options asked to fail."));
                    }
                    Some(Fail::Conn) => {
                        return Err(ScoutError::conn("The scan's options asked to fail."));
                    }
                    Some(Fail::Auth) => {
                        return Err(ScoutError::auth("The scan's options asked to fail."));
                    }
                    Some(Fail::Err) => {
                        return Err(ScoutError::err("The scan's options asked to fail."));
                    }
                }
            }
            first = false;
            if last {
                break;
            }
        }

        let end = ScoutEnd::new(true);
        Ok(if walk.depth_capped {
            end.truncated(Truncation::Depth)
        } else {
            end
        })
    }
}

#[cfg(test)]
mod tests {
    use std::collections::{HashMap, HashSet};

    use rs_edge_driver::ItemKind;

    use super::*;

    fn opts(v: Value) -> Result<Options, String> {
        Options::parse(v.as_object().unwrap())
    }

    fn items(tree: Tree, root: Option<&str>, with_root: bool, max_depth: u32) -> Vec<Item> {
        let root = root.map(|r| tree.find_folder(r).unwrap());
        tree.walk(root, with_root, max_depth, false, false)
            .collect()
    }

    fn ids(items: &[Item]) -> Vec<&str> {
        items.iter().map(|i| i.id.as_str()).collect()
    }

    #[test]
    fn options_default_and_parse() {
        assert_eq!(opts(json!({})).unwrap(), Options::default());
        let o = opts(json!({
            "size": 7, "depth": 0, "fail": "CONN", "hang": true,
            "delay_ms": 5, "duplicates": true,
        }))
        .unwrap();
        assert_eq!(
            o,
            Options {
                size: 7,
                depth: 0,
                fail: Some(Fail::Conn),
                hang: true,
                delay_ms: 5,
                duplicates: true,
            }
        );
        assert_eq!(
            opts(json!({ "size": null, "fail": null })).unwrap(),
            Options::default()
        );
    }

    #[test]
    fn options_refuse_bad_values() {
        for bad in [
            json!({ "size": -1 }),
            json!({ "size": 1.5 }),
            json!({ "size": "10" }),
            json!({ "size": MAX_SIZE + 1 }),
            json!({ "depth": 17 }),
            json!({ "fail": "NOPE" }),
            json!({ "fail": true }),
            json!({ "hang": 1 }),
            json!({ "delay_ms": 60_001 }),
            json!({ "duplicates": "yes" }),
            json!({ "sizes": 10 }),
        ] {
            assert!(opts(bad.clone()).is_err(), "{bad}");
        }
    }

    /// The tree from the module docs: value 1234 in f2.123 in f1.12.
    #[test]
    fn places_values_as_documented() {
        let tree = Tree::new(2000, 2);
        let all: Vec<Item> = tree.walk(None, false, 8, false, false).collect();
        let v = all.iter().find(|i| i.id == "v1234").unwrap();
        assert_eq!(v.parent.as_deref(), Some("f2.123"));
        let f = all.iter().find(|i| i.id == "f2.123").unwrap();
        assert_eq!(f.parent.as_deref(), Some("f1.12"));
        assert_eq!(f.name, "Group 123");
        let top = all.iter().find(|i| i.id == "f1.12").unwrap();
        assert_eq!(top.parent, None);
        // 20 top folders, 200 below them and 2000 values.
        assert_eq!(all.len(), 20 + 200 + 2000);
    }

    #[test]
    fn small_tree_in_order() {
        let tree = Tree::new(12, 1);
        assert_eq!(
            ids(&items(tree, None, false, 8)),
            [
                "f1.0", "v0", "v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8", "v9", "f1.1", "v10",
                "v11"
            ]
        );
    }

    #[test]
    fn depth_zero_is_flat() {
        let all = items(Tree::new(3, 0), None, false, 1);
        assert_eq!(ids(&all), ["v0", "v1", "v2"]);
        assert!(all.iter().all(|i| i.parent.is_none()));
    }

    #[test]
    fn empty_tree() {
        assert!(items(Tree::new(0, 2), None, false, 8).is_empty());
    }

    /// Every id is unique and every parent comes before its children.
    #[test]
    fn ids_are_unique_and_parents_come_first() {
        for (size, depth) in [(0, 2), (1, 2), (99, 1), (1001, 3), (5000, 2), (37, 4)] {
            let all = items(Tree::new(size, depth), None, false, 32);
            let mut seen = HashSet::new();
            for item in &all {
                if let Some(p) = &item.parent {
                    assert!(seen.contains(p.as_str()), "{} before {p}", item.id);
                }
                assert!(seen.insert(item.id.as_str()), "{} twice", item.id);
            }
            let values = all.iter().filter(|i| i.kind == ItemKind::Value).count();
            assert_eq!(values as u64, size);
        }
    }

    /// Each value's address parses, prints as itself, and is unique.
    #[test]
    fn addresses_are_canonical() {
        let all = items(Tree::new(500, 2), None, false, 8);
        let mut seen = HashSet::new();
        for item in all.iter().filter(|i| i.kind == ItemKind::Value) {
            let a = item.address.as_deref().unwrap();
            let parsed = Addr::parse(a).unwrap();
            assert_eq!(parsed.to_string(), a);
            assert!(seen.insert(a.to_owned()), "{a} twice");
        }
        assert_eq!(Tree::address(0).to_string(), "const:1000:0:bd");
        assert_eq!(Tree::address(4).to_string(), "sin:1000:4:ld");
        assert_eq!(Tree::address(8).to_string(), "saw:1000:8:bf");
        assert_eq!(Tree::address(11).to_string(), "saw:1000:11:lf");
        assert_eq!(Tree::address(12).to_string(), "const:1000:12:bd");
    }

    #[test]
    fn types_follow_the_packing() {
        let tree = Tree::new(12, 0);
        let all = items(tree, None, false, 1);
        let t: Vec<_> = all.iter().map(|i| i.r#type.unwrap()).collect();
        assert_eq!(t[0], ScoutType::Double);
        assert_eq!(t[3], ScoutType::Double);
        assert_eq!(t[6], ScoutType::Float);
        assert_eq!(t[9], ScoutType::Float);
    }

    #[test]
    fn depth_cap_marks_folders() {
        let tree = Tree::new(250, 2);
        let mut walk = tree.walk(None, false, 1, false, false);
        let all: Vec<Item> = walk.by_ref().collect();
        assert_eq!(ids(&all), ["f1.0", "f1.1", "f1.2"]);
        assert!(all.iter().all(|i| i.more));
        assert!(walk.depth_capped);

        let mut walk = tree.walk(None, false, 2, false, false);
        let all: Vec<Item> = walk.by_ref().collect();
        assert_eq!(all.len(), 3 + 25);
        assert!(
            all.iter()
                .filter(|i| i.id.starts_with("f2."))
                .all(|i| i.more)
        );
        assert!(walk.depth_capped);

        // Values sit at level 3, so a cap of 3 lists everything.
        let mut walk = tree.walk(None, false, 3, false, false);
        assert_eq!(walk.by_ref().count(), 3 + 25 + 250);
        assert!(!walk.depth_capped);
    }

    #[test]
    fn finds_folders() {
        let tree = Tree::new(250, 2);
        assert_eq!(
            tree.find_folder("f1.2"),
            Some(Folder { level: 1, index: 2 })
        );
        assert_eq!(
            tree.find_folder("f2.24"),
            Some(Folder {
                level: 2,
                index: 24
            })
        );
        for bad in [
            "f1.3",
            "f2.25",
            "f3.0",
            "f0.0",
            "f01.2",
            "f1.02",
            "f1.",
            "f.1",
            "v1",
            "",
            "f1.-1",
            "f1.99999999999999999999",
        ] {
            assert_eq!(tree.find_folder(bad), None, "{bad:?}");
        }
    }

    /// A branch scan lists the folder, then exactly the part of the
    /// full scan under it, with the same ids and parents.
    #[test]
    fn branch_matches_the_full_scan() {
        let tree = Tree::new(2345, 3);
        let full = items(tree, None, false, 32);
        let parents: HashMap<&str, Option<&str>> = full
            .iter()
            .map(|i| (i.id.as_str(), i.parent.as_deref()))
            .collect();
        for root in ["f1.2", "f2.17", "f3.234"] {
            let branch = items(tree, Some(root), true, 32);
            assert_eq!(branch[0].id, root);
            // Everything in the full scan whose chain reaches the root.
            let under: Vec<&Item> = full
                .iter()
                .filter(|i| {
                    let mut id = Some(i.id.as_str());
                    while let Some(x) = id {
                        if x == root {
                            return true;
                        }
                        id = parents[x];
                    }
                    false
                })
                .collect();
            assert_eq!(branch.len(), under.len(), "{root}");
            for (b, f) in branch.iter().zip(under) {
                assert_eq!(b, f, "{root}");
            }
        }
    }

    #[test]
    fn rooted_scan_lists_only_the_children() {
        let tree = Tree::new(250, 2);
        let all = items(tree, Some("f1.2"), false, 1);
        assert_eq!(ids(&all), ["f2.20", "f2.21", "f2.22", "f2.23", "f2.24"]);
        assert!(all.iter().all(|i| i.more));
        let all = items(tree, Some("f2.24"), true, 8);
        assert_eq!(ids(&all)[..3], ["f2.24", "v240", "v241"]);
        assert_eq!(all.len(), 11);
    }

    #[test]
    fn duplicates_repeat_every_tenth_value() {
        let tree = Tree::new(25, 0);
        let all: Vec<Item> = tree.walk(None, false, 1, true, false).collect();
        assert_eq!(all.len(), 28);
        assert_eq!(ids(&all)[..3], ["v0", "v0", "v1"]);
    }

    #[test]
    fn samples_only_when_asked() {
        let tree = Tree::new(8, 0);
        let without: Vec<Item> = tree.walk(None, false, 1, false, false).collect();
        assert!(without.iter().all(|i| i.sample.is_none()));
        let with: Vec<Item> = tree.walk(None, false, 1, false, true).collect();
        // Constants sample as their amplitude.
        assert_eq!(with[0].sample.as_deref(), Some("0"));
        assert_eq!(with[3].sample.as_deref(), Some("3"));
        assert_eq!(with[6].sample.as_deref(), Some("6"));
        assert!(with.iter().all(|i| i.sample.is_some()));
    }

    #[test]
    fn roots_are_checked() {
        let tree = Tree::new(250, 2);
        let req = |root: Option<&str>, folder: Option<&str>| {
            ScoutRequest::new(root, folder, Map::new(), Default::default())
        };
        assert_eq!(find_root(&tree, &req(None, None)).unwrap(), (None, false));
        assert_eq!(
            find_root(&tree, &req(Some("f1.1"), None)).unwrap(),
            (Some(Folder { level: 1, index: 1 }), false)
        );
        assert_eq!(
            find_root(&tree, &req(Some("f1.1"), Some("f1.1"))).unwrap(),
            (Some(Folder { level: 1, index: 1 }), true)
        );
        for (root, folder) in [
            (Some("f1.9"), None),
            (Some("v1"), None),
            (Some("f1.1"), Some("f1.2")),
            (None, Some("f1.1")),
        ] {
            let e = find_root(&tree, &req(root, folder)).unwrap_err();
            assert_eq!(e.code.as_str(), "OPTIONS", "{root:?} {folder:?}");
        }
    }
}

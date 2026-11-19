// ACS OPC UA driver
// Subscriptions: make them, retry what the server refused, count them
// Copyright 2026 University of Sheffield

//! The session's subscriptions. One subscription per poll interval,
//! each with a monitored item per address.
//!
//! What the server refuses is not lost: a subscription the server
//! won't create, or an item it won't monitor (a PLC whose server starts
//! before its program has loaded its nodes answers `BadNodeIdUnknown`),
//! is retried on a timer with a back-off from 5 seconds to 5 minutes,
//! with one log line when an address is refused and one when it
//! recovers. A refusal for one interval leaves the others working.
//!
//! An address that ends in an array index (see `addr.rs`) is asked for
//! as the node it names as written first. Only if the server answers
//! `BadNodeIdUnknown` for that item is it asked for again at once as
//! the node without the suffix with the index range. Which form the
//! server took is kept in [`Forms`] for as long as these subscriptions
//! last, which is until the session reconnects or is replaced, and
//! writes use the same form.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU8, AtomicU64, AtomicUsize, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use opcua::client::{DataChangeCallback, Session};
use opcua::types::{
    AttributeId, DataValue, MonitoredItemCreateRequest, MonitoringMode, MonitoringParameters,
    NodeId, ReadValueId, StatusCode, TimestampsToReturn, Variant,
};
use rs_edge_driver::DriverHandle;

use crate::addr::Addr;
use crate::value;

/// The subscription settings the built-in connection used.
const LIFETIME_COUNT: u32 = 100;
const MAX_KEEP_ALIVE_COUNT: u32 = 10;
const MAX_NOTIFICATIONS_PER_PUBLISH: u32 = 1000;
const QUEUE_SIZE: u32 = 1000;

/// The most monitored items to ask for in one request, when the server
/// doesn't give a lower limit. node-opcua servers accept 1,000.
const ITEMS_PER_REQUEST: usize = 1000;
/// How long a single request may take.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
/// The retry back-off for what the server refused.
const RETRY_FIRST: Duration = Duration::from_secs(5);
const RETRY_MAX: Duration = Duration::from_secs(300);
/// How often to log values dropped because the agent is behind.
const DROP_LOG_EVERY_MS: i64 = 10_000;

/// One OPC UA subscription per poll interval, with the addresses it
/// monitors.
pub type Plan = Vec<(u64, Vec<Addr>)>;

/// Every value dropped because the Edge Agent was not keeping up, in
/// this process. For the tests.
static DROPPED_TOTAL: AtomicU64 = AtomicU64::new(0);

pub fn dropped_total() -> u64 {
    DROPPED_TOTAL.load(Ordering::Relaxed)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Values dropped since the last log line.
#[derive(Default)]
pub struct Dropped {
    since_log: AtomicU64,
    last_log: AtomicI64,
}

impl Dropped {
    fn record(&self) {
        DROPPED_TOTAL.fetch_add(1, Ordering::Relaxed);
        self.since_log.fetch_add(1, Ordering::Relaxed);
        let now = now_ms();
        let last = self.last_log.load(Ordering::Relaxed);
        if now - last >= DROP_LOG_EVERY_MS
            && self
                .last_log
                .compare_exchange(last, now, Ordering::Relaxed, Ordering::Relaxed)
                .is_ok()
        {
            let n = self.since_log.swap(0, Ordering::Relaxed);
            tracing::warn!(
                "the Edge Agent is not keeping up: dropped {n} values since the last report \
                 (the driver keeps at most its publish queue limit waiting)"
            );
        }
    }
}

/// Which form of each address that could name an array element the
/// server was last asked for: the node as written, or the node without
/// the suffix with the index range. Addresses with no element form are
/// not in it.
#[derive(Default)]
pub struct Forms(HashMap<Addr, Form>);

#[derive(Default)]
struct Form {
    /// `UNKNOWN`, `EXACT` or `ELEMENT`.
    asked: AtomicU8,
    /// Whether the address has been logged as having no data because
    /// its index is outside the array.
    warned: AtomicBool,
}

const UNKNOWN: u8 = 0;
const EXACT: u8 = 1;
const ELEMENT: u8 = 2;

impl Forms {
    pub fn new<'a>(addrs: impl IntoIterator<Item = &'a Addr>) -> Self {
        Self(
            addrs
                .into_iter()
                .filter(|a| a.element.is_some())
                .map(|a| (a.clone(), Form::default()))
                .collect(),
        )
    }

    /// Record which form is being asked for. It is recorded before the
    /// request, so a value that arrives at once is read in that form.
    pub fn set(&self, addr: &Addr, element: bool) {
        if let Some(f) = self.0.get(addr) {
            f.asked
                .store(if element { ELEMENT } else { EXACT }, Ordering::SeqCst);
        }
    }

    /// Whether the address was last asked for as an element (`true`),
    /// as the node as written (`false`), or not yet (`None`).
    pub fn element(&self, addr: &Addr) -> Option<bool> {
        if addr.node.is_none() {
            return Some(true);
        }
        match self.0.get(addr)?.asked.load(Ordering::SeqCst) {
            UNKNOWN => None,
            EXACT => Some(false),
            _ => Some(true),
        }
    }

    /// Note whether an element address's index is outside the array
    /// (`outside` is the status that says so), and log it once when it
    /// is and once when it has data again.
    fn outside(&self, addr: &Addr, outside: Option<StatusCode>) {
        let Some(f) = self.0.get(addr) else {
            return;
        };
        match outside {
            Some(s) => {
                if !f.warned.swap(true, Ordering::SeqCst) {
                    tracing::warn!(
                        addr = %addr.raw,
                        "the index is outside the array ({s}); this address gets no data until \
                         the array is big enough"
                    );
                }
            }
            None => {
                if f.warned.swap(false, Ordering::SeqCst) {
                    tracing::info!(addr = %addr.raw, "the array element has data again");
                }
            }
        }
    }
}

/// The status, if it says an index range is outside the array.
fn outside_status(status: Option<StatusCode>) -> Option<StatusCode> {
    status
        .filter(|s| *s == StatusCode::BadIndexRangeNoData || *s == StatusCode::BadIndexRangeInvalid)
}

/// What every subscription's callback needs.
#[derive(Clone)]
pub struct Sink {
    pub handle: DriverHandle<Addr>,
    pub dropped: Arc<Dropped>,
}

/// One interval: its subscription, if made, and the items still to
/// make. Client handles count from 1 within each subscription and
/// survive async-opcua recreating it.
struct Interval {
    ms: u64,
    sub: Option<u32>,
    by_handle: Arc<HashMap<u32, Addr>>,
    pending: Vec<(u32, Addr)>,
}

/// The subscriptions made for a plan, and the task retrying what the
/// server refused.
pub struct Subs {
    pub plan: Plan,
    /// Which form of each element address the server took.
    pub forms: Arc<Forms>,
    /// How many monitored items the session should hold.
    expected: Arc<AtomicUsize>,
    retry: Option<tokio::task::JoinHandle<()>>,
}

impl Drop for Subs {
    fn drop(&mut self) {
        if let Some(t) = self.retry.take() {
            t.abort();
        }
    }
}

impl Subs {
    /// Whether the session still holds every item made so far. After a
    /// reconnect async-opcua moves or remakes the subscriptions, and
    /// leaves out, without saying, any it couldn't.
    pub fn intact(&self, session: &Session) -> bool {
        held(session) == self.expected.load(Ordering::SeqCst)
    }
}

/// How many monitored items the session holds.
fn held(session: &Session) -> usize {
    let state = session.subscription_state().lock();
    state
        .subscription_ids()
        .unwrap_or_default()
        .iter()
        .filter_map(|id| state.get(*id))
        .map(|s| s.monitored_items().count())
        .sum()
}

/// Delete every subscription the session has. After a reconnect
/// async-opcua may have remade them with new ids, so ask the session.
pub async fn delete_all(session: &Session) {
    let ids = session
        .subscription_state()
        .lock()
        .subscription_ids()
        .unwrap_or_default();
    if ids.is_empty() {
        return;
    }
    match tokio::time::timeout(REQUEST_TIMEOUT, session.delete_subscriptions(&ids)).await {
        Ok(Ok(_)) => {}
        Ok(Err(e)) => tracing::warn!("deleting subscriptions failed: {e}"),
        Err(_) => tracing::warn!("deleting subscriptions timed out"),
    }
}

/// The server's limit on monitored items per request
/// (`MaxMonitoredItemsPerCall`), or our own if it gives none.
pub async fn items_per_request(session: &Session) -> usize {
    let id = ReadValueId {
        node_id: NodeId::new(0, 11714u32),
        attribute_id: AttributeId::Value as u32,
        ..Default::default()
    };
    let read = tokio::time::timeout(
        REQUEST_TIMEOUT,
        session.read(&[id], TimestampsToReturn::Neither, 0.0),
    )
    .await;
    let limit = match read {
        Ok(Ok(v)) => match v.first().and_then(|d| d.value.clone()) {
            Some(Variant::UInt32(n)) => n as usize,
            _ => 0,
        },
        _ => 0,
    };
    match limit {
        0 => ITEMS_PER_REQUEST,
        n => n.min(ITEMS_PER_REQUEST),
    }
}

fn callback(
    by_handle: Arc<HashMap<u32, Addr>>,
    forms: Arc<Forms>,
    sink: Sink,
    session: &Session,
) -> DataChangeCallback {
    let ctx = session.context();
    DataChangeCallback::new(move |dv: DataValue, item| {
        let Some(addr) = by_handle.get(&item.client_handle()) else {
            return;
        };
        // The built-in passed on the value whatever its status, and
        // nothing when there was no value.
        let element = match &addr.element {
            Some(e) if forms.element(addr) == Some(true) => Some(e),
            _ => None,
        };
        // An index outside the array comes as a status, with no value
        // or an empty array. Say so once rather than leave the metric
        // silent, and don't publish the empty array.
        if element.is_some() {
            let outside = outside_status(dv.status);
            forms.outside(addr, outside);
            if outside.is_some() {
                return;
            }
        }
        let Some(v) = dv.value else {
            return;
        };
        let v = match element {
            Some(e) if e.single() => value::single_element(v),
            _ => v,
        };
        // async-opcua moves every DateTime it decodes onto our clock
        // when it allows for a server clock that is out
        // (ignore_clock_skew). Values are the server's data, so put
        // them back as the server sent them, as node-opcua gave them.
        let offset = ctx.read().options().client_offset;
        let v = value::undo_clock_offset(v, offset);
        // async-opcua calls this for each value of a notification in
        // one synchronous loop, and try_publish doesn't wait, so a
        // notification's values reach the agent back to back and it can
        // put them in one DDATA. try_publish refuses, rather than
        // queueing without limit, while the agent is behind: the
        // server goes on sending, so waiting would only move the
        // backlog into this process.
        if let Some(p) = value::packet(&v, now_ms())
            && !sink.handle.try_publish(addr.clone(), p.into())
        {
            sink.dropped.record();
        }
    })
}

async fn create_subscription(
    session: &Session,
    iv: &Interval,
    forms: &Arc<Forms>,
    sink: &Sink,
) -> Result<u32, StatusCode> {
    let made = tokio::time::timeout(
        REQUEST_TIMEOUT,
        session.create_subscription(
            Duration::from_millis(iv.ms),
            LIFETIME_COUNT,
            MAX_KEEP_ALIVE_COUNT,
            MAX_NOTIFICATIONS_PER_PUBLISH,
            0,
            true,
            callback(iv.by_handle.clone(), forms.clone(), sink.clone(), session),
        ),
    )
    .await;
    match made {
        Ok(Ok(id)) => Ok(id),
        Ok(Err(e)) => Err(e.status()),
        Err(_) => Err(StatusCode::BadTimeout),
    }
}

/// The node and index range to ask for: the node as written, or for an
/// element address asked for as one, the node without the suffix and
/// the index range.
pub fn read_value_id(a: &Addr, element: bool) -> ReadValueId {
    let (node_id, index_range) = match (&a.node, &a.element) {
        (Some(node), _) if !element => (node.clone(), Default::default()),
        (_, Some(e)) => (e.node.clone(), e.range.clone()),
        _ => unreachable!("planned addresses have a node"),
    };
    ReadValueId {
        node_id,
        attribute_id: AttributeId::Value as u32,
        index_range,
        ..Default::default()
    }
}

/// Ask for monitored items, `per_request` at a time, halving a request
/// the server says is too big. `element` says to ask for element
/// addresses as elements; addresses that are not a node id as written
/// always are. Returns the items it refused, with why, and how many it
/// made.
async fn create_items(
    session: &Session,
    sub: u32,
    ms: u64,
    items: &[(u32, Addr)],
    per_request: usize,
    forms: &Forms,
    element: bool,
) -> (Vec<(u32, Addr, StatusCode)>, usize) {
    let mut refused = Vec::new();
    let mut made = 0;
    let mut todo: Vec<&[(u32, Addr)]> = items.chunks(per_request.max(1)).rev().collect();
    while let Some(chunk) = todo.pop() {
        let requests = chunk
            .iter()
            .map(|(h, a)| {
                let element = element || a.node.is_none();
                forms.set(a, element);
                (h, read_value_id(a, element))
            })
            .map(|(h, item_to_monitor)| MonitoredItemCreateRequest {
                item_to_monitor,
                monitoring_mode: MonitoringMode::Reporting,
                requested_parameters: MonitoringParameters {
                    client_handle: *h,
                    sampling_interval: ms as f64,
                    filter: Default::default(),
                    queue_size: QUEUE_SIZE,
                    discard_oldest: false,
                },
            })
            .collect();
        let result = tokio::time::timeout(
            REQUEST_TIMEOUT,
            session.create_monitored_items(sub, TimestampsToReturn::Both, requests),
        )
        .await;
        match result {
            Ok(Ok(results)) => {
                for ((h, a), r) in chunk.iter().zip(results.iter()) {
                    let status = r.result.status_code;
                    if status.is_good() {
                        made += 1;
                    } else {
                        refused.push((*h, a.clone(), status));
                    }
                }
            }
            Ok(Err(e)) if e.status() == StatusCode::BadTooManyOperations && chunk.len() > 1 => {
                let (a, b) = chunk.split_at(chunk.len() / 2);
                todo.push(b);
                todo.push(a);
            }
            failed => {
                let status = match failed {
                    Ok(Err(e)) => e.status(),
                    _ => StatusCode::BadTimeout,
                };
                refused.extend(chunk.iter().map(|(h, a)| (*h, a.clone(), status)));
            }
        }
    }
    (refused, made)
}

/// Make one interval's subscription and items, or as much of it as the
/// server allows. `first` says whether to log refusals: an address is
/// logged once when it is first refused, not on every retry.
async fn make_interval(
    session: &Session,
    iv: &mut Interval,
    forms: &Arc<Forms>,
    sink: &Sink,
    per_request: usize,
    first: bool,
) -> usize {
    if iv.sub.is_none() {
        match create_subscription(session, iv, forms, sink).await {
            Ok(id) => {
                if !first {
                    tracing::info!("subscription every {} ms made", iv.ms);
                }
                iv.sub = Some(id);
            }
            Err(status) => {
                if first {
                    tracing::error!(
                        "can't make the subscription every {} ms ({status}); its {} addresses \
                         get no data until it can be made, retrying",
                        iv.ms,
                        iv.pending.len(),
                    );
                }
                return 0;
            }
        }
    }
    let sub = iv.sub.expect("just made");
    let (refused, mut made) =
        create_items(session, sub, iv.ms, &iv.pending, per_request, forms, false).await;
    // An address that ends in an array index and is not a node on this
    // server as written is asked for again at once as the array node
    // with the index range.
    let (again, mut refused): (Vec<_>, Vec<_>) = refused.into_iter().partition(|(_, a, s)| {
        *s == StatusCode::BadNodeIdUnknown && a.node.is_some() && a.element.is_some()
    });
    if !again.is_empty() {
        let again: Vec<(u32, Addr)> = again.into_iter().map(|(h, a, _)| (h, a)).collect();
        let (r, m) = create_items(session, sub, iv.ms, &again, per_request, forms, true).await;
        refused.extend(r);
        made += m;
    }
    let still: HashMap<u32, StatusCode> = refused.iter().map(|(h, _, s)| (*h, *s)).collect();
    for (h, a) in &iv.pending {
        match (still.get(h), first) {
            (Some(status), true) => tracing::error!(
                addr = %a.raw,
                "the server won't monitor this address ({status}); it gets no data until \
                 it can, retrying"
            ),
            (None, false) => tracing::info!(addr = %a.raw, "the server now monitors this address"),
            _ => {}
        }
    }
    iv.pending = refused.into_iter().map(|(h, a, _)| (h, a)).collect();
    made
}

/// Read once each address the server now monitors as an array element,
/// to log one whose index is outside the array. Some servers, node-opcua
/// among them, monitor such an element without complaint and then never
/// send a value or a status for it, so without this the metric would be
/// silent with nothing in the log.
async fn check_elements(session: &Session, forms: &Forms, refused: &[&Addr], per_request: usize) {
    let addrs: Vec<&Addr> = forms
        .0
        .keys()
        .filter(|a| forms.element(a) == Some(true) && !refused.contains(a))
        .collect();
    for chunk in addrs.chunks(per_request.max(1)) {
        let ids: Vec<ReadValueId> = chunk.iter().map(|a| read_value_id(a, true)).collect();
        let read = tokio::time::timeout(
            REQUEST_TIMEOUT,
            session.read(&ids, TimestampsToReturn::Neither, 0.0),
        )
        .await;
        let Ok(Ok(values)) = read else {
            return;
        };
        for (a, dv) in chunk.iter().zip(values) {
            if let Some(s) = outside_status(dv.status) {
                forms.outside(a, Some(s));
            }
        }
    }
}

/// Make the subscriptions for a plan, and start retrying whatever the
/// server refused.
pub async fn make(session: Arc<Session>, plan: Plan, sink: Sink) -> Subs {
    let per_request = items_per_request(&session).await;
    let forms = Arc::new(Forms::new(plan.iter().flat_map(|(_, addrs)| addrs)));
    let mut intervals: Vec<Interval> = plan
        .iter()
        .map(|(ms, addrs)| {
            let items: Vec<(u32, Addr)> = addrs
                .iter()
                .enumerate()
                .map(|(i, a)| (i as u32 + 1, a.clone()))
                .collect();
            Interval {
                ms: *ms,
                sub: None,
                by_handle: Arc::new(items.iter().cloned().collect()),
                pending: items,
            }
        })
        .collect();

    let mut made = 0;
    for iv in &mut intervals {
        let total = iv.pending.len();
        made += make_interval(&session, iv, &forms, &sink, per_request, true).await;
        tracing::info!(
            "subscribed to {} of {total} addresses every {} ms",
            total - iv.pending.len(),
            iv.ms
        );
    }

    // Those the server refused are logged already.
    let refused: Vec<&Addr> = intervals
        .iter()
        .flat_map(|iv| iv.pending.iter().map(|(_, a)| a))
        .collect();
    check_elements(&session, &forms, &refused, per_request).await;

    let expected = Arc::new(AtomicUsize::new(made));
    intervals.retain(|iv| !iv.pending.is_empty());
    let retry = (!intervals.is_empty()).then(|| {
        let expected = expected.clone();
        let forms = forms.clone();
        tokio::spawn(async move {
            let mut wait = RETRY_FIRST;
            while !intervals.is_empty() {
                tokio::time::sleep(wait).await;
                wait = (wait * 2).min(RETRY_MAX);
                for iv in &mut intervals {
                    let made = make_interval(&session, iv, &forms, &sink, per_request, false).await;
                    expected.fetch_add(made, Ordering::SeqCst);
                }
                intervals.retain(|iv| !iv.pending.is_empty());
            }
        })
    });

    Subs {
        plan,
        forms,
        expected,
        retry,
    }
}

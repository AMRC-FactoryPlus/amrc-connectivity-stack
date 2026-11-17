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

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicI64, AtomicU64, AtomicUsize, Ordering};
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
        let Some(v) = dv.value else {
            return;
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
            callback(iv.by_handle.clone(), sink.clone(), session),
        ),
    )
    .await;
    match made {
        Ok(Ok(id)) => Ok(id),
        Ok(Err(e)) => Err(e.status()),
        Err(_) => Err(StatusCode::BadTimeout),
    }
}

/// Ask for monitored items, `per_request` at a time, halving a request
/// the server says is too big. Returns the items it refused, with
/// why, and how many it made.
async fn create_items(
    session: &Session,
    sub: u32,
    ms: u64,
    items: &[(u32, Addr)],
    per_request: usize,
) -> (Vec<(u32, Addr, StatusCode)>, usize) {
    let mut refused = Vec::new();
    let mut made = 0;
    let mut todo: Vec<&[(u32, Addr)]> = items.chunks(per_request.max(1)).rev().collect();
    while let Some(chunk) = todo.pop() {
        let requests = chunk
            .iter()
            .map(|(h, a)| MonitoredItemCreateRequest {
                item_to_monitor: ReadValueId {
                    node_id: a.node.clone().expect("planned addresses have a node"),
                    attribute_id: AttributeId::Value as u32,
                    ..Default::default()
                },
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
    sink: &Sink,
    per_request: usize,
    first: bool,
) -> usize {
    if iv.sub.is_none() {
        match create_subscription(session, iv, sink).await {
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
    let (refused, made) = create_items(session, sub, iv.ms, &iv.pending, per_request).await;
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

/// Make the subscriptions for a plan, and start retrying whatever the
/// server refused.
pub async fn make(session: Arc<Session>, plan: Plan, sink: Sink) -> Subs {
    let per_request = items_per_request(&session).await;
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
        made += make_interval(&session, iv, &sink, per_request, true).await;
        tracing::info!(
            "subscribed to {} of {total} addresses every {} ms",
            total - iv.pending.len(),
            iv.ms
        );
    }

    let expected = Arc::new(AtomicUsize::new(made));
    intervals.retain(|iv| !iv.pending.is_empty());
    let retry = (!intervals.is_empty()).then(|| {
        let expected = expected.clone();
        tokio::spawn(async move {
            let mut wait = RETRY_FIRST;
            while !intervals.is_empty() {
                tokio::time::sleep(wait).await;
                wait = (wait * 2).min(RETRY_MAX);
                for iv in &mut intervals {
                    let made = make_interval(&session, iv, &sink, per_request, false).await;
                    expected.fetch_add(made, Ordering::SeqCst);
                }
                intervals.retain(|iv| !iv.pending.is_empty());
            }
        })
    });

    Subs {
        plan,
        expected,
        retry,
    }
}

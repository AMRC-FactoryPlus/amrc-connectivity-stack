// ACS OPC UA driver
// The rs-edge-driver handler: session, subscriptions and writes
// Copyright 2026 University of Sheffield

//! The [`Handler`] that joins an OPC UA session to the driver library.
//!
//! It works as the built-in connection does: one session, values from
//! subscriptions with monitored items sampled and published at each
//! device's poll interval, and writes with the OPC UA Write service.
//! async-opcua keeps the session up: it reconnects with a back-off of
//! 1 to 20 seconds, as node-opcua did for the built-in, and moves or
//! recreates the subscriptions on the new session.

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use futures::StreamExt;
use opcua::client::{
    Client, ClientBuilder, DataChangeCallback, IdentityToken, Password, Session, SessionPollResult,
};
use opcua::crypto::SecurityPolicy;
use opcua::types::{
    AttributeId, DataValue, MonitoredItemCreateRequest, MonitoringMode, MonitoringParameters,
    ReadValueId, StatusCode, TimestampsToReturn, WriteValue as UaWriteValue,
};
use rs_edge_driver::{
    AddrGroup, ConnectError, DriverHandle, Handler, HandlerError, WriteError, WriteValue,
};
use tokio::sync::watch;
use tokio::task::JoinHandle;

use crate::addr::Addr;
use crate::config::Config;
use crate::value::{self, WriteFailure};

/// The subscription settings the built-in connection used.
const LIFETIME_COUNT: u32 = 100;
const MAX_KEEP_ALIVE_COUNT: u32 = 10;
const MAX_NOTIFICATIONS_PER_PUBLISH: u32 = 1000;
const QUEUE_SIZE: u32 = 1000;
/// The publishing interval node-opcua requests when it is given none.
const DEFAULT_INTERVAL_MS: u64 = 1000;

/// node-opcua's default session timeout. It also limits how long a
/// session the server can't hand back after a dropped connection (see
/// README) stays on the server.
const SESSION_TIMEOUT_MS: u32 = 60_000;
/// The secure channel token lifetime to ask for. The client renews the
/// token at 75% of its lifetime measured against the server's clock
/// (upstream issue #289), so a server clock that is out by more than a
/// quarter of the lifetime makes the channel drop and reconnect once
/// per lifetime. An hour tolerates a server clock 15 minutes out.
const CHANNEL_LIFETIME_MS: u32 = 3_600_000;
/// How long `connect` waits for the session before reporting failure.
/// async-opcua keeps trying after that.
const CONNECT_WAIT: Duration = Duration::from_secs(30);
/// How long a single request (GetEndpoints, Write, CreateSubscription)
/// may take.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
/// How many monitored items to create per request. node-opcua servers
/// accept 1,000 by default.
const ITEMS_PER_REQUEST: usize = 1000;

/// The state of the session, as the event loop sees it.
#[derive(Debug, Clone, PartialEq)]
enum State {
    Connecting,
    Up,
    Failed(StatusCode),
}

/// A session and the task running its event loop.
struct Conn {
    session: Arc<Session>,
    state: watch::Receiver<State>,
    task: JoinHandle<()>,
}

/// One OPC UA subscription per poll interval, with the addresses it
/// monitors.
type Plan = Vec<(u64, Vec<Addr>)>;

pub struct OpcuaHandler {
    handle: DriverHandle<Addr>,
    config: Config,
    conn: Option<Conn>,
    /// What the session's subscriptions monitor, once they are made.
    subscribed: Option<Plan>,
}

/// Where the client keeps its certificate and the server certificates
/// it has seen. The built-in connection kept node-opcua's in the
/// agent's `emptyDir`, so it lasted as long as the pod. This lasts as
/// long as the container.
fn pki_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("OPCUA_PKI_DIR") {
        return dir.into();
    }
    match std::env::var_os("HOME") {
        Some(home) => PathBuf::from(home).join("pki"),
        None => std::env::temp_dir().join("edge-opcua-pki"),
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Whether a failed connection is the server refusing who we are,
/// reported as `AUTH`, rather than not reaching it, reported as `CONN`.
fn is_auth_failure(status: StatusCode) -> bool {
    [
        StatusCode::BadUserAccessDenied,
        StatusCode::BadIdentityTokenInvalid,
        StatusCode::BadIdentityTokenRejected,
        StatusCode::BadSecurityChecksFailed,
        StatusCode::BadCertificateUntrusted,
        StatusCode::BadCertificateInvalid,
        StatusCode::BadCertificateRevoked,
        StatusCode::BadCertificateUseNotAllowed,
        StatusCode::BadCertificateTimeInvalid,
        StatusCode::BadSecurityPolicyRejected,
        StatusCode::BadSecurityModeRejected,
    ]
    .contains(&status)
}

fn connect_error(status: StatusCode) -> ConnectError {
    if is_auth_failure(status) {
        ConnectError::AuthFailed
    } else {
        ConnectError::ConnectionFailed
    }
}

/// The subscriptions to make: each address with a node goes in the
/// subscription for the shortest poll interval of the groups it is in.
/// An address in no group, or in a group with no interval, is sampled
/// every second, node-opcua's default.
fn plan(addrs: &[Addr], groups: &[AddrGroup<Addr>]) -> Plan {
    let mut interval: HashMap<&Addr, u64> = HashMap::new();
    for g in groups {
        let ms = match g.poll.as_millis() as u64 {
            0 => DEFAULT_INTERVAL_MS,
            ms => ms,
        };
        for a in &g.addrs {
            interval
                .entry(a)
                .and_modify(|i| *i = (*i).min(ms))
                .or_insert(ms);
        }
    }
    let mut by_interval: BTreeMap<u64, Vec<Addr>> = BTreeMap::new();
    for a in addrs.iter().filter(|a| a.node.is_some()) {
        let ms = interval.get(a).copied().unwrap_or(DEFAULT_INTERVAL_MS);
        by_interval.entry(ms).or_default().push(a.clone());
    }
    by_interval
        .into_iter()
        .map(|(ms, mut addrs)| {
            addrs.sort_by(|a, b| a.raw.cmp(&b.raw));
            (ms, addrs)
        })
        .collect()
}

impl OpcuaHandler {
    fn client(&self) -> Result<Client, ConnectError> {
        let host = std::env::var("HOSTNAME").unwrap_or_else(|_| "localhost".into());
        ClientBuilder::new()
            // The names node-opcua gave the built-in connection.
            .application_name("acs-edge")
            .application_uri(format!("urn:{host}:acs-edge"))
            .product_uri("urn:acs-edge")
            .pki_dir(pki_dir())
            .create_sample_keypair(true)
            // node-opcua accepts any server certificate by default, and
            // the built-in connection left it so.
            .trust_server_certs(true)
            .verify_server_certs(false)
            .session_retry_limit(-1)
            .session_retry_initial(Duration::from_secs(1))
            .session_retry_max(Duration::from_secs(20))
            .recreate_subscriptions(true)
            .session_timeout(SESSION_TIMEOUT_MS)
            .channel_lifetime(CHANNEL_LIFETIME_MS)
            .request_timeout(REQUEST_TIMEOUT)
            .client()
            .map_err(|e| {
                tracing::error!("can't make an OPC UA client: {}", e.join(", "));
                ConnectError::ConnectionFailed
            })
    }

    /// Start a session: ask the server for its endpoints, take the one
    /// with the configured security, and connect to it at the
    /// configured URL. A server can advertise an address the edge
    /// can't reach (behind NAT, say), and node-opcua used the
    /// configured URL too.
    async fn start(&self) -> Result<Conn, ConnectError> {
        let mut client = self.client()?;
        let c = &self.config;

        let endpoints = tokio::time::timeout(
            REQUEST_TIMEOUT,
            client.get_server_endpoints_from_url(c.endpoint.as_str()),
        )
        .await
        .map_err(|_| {
            tracing::warn!(endpoint = %c.endpoint, "no answer to GetEndpoints");
            ConnectError::ConnectionFailed
        })?
        .map_err(|e| {
            tracing::warn!(endpoint = %c.endpoint, "GetEndpoints failed: {e}");
            ConnectError::ConnectionFailed
        })?;

        let Some(mut endpoint) = endpoints.into_iter().find(|e| {
            e.security_mode == c.mode
                && SecurityPolicy::from_uri(e.security_policy_uri.as_ref()) == c.policy
        }) else {
            tracing::error!(
                endpoint = %c.endpoint,
                "the server has no endpoint with security mode {:?} and policy {}",
                c.mode,
                c.policy,
            );
            return Err(ConnectError::ConnectionFailed);
        };
        endpoint.endpoint_url = c.endpoint.as_str().into();

        let identity = match &c.credentials {
            Some((user, pass)) => {
                IdentityToken::UserName(user.clone(), Password::new(pass.clone()))
            }
            None => IdentityToken::Anonymous,
        };
        let (session, event_loop) = client
            .connect_to_endpoint_directly(endpoint, identity)
            .map_err(|e| {
                tracing::error!("can't start a session: {e}");
                ConnectError::ConnectionFailed
            })?;

        let (tx, state) = watch::channel(State::Connecting);
        let handle = self.handle.clone();
        let task = tokio::spawn(async move {
            let mut events = std::pin::pin!(event_loop.enter());
            let mut up = false;
            while let Some(event) = events.next().await {
                match event {
                    Ok(SessionPollResult::Reconnected(mode)) => {
                        tracing::info!("OPC UA session up ({mode:?})");
                        up = true;
                        let _ = tx.send(State::Up);
                    }
                    Ok(SessionPollResult::ConnectionLost(status)) => {
                        tracing::warn!("OPC UA connection lost: {status}");
                        let _ = tx.send(State::Connecting);
                        // Tell the agent, which marks the devices
                        // offline until `connect` says it is back.
                        if std::mem::take(&mut up) {
                            handle.disconnected(ConnectError::ConnectionFailed);
                        }
                    }
                    Ok(SessionPollResult::ReconnectFailed(status)) => {
                        tracing::warn!("OPC UA connection failed: {status}");
                        let _ = tx.send(State::Failed(status));
                    }
                    Ok(_) => {}
                    Err(status) => {
                        tracing::error!("OPC UA session ended: {status}");
                        let _ = tx.send(State::Failed(status));
                        if up {
                            handle.error();
                        }
                        return;
                    }
                }
            }
        });

        Ok(Conn {
            session,
            state,
            task,
        })
    }

    /// Wait for the session to be up, or for an attempt to fail.
    async fn wait_up(state: &mut watch::Receiver<State>) -> Result<(), ConnectError> {
        state.mark_unchanged();
        if *state.borrow() == State::Up {
            return Ok(());
        }
        let wait = async {
            loop {
                if state.changed().await.is_err() {
                    return Err(ConnectError::ConnectionFailed);
                }
                match &*state.borrow_and_update() {
                    State::Up => return Ok(()),
                    State::Failed(s) => return Err(connect_error(*s)),
                    State::Connecting => {}
                }
            }
        };
        tokio::time::timeout(CONNECT_WAIT, wait)
            .await
            .unwrap_or(Err(ConnectError::ConnectionFailed))
    }

    /// Delete every subscription the session has. After a reconnect
    /// async-opcua may have recreated them with new ids, so ask the
    /// session rather than remembering ids.
    async fn unsubscribe(session: &Session) {
        let ids = session
            .subscription_state()
            .lock()
            .subscription_ids()
            .unwrap_or_default();
        if !ids.is_empty() {
            match tokio::time::timeout(REQUEST_TIMEOUT, session.delete_subscriptions(&ids)).await {
                Ok(Ok(_)) => {}
                Ok(Err(e)) => tracing::warn!("deleting subscriptions failed: {e}"),
                Err(_) => tracing::warn!("deleting subscriptions timed out"),
            }
        }
    }

    /// Make one subscription per poll interval. Returns false if the
    /// session refused one; monitored items the server refuses are
    /// logged and left out.
    async fn make_subscriptions(&self, session: &Session, plan: &Plan) -> bool {
        for (interval, addrs) in plan {
            // Client handles count from 1 in each subscription. They
            // survive async-opcua recreating the subscription.
            let by_handle: HashMap<u32, Addr> = addrs
                .iter()
                .enumerate()
                .map(|(i, a)| (i as u32 + 1, a.clone()))
                .collect();
            let handle = self.handle.clone();
            let callback = DataChangeCallback::new(move |dv: DataValue, item| {
                let Some(addr) = by_handle.get(&item.client_handle()) else {
                    return;
                };
                // The built-in passed on the value whatever its status,
                // and nothing when there was no value.
                let Some(v) = dv.value else {
                    return;
                };
                // async-opcua calls this for each value of a
                // notification in one synchronous loop, and `publish`
                // only queues, so a notification's values reach the
                // agent back to back and it can put them in one DDATA.
                // Don't add an await here (publish_wait would).
                if let Some(p) = value::packet(&v, now_ms()) {
                    handle.publish(addr.clone(), p.into());
                }
            });

            let sub = tokio::time::timeout(
                REQUEST_TIMEOUT,
                session.create_subscription(
                    Duration::from_millis(*interval),
                    LIFETIME_COUNT,
                    MAX_KEEP_ALIVE_COUNT,
                    MAX_NOTIFICATIONS_PER_PUBLISH,
                    0,
                    true,
                    callback,
                ),
            )
            .await;
            let sub = match sub {
                Ok(Ok(id)) => id,
                Ok(Err(e)) => {
                    tracing::error!("CreateSubscription at {interval} ms failed: {e}");
                    return false;
                }
                Err(_) => {
                    tracing::error!("CreateSubscription at {interval} ms timed out");
                    return false;
                }
            };

            let items: Vec<(u32, &Addr)> = addrs
                .iter()
                .enumerate()
                .map(|(i, a)| (i as u32 + 1, a))
                .collect();
            let mut created = 0;
            for chunk in items.chunks(ITEMS_PER_REQUEST) {
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
                            sampling_interval: *interval as f64,
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
                        for ((_, addr), r) in chunk.iter().zip(results.iter()) {
                            let status = r.result.status_code;
                            if status.is_good() {
                                created += 1;
                            } else {
                                tracing::error!(addr = %addr.raw, "can't monitor: {status}");
                            }
                        }
                    }
                    Ok(Err(e)) => {
                        tracing::error!("CreateMonitoredItems failed: {e}");
                        return false;
                    }
                    Err(_) => {
                        tracing::error!("CreateMonitoredItems timed out");
                        return false;
                    }
                }
            }
            tracing::info!(
                "subscribed to {created} of {} addresses every {interval} ms",
                addrs.len()
            );
        }
        true
    }
}

#[async_trait]
impl Handler for OpcuaHandler {
    type Addr = Addr;

    /// Values come from subscriptions. The agent also sends a `poll`
    /// for every device at its interval, and reading every node again
    /// each time would double the load on the server for no new data,
    /// so polls are ignored.
    const SUPPORTS_POLL: bool = false;
    const TYPED_WRITES: bool = true;

    fn create(handle: DriverHandle<Addr>, config: serde_json::Value) -> Result<Self, HandlerError> {
        let config = Config::from_json(config).map_err(HandlerError::new)?;
        tracing::info!(
            endpoint = %config.endpoint,
            "OPC UA connection, security {:?} {}, {}",
            config.mode,
            config.policy,
            if config.credentials.is_some() { "with credentials" } else { "anonymous" },
        );
        Ok(Self {
            handle,
            config,
            conn: None,
            subscribed: None,
        })
    }

    fn parse_addr(&self, addr: &str) -> Option<Addr> {
        let parsed = Addr::parse(addr);
        if parsed.node.is_none() {
            tracing::error!("address {addr:?} is not an OPC UA node id; it will get no data");
        }
        Some(parsed)
    }

    /// Start the session, or wait for the running one to reconnect.
    async fn connect(&mut self) -> Result<(), ConnectError> {
        if self.conn.as_ref().is_some_and(|c| c.task.is_finished()) {
            self.close().await;
        }
        if self.conn.is_none() {
            self.conn = Some(self.start().await?);
        }
        let conn = self.conn.as_mut().expect("just set");
        let result = Self::wait_up(&mut conn.state).await;
        if let Err(e) = result {
            tracing::warn!("OPC UA connection not up yet ({e:?}); still trying");
        }
        result
    }

    async fn close(&mut self) {
        self.subscribed = None;
        if let Some(conn) = self.conn.take() {
            conn.session.disable_reconnects();
            let _ = tokio::time::timeout(REQUEST_TIMEOUT, conn.session.disconnect()).await;
            conn.task.abort();
        }
    }

    async fn subscribe_groups(&mut self, addrs: &[Addr], groups: &[AddrGroup<Addr>]) -> bool {
        let plan = plan(addrs, groups);
        if self.subscribed.as_ref() == Some(&plan) {
            // async-opcua carries the subscriptions over a reconnect.
            return true;
        }
        let Some(session) = self.conn.as_ref().map(|c| c.session.clone()) else {
            return false;
        };

        Self::unsubscribe(&session).await;
        self.subscribed = None;
        if self.make_subscriptions(&session, &plan).await {
            self.subscribed = Some(plan);
            true
        } else {
            // Leave nothing half made, and have the library connect
            // and subscribe again.
            Self::unsubscribe(&session).await;
            self.handle.error();
            false
        }
    }

    async fn write(&mut self, addr: &Addr, value: WriteValue) -> Result<(), WriteError> {
        let Some(node) = &addr.node else {
            return Err(WriteError::BadValue(format!(
                "{:?} is not an OPC UA node id",
                addr.raw
            )));
        };
        let variant = value::to_variant(&value).map_err(WriteError::BadValue)?;
        let Some(conn) = &self.conn else {
            return Err(WriteError::Failed("not connected".into()));
        };

        let request = UaWriteValue {
            node_id: node.clone(),
            attribute_id: AttributeId::Value as u32,
            value: DataValue::value_only(variant),
            ..Default::default()
        };
        let result = tokio::time::timeout(REQUEST_TIMEOUT, conn.session.write(&[request])).await;
        let status = match result {
            Ok(Ok(results)) => results
                .first()
                .copied()
                .unwrap_or(StatusCode::BadUnexpectedError),
            Ok(Err(e)) => return Err(WriteError::Failed(e.to_string())),
            Err(_) => return Err(WriteError::Failed("no answer from the server".into())),
        };
        if status.is_good() {
            return Ok(());
        }
        let message = status.to_string();
        Err(match value::write_failure(status) {
            WriteFailure::ReadOnly => WriteError::ReadOnly(message),
            WriteFailure::BadValue => WriteError::BadValue(message),
            WriteFailure::Failed => WriteError::Failed(message),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn a(raw: &str) -> Addr {
        Addr::parse(raw)
    }

    fn group(name: &str, ms: u64, addrs: &[&str]) -> AddrGroup<Addr> {
        AddrGroup::new(
            name,
            Duration::from_millis(ms),
            addrs.iter().map(|s| a(s)).collect(),
        )
    }

    #[test]
    fn one_subscription_per_interval_at_the_fastest() {
        let addrs = [
            a("ns=2;s=A"),
            a("ns=2;s=B"),
            a("ns=2;s=C"),
            a("ns=2;s=D"),
            a("bad"),
        ];
        let groups = [
            group("Slow", 1000, &["ns=2;s=A", "ns=2;s=B"]),
            group("Fast", 100, &["ns=2;s=B", "ns=2;s=C", "bad"]),
        ];
        let p = plan(&addrs, &groups);
        let names: Vec<(u64, Vec<&str>)> = p
            .iter()
            .map(|(ms, v)| (*ms, v.iter().map(|a| a.raw.as_str()).collect()))
            .collect();
        assert_eq!(
            names,
            vec![
                (100, vec!["ns=2;s=B", "ns=2;s=C"]),
                (1000, vec!["ns=2;s=A", "ns=2;s=D"]),
            ]
        );
    }

    /// A device with nothing to read adds no subscription, so the
    /// server is never asked to monitor an empty list (BadNothingToDo,
    /// which crashed the built-in connection's agent).
    #[test]
    fn devices_with_nothing_to_read_add_no_subscription() {
        let groups = [group("Empty", 1000, &[]), group("Bad", 500, &["bad"])];
        assert!(plan(&[], &groups).is_empty());
        assert!(plan(&[a("bad")], &groups).is_empty());
        let p = plan(
            &[a("ns=2;s=A")],
            &[group("A", 1000, &["ns=2;s=A"]), groups[0].clone()],
        );
        assert_eq!(p.len(), 1);
    }
}

// ACS OPC UA driver
// The rs-edge-driver handler: session, subscriptions and writes
// Copyright 2026 University of Sheffield

//! The [`Handler`] that joins an OPC UA session to the driver library.
//!
//! It works as the built-in connection does: one session, values from
//! subscriptions with monitored items sampled and published at each
//! device's poll interval, and writes with the OPC UA Write service.
//! async-opcua keeps the session up: it reconnects with a back-off of
//! 1 to 20 seconds, as node-opcua did for the built-in. After every
//! reconnect the driver makes its subscriptions again once the driver
//! is `UP`, so the server's first notification, with every item's
//! current value, reaches the agent: values that changed while the
//! connection was down are not left stale.

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use async_trait::async_trait;
use futures::StreamExt;
use opcua::client::{Client, ClientBuilder, IdentityToken, Password, Session, SessionPollResult};
use opcua::crypto::SecurityPolicy;
use opcua::types::{
    AttributeId, DataValue, MessageSecurityMode, StatusCode, WriteValue as UaWriteValue,
};
use rs_edge_driver::{
    AddrGroup, ConnectError, DriverHandle, Handler, HandlerError, WriteError, WriteValue,
};
use tokio::sync::watch;
use tokio::task::JoinHandle;

use crate::addr::Addr;
use crate::config::Config;
use crate::subs::{self, Dropped, Plan, Sink, Subs};
use crate::value::{self, WriteFailure};

/// The publishing interval node-opcua requests when it is given none.
const DEFAULT_INTERVAL_MS: u64 = 1000;

/// node-opcua's default session timeout. It also limits how long a
/// session the server can't hand back after a dropped connection (see
/// README) stays on the server.
const SESSION_TIMEOUT_MS: u32 = 60_000;
/// The secure channel token lifetime to ask for: node-opcua's default.
/// The client allows for a server clock that is out
/// (`ignore_clock_skew`), so the token is renewed in time however far
/// out it is. `EDGE_OPCUA_CHANNEL_LIFETIME_MS` overrides it, for the
/// tests.
const CHANNEL_LIFETIME_MS: u32 = 600_000;
/// How long `connect` waits for the session before reporting failure.
/// async-opcua keeps trying after that.
const CONNECT_WAIT: Duration = Duration::from_secs(30);
/// How long a single request (GetEndpoints, Write) may take.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

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
    /// Set by the event loop each time the session reconnects, so the
    /// next `subscribe_groups` makes the subscriptions again.
    reconnected: Arc<AtomicBool>,
}

pub struct OpcuaHandler {
    handle: DriverHandle<Addr>,
    config: Config,
    conn: Option<Conn>,
    /// The session's subscriptions, once they are made.
    subs: Option<Subs>,
    dropped: Arc<Dropped>,
    /// The SHA-1 thumbprint of the client certificate, once it has been
    /// logged. Only connections with security use it.
    thumbprint: Option<String>,
}

/// Where the client keeps its certificate and the server certificates
/// it has seen. The built-in connection kept node-opcua's in the
/// agent's `emptyDir`, so it lasted as long as the pod. The edge-agent
/// chart gives this driver a directory that lasts as long as the pod
/// too, in `DRIVER_STATE_DIR` (the DriverDef's `stateDir`).
/// `OPCUA_PKI_DIR` overrides it. Without either it lasts as long as the
/// container.
fn pki_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("OPCUA_PKI_DIR") {
        return dir.into();
    }
    if let Some(dir) = std::env::var_os("DRIVER_STATE_DIR") {
        return PathBuf::from(dir).join("pki");
    }
    match std::env::var_os("HOME") {
        Some(home) => PathBuf::from(home).join("pki"),
        None => std::env::temp_dir().join("edge-opcua-pki"),
    }
}

fn channel_lifetime() -> u32 {
    std::env::var("EDGE_OPCUA_CHANNEL_LIFETIME_MS")
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|ms| *ms > 0)
        .unwrap_or(CHANNEL_LIFETIME_MS)
}

/// Whether a failed connection is the server refusing who we are,
/// reported as `AUTH`, rather than not reaching it, reported as `CONN`.
/// A Good status only means a refusal on a secure connection (see
/// `is_refusal`).
fn is_auth_failure(status: StatusCode, secure: bool) -> bool {
    if status.is_good() {
        return secure;
    }
    is_refusal(status)
        || [
            StatusCode::BadUserAccessDenied,
            StatusCode::BadIdentityTokenInvalid,
            StatusCode::BadIdentityTokenRejected,
        ]
        .contains(&status)
}

/// Whether a failed attempt to connect is the server refusing the
/// secure channel, which it does when it doesn't trust the client's
/// certificate.
///
/// Some servers, node-opcua among them, send that refusal as a
/// secure-channel message (channel id, security policy, then a
/// ServiceFault with the real status) in a TCP error frame. async-opcua
/// reads the frame as a plain error message, so the channel id becomes
/// the status code and the policy URI the reason: a "Good" status that
/// differs each time, such as `Good, Partial`. A failure is never Good,
/// so a Good status here is that refusal.
fn is_refusal(status: StatusCode) -> bool {
    status.is_good()
        || [
            StatusCode::BadSecurityChecksFailed,
            StatusCode::BadCertificateUntrusted,
            StatusCode::BadCertificateInvalid,
            StatusCode::BadCertificateRevoked,
            StatusCode::BadCertificateUseNotAllowed,
            StatusCode::BadCertificateTimeInvalid,
            StatusCode::BadCertificateHostNameInvalid,
            StatusCode::BadCertificateUriInvalid,
            StatusCode::BadCertificateRevocationUnknown,
            StatusCode::BadCertificateIssuerRevocationUnknown,
            StatusCode::BadCertificateChainIncomplete,
            StatusCode::BadSecurityPolicyRejected,
            StatusCode::BadSecurityModeRejected,
        ]
        .contains(&status)
}

/// The log line for a failed attempt to connect. A secure connection
/// the server refused says that the server may not trust the driver's
/// certificate, which is what a person needs to act on, rather than a
/// status that may be nonsense (see `is_refusal`).
fn failure_message(status: StatusCode, thumbprint: Option<&str>) -> String {
    match thumbprint {
        Some(thumbprint) if is_refusal(status) => {
            let why = if status.is_good() {
                String::new()
            } else {
                format!(" ({status})")
            };
            format!(
                "the OPC UA server refused the secure connection{why}: it may not trust \
                 this driver's certificate, SHA-1 thumbprint {thumbprint}. Look for it in \
                 the server's rejected certificates and trust it there"
            )
        }
        _ if status.is_good() => {
            "OPC UA connection failed: the server closed it without a readable status".into()
        }
        _ => format!("OPC UA connection failed: {status}"),
    }
}

fn connect_error(status: StatusCode, secure: bool) -> ConnectError {
    if is_auth_failure(status, secure) {
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
            .channel_lifetime(channel_lifetime())
            // Time the secure channel token's renewal on our clock, not
            // the server's (upstream issue #289). It also moves every
            // DateTime it decodes onto our clock; subs.rs puts values
            // back as the server sent them.
            .ignore_clock_skew(true)
            .request_timeout(REQUEST_TIMEOUT)
            .client()
            .map_err(|e| {
                tracing::error!("can't make an OPC UA client: {}", e.join(", "));
                ConnectError::ConnectionFailed
            })
    }

    fn secure(&self) -> bool {
        self.config.mode != MessageSecurityMode::None
    }

    /// Log the client certificate's file and SHA-1 thumbprint, once, for
    /// a connection with security, so a person can find the certificate
    /// in the server's rejected list and trust it. The certificate is
    /// made when the first client is, and lasts as long as `pki_dir`.
    fn log_certificate(&mut self, client: &Client) {
        if !self.secure() || self.thumbprint.is_some() {
            return;
        }
        let store = client.certificate_store().read();
        let path = store.own_certificate_path();
        match store.read_own_cert() {
            Ok(cert) => {
                let thumbprint = cert.thumbprint().as_hex_string();
                tracing::info!(
                    "OPC UA client certificate {}, SHA-1 thumbprint {thumbprint}: the server \
                     must trust it for a {:?} connection",
                    path.display(),
                    self.config.mode,
                );
                self.thumbprint = Some(thumbprint);
            }
            Err(e) => tracing::warn!("can't read the OPC UA client certificate: {e}"),
        }
    }

    /// Start a session: ask the server for its endpoints, take the one
    /// with the configured security, and connect to it at the
    /// configured URL. A server can advertise an address the edge
    /// can't reach (behind NAT, say), and node-opcua used the
    /// configured URL too.
    async fn start(&mut self) -> Result<Conn, ConnectError> {
        let mut client = self.client()?;
        self.log_certificate(&client);
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
        let reconnected = Arc::new(AtomicBool::new(false));
        let flag = reconnected.clone();
        let thumbprint = self.thumbprint.clone();
        let task = tokio::spawn(async move {
            let mut events = std::pin::pin!(event_loop.enter());
            let mut up = false;
            while let Some(event) = events.next().await {
                match event {
                    Ok(SessionPollResult::Reconnected(mode)) => {
                        tracing::info!("OPC UA session up ({mode:?})");
                        up = true;
                        // async-opcua has moved or remade the
                        // subscriptions, and the server's first values
                        // went while the driver was not UP, so the
                        // agent never saw them. Make them again.
                        flag.store(true, Ordering::SeqCst);
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
                        tracing::warn!("{}", failure_message(status, thumbprint.as_deref()));
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
            reconnected,
        })
    }

    /// Wait for the session to be up, or for an attempt to fail.
    async fn wait_up(state: &mut watch::Receiver<State>, secure: bool) -> Result<(), ConnectError> {
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
                    State::Failed(s) => return Err(connect_error(*s, secure)),
                    State::Connecting => {}
                }
            }
        };
        tokio::time::timeout(CONNECT_WAIT, wait)
            .await
            .unwrap_or(Err(ConnectError::ConnectionFailed))
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
            subs: None,
            dropped: Arc::default(),
            thumbprint: None,
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
        let secure = self.secure();
        let conn = self.conn.as_mut().expect("just set");
        let result = Self::wait_up(&mut conn.state, secure).await;
        if let Err(e) = result {
            tracing::warn!("OPC UA connection not up yet ({e:?}); still trying");
        }
        result
    }

    async fn close(&mut self) {
        self.subs = None;
        if let Some(conn) = self.conn.take() {
            conn.session.disable_reconnects();
            let _ = tokio::time::timeout(REQUEST_TIMEOUT, conn.session.disconnect()).await;
            conn.task.abort();
        }
    }

    /// Make the subscriptions for the address map. They are kept when
    /// the map is the same, unless the session has reconnected since
    /// or no longer holds every item made: then they are made again,
    /// so the server sends every item's current value. A request the
    /// server refuses doesn't take the connection down: what it refused
    /// is retried (see `subs.rs`).
    async fn subscribe_groups(&mut self, addrs: &[Addr], groups: &[AddrGroup<Addr>]) -> bool {
        let plan = plan(addrs, groups);
        let Some(conn) = self.conn.as_ref() else {
            return false;
        };
        let session = conn.session.clone();
        let reconnected = conn.reconnected.swap(false, Ordering::SeqCst);
        if let Some(subs) = &self.subs
            && subs.plan == plan
            && !reconnected
        {
            if subs.intact(&session) {
                return true;
            }
            tracing::warn!("the session has lost monitored items; making the subscriptions again");
        }

        self.subs = None;
        subs::delete_all(&session).await;
        let sink = Sink {
            handle: self.handle.clone(),
            dropped: self.dropped.clone(),
        };
        self.subs = Some(subs::make(session, plan, sink).await);
        true
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

    /// The statuses async-opcua gave for node-opcua's refusals: the
    /// secure channel id read as a status, so Good with history bits.
    fn garbled() -> [StatusCode; 3] {
        [
            StatusCode::from(2u32),
            StatusCode::from(4u32),
            StatusCode::from(10u32),
        ]
    }

    #[test]
    fn a_good_status_for_a_failure_is_a_refusal_on_a_secure_connection() {
        for s in garbled() {
            assert!(s.is_good(), "{s}");
            assert!(is_refusal(s), "{s}");
            assert!(matches!(connect_error(s, true), ConnectError::AuthFailed));
            assert!(matches!(
                connect_error(s, false),
                ConnectError::ConnectionFailed
            ));
        }
        assert!(matches!(
            connect_error(StatusCode::BadCertificateUntrusted, false),
            ConnectError::AuthFailed
        ));
        assert!(matches!(
            connect_error(StatusCode::BadConnectionClosed, true),
            ConnectError::ConnectionFailed
        ));
        assert!(!is_refusal(StatusCode::BadTimeout));
    }

    #[test]
    fn a_refusal_says_the_server_may_not_trust_the_certificate() {
        let t = "0123456789abcdef0123456789abcdef01234567";
        for s in garbled() {
            let m = failure_message(s, Some(t));
            assert!(m.contains("may not trust") && m.contains(t), "{m}");
            assert!(!m.contains("Good"), "{m}");
            let m = failure_message(s, None);
            assert!(!m.contains("Good") && !m.contains("may not trust"), "{m}");
        }
        let m = failure_message(StatusCode::BadSecurityChecksFailed, Some(t));
        assert!(
            m.contains("may not trust") && m.contains("BadSecurityChecksFailed"),
            "{m}"
        );
        let m = failure_message(StatusCode::BadTimeout, Some(t));
        assert!(
            !m.contains("may not trust") && m.contains("BadTimeout"),
            "{m}"
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

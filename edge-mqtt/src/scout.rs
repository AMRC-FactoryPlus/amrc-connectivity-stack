// ACS MQTT driver
// Edge Scout: list the topics a broker carries by listening for a while
// Copyright 2026 University of Sheffield

//! The [`Scouter`] for MQTT.
//!
//! A scan opens a second, short-lived connection to the device's
//! broker with the same host, TLS and credentials as the driver's own,
//! but its own client id, a clean session and no will, so the driver's
//! session is not taken over. A broker that sets the client id from
//! the login breaks this: mosquitto with `use_username_as_clientid`,
//! or with `use_identity_as_username` for certificate logins, gives
//! the scan the driver's client id and drops the driver's connection.
//! The scan therefore watches the driver's connection and ends with
//! `CONN` as soon as it is lost, so the driver reconnects once instead
//! of the two taking turns until the window closes. It subscribes at QoS 0 to the scan's
//! filters, listens for the window the options set, and lists every
//! topic it heard, with the folders above it and the leaves of JSON
//! payloads. [`crate::survey`] does the listing.
//!
//! An MQTT scan is never exhaustive: a topic that was quiet during the
//! window is missing but not gone.
//!
//! Brokers differ in how they treat a filter the client may not read.
//! mosquitto with an `acl_file` grants every subscription and then
//! leaves out the messages the client may not read, so a scan under a
//! narrow ACL finds fewer topics and can't tell. mosquitto with the
//! dynamic security plugin, and other brokers that check the filter
//! itself, answer the SUBACK with a failure. The scan then ends
//! truncated with the reason `partial_access` when some filters were
//! refused, and with `AUTH` when every filter was.

use std::time::Duration;

use async_trait::async_trait;
use rs_edge_driver::{
    Progress, ScoutEnd, ScoutError, ScoutRequest, ScoutSink, Scouter, Stop, Truncation,
};
use rumqttc::{
    AsyncClient, ConnectReturnCode, ConnectionError, Event, EventLoop, Incoming, QoS,
    SubscribeFilter, SubscribeReasonCode,
};
use tokio::time::Instant;

use std::sync::Arc;

use crate::config::Conf;
use crate::handler::{Lost, client_options};
use crate::survey::{Recorded, ScanOptions, Survey, scout_client_id};

/// The keep-alive of a scan's connection.
const KEEP_ALIVE: Duration = Duration::from_secs(30);

/// Why a scan ends when the driver's own connection drops.
pub const DRIVER_LOST: &str = "The driver lost its own connection to the broker during the scan, \
so the scan stopped to let it reconnect. A broker that sets the client id from the login, \
such as mosquitto with use_username_as_clientid, gives the scan the driver's client id and \
drops the driver. Scanning is not safe on such a broker.";

/// How long the broker has to answer the SUBSCRIBE.
const SUBACK_TIMEOUT: Duration = Duration::from_secs(10);

/// How often the scan reports progress while it listens.
const PROGRESS_EVERY: Duration = Duration::from_secs(1);

/// The most time kept back from the Edge Agent's time cap for sending
/// the items after listening.
const SEND_RESERVE: Duration = Duration::from_secs(5);

/// Items handed to the library at a time, so a cancel is seen between
/// batches.
const ADD_CHUNK: usize = 1000;

/// Lists a broker's topics. One is made for each connection of the
/// driver, and each scan opens its own client.
pub struct MqttScouter {
    conf: Conf,
    /// The driver's own client id, which the scan's id is made from.
    client_id: String,
    /// Set when the driver's own connection is lost.
    lost: Arc<Lost>,
}

impl MqttScouter {
    pub(crate) fn new(conf: Conf, client_id: String, lost: Arc<Lost>) -> Self {
        Self {
            conf,
            client_id,
            lost,
        }
    }

    /// The scan's client id: the one the options give, or one made
    /// from the driver's own.
    fn scan_client_id(&self, opts: &ScanOptions) -> Result<String, ScoutError> {
        match &opts.client_id {
            Some(id) if *id == self.client_id => Err(ScoutError::options(
                "client_id is the driver's own client id, which would disconnect the driver",
            )),
            Some(id) => Ok(id.clone()),
            None => {
                let hex = uuid::Uuid::new_v4().simple().to_string();
                Ok(scout_client_id(&self.client_id, &hex))
            }
        }
    }
}

/// How long to listen: the options' window, less time kept back from
/// the Edge Agent's cap to send the items.
pub fn listen_window(option_seconds: u64, limit_seconds: u64) -> Duration {
    let cap = Duration::from_secs(limit_seconds);
    let reserve = SEND_RESERVE.min(cap / 4);
    Duration::from_secs(option_seconds).min(cap - reserve)
}

/// Which truncation reason a finished scan reports, if any. The item
/// cap comes first, then refused filters, then the depth cap.
pub fn truncation(full: bool, refused: bool, depth: bool) -> Option<Truncation> {
    if full {
        Some(Truncation::Items)
    } else if refused {
        Some(Truncation::PartialAccess)
    } else if depth {
        Some(Truncation::Depth)
    } else {
        None
    }
}

/// What the broker said to the SUBSCRIBE.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Granted {
    All,
    Some,
    None,
}

/// Read a SUBACK's codes.
pub fn granted(codes: &[SubscribeReasonCode]) -> Granted {
    let refused = codes
        .iter()
        .filter(|c| matches!(c, SubscribeReasonCode::Failure))
        .count();
    match refused {
        0 => Granted::All,
        n if n == codes.len() => Granted::None,
        _ => Granted::Some,
    }
}

/// The scan's connection, closed when dropped.
struct Client {
    client: AsyncClient,
    eventloop: EventLoop,
}

impl Client {
    /// Connect, mapping a refusal to `AUTH` and anything else to
    /// `CONN`.
    async fn connect(conf: &Conf, client_id: &str) -> Result<Self, ScoutError> {
        let mut opts = client_options(conf, client_id).map_err(ScoutError::conn)?;
        opts.set_clean_session(true);
        opts.set_keep_alive(KEEP_ALIVE);
        let (client, mut eventloop) = AsyncClient::new(opts, 16);
        match eventloop.poll().await {
            Ok(Event::Incoming(Incoming::ConnAck(_))) => Ok(Self { client, eventloop }),
            Err(ConnectionError::ConnectionRefused(code)) => Err(match code {
                ConnectReturnCode::BadUserNamePassword | ConnectReturnCode::NotAuthorized => {
                    ScoutError::auth(format!(
                        "The broker refused the scan's connection as {client_id}: {code:?}"
                    ))
                }
                ConnectReturnCode::BadClientId => ScoutError::auth(format!(
                    "The broker refused the client id {client_id}. Set client_id in the options."
                )),
                _ => ScoutError::conn(format!(
                    "The broker refused the scan's connection: {code:?}"
                )),
            }),
            Err(e) => Err(ScoutError::conn(format!(
                "The scan could not connect to the broker: {e}"
            ))),
            Ok(event) => Err(ScoutError::conn(format!(
                "Unexpected first packet from the broker: {event:?}"
            ))),
        }
    }

    /// Send DISCONNECT and give it a moment to go.
    async fn close(mut self) {
        if self.client.try_disconnect().is_ok() {
            let _ = tokio::time::timeout(Duration::from_millis(500), async {
                while self.eventloop.poll().await.is_ok() {}
            })
            .await;
        }
    }
}

#[async_trait]
impl Scouter for MqttScouter {
    async fn scout(&self, req: ScoutRequest, sink: ScoutSink) -> Result<ScoutEnd, ScoutError> {
        let opts =
            ScanOptions::from_request(req.root.as_deref(), req.folder_id.as_deref(), &req.options)
                .map_err(ScoutError::options)?;
        let client_id = self.scan_client_id(&opts)?;
        let window = listen_window(opts.seconds, req.limits.seconds);
        let filters = opts.filters.clone();
        let limits = req.limits;
        let mut survey = Survey::new(opts, limits.items, limits.depth, limits.samples);
        let cancel = sink.cancelled();
        if self.lost.is_set() {
            return Err(ScoutError::conn(DRIVER_LOST));
        }

        tracing::info!(
            client_id,
            ?filters,
            seconds = window.as_secs_f64(),
            "scan connecting to the MQTT server"
        );
        let mut client = tokio::select! {
            _ = cancel.cancelled() => return Err(Stop::Cancelled.into()),
            _ = self.lost.wait() => return Err(ScoutError::conn(DRIVER_LOST)),
            c = Client::connect(&self.conf, &client_id) => c?,
        };
        client
            .client
            .subscribe_many(
                filters
                    .iter()
                    .map(|f| SubscribeFilter::new(f.clone(), QoS::AtMostOnce)),
            )
            .await
            .map_err(|e| ScoutError::conn(format!("could not subscribe: {e}")))?;

        // Listen from the SUBACK until the window closes.
        let started = Instant::now();
        let mut listening: Option<Instant> = None;
        let suback_by = started + SUBACK_TIMEOUT;
        let mut refused = false;
        let mut tick = tokio::time::interval(PROGRESS_EVERY);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let outcome: Result<(), ScoutError> = loop {
            let until = listening.map_or(suback_by, |t| t + window);
            tokio::select! {
                biased;
                _ = cancel.cancelled() => break Err(Stop::Cancelled.into()),
                _ = self.lost.wait() => {
                    tracing::warn!("the driver's own connection was lost, ending the scan");
                    break Err(ScoutError::conn(DRIVER_LOST));
                }
                _ = tokio::time::sleep_until(until) => {
                    if listening.is_none() {
                        break Err(ScoutError::conn("The broker did not answer the subscription"));
                    }
                    break Ok(());
                }
                ev = client.eventloop.poll() => match ev {
                    Ok(Event::Incoming(Incoming::Publish(p))) => {
                        let r = survey.record(&p.topic, &p.payload, p.retain, std::time::Instant::now());
                        if r == Recorded::Full {
                            tracing::info!("scan reached its item cap");
                            break Ok(());
                        }
                    }
                    Ok(Event::Incoming(Incoming::SubAck(ack))) if listening.is_none() => {
                        match granted(&ack.return_codes) {
                            Granted::All => {}
                            Granted::Some => {
                                tracing::warn!(codes = ?ack.return_codes, "the broker refused some scan filters");
                                refused = true;
                            }
                            Granted::None => {
                                break Err(ScoutError::auth(
                                    "The broker refused every filter. Give narrower filters.",
                                ));
                            }
                        }
                        listening = Some(Instant::now());
                    }
                    Ok(_) => {}
                    Err(e) => {
                        break Err(ScoutError::conn(format!(
                            "The scan lost its connection to the broker: {e}"
                        )));
                    }
                },
                _ = tick.tick() => {
                    let note = match listening {
                        Some(_) => format!("Listening: {} topics", survey.topics()),
                        None => "Subscribing".to_owned(),
                    };
                    sink.progress(
                        Progress::new(survey.messages())
                            .with_found(survey.items() as u64)
                            .with_note(note),
                    );
                }
            }
        };
        client.close().await;
        outcome?;

        let listened = listening.map_or(Duration::ZERO, |t| t.elapsed());
        tracing::info!(
            messages = survey.messages(),
            topics = survey.topics(),
            items = survey.items(),
            flooded = survey.flooded(),
            inspected_bytes = survey.inspected_bytes(),
            "scan finished listening"
        );
        let reason = truncation(survey.full(), refused, survey.depth_hit());
        let mut items = survey.into_items(listened).into_iter();
        loop {
            let chunk: Vec<_> = items.by_ref().take(ADD_CHUNK).collect();
            if chunk.is_empty() {
                break;
            }
            sink.add(chunk).await?;
        }

        let end = ScoutEnd::new(false);
        Ok(match reason {
            Some(r) => end.truncated(r),
            None => end,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_window_leaves_time_to_send() {
        assert_eq!(listen_window(10, 120), Duration::from_secs(10));
        assert_eq!(listen_window(120, 120), Duration::from_secs(115));
        assert_eq!(listen_window(120, 600), Duration::from_secs(120));
        assert_eq!(listen_window(10, 8), Duration::from_secs(6));
        assert_eq!(listen_window(10, 1), Duration::from_millis(750));
    }

    #[test]
    fn truncation_reasons_in_order() {
        assert_eq!(truncation(false, false, false), None);
        assert_eq!(truncation(true, true, true), Some(Truncation::Items));
        assert_eq!(
            truncation(false, true, true),
            Some(Truncation::PartialAccess)
        );
        assert_eq!(truncation(false, false, true), Some(Truncation::Depth));
    }

    #[test]
    fn suback_codes() {
        let ok = SubscribeReasonCode::Success(QoS::AtMostOnce);
        let no = SubscribeReasonCode::Failure;
        assert_eq!(granted(&[ok, ok]), Granted::All);
        assert_eq!(granted(&[no, ok]), Granted::Some);
        assert_eq!(granted(&[no, no]), Granted::None);
    }

    #[tokio::test]
    async fn lost_wakes_waiters_and_stays_set() {
        let lost = Arc::new(Lost::default());
        assert!(!lost.is_set());
        let waiter = tokio::spawn({
            let lost = lost.clone();
            async move { lost.wait().await }
        });
        tokio::task::yield_now().await;
        assert!(!waiter.is_finished());
        lost.set();
        tokio::time::timeout(Duration::from_secs(1), waiter)
            .await
            .expect("the waiter wakes")
            .unwrap();
        // A wait that starts after the loss returns at once.
        tokio::time::timeout(Duration::from_millis(100), lost.wait())
            .await
            .expect("already set");
    }

    #[test]
    fn the_driver_client_id_is_refused() {
        let conf = Conf::from_json(&serde_json::json!({
            "protocol": "mqtt", "host": "h", "port": 1883, "clientId": "edge",
        }))
        .unwrap();
        let s = MqttScouter::new(conf, "edge".into(), Default::default());
        let mut opts = ScanOptions::from_request(None, None, &Default::default()).unwrap();
        let id = s.scan_client_id(&opts).unwrap();
        assert!(id.starts_with("edge-scout-") && id.len() == 17, "{id}");
        assert_ne!(id, s.scan_client_id(&opts).unwrap(), "ids are random");
        opts.client_id = Some("edge".into());
        assert_eq!(
            s.scan_client_id(&opts).unwrap_err().code,
            rs_edge_driver::ScoutCode::Options
        );
        opts.client_id = Some("other".into());
        assert_eq!(s.scan_client_id(&opts).unwrap(), "other");
    }
}

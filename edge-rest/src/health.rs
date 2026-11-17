// ACS REST driver
// Connection health: CONN or AUTH only when every address is failing
// Copyright 2026 University of Sheffield

//! A REST connection often has several endpoints feeding different
//! devices, and with the built-in connection a failing endpoint only
//! lost its own data. So one failing address leaves the connection up:
//! it gets no data, and its failure is logged once until it recovers.
//! The driver reports `CONN` or `AUTH` only when no address has had a
//! reply for a whole poll round.
//!
//! The driver doesn't see poll rounds: the Edge Agent polls each device
//! on its own timer, and the library calls the driver once per address.
//! So a round is measured: it is the longest time between two polls of
//! any one address, plus [`SLACK`]. The connection is lost when every
//! address is failing and no address has had a reply for longer than a
//! round. An address that hasn't been polled for three of its own gaps
//! is taken to have left the address map and is forgotten.
//!
//! "A reply" is any HTTP reply other than 401 or 403, so a 404 or 500
//! from one endpoint shows the server is there.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use rs_edge_driver::ConnectError;

/// Added to the measured round, for the time a request takes.
pub const SLACK: Duration = Duration::from_secs(1);

/// The round to assume before any address has been polled twice.
const FIRST_ROUND: Duration = Duration::from_secs(1);

/// How an address is failing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Failure {
    /// 401 or 403.
    Auth,
    /// No reply.
    Conn,
}

/// What a read of one address gave, for the health tracker.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Read {
    /// 200, with data.
    Data,
    /// Another status: the server is there, but no data.
    Status(u16),
    /// Nothing usable for another reason, such as a page that isn't
    /// JSON. The server replied.
    NoData,
    Failed(Failure),
}

/// What to do after a read.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Verdict {
    /// Log this read: the address's state has changed since the last
    /// one that was logged.
    pub log: bool,
    /// The address had been failing or giving no data and now gives
    /// data again.
    pub recovered: bool,
    /// Report the connection lost, for this reason.
    pub lost: Option<ConnectError>,
}

#[derive(Debug)]
struct Entry {
    last_poll: Instant,
    /// The time between this address's last two polls.
    gap: Option<Duration>,
    /// The last read, if it didn't give data.
    state: Option<Read>,
}

/// The health of one connection's addresses.
#[derive(Debug)]
pub struct Health {
    /// When any address last got a reply, or when the connection came
    /// up.
    last_reply: Instant,
    addrs: HashMap<String, Entry>,
    /// The connection has been reported lost, and not come up since.
    reported: bool,
}

impl Health {
    pub fn new(now: Instant) -> Self {
        Self {
            last_reply: now,
            addrs: HashMap::new(),
            reported: false,
        }
    }

    /// The connection is up again: start counting from now. Each
    /// address's state is kept, so a failure still logged isn't logged
    /// again.
    pub fn reset(&mut self, now: Instant) {
        self.last_reply = now;
        self.reported = false;
    }

    /// A poll of `addr` is starting.
    pub fn polled(&mut self, addr: &str, now: Instant) {
        match self.addrs.get_mut(addr) {
            Some(e) => {
                e.gap = Some(now.saturating_duration_since(e.last_poll));
                e.last_poll = now;
            }
            None => {
                self.addrs.insert(
                    addr.to_owned(),
                    Entry {
                        last_poll: now,
                        gap: None,
                        state: None,
                    },
                );
            }
        }
        self.addrs.retain(|_, e| {
            let keep_for = e.gap.map_or(Duration::from_secs(60), |g| g * 3 + SLACK);
            now.saturating_duration_since(e.last_poll) <= keep_for
        });
    }

    /// The longest time between two polls of one address, plus
    /// [`SLACK`].
    pub fn round(&self) -> Duration {
        self.addrs
            .values()
            .filter_map(|e| e.gap)
            .max()
            .unwrap_or(FIRST_ROUND)
            + SLACK
    }

    /// A read of `addr` has finished.
    pub fn read(&mut self, addr: &str, read: Read, now: Instant) -> Verdict {
        if !matches!(read, Read::Failed(_)) {
            self.last_reply = now;
        }
        let state = (read != Read::Data).then_some(read);
        let Some(entry) = self.addrs.get_mut(addr) else {
            return Verdict::default();
        };
        let before = std::mem::replace(&mut entry.state, state);
        let mut verdict = Verdict {
            log: before != state && state.is_some(),
            recovered: before.is_some() && state.is_none(),
            lost: None,
        };

        if !self.reported
            && matches!(read, Read::Failed(_))
            && now.saturating_duration_since(self.last_reply) > self.round()
            && self
                .addrs
                .values()
                .all(|e| matches!(e.state, Some(Read::Failed(_))))
        {
            self.reported = true;
            let all_auth = self
                .addrs
                .values()
                .all(|e| e.state == Some(Read::Failed(Failure::Auth)));
            verdict.lost = Some(if all_auth {
                ConnectError::AuthFailed
            } else {
                ConnectError::ConnectionFailed
            });
        }
        verdict
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONN: Read = Read::Failed(Failure::Conn);
    const AUTH: Read = Read::Failed(Failure::Auth);

    /// A clock for the tests.
    struct Clock(Instant);

    impl Clock {
        fn at(&self, ms: u64) -> Instant {
            self.0 + Duration::from_millis(ms)
        }
    }

    /// Poll every address every `every` ms from `from` to `to`, each
    /// read giving what `reads` says, and return the first loss.
    fn run(
        h: &mut Health,
        c: &Clock,
        (from, to, every): (u64, u64, u64),
        reads: &[(&str, Read)],
    ) -> Option<(u64, ConnectError)> {
        let mut t = from;
        while t < to {
            for (a, r) in reads {
                h.polled(a, c.at(t));
                if let Some(lost) = h.read(a, *r, c.at(t + 5)).lost {
                    return Some((t, lost));
                }
            }
            t += every;
        }
        None
    }

    #[test]
    fn one_failing_address_leaves_the_connection_up() {
        let c = Clock(Instant::now());
        let mut h = Health::new(c.at(0));
        let got = run(
            &mut h,
            &c,
            (0, 60_000, 250),
            &[("/a", Read::Data), ("/b", CONN)],
        );
        assert_eq!(got, None);
    }

    /// A 404 is a reply: the server is there.
    #[test]
    fn an_error_status_counts_as_a_reply() {
        let c = Clock(Instant::now());
        let mut h = Health::new(c.at(0));
        let got = run(
            &mut h,
            &c,
            (0, 60_000, 250),
            &[("/a", Read::Status(404)), ("/b", CONN)],
        );
        assert_eq!(got, None);
    }

    #[test]
    fn every_address_failing_loses_the_connection_after_a_round() {
        let c = Clock(Instant::now());
        let mut h = Health::new(c.at(0));
        let got = run(&mut h, &c, (0, 60_000, 250), &[("/a", CONN), ("/b", CONN)]);
        // The round is 250 ms plus a second of slack.
        let (t, why) = got.unwrap();
        assert_eq!(why, ConnectError::ConnectionFailed);
        assert!((1250..=1500).contains(&t), "{t}");
    }

    #[test]
    fn all_auth_failures_give_auth_and_a_mix_gives_conn() {
        let c = Clock(Instant::now());
        let mut h = Health::new(c.at(0));
        let got = run(&mut h, &c, (0, 10_000, 250), &[("/a", AUTH), ("/b", AUTH)]);
        assert_eq!(got.unwrap().1, ConnectError::AuthFailed);

        let mut h = Health::new(c.at(0));
        let got = run(&mut h, &c, (0, 10_000, 250), &[("/a", AUTH), ("/b", CONN)]);
        assert_eq!(got.unwrap().1, ConnectError::ConnectionFailed);
    }

    /// The first failure, before the other address has even been
    /// polled, doesn't lose the connection.
    #[test]
    fn a_failure_at_the_start_waits_for_a_round() {
        let c = Clock(Instant::now());
        let mut h = Health::new(c.at(0));
        h.polled("/a", c.at(0));
        assert_eq!(h.read("/a", CONN, c.at(1)).lost, None);
        h.polled("/b", c.at(10));
        assert_eq!(h.read("/b", Read::Data, c.at(20)).lost, None);
    }

    /// A device polled every 20 s that still works keeps a connection
    /// up while a 250 ms device fails.
    #[test]
    fn a_slow_working_address_keeps_the_connection_up() {
        let c = Clock(Instant::now());
        let mut h = Health::new(c.at(0));
        let mut t = 0;
        while t < 120_000 {
            if t % 20_000 == 0 {
                h.polled("/slow", c.at(t));
                assert_eq!(h.read("/slow", Read::Data, c.at(t + 5)).lost, None);
            }
            h.polled("/fast", c.at(t));
            assert_eq!(h.read("/fast", CONN, c.at(t + 5)).lost, None, "{t}");
            t += 250;
        }
    }

    #[test]
    fn failures_are_logged_once_until_they_recover() {
        let c = Clock(Instant::now());
        let mut h = Health::new(c.at(0));
        let mut logs = Vec::new();
        for (i, r) in [
            CONN,
            CONN,
            CONN,
            Read::Data,
            Read::Data,
            CONN,
            Read::Status(500),
            Read::Status(500),
        ]
        .into_iter()
        .enumerate()
        {
            let t = i as u64 * 100;
            h.polled("/a", c.at(t));
            h.polled("/b", c.at(t));
            h.read("/b", Read::Data, c.at(t));
            let v = h.read("/a", r, c.at(t + 1));
            logs.push((v.log, v.recovered));
        }
        assert_eq!(
            logs,
            [
                (true, false),
                (false, false),
                (false, false),
                (false, true),
                (false, false),
                (true, false),
                (true, false),
                (false, false),
            ]
        );
    }

    #[test]
    fn the_loss_is_reported_once_until_reset() {
        let c = Clock(Instant::now());
        let mut h = Health::new(c.at(0));
        assert!(run(&mut h, &c, (0, 5_000, 250), &[("/a", CONN)]).is_some());
        assert_eq!(run(&mut h, &c, (5_000, 10_000, 250), &[("/a", CONN)]), None);
        h.reset(c.at(10_000));
        let (t, _) = run(&mut h, &c, (10_000, 20_000, 250), &[("/a", CONN)]).unwrap();
        assert!(t >= 11_250, "{t}");
    }

    /// An address that leaves the map stops counting, so the others
    /// decide.
    #[test]
    fn addresses_no_longer_polled_are_forgotten() {
        let c = Clock(Instant::now());
        let mut h = Health::new(c.at(0));
        run(
            &mut h,
            &c,
            (0, 2_000, 250),
            &[("/old", Read::Data), ("/a", CONN)],
        );
        let got = run(&mut h, &c, (2_000, 10_000, 250), &[("/a", CONN)]);
        assert_eq!(got.unwrap().1, ConnectError::ConnectionFailed);
    }
}

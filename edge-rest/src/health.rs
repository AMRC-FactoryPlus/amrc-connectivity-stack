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
//! round.
//!
//! The table holds exactly the addresses in the Edge Agent's current
//! address map, which the handler passes to [`Health::set_addrs`]
//! whenever the map changes. An address is never dropped for not being
//! polled, so a working address polled every few minutes keeps the
//! connection up for as long as it works, and one that has not been
//! polled yet counts as not failing.
//!
//! "A reply" is any HTTP reply other than 401 or 403, so a 404 or 500
//! from one endpoint shows the server is there.

use std::collections::{HashMap, HashSet};
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
    /// JSON or an address that doesn't make a URL. Not the server's
    /// fault, or the server replied.
    NoData,
    /// A 200 reply too large to send to the Edge Agent.
    TooLarge,
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
    /// When it was last polled, if it has been.
    last_poll: Option<Instant>,
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

    /// The Edge Agent's address map has changed: keep exactly these
    /// addresses. An address that has left is forgotten, and a new one
    /// starts out not failing.
    pub fn set_addrs<'a>(&mut self, addrs: impl IntoIterator<Item = &'a str>) {
        let current: HashSet<&str> = addrs.into_iter().collect();
        self.addrs.retain(|a, _| current.contains(a.as_str()));
        for a in current {
            self.addrs.entry(a.to_owned()).or_insert(Entry {
                last_poll: None,
                gap: None,
                state: None,
            });
        }
    }

    /// A poll of `addr` is starting.
    pub fn polled(&mut self, addr: &str, now: Instant) {
        let e = self.addrs.entry(addr.to_owned()).or_insert(Entry {
            last_poll: None,
            gap: None,
            state: None,
        });
        if let Some(last) = e.last_poll {
            e.gap = Some(now.saturating_duration_since(last));
        }
        e.last_poll = Some(now);
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
    fn addresses_that_leave_the_map_are_forgotten() {
        let c = Clock(Instant::now());
        let mut h = Health::new(c.at(0));
        h.set_addrs(["/old", "/a"]);
        run(
            &mut h,
            &c,
            (0, 2_000, 250),
            &[("/old", Read::Data), ("/a", CONN)],
        );
        assert_eq!(run(&mut h, &c, (2_000, 10_000, 250), &[("/a", CONN)]), None);
        h.set_addrs(["/a"]);
        let got = run(&mut h, &c, (10_000, 20_000, 250), &[("/a", CONN)]);
        assert_eq!(got.unwrap().1, ConnectError::ConnectionFailed);
    }

    /// The review's case: a working address polled every 120 s and a
    /// failing one polled every second, over ten minutes. The working
    /// one is never dropped, so the connection stays up throughout.
    #[test]
    fn a_rarely_polled_working_address_is_never_dropped() {
        let c = Clock(Instant::now());
        let mut h = Health::new(c.at(0));
        h.set_addrs(["/slow", "/fast"]);
        let mut t = 0;
        while t < 600_000 {
            if t % 120_000 == 0 {
                h.polled("/slow", c.at(t));
                assert_eq!(h.read("/slow", Read::Data, c.at(t + 5)).lost, None, "{t}");
            }
            h.polled("/fast", c.at(t));
            assert_eq!(h.read("/fast", CONN, c.at(t + 5)).lost, None, "{t}");
            t += 1_000;
        }
    }

    /// An address in the map that hasn't been polled yet isn't failing,
    /// so it holds the connection up until it has been tried.
    #[test]
    fn an_address_not_yet_polled_is_not_failing() {
        let c = Clock(Instant::now());
        let mut h = Health::new(c.at(0));
        h.set_addrs(["/later", "/a"]);
        assert_eq!(run(&mut h, &c, (0, 10_000, 250), &[("/a", CONN)]), None);
        h.polled("/later", c.at(10_000));
        // Once it has been tried and failed too, every address is
        // failing, so this read loses the connection.
        assert_eq!(
            h.read("/later", CONN, c.at(10_005)).lost,
            Some(ConnectError::ConnectionFailed)
        );
    }
}

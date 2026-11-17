//! A fake handler whose behaviour each test sets through [`Ctl`].

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use bytes::Bytes;
use rs_edge_driver::{ConnectError, DriverHandle, Handler, HandlerError, Poller};

use super::{lookup, register};

/// What the fake handler does, and what it has seen.
#[derive(Default)]
pub struct Ctl {
    /// `connect` returns this error while it is set.
    pub connect_error: Mutex<Option<ConnectError>>,
    /// `connect` sleeps this long first.
    pub connect_delay: Mutex<Duration>,
    /// Each poll sleeps this long.
    pub poll_delay: Mutex<Duration>,
    /// Polls return this many bytes instead of the address string.
    pub poll_size: Mutex<Option<usize>>,
    /// Hand out a [`Poller`] so polls can run without the handler lock.
    pub use_poller: AtomicBool,
    /// `cmd` sleeps this long.
    pub cmd_delay: Mutex<Duration>,
    /// `subscribe` returns this (default `true`).
    pub subscribe_fails: AtomicBool,

    pub creates: AtomicUsize,
    pub connects: AtomicUsize,
    pub closes: AtomicUsize,
    pub polls: AtomicUsize,
    pub in_flight: AtomicUsize,
    pub max_in_flight: AtomicUsize,
    pub cmds: Mutex<Vec<(String, Bytes)>>,
    pub subscribed: Mutex<Vec<Vec<String>>>,
    pub handle: Mutex<Option<DriverHandle<String>>>,
}

impl Ctl {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// A `conf` payload that makes the handler use this `Ctl`.
    pub fn conf(self: &Arc<Self>) -> serde_json::Value {
        register(self.clone())
    }

    pub fn handle(&self) -> DriverHandle<String> {
        self.handle.lock().unwrap().clone().expect("no handler yet")
    }

    pub fn count(n: &AtomicUsize) -> usize {
        n.load(Ordering::SeqCst)
    }

    async fn do_poll(&self, addr: &str) -> Option<Bytes> {
        let now = self.in_flight.fetch_add(1, Ordering::SeqCst) + 1;
        self.max_in_flight.fetch_max(now, Ordering::SeqCst);
        let delay = *self.poll_delay.lock().unwrap();
        tokio::time::sleep(delay).await;
        self.in_flight.fetch_sub(1, Ordering::SeqCst);
        self.polls.fetch_add(1, Ordering::SeqCst);
        let size = *self.poll_size.lock().unwrap();
        Some(match size {
            Some(n) => Bytes::from(vec![b'x'; n]),
            None => Bytes::from(addr.to_owned()),
        })
    }
}

pub struct FakeHandler {
    ctl: Arc<Ctl>,
}

struct FakePoller(Arc<Ctl>);

#[async_trait]
impl Poller<String> for FakePoller {
    async fn poll(&self, addr: &String) -> Option<Bytes> {
        self.0.do_poll(addr).await
    }
}

#[async_trait]
impl Handler for FakeHandler {
    type Addr = String;

    fn create(
        handle: DriverHandle<String>,
        config: serde_json::Value,
    ) -> Result<Self, HandlerError> {
        let ctl: Arc<Ctl> = lookup(&config).ok_or_else(|| HandlerError::new("no ctl key"))?;
        ctl.creates.fetch_add(1, Ordering::SeqCst);
        *ctl.handle.lock().unwrap() = Some(handle);
        Ok(Self { ctl })
    }

    fn parse_addr(&self, addr: &str) -> Option<String> {
        (addr != "bad").then(|| addr.to_owned())
    }

    async fn connect(&mut self) -> Result<(), ConnectError> {
        self.ctl.connects.fetch_add(1, Ordering::SeqCst);
        let delay = *self.ctl.connect_delay.lock().unwrap();
        tokio::time::sleep(delay).await;
        match *self.ctl.connect_error.lock().unwrap() {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }

    async fn close(&mut self) {
        self.ctl.closes.fetch_add(1, Ordering::SeqCst);
    }

    async fn poll(&mut self, addr: &String) -> Option<Bytes> {
        self.ctl.do_poll(addr).await
    }

    fn poller(&self) -> Option<Arc<dyn Poller<String>>> {
        if self.ctl.use_poller.load(Ordering::SeqCst) {
            Some(Arc::new(FakePoller(self.ctl.clone())))
        } else {
            None
        }
    }

    async fn subscribe(&mut self, addrs: &[String]) -> bool {
        let mut a = addrs.to_vec();
        a.sort();
        self.ctl.subscribed.lock().unwrap().push(a);
        !self.ctl.subscribe_fails.load(Ordering::SeqCst)
    }

    async fn cmd(&mut self, command: &str, payload: Bytes) {
        let delay = *self.ctl.cmd_delay.lock().unwrap();
        tokio::time::sleep(delay).await;
        self.ctl
            .cmds
            .lock()
            .unwrap()
            .push((command.to_owned(), payload));
    }
}

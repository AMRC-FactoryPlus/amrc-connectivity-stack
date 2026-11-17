// ACS UDP driver
// The socket: receive datagrams, forward them in order, count drops
// Copyright 2026 University of Sheffield

//! The socket side of the driver.
//!
//! One task reads the socket and hands each datagram to the driver
//! library with [`DriverHandle::try_publish`], in the order the kernel
//! delivered them, so they reach the Edge Agent in arrival order.
//!
//! A datagram can be lost in two places, and both are counted:
//!
//! - **in the driver**, when more than the publish queue's limit is
//!   waiting to go to the Edge Agent because the agent is behind. The
//!   datagram is dropped rather than queued without limit, so a slow
//!   agent can't make the driver run out of memory;
//! - **in the kernel**, when the socket's receive buffer is full
//!   because this task is behind. Linux counts these per socket in
//!   `/proc/net/udp`.
//!
//! Every [`REPORT_EVERY`] the driver logs a warning if either count
//! went up, with the totals.

use std::io;
use std::net::{Ipv4Addr, SocketAddrV4};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use bytes::Bytes;
use rs_edge_driver::{ConnectError, DriverHandle};
use socket2::{Domain, Protocol, Socket, Type};
use tokio::net::UdpSocket;
use tokio::task::JoinHandle;

use crate::DATAGRAM_ADDR;

/// How often drops are reported.
pub const REPORT_EVERY: Duration = Duration::from_secs(10);

/// The largest UDP payload over IPv4 is 65,507 bytes.
const MAX_DATAGRAM: usize = 65_536;

/// What the driver has done with the datagrams it received, since it
/// started.
#[derive(Debug, Default)]
pub struct Stats {
    /// Datagrams read from the socket.
    pub received: AtomicU64,
    /// Datagrams handed on to the Edge Agent.
    pub forwarded: AtomicU64,
    /// Datagrams dropped because the queue to the Edge Agent was full.
    pub dropped: AtomicU64,
    /// Datagrams with nowhere to go, because no metric on the
    /// connection has the empty address (or the address map has not
    /// arrived yet). The built-in connection drops these too.
    pub unrouted: AtomicU64,
}

/// A copy of the counters at one moment.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Counts {
    pub received: u64,
    pub forwarded: u64,
    pub dropped: u64,
    pub unrouted: u64,
    /// Dropped by the kernel, where the system reports it.
    pub kernel: Option<u64>,
}

impl Stats {
    pub fn counts(&self) -> Counts {
        Counts {
            received: self.received.load(Ordering::Relaxed),
            forwarded: self.forwarded.load(Ordering::Relaxed),
            dropped: self.dropped.load(Ordering::Relaxed),
            unrouted: self.unrouted.load(Ordering::Relaxed),
            kernel: None,
        }
    }
}

/// Bind a `udp4` socket to `0.0.0.0:port`, as the built-in connection
/// does, with a receive buffer of up to `recv_buffer` bytes. Returns
/// the socket and the buffer size the kernel actually gave it.
///
/// Like the built-in connection, it does not set `SO_REUSEADDR`, so a
/// port another socket holds is refused rather than shared.
pub fn bind(port: u16, recv_buffer: usize) -> io::Result<(UdpSocket, usize)> {
    let sock = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    if let Err(e) = sock.set_recv_buffer_size(recv_buffer) {
        tracing::warn!(%e, recv_buffer, "could not set the receive buffer size");
    }
    let got = sock.recv_buffer_size().unwrap_or(0);
    sock.bind(&SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, port).into())?;
    sock.set_nonblocking(true)?;
    let sock = UdpSocket::from_std(sock.into())?;
    Ok((sock, got))
}

/// The tasks reading a bound socket. Dropping it stops them and closes
/// the socket.
pub struct Receiver {
    reader: JoinHandle<()>,
    reporter: JoinHandle<()>,
    /// The port the socket is bound to.
    pub port: u16,
}

impl Drop for Receiver {
    fn drop(&mut self) {
        self.reader.abort();
        self.reporter.abort();
    }
}

impl Receiver {
    /// Start reading `socket`. Datagrams go to `handle` while `routed`
    /// is set. A socket error reports the connection lost, and the
    /// driver then calls `connect` again, which binds a new socket.
    pub fn start(
        socket: UdpSocket,
        handle: DriverHandle<String>,
        routed: Arc<AtomicBool>,
        stats: Arc<Stats>,
    ) -> io::Result<Self> {
        let port = socket.local_addr()?.port();
        let reader = tokio::spawn(read(socket, handle, routed, stats.clone()));
        let reporter = tokio::spawn(report(port, stats));
        Ok(Self {
            reader,
            reporter,
            port,
        })
    }
}

async fn read(
    socket: UdpSocket,
    handle: DriverHandle<String>,
    routed: Arc<AtomicBool>,
    stats: Arc<Stats>,
) {
    let mut buf = vec![0u8; MAX_DATAGRAM];
    loop {
        let n = match socket.recv(&mut buf).await {
            Ok(n) => n,
            Err(e) => {
                tracing::error!(%e, "UDP socket error, binding again");
                handle.disconnected(ConnectError::ConnectionFailed);
                return;
            }
        };
        stats.received.fetch_add(1, Ordering::Relaxed);
        if !routed.load(Ordering::Relaxed) {
            stats.unrouted.fetch_add(1, Ordering::Relaxed);
            continue;
        }
        let data = Bytes::copy_from_slice(&buf[..n]);
        if handle.try_publish(DATAGRAM_ADDR.to_owned(), data) {
            stats.forwarded.fetch_add(1, Ordering::Relaxed);
        } else {
            stats.dropped.fetch_add(1, Ordering::Relaxed);
        }
    }
}

async fn report(port: u16, stats: Arc<Stats>) {
    let mut tick = tokio::time::interval(REPORT_EVERY);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    tick.tick().await;
    let mut last = Counts {
        kernel: kernel_drops(port),
        ..stats.counts()
    };
    loop {
        tick.tick().await;
        let now = Counts {
            kernel: kernel_drops(port),
            ..stats.counts()
        };
        if let Some(msg) = drop_report(&last, &now) {
            tracing::warn!("{msg}");
        }
        tracing::debug!(port, ?now, "datagram counts");
        last = now;
    }
}

/// A warning naming what was dropped between two readings, or `None`
/// if nothing was.
pub fn drop_report(last: &Counts, now: &Counts) -> Option<String> {
    let queue = now.dropped - last.dropped;
    let kernel = match (last.kernel, now.kernel) {
        (Some(a), Some(b)) => b.saturating_sub(a),
        _ => 0,
    };
    if queue == 0 && kernel == 0 {
        return None;
    }
    Some(format!(
        "dropped {} datagrams in the last {} s ({queue} because the Edge Agent \
         was behind, {kernel} in the kernel because the driver was behind); \
         {} received and {} forwarded in that time. Since start: {} dropped \
         by the driver{}",
        queue + kernel,
        REPORT_EVERY.as_secs(),
        now.received - last.received,
        now.forwarded - last.forwarded,
        now.dropped,
        match now.kernel {
            Some(k) => format!(", {k} by the kernel"),
            None => String::new(),
        },
    ))
}

/// The kernel's count of datagrams dropped on the IPv4 socket bound to
/// `0.0.0.0:port`, from `/proc/net/udp`. `None` where there is no such
/// file (not Linux) or no such socket.
pub fn kernel_drops(port: u16) -> Option<u64> {
    let text = std::fs::read_to_string("/proc/net/udp").ok()?;
    proc_udp_drops(&text, port)
}

/// Read the `drops` column for `0.0.0.0:port` from the text of
/// `/proc/net/udp`.
pub fn proc_udp_drops(text: &str, port: u16) -> Option<u64> {
    let local = format!("00000000:{port:04X}");
    text.lines().skip(1).find_map(|line| {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.get(1) != Some(&local.as_str()) {
            return None;
        }
        cols.last()?.parse().ok()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROC: &str = "   sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode ref pointer drops
  715: 00000000:C41D 00000000:0000 07 00000000:00000000 00:00000000 00000000  1000        0 123456 2 0000000000000000 42
  716: 0100007F:C41D 00000000:0000 07 00000000:00000000 00:00000000 00000000  1000        0 123457 2 0000000000000000 7
";

    #[test]
    fn reads_drops_for_the_wildcard_socket() {
        assert_eq!(proc_udp_drops(PROC, 50205), Some(42));
        assert_eq!(proc_udp_drops(PROC, 50206), None);
        assert_eq!(proc_udp_drops("", 50205), None);
    }

    #[test]
    fn report_only_when_something_dropped() {
        let a = Counts {
            received: 10,
            forwarded: 10,
            kernel: Some(5),
            ..Counts::default()
        };
        assert_eq!(drop_report(&a, &a), None);

        let b = Counts {
            received: 30,
            forwarded: 25,
            dropped: 5,
            kernel: Some(8),
            ..a
        };
        let msg = drop_report(&a, &b).unwrap();
        assert!(msg.starts_with("dropped 8 datagrams"), "{msg}");
        assert!(
            msg.contains("5 because the Edge Agent was behind, 3 in the kernel"),
            "{msg}"
        );
        assert!(msg.contains("20 received and 15 forwarded"), "{msg}");

        let no_kernel = Counts { kernel: None, ..b };
        let msg = drop_report(&Counts { kernel: None, ..a }, &no_kernel).unwrap();
        assert!(msg.starts_with("dropped 5 datagrams"), "{msg}");
    }

    #[tokio::test]
    async fn bind_takes_the_port_and_refuses_a_held_one() {
        let (sock, got) = bind(0, 1 << 20).unwrap();
        assert!(got > 0);
        let port = sock.local_addr().unwrap().port();
        assert!(bind(port, 1 << 20).is_err(), "port {port} bound twice");
    }
}

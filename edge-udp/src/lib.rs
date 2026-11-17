// ACS UDP driver
// Crate root: the parts of the driver, public so the tests can reach them
// Copyright 2026 University of Sheffield

//! A split driver that listens on a UDP port and passes each datagram
//! to the Edge Agent as it arrived, for the agent to parse with the
//! device's payload format. It replaces the Edge Agent's built-in UDP
//! connection (`acs-edge/lib/devices/UDP.ts`) and behaves as it does:
//!
//! - it binds a `udp4` socket to `0.0.0.0` on the configured port;
//! - every datagram goes to the address `""` (the empty string), and
//!   only to that address, so only metrics with an empty address get
//!   data;
//! - it never writes.
//!
//! The parts:
//!
//! - [`config`] reads the connection details;
//! - [`settings`] reads the queue and buffer sizes from the
//!   environment;
//! - [`receiver`] owns the socket, forwards datagrams in order and
//!   counts what it drops;
//! - [`handler`] joins them to `rs-edge-driver`'s `Handler` trait.

pub mod config;
pub mod handler;
pub mod receiver;
pub mod settings;

pub use config::UdpConf;
pub use handler::UdpHandler;
pub use receiver::Stats;

/// The address every datagram is delivered to, as the built-in
/// connection does.
pub const DATAGRAM_ADDR: &str = "";

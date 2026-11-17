// ACS Rust test driver
// Crate root: the parts of the driver, public so the tests can reach them
// Copyright 2026 University of Sheffield

//! A split driver that makes up its data: each address names a wave
//! (constant, sine or sawtooth) and how to pack its value, and every
//! poll returns the wave's value at that moment.
//!
//! This is the Rust port of the JS `edge-test` driver and gives the
//! same bytes for the same address and time. It is also the reference
//! layout for Rust drivers in this repository:
//!
//! - `main.rs` sets up logging and runs the driver, nothing else;
//! - [`addr`] parses address strings, with unit tests;
//! - [`wave`] is the device side, here a pure function of the address
//!   and the time;
//! - [`handler`] joins them to `rs-edge-driver`'s `Handler` trait.

pub mod addr;
pub mod handler;
pub mod wave;

pub use addr::Addr;
pub use handler::{TestHandler, clock};

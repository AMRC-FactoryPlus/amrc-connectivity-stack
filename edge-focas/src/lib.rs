// ACS FOCAS driver
// Crate root: the parts of the driver, public so the tests can reach them
// Copyright 2026 University of Sheffield

//! A split driver for FANUC CNC controls over FOCAS Ethernet.
//!
//! It speaks the FOCAS wire protocol itself, so it needs no FANUC
//! library (`Fwlib32`/`libfwlib32.so`) and runs on any platform.
//!
//! - [`protocol`] is the byte format;
//! - [`addr`] parses address strings, with unit tests;
//! - [`client`] is a connection to one control and the read behind
//!   each address;
//! - [`handler`] joins it to `rs-edge-driver`'s `Handler` trait;

pub mod addr;
pub mod client;
pub mod handler;
pub mod protocol;

pub use addr::Addr;
pub use handler::FocasHandler;

// ACS REST driver
// Crate root: the parts of the driver, public so the tests can reach them
// Copyright 2026 University of Sheffield

//! A split driver for HTTP devices. It replaces the Edge Agent's
//! built-in REST connection and takes the same connection details:
//! each poll GETs `baseURL + address` and passes the body to the Edge
//! Agent as it is, for the agent to parse with the device's payload
//! format.
//!
//! - [`addr`] parses addresses, including `${n:m}` page counters;
//! - [`config`] reads the connection details and builds Basic auth;
//! - [`read`] turns replies into data, `AUTH` or `CONN`, and fetches
//!   pages;
//! - [`http`] is the HTTP client;
//! - [`handler`] joins them to `rs-edge-driver`'s `Handler` trait.

pub mod addr;
pub mod config;
pub mod handler;
pub mod http;
pub mod read;

pub use addr::Addr;
pub use handler::RestHandler;

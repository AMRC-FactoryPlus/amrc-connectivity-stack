// ACS OPC UA driver
// Crate root: the parts of the driver, public so the tests can reach them
// Copyright 2026 University of Sheffield

//! A split driver for OPC UA servers, replacing the Edge Agent's
//! built-in OPC UA connection. It takes the same connection details,
//! subscribes to each address at its device's poll interval, publishes
//! each value as `{"value", "timestamp"}` JSON, and writes typed
//! values.
//!
//! - `main.rs` sets up logging and runs the driver, nothing else;
//! - [`config`] checks the connection details;
//! - [`addr`] parses node ids;
//! - [`value`] turns OPC UA values into data packets and typed writes
//!   into OPC UA values;
//! - [`subs`] makes the subscriptions and retries what the server
//!   refused;
//! - [`scout`] lists the server's address space for the Edge Scout
//!   panel;
//! - [`read`] reads current values for the Edge Scout panel's live
//!   values;
//! - [`handler`] joins them to `rs-edge-driver`'s `Handler` trait.

pub mod addr;
pub mod config;
pub mod handler;
pub mod read;
pub mod scout;
pub mod subs;
pub mod value;

pub use addr::Addr;
pub use handler::OpcuaHandler;
pub use subs::dropped_total;

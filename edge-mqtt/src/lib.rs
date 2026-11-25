// ACS MQTT driver
// Crate root: the parts of the driver, public so the tests can reach them
// Copyright 2026 University of Sheffield

//! A split driver for MQTT devices. It subscribes to each address as a
//! topic on the device's broker and passes every message's payload to
//! the Edge Agent unchanged, as the agent's built-in MQTT connection
//! does.
//!
//! - `main.rs` sets up logging and runs the driver, nothing else;
//! - [`config`] reads the connection details;
//! - [`topics`] works out which topic filters to subscribe to;
//! - [`write`] makes the payload for a write;
//! - [`survey`] turns what a scan heard into scout items;
//! - [`scout`] runs a scan on its own connection to the broker;
//! - [`live`] keeps the last message on the topics the Edge Scout
//!   panel reads;
//! - [`handler`] joins them to `rs-edge-driver`'s `Handler` trait.

pub mod config;
pub mod handler;
pub mod live;
pub mod scout;
pub mod survey;
pub mod topics;
pub mod write;

pub use handler::MqttHandler;

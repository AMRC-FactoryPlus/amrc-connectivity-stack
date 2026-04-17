//! # rs-edge-driver
//!
//! A framework for building Factory+ edge device drivers in Rust.
//!
//! This library handles all communication with the edge agent (MQTT,
//! Sparkplug lifecycle, configuration management). Driver authors only
//! need to implement the [`Handler`] trait to define how to talk to
//! their specific device protocol.
//!
//! # Quick start
//!
//! 1. Implement [`Handler`] for your device type
//! 2. Create a [`DriverConfig`] (typically via [`DriverConfig::from_env`])
//! 3. Construct a [`Driver`] and call [`Driver::run`]
//!
//! ```rust,ignore
//! use async_trait::async_trait;
//! use bytes::Bytes;
//! use rs_edge_driver::*;
//!
//! struct MyHandler { handle: DriverHandle }
//!
//! #[async_trait]
//! impl Handler for MyHandler {
//!     type Addr = String;
//!
//!     fn create(handle: DriverHandle, config: serde_json::Value) -> Result<Self, HandlerError> {
//!         Ok(Self { handle })
//!     }
//!
//!     fn parse_addr(&self, addr: &str) -> Option<String> {
//!         Some(addr.to_string())
//!     }
//!
//!     async fn connect(&mut self) -> Result<(), ConnectError> {
//!         Ok(())
//!     }
//!
//!     async fn poll(&mut self, addr: &String) -> Option<Bytes> {
//!         Some(Bytes::from_static(b"hello"))
//!     }
//!
//!     async fn close(&mut self) {}
//! }
//!
//! #[tokio::main]
//! async fn main() -> Result<(), Error> {
//!     let config = DriverConfig::from_env()?;
//!     let mut driver = Driver::<MyHandler>::new(config);
//!     driver.run().await
//! }
//! ```

mod config;
mod driver;
mod error;
mod handler;
mod status;

pub use config::DriverConfig;
pub use driver::{Driver, DriverHandle};
pub use error::{ConnectError, Error, HandlerError};
pub use handler::Handler;
pub use status::Status;

use std::env;
use std::time::Duration;

use crate::error::Error;

/// The default largest MQTT packet the driver will send or accept,
/// in bytes (16 MiB).
///
/// The Edge Agent sends files of up to 10 MiB to drivers by default
/// (`DRIVER_FILE_LIMIT` in acs-edge), and an `addr` map for a big
/// connection can run to megabytes, so this leaves headroom above
/// both. rumqttc's own default of 10 KiB is far too small.
pub const DEFAULT_MAX_PACKET_SIZE: usize = 16 * 1024 * 1024;

/// Configuration for the driver runtime, specifying how to connect
/// to the edge agent's MQTT broker.
///
/// Build one with [`DriverConfig::from_env`] or [`DriverConfig::new`]
/// and then change any field you need. The struct is
/// `#[non_exhaustive]`, so new fields can be added without breaking
/// drivers.
#[derive(Debug, Clone)]
#[non_exhaustive]
pub struct DriverConfig {
    /// MQTT broker URL (e.g. `mqtt://localhost:1883`).
    pub mqtt_url: String,
    /// Username for MQTT authentication — also used as the driver
    /// identity in `fpEdge1/{id}/...` topics.
    pub username: String,
    /// Password for MQTT authentication.
    pub password: String,
    /// How long to wait before retrying a failed device connection.
    pub reconnect_delay: Duration,
    /// Whether to poll addresses serially (one at a time) rather than
    /// in parallel. Serial mode is needed for protocols like Modbus
    /// that cannot handle concurrent requests.
    pub serial_poll: bool,
    /// How long a single poll may run once it has started, before the
    /// driver gives up on it. Time spent waiting for the handler is
    /// not counted.
    pub poll_timeout: Duration,
    /// MQTT keep-alive interval for the connection to the edge agent.
    /// Must be zero or at least one second.
    pub keep_alive: Duration,
    /// The largest MQTT packet, in bytes, the driver will send or
    /// accept. Defaults to [`DEFAULT_MAX_PACKET_SIZE`].
    pub max_packet_size: usize,
}

impl DriverConfig {
    /// Build a configuration with the given broker details and
    /// defaults for everything else.
    pub fn new(
        mqtt_url: impl Into<String>,
        username: impl Into<String>,
        password: impl Into<String>,
    ) -> Self {
        Self {
            mqtt_url: mqtt_url.into(),
            username: username.into(),
            password: password.into(),
            reconnect_delay: Duration::from_secs(5),
            serial_poll: false,
            poll_timeout: Duration::from_secs(30),
            keep_alive: Duration::from_secs(30),
            max_packet_size: DEFAULT_MAX_PACKET_SIZE,
        }
    }

    /// Build configuration from environment variables:
    /// - `EDGE_MQTT` — broker URL
    /// - `EDGE_USERNAME` — MQTT username / driver identity
    /// - `EDGE_PASSWORD` — MQTT password
    ///
    /// Every other field takes its default, as in [`DriverConfig::new`].
    pub fn from_env() -> Result<Self, Error> {
        Ok(Self::new(
            required_env("EDGE_MQTT")?,
            required_env("EDGE_USERNAME")?,
            required_env("EDGE_PASSWORD")?,
        ))
    }
}

fn required_env(var: &'static str) -> Result<String, Error> {
    env::var(var).map_err(|_| Error::MissingEnv { var })
}

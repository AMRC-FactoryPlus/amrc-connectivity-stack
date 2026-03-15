use std::env;
use std::time::Duration;

use crate::error::Error;

/// Configuration for the driver runtime, specifying how to connect
/// to the edge agent's MQTT broker.
#[derive(Debug, Clone)]
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
}

impl DriverConfig {
    /// Build configuration from environment variables:
    /// - `EDGE_MQTT` — broker URL
    /// - `EDGE_USERNAME` — MQTT username / driver identity
    /// - `EDGE_PASSWORD` — MQTT password
    pub fn from_env() -> Result<Self, Error> {
        Ok(Self {
            mqtt_url: required_env("EDGE_MQTT")?,
            username: required_env("EDGE_USERNAME")?,
            password: required_env("EDGE_PASSWORD")?,
            reconnect_delay: Duration::from_secs(5),
        })
    }
}

fn required_env(var: &'static str) -> Result<String, Error> {
    env::var(var).map_err(|_| Error::MissingEnv { var })
}

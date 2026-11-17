// ACS MQTT driver
// Entry point: set up logging and run the driver
// Copyright 2026 University of Sheffield

use std::time::Duration;

use edge_mqtt::MqttHandler;
use rs_edge_driver::{Driver, DriverConfig, Error, init_logging};

const GIT_VERSION: &str = match option_env!("GIT_VERSION") {
    Some(v) => v,
    None => "unknown",
};

#[tokio::main]
async fn main() -> Result<(), Error> {
    init_logging();
    tracing::info!("edge-mqtt revision {GIT_VERSION}");

    let mut config = DriverConfig::from_env()?;
    // The built-in tries the broker again every 10 seconds.
    config.reconnect_delay = Duration::from_secs(10);
    let mut driver = Driver::<MqttHandler>::new(config);
    driver.run().await
}

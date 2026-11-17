// ACS UDP driver
// Entry point: set up logging and run the driver
// Copyright 2026 University of Sheffield

use edge_udp::{UdpHandler, settings};
use rs_edge_driver::{Driver, DriverConfig, DriverOptions, Error, init_logging};

const GIT_VERSION: &str = match option_env!("GIT_VERSION") {
    Some(v) => v,
    None => "unknown",
};

#[tokio::main]
async fn main() -> Result<(), Error> {
    init_logging();
    tracing::info!("edge-udp revision {GIT_VERSION}");

    let config = DriverConfig::from_env()?;
    let mut options = DriverOptions::default();
    options.publish_queue_bytes = settings::queue_bytes();
    tracing::info!(
        queue_bytes = options.publish_queue_bytes,
        recv_buffer = settings::recv_buffer(),
        "queue and socket buffer sizes"
    );
    let mut driver = Driver::<UdpHandler>::with_options(config, options);
    driver.run().await
}

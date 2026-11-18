// ACS Rust test driver
// Entry point: set up logging and run the driver
// Copyright 2026 University of Sheffield

use edge_test_rs::{TestHandler, clock};
use rs_edge_driver::{Driver, DriverConfig, Error, init_logging};

const GIT_VERSION: &str = match option_env!("GIT_VERSION") {
    Some(v) => v,
    None => "unknown",
};

#[tokio::main]
async fn main() -> Result<(), Error> {
    init_logging();
    clock::start();
    tracing::info!("edge-test-rs revision {GIT_VERSION}");

    let config = DriverConfig::from_env()?;
    let mut driver = Driver::<TestHandler>::new(config);
    driver.run().await
}

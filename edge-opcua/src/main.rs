// ACS OPC UA driver
// Entry point: set up logging and run the driver
// Copyright 2026 University of Sheffield

use edge_opcua::OpcuaHandler;
use rs_edge_driver::{Driver, DriverConfig, Error};

const GIT_VERSION: &str = match option_env!("GIT_VERSION") {
    Some(v) => v,
    None => "unknown",
};

#[tokio::main]
async fn main() -> Result<(), Error> {
    edge_opcua::logging::init();
    tracing::info!("edge-opcua revision {GIT_VERSION}");

    let config = DriverConfig::from_env()?;
    let mut driver = Driver::<OpcuaHandler>::new(config);
    driver.run().await
}

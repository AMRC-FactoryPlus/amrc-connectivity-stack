// ACS FOCAS driver
// Entry point for the fake FANUC control
// Copyright 2026 University of Sheffield

//! Run a fake FANUC control for trying the driver without a machine.
//!
//! ```text
//! focas-sim [LISTEN]      default 0.0.0.0:8193
//! ```
//!
//! Set `RUST_LOG=debug` to log every request and answer.

use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> std::io::Result<()> {
    rs_edge_driver::init_logging();
    let listen = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "0.0.0.0:8193".to_string());
    let listener = TcpListener::bind(&listen).await?;
    tracing::info!("fake FANUC control listening on {}", listener.local_addr()?);
    tokio::select! {
        r = edge_focas::sim::serve(listener) => r,
        _ = tokio::signal::ctrl_c() => Ok(()),
    }
}

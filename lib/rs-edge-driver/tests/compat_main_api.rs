//! The library's public API must stay compatible with what it was on
//! `main` before the split-driver work (commit e5672d2c), because
//! drivers outside this repository build against it.
//!
//! `compat/test_driver_pre_885.rs` is the example driver exactly as it
//! was then. It must compile here unmodified, so if a change breaks
//! it, fix the library, not the copy.

/// The pre-885 example driver, compiled as a module of this test. Its
/// `main` builds a `Driver` from `DriverConfig::from_env` and runs it.
#[allow(dead_code)]
#[path = "compat/test_driver_pre_885.rs"]
mod pre_885_example;

use std::time::Duration;

use rs_edge_driver::{ConnectError, DriverConfig, Error, HandlerError, Status};

/// FNV-1a, to check the copy above hasn't been edited.
fn fnv1a(data: &[u8]) -> u64 {
    data.iter().fold(0xcbf2_9ce4_8422_2325, |h, b| {
        (h ^ u64::from(*b)).wrapping_mul(0x0100_0000_01b3)
    })
}

#[test]
fn example_copy_is_unmodified() {
    let copy = include_bytes!("compat/test_driver_pre_885.rs");
    assert_eq!(
        (copy.len(), fnv1a(copy)),
        (3027, 0x538d_90be_9a7a_a427),
        "tests/compat/test_driver_pre_885.rs must stay identical to \
         `git show e5672d2c:lib/rs-edge-driver/examples/test_driver.rs`"
    );
}

/// Code written against the pre-885 API: a struct-literal config and
/// exhaustive matches on the public enums.
#[test]
fn pre_885_api_shapes_still_compile() {
    let config = DriverConfig {
        mqtt_url: "mqtt://localhost".into(),
        username: "Conn".into(),
        password: "pw".into(),
        reconnect_delay: Duration::from_secs(5),
        serial_poll: false,
    };
    assert_eq!(config.username, "Conn");

    let status = |s: Status| match s {
        Status::Down => "DOWN",
        Status::Ready => "READY",
        Status::Conf => "CONF",
        Status::Addr => "ADDR",
        Status::Conn => "CONN",
        Status::Auth => "AUTH",
        Status::Up => "UP",
    };
    assert_eq!(status(Status::Up), Status::Up.to_string());

    let reason = |e: ConnectError| match e {
        ConnectError::ConnectionFailed => "conn",
        ConnectError::AuthFailed => "auth",
    };
    assert_eq!(reason(ConnectError::AuthFailed), "auth");

    let errors = |e: &Error| match e {
        Error::Mqtt(_) | Error::Config(_) | Error::MissingEnv { .. } | Error::Other(_) => (),
    };
    errors(&Error::Config(HandlerError::new("x")));
}

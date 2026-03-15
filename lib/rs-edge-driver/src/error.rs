use thiserror::Error;

/// Error returned by [`Handler::connect`] to indicate why
/// the connection to the southbound device failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectError {
    /// Could not reach or communicate with the device.
    ConnectionFailed,
    /// Connected but authentication/authorisation was rejected.
    AuthFailed,
}

/// Error returned by [`Handler::create`] when the configuration
/// supplied by the edge agent is invalid or incomplete.
#[derive(Debug, Error)]
#[error("invalid handler configuration: {reason}")]
pub struct HandlerError {
    pub reason: String,
}

impl HandlerError {
    pub fn new(reason: impl Into<String>) -> Self {
        Self {
            reason: reason.into(),
        }
    }
}

/// Top-level errors produced by the driver runtime.
#[derive(Debug, Error)]
pub enum Error {
    #[error("MQTT error: {0}")]
    Mqtt(String),

    #[error("configuration error: {0}")]
    Config(#[from] HandlerError),

    #[error("environment variable {var} not set")]
    MissingEnv { var: &'static str },

    #[error("{0}")]
    Other(String),
}

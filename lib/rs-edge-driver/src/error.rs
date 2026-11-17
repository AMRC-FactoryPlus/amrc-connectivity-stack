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

/// Error returned by [`Handler::write`](crate::Handler::write) when a
/// typed write fails. The driver reports it to the edge agent on
/// `fpEdge1/{id}/err/{data topic}` as the error code, a newline and
/// the message.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum WriteError {
    /// The address can't be written. Reported as `RO`.
    #[error("read-only: {0}")]
    ReadOnly(String),
    /// The value isn't acceptable for the address, for example the
    /// wrong type for the device. Reported as `CMD`.
    #[error("bad value: {0}")]
    BadValue(String),
    /// The write failed for another reason. Reported as `ERR`.
    #[error("write failed: {0}")]
    Failed(String),
}

impl WriteError {
    /// The error code from the protocol's address error table.
    pub fn code(&self) -> &'static str {
        match self {
            Self::ReadOnly(_) => "RO",
            Self::BadValue(_) => "CMD",
            Self::Failed(_) => "ERR",
        }
    }

    /// The message, without the code.
    pub fn message(&self) -> &str {
        match self {
            Self::ReadOnly(m) | Self::BadValue(m) | Self::Failed(m) => m,
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

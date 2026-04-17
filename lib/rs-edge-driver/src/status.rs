use std::fmt;

/// The operational status of the driver, published to
/// `fpEdge1/{id}/status` so the edge agent knows the driver's state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    /// Driver is not connected to MQTT.
    Down,
    /// Connected to MQTT, awaiting configuration from the edge agent.
    Ready,
    /// Received an invalid or unusable device configuration.
    Conf,
    /// Received invalid address mappings.
    Addr,
    /// Handler failed to connect to the southbound device.
    Conn,
    /// Handler connected but authentication was rejected.
    Auth,
    /// Fully operational — connected to the device and ready for data.
    Up,
}

impl fmt::Display for Status {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            Status::Down => "DOWN",
            Status::Ready => "READY",
            Status::Conf => "CONF",
            Status::Addr => "ADDR",
            Status::Conn => "CONN",
            Status::Auth => "AUTH",
            Status::Up => "UP",
        };
        f.write_str(s)
    }
}

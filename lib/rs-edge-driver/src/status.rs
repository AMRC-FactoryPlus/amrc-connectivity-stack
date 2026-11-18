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

/// The status the driver actually tracks and publishes.
///
/// This is [`Status`] plus `ERR`. It is kept private so that adding
/// statuses never changes the public [`Status`] enum, which driver
/// code may match on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum State {
    Down,
    Ready,
    Conf,
    Addr,
    Conn,
    Auth,
    Up,
    /// Some other error, such as a protocol error on the southbound
    /// connection.
    Err,
}

impl From<Status> for State {
    fn from(s: Status) -> Self {
        match s {
            Status::Down => State::Down,
            Status::Ready => State::Ready,
            Status::Conf => State::Conf,
            Status::Addr => State::Addr,
            Status::Conn => State::Conn,
            Status::Auth => State::Auth,
            Status::Up => State::Up,
        }
    }
}

impl fmt::Display for State {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            State::Err => f.write_str("ERR"),
            State::Down => Status::Down.fmt(f),
            State::Ready => Status::Ready.fmt(f),
            State::Conf => Status::Conf.fmt(f),
            State::Addr => Status::Addr.fmt(f),
            State::Conn => Status::Conn.fmt(f),
            State::Auth => Status::Auth.fmt(f),
            State::Up => Status::Up.fmt(f),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{State, Status};

    #[test]
    fn state_prints_as_the_wire_status() {
        assert_eq!(State::Err.to_string(), "ERR");
        assert_eq!(State::from(Status::Up).to_string(), "UP");
        assert_eq!(State::from(Status::Down).to_string(), "DOWN");
    }
}

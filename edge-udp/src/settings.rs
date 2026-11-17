// ACS UDP driver
// Queue and buffer sizes, from the environment
// Copyright 2026 University of Sheffield

//! Sizes that belong to the deployment, not the connection, so they
//! come from the environment and have defaults that need no setting.

use rs_edge_driver::DEFAULT_PUBLISH_QUEUE_BYTES;

/// The receive buffer the driver asks the kernel for, in bytes, unless
/// `UDP_RECV_BUFFER` says otherwise.
///
/// Linux caps it at `net.core.rmem_max` (208 KiB on a stock node) and
/// then doubles it, so on most nodes this gets 416 KiB, twice what the
/// built-in connection's socket gets. A node with a larger
/// `rmem_max` gives up to this.
pub const DEFAULT_RECV_BUFFER: usize = 8 * 1024 * 1024;

/// The receive buffer to ask for: `UDP_RECV_BUFFER`, or
/// [`DEFAULT_RECV_BUFFER`].
pub fn recv_buffer() -> usize {
    from_env("UDP_RECV_BUFFER").unwrap_or(DEFAULT_RECV_BUFFER)
}

/// The most datagram data, in bytes, that may wait to go to the edge
/// agent before the driver drops datagrams: `UDP_QUEUE_BYTES`, or the
/// library's default of 16 MiB.
pub fn queue_bytes() -> usize {
    from_env("UDP_QUEUE_BYTES").unwrap_or(DEFAULT_PUBLISH_QUEUE_BYTES)
}

fn from_env(var: &str) -> Option<usize> {
    let raw = std::env::var(var).ok()?;
    match parse_size(&raw) {
        Some(n) => Some(n),
        None => {
            tracing::warn!(var, value = raw, "not a size in bytes, using the default");
            None
        }
    }
}

/// A positive whole number of bytes.
pub fn parse_size(raw: &str) -> Option<usize> {
    raw.trim().parse::<usize>().ok().filter(|n| *n > 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes() {
        assert_eq!(parse_size("1048576"), Some(1_048_576));
        assert_eq!(parse_size(" 42 "), Some(42));
        assert_eq!(parse_size("0"), None);
        assert_eq!(parse_size("-1"), None);
        assert_eq!(parse_size("1M"), None);
        assert_eq!(parse_size(""), None);
    }
}

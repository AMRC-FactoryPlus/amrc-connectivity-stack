// ACS OPC UA driver
// Logging: the driver library's filter, with async-opcua kept at info
// Copyright 2026 University of Sheffield

//! The log filter. `VERBOSE` works as it does for every Rust driver
//! (`rs_edge_driver::log_filter`), except that async-opcua's crates
//! (`opcua_client`, `opcua_core` and so on) stay at `info` unless
//! `VERBOSE` names them. The edge-agent chart sets `VERBOSE=ALL` by
//! default, and at `debug` async-opcua logs two or three lines for
//! every Publish it sends and one for every monitored item it makes.
//! `VERBOSE=ALL,opcua=debug` or `RUST_LOG` brings them back.

use rs_edge_driver::log_filter;
use tracing_subscriber::EnvFilter;

/// The `tracing` filter for `VERBOSE` and `RUST_LOG`.
pub fn filter(verbose: Option<&str>, rust_log: Option<&str>) -> String {
    let mut filter = log_filter(verbose, rust_log);
    let rust_log = rust_log.is_some_and(|r| !r.trim().is_empty());
    let named = verbose.is_some_and(|v| v.contains("opcua"));
    if !rust_log && !named {
        filter.push_str(",opcua=info");
    }
    filter
}

/// Set up `tracing` output on stdout, as `rs_edge_driver::init_logging`
/// does, with [`filter`].
pub fn init() {
    let verbose = std::env::var("VERBOSE").ok();
    let rust_log = std::env::var("RUST_LOG").ok();
    let filter = filter(verbose.as_deref(), rust_log.as_deref());
    let filter = EnvFilter::try_new(&filter).unwrap_or_else(|e| {
        eprintln!("bad log filter {filter:?} ({e}), using info");
        EnvFilter::new("info")
    });
    let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();
}

#[cfg(test)]
mod tests {
    use super::filter;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tracing_subscriber::layer::{Context, Layer, SubscriberExt};
    use tracing_subscriber::{EnvFilter, Registry};

    /// Counts the events that get through the filter.
    struct Count(Arc<AtomicUsize>);
    impl<S: tracing::Subscriber> Layer<S> for Count {
        fn on_event(&self, _: &tracing::Event<'_>, _: Context<'_, S>) {
            self.0.fetch_add(1, Ordering::Relaxed);
        }
    }

    /// How many of the events `emit` sends `filter` lets through.
    fn logged(filter: &str, emit: impl FnOnce()) -> usize {
        let n = Arc::new(AtomicUsize::new(0));
        let sub = Registry::default()
            .with(EnvFilter::new(filter))
            .with(Count(n.clone()));
        tracing::subscriber::with_default(sub, emit);
        n.load(Ordering::Relaxed)
    }

    fn async_opcua() {
        tracing::debug!(target: "opcua_client::session::services::subscriptions", "publish");
        tracing::debug!(target: "opcua_core::comms", "chunk");
    }

    #[test]
    fn async_opcua_debug_is_off_at_the_chart_default() {
        // The edge-agent chart's default verbosity.
        let f = filter(Some("ALL,!token,!service,!sparkplug"), None);
        assert_eq!(logged(&f, async_opcua), 0);
        assert_eq!(
            logged(
                &f,
                || tracing::info!(target: "opcua_client::session", "connected")
            ),
            1
        );
        assert_eq!(
            logged(&f, || tracing::debug!(target: "edge_opcua::subs", "x")),
            1
        );
    }

    #[test]
    fn verbose_can_turn_async_opcua_debug_on() {
        assert_eq!(
            logged(&filter(Some("ALL,opcua=debug"), None), async_opcua),
            2
        );
        assert_eq!(logged(&filter(Some("opcua_client"), None), async_opcua), 1);
    }

    #[test]
    fn rust_log_wins() {
        assert_eq!(filter(Some("ALL"), Some("debug")), "debug");
        assert_eq!(logged(&filter(Some("ALL"), Some("debug")), async_opcua), 2);
    }

    #[test]
    fn info_without_verbose() {
        let f = filter(None, None);
        assert_eq!(logged(&f, async_opcua), 0);
        assert_eq!(
            logged(&f, || tracing::debug!(target: "edge_opcua::subs", "x")),
            0
        );
    }
}

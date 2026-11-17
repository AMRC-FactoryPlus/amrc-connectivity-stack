use tracing::{Level, Metadata};
use tracing_subscriber::EnvFilter;
use tracing_subscriber::Layer;
use tracing_subscriber::layer::{Context, Filter, SubscriberExt};
use tracing_subscriber::util::SubscriberInitExt;

/// Work out the `tracing` filter for a driver from the `VERBOSE` and
/// `RUST_LOG` environment variables.
///
/// `RUST_LOG`, if set, wins, as it does for any Rust program. Otherwise
/// `VERBOSE` works as it does for the JS edge drivers:
///
/// - unset, empty or `0`: `info`
/// - `1` or `ALL`: `debug` for everything
/// - a comma-separated list of names: `debug` for each named target
///   (for example `rs_edge_driver`), and a name starting with `!`
///   turns that target off. Entries containing `=` are passed through
///   as `tracing` filter directives, so `rs_edge_driver=trace` works.
///
/// [`init_logging`] adds one rule on top: with `VERBOSE`, `debug` and
/// `trace` from downloaded crates only come through for targets
/// `VERBOSE` names.
pub fn log_filter(verbose: Option<&str>, rust_log: Option<&str>) -> String {
    if let Some(r) = rust_log.map(str::trim).filter(|r| !r.is_empty()) {
        return r.to_owned();
    }

    let verbose = verbose.map(str::trim).unwrap_or("");
    let mut directives = vec!["info".to_owned()];
    for item in verbose.split(',').map(str::trim) {
        match item {
            "" | "0" => {}
            "1" | "ALL" | "all" => directives[0] = "debug".to_owned(),
            d if d.contains('=') => directives.push(d.to_owned()),
            d => match d.strip_prefix('!') {
                Some(off) => directives.push(format!("{off}=off")),
                None => directives.push(format!("{d}=debug")),
            },
        }
    }
    directives.join(",")
}

/// The targets `VERBOSE` names for `debug` or more, as a filter that
/// lets nothing else through, or `None` if it names none.
fn named_filter(verbose: &str) -> Option<String> {
    let named: Vec<String> = verbose
        .split(',')
        .map(str::trim)
        .filter(|d| !matches!(*d, "" | "0" | "1" | "ALL" | "all") && !d.starts_with('!'))
        .map(|d| match d.contains('=') {
            true => d.to_owned(),
            false => format!("{d}=debug"),
        })
        .collect();
    (!named.is_empty()).then(|| format!("off,{}", named.join(",")))
}

/// Whether a source file belongs to a crate cargo downloaded: from
/// crates.io or another registry (`$CARGO_HOME/registry/src`) or from
/// git (`$CARGO_HOME/git/checkouts`). The driver's own crate and path
/// dependencies such as this library are built where they are.
fn is_downloaded(file: &str) -> bool {
    let file = file.replace('\\', "/");
    file.contains("/registry/src/") || file.contains("/git/checkouts/")
}

/// Whether to keep an event the `VERBOSE` filter let through.
/// `debug` and `trace` from a downloaded crate are dropped unless
/// `VERBOSE` named its target, because `VERBOSE=ALL` (the edge-agent
/// chart's default) would otherwise pass on every line rumqttc or an
/// OPC UA client logs for each message.
fn keep(level: &Level, file: Option<&str>, named: impl FnOnce() -> bool) -> bool {
    *level <= Level::INFO || !file.is_some_and(is_downloaded) || named()
}

/// The filter [`init_logging`] uses: [`log_filter`], then [`keep`]
/// unless `RUST_LOG` is set.
struct DriverFilter {
    filter: EnvFilter,
    /// Whether to apply [`keep`].
    quiet_downloaded: bool,
    named: Option<EnvFilter>,
}

impl<S> Filter<S> for DriverFilter {
    fn enabled(&self, meta: &Metadata<'_>, cx: &Context<'_, S>) -> bool {
        Filter::<S>::enabled(&self.filter, meta, cx)
            && (!self.quiet_downloaded
                || keep(meta.level(), meta.file(), || {
                    self.named
                        .as_ref()
                        .is_some_and(|n| Filter::<S>::enabled(n, meta, cx))
                }))
    }

    fn max_level_hint(&self) -> Option<tracing::level_filters::LevelFilter> {
        Filter::<S>::max_level_hint(&self.filter)
    }
}

fn env_filter(filter: &str) -> EnvFilter {
    EnvFilter::try_new(filter).unwrap_or_else(|e| {
        eprintln!("bad log filter {filter:?} ({e}), using info");
        EnvFilter::new("info")
    })
}

/// Set up `tracing` output on stdout, with the level taken from
/// `VERBOSE` or `RUST_LOG` as described in [`log_filter`].
///
/// With `VERBOSE`, `debug` and `trace` from crates cargo downloaded
/// (rumqttc, an OPC UA client and so on) only come through for targets
/// `VERBOSE` names, so `VERBOSE=ALL` means `debug` for the driver and
/// this library, and `VERBOSE=ALL,rumqttc` adds rumqttc's. `RUST_LOG`
/// is used as it is.
///
/// Call this once at the start of `main`. It does nothing if a global
/// subscriber is already set.
pub fn init_logging() {
    let verbose = std::env::var("VERBOSE").ok();
    let rust_log = std::env::var("RUST_LOG").ok();
    let filter = env_filter(&log_filter(verbose.as_deref(), rust_log.as_deref()));
    let quiet_downloaded = !rust_log.is_some_and(|r| !r.trim().is_empty());
    let named = named_filter(verbose.as_deref().unwrap_or("")).map(|f| env_filter(&f));
    let filter = DriverFilter {
        filter,
        quiet_downloaded,
        named,
    };
    let _ = tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer().with_filter(filter))
        .try_init();
}

#[cfg(test)]
mod tests {
    use super::{is_downloaded, keep, log_filter, named_filter};
    use tracing::Level;

    #[test]
    fn defaults_to_info() {
        assert_eq!(log_filter(None, None), "info");
        assert_eq!(log_filter(Some(""), None), "info");
        assert_eq!(log_filter(Some("0"), None), "info");
    }

    #[test]
    fn verbose_one_or_all_is_debug() {
        assert_eq!(log_filter(Some("1"), None), "debug");
        assert_eq!(log_filter(Some("ALL"), None), "debug");
    }

    #[test]
    fn verbose_names_targets() {
        assert_eq!(
            log_filter(Some("rs_edge_driver,!rumqttc"), None),
            "info,rs_edge_driver=debug,rumqttc=off"
        );
        assert_eq!(
            log_filter(Some("1,rs_edge_driver=trace"), None),
            "debug,rs_edge_driver=trace"
        );
    }

    #[test]
    fn rust_log_wins() {
        assert_eq!(log_filter(Some("1"), Some("warn")), "warn");
        assert_eq!(log_filter(Some("1"), Some(" ")), "debug");
    }

    #[test]
    fn every_result_parses() {
        for v in ["", "1", "ALL", "a,!b", "x=trace"] {
            let f = log_filter(Some(v), None);
            assert!(tracing_subscriber::EnvFilter::try_new(&f).is_ok(), "{f}");
        }
        for v in ["a", "1,rumqttc", "ALL,opcua=trace,!b"] {
            let f = named_filter(v).unwrap();
            assert!(tracing_subscriber::EnvFilter::try_new(&f).is_ok(), "{f}");
        }
    }

    #[test]
    fn named_targets_only() {
        // The edge-agent chart's default names nothing to turn on.
        assert_eq!(named_filter("ALL,!token,!service,!sparkplug"), None);
        assert_eq!(named_filter(""), None);
        assert_eq!(
            named_filter("ALL,rumqttc,opcua_client=trace"),
            Some("off,rumqttc=debug,opcua_client=trace".to_owned())
        );
    }

    #[test]
    fn downloaded_crates_are_told_apart_by_path() {
        for f in [
            "/usr/local/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rumqttc-0.25.1/src/state.rs",
            "/home/u/.cargo/git/checkouts/async-opcua-77f3d458efc8cdad/cabe0c6/async-opcua-client/src/session/mod.rs",
            r"C:\Users\u\.cargo\registry\src\index.crates.io-x\log-0.4.0\src\lib.rs",
        ] {
            assert!(is_downloaded(f), "{f}");
        }
        for f in [
            "src/handler.rs",
            "/src/lib/rs-edge-driver/src/driver.rs",
            "/repo/lib/rs-edge-driver/src/driver.rs",
            "../lib/rs-edge-driver/src/logging.rs",
        ] {
            assert!(!is_downloaded(f), "{f}");
        }
    }

    const RUMQTTC: Option<&str> =
        Some("/usr/local/cargo/registry/src/index.crates.io-x/rumqttc-0.25.1/src/state.rs");

    #[test]
    fn debug_from_a_downloaded_crate_needs_naming() {
        assert!(!keep(&Level::DEBUG, RUMQTTC, || false));
        assert!(!keep(&Level::TRACE, RUMQTTC, || false));
        assert!(keep(&Level::DEBUG, RUMQTTC, || true));
        assert!(keep(&Level::INFO, RUMQTTC, || false));
        assert!(keep(&Level::WARN, RUMQTTC, || false));
    }

    #[test]
    fn debug_from_the_driver_and_library_is_kept() {
        assert!(keep(&Level::DEBUG, Some("src/handler.rs"), || false));
        assert!(keep(
            &Level::TRACE,
            Some("/src/lib/rs-edge-driver/src/driver.rs"),
            || false
        ));
        assert!(keep(&Level::DEBUG, None, || false));
    }
}

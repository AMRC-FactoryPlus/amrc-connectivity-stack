use tracing_subscriber::EnvFilter;

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

/// Set up `tracing` output on stdout, with the level taken from
/// `VERBOSE` or `RUST_LOG` as described in [`log_filter`].
///
/// Call this once at the start of `main`. It does nothing if a global
/// subscriber is already set.
pub fn init_logging() {
    let verbose = std::env::var("VERBOSE").ok();
    let rust_log = std::env::var("RUST_LOG").ok();
    let filter = log_filter(verbose.as_deref(), rust_log.as_deref());
    let filter = EnvFilter::try_new(&filter).unwrap_or_else(|e| {
        eprintln!("bad log filter {filter:?} ({e}), using info");
        EnvFilter::new("info")
    });
    let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();
}

#[cfg(test)]
mod tests {
    use super::log_filter;

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
    }
}

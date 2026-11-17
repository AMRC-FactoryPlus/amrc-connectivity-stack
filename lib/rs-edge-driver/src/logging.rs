use tracing_subscriber::EnvFilter;

/// Dependencies of this library that stay at `info` when `VERBOSE`
/// turns `debug` on for everything, unless `VERBOSE` names them.
/// rumqttc logs a line at `debug` for every MQTT packet, which is
/// every data message the driver sends.
const QUIET: &[&str] = &["rumqttc"];

/// Work out the `tracing` filter for a driver from the `VERBOSE` and
/// `RUST_LOG` environment variables.
///
/// `RUST_LOG`, if set, wins, as it does for any Rust program. Otherwise
/// `VERBOSE` works as it does for the JS edge drivers:
///
/// - unset, empty or `0`: `info`
/// - `1` or `ALL`: `debug` for everything except rumqttc, which logs
///   every MQTT packet at `debug` and stays at `info`
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
    if directives[0] == "debug" {
        for q in QUIET {
            if !verbose.contains(q) {
                directives.push(format!("{q}=info"));
            }
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
        assert_eq!(log_filter(Some("1"), None), "debug,rumqttc=info");
        assert_eq!(log_filter(Some("ALL"), None), "debug,rumqttc=info");
        // The edge-agent chart's default.
        assert_eq!(
            log_filter(Some("ALL,!token,!service,!sparkplug"), None),
            "debug,token=off,service=off,sparkplug=off,rumqttc=info"
        );
    }

    #[test]
    fn verbose_can_name_rumqttc() {
        assert_eq!(log_filter(Some("ALL,rumqttc"), None), "debug,rumqttc=debug");
        assert_eq!(
            log_filter(Some("1,rumqttc=trace"), None),
            "debug,rumqttc=trace"
        );
        assert_eq!(log_filter(Some("rumqttc"), None), "info,rumqttc=debug");
    }

    #[test]
    fn verbose_names_targets() {
        assert_eq!(
            log_filter(Some("rs_edge_driver,!rumqttc"), None),
            "info,rs_edge_driver=debug,rumqttc=off"
        );
        assert_eq!(
            log_filter(Some("1,rs_edge_driver=trace"), None),
            "debug,rs_edge_driver=trace,rumqttc=info"
        );
    }

    #[test]
    fn rust_log_wins() {
        assert_eq!(log_filter(Some("1"), Some("warn")), "warn");
        assert_eq!(log_filter(Some("1"), Some(" ")), "debug,rumqttc=info");
    }

    #[test]
    fn every_result_parses() {
        for v in ["", "1", "ALL", "a,!b", "x=trace"] {
            let f = log_filter(Some(v), None);
            assert!(tracing_subscriber::EnvFilter::try_new(&f).is_ok(), "{f}");
        }
    }
}

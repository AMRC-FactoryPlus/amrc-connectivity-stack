//! Gap 5: `active OFFLINE` and the README link. ERR is covered in
//! `gap4_conn_events.rs` and VERBOSE by unit tests in `src/logging.rs`.

mod common;

use std::path::Path;

use common::handler::{Ctl, FakeHandler};
use common::{FakeAgent, FromDriver, ms, secs, spawn_driver};

/// OFFLINE: drop the configuration, close the handler and go back to
/// READY. ONLINE afterwards publishes READY so the agent sends conf.
#[tokio::test]
async fn active_offline_closes_handler() {
    let mut agent = FakeAgent::start("Conn").await;
    let _driver = spawn_driver::<FakeHandler>(agent.config());
    let ctl = Ctl::new();

    agent.handshake(ctl.conf(), &[("1", "a")]).await;
    agent.wait_status("UP", secs(5)).await;

    agent.send("active", "OFFLINE");
    tokio::time::sleep(ms(300)).await;
    assert_eq!(Ctl::count(&ctl.closes), 1, "handler not closed");

    // No configuration, so a poll gets nothing back.
    agent.send("poll", "1");
    let events = agent.drain(ms(500)).await;
    assert!(
        !events.iter().any(|e| matches!(e, FromDriver::Data { .. })),
        "data after OFFLINE: {events:?}"
    );

    agent.send("active", "ONLINE");
    agent.wait_status("READY", secs(2)).await;
}

#[test]
fn readme_links_resolve() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let readme = std::fs::read_to_string(root.join("README.md")).unwrap();
    for part in readme.split("](").skip(1) {
        let target = part.split(')').next().unwrap();
        if target.contains("://") || target.starts_with('#') {
            continue;
        }
        let path = target.split('#').next().unwrap();
        assert!(root.join(path).exists(), "README links to missing {target}");
    }
}

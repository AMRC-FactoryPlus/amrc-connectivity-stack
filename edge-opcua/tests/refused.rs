// ACS OPC UA driver
// A server that doesn't trust the driver's certificate
// Copyright 2026 University of Sheffield

//! A server that refuses the driver's client certificate, as one set up
//! by hand does until someone trusts it. The driver must say so in
//! plain words, and log its certificate's thumbprint and file at start,
//! so a person can find it in the server's rejected list. It refuses
//! with a message async-opcua decodes as nonsense (a "Good" status that
//! differs each time), which is all the driver used to log.
//!
//! This runs the driver binary as a child, so the test reads what it
//! logs at its default level, as an Edge Agent pod shows it. Like
//! `opcua.rs` it needs `EDGE_OPCUA_SERVER_TESTS`.

mod support;

use support::*;

#[tokio::test(flavor = "multi_thread")]
async fn a_refused_certificate_is_logged_plainly() {
    if !enabled() {
        return;
    }
    let server = Server::start_with(&[("REJECT_CLIENTS", "1")]).await;
    let mut agent = FakeAgent::start("OPCUA").await;
    let driver = ChildDriver::start(&agent);
    agent.wait_status("READY", secs(10)).await;
    agent.send(
        "conf",
        conf(&server, "SignAndEncrypt", "Basic256Sha256", None).to_string(),
    );
    agent.send("addr", addr_packet(&[node("Double")]));

    // At start: where the certificate is and its thumbprint.
    let cert = driver.state_dir.join("pki/own/cert.der");
    let line = driver
        .wait_line(&["thumbprint", &cert.display().to_string()], secs(30))
        .await;
    let thumbprint = line
        .split(|c: char| !c.is_ascii_hexdigit())
        .find(|w| w.len() == 40)
        .unwrap_or_else(|| panic!("no SHA-1 thumbprint in {line:?}"))
        .to_lowercase();

    // Each refusal says the server may not trust the certificate.
    driver
        .wait_line(&["may not trust", &thumbprint], secs(60))
        .await;
    agent.wait_status("AUTH", secs(60)).await;

    // The thumbprint is the one the server filed the certificate under.
    let rejected: Vec<String> = std::fs::read_dir(server.pki().join("server/rejected"))
        .expect("the server rejected nothing")
        .map(|e| e.unwrap().file_name().to_string_lossy().to_lowercase())
        .collect();
    assert!(
        rejected.iter().any(|f| f.contains(&thumbprint)),
        "{thumbprint} is not in the server's rejected list {rejected:?}"
    );
    // Nothing that reads as a Good status for a failure.
    eprintln!("{}", driver.log().join("\n"));
    for l in driver.log() {
        assert!(
            !(l.contains("connection failed") && l.contains("Good")),
            "{l}"
        );
    }
}

/// A connection with security mode None logs no certificate: it doesn't
/// use one.
#[tokio::test(flavor = "multi_thread")]
async fn no_certificate_line_without_security() {
    if !enabled() {
        return;
    }
    let server = Server::start().await;
    let mut agent = FakeAgent::start("OPCUA").await;
    let driver = ChildDriver::start(&agent);
    agent.wait_status("READY", secs(10)).await;
    agent.send("conf", conf(&server, "None", "None", None).to_string());
    agent.send("addr", addr_packet(&[node("Double")]));
    agent.wait_status("UP", secs(30)).await;
    values(&mut agent, &["t0"], secs(10)).await;
    for l in driver.log() {
        assert!(!l.contains("thumbprint"), "{l}");
    }
}

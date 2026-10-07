/*
 * AMRC InfluxDB UNS Historian
 * Tests for the connection watchdog
 * Copyright 2026 AMRC
 *
 * Run with `npm test` (Node 22.18 or later strips the TypeScript
 * types from src/Utils/watchdog.ts itself).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    ConnectionWatchdog, DEFAULT_CONNECT_TIMEOUT_S,
    describeConnectionChange, describeConnectionTimeout,
    parseConnectTimeout, parseStallTimeout, parseTimeoutSeconds,
    subscriptionOutcome,
} from "../src/Utils/watchdog.ts";

const T = 300_000;

/* A connection watchdog on a fake clock. */
function fake (timeoutMs = T) {
    let t = 1_000_000;
    const fires = [];
    const changes = [];
    const wd = new ConnectionWatchdog({
        timeoutMs,
        now: () => t,
        onTimeout: (state, ms) => fires.push({ state, ms }),
        onChange: (state, prev) => changes.push(`${prev}->${state}`),
    });
    return { wd, fires, changes, advance: ms => { t += ms; } };
}

/* Feed a subscribe callback result through the same path the
 * services use. */
function suback (wd, session, err, granted) {
    const outcome = subscriptionOutcome(err, granted);
    if (outcome.status === "granted") wd.subscribed(session);
    return outcome.status;
}

const GRANTED = [{ topic: "UNS/v1/#", qos: 0 }];

test("parseConnectTimeout defaults when unset or empty", () => {
    assert.equal(parseConnectTimeout(undefined), DEFAULT_CONNECT_TIMEOUT_S * 1000);
    assert.equal(parseConnectTimeout(""), DEFAULT_CONNECT_TIMEOUT_S * 1000);
    assert.equal(parseConnectTimeout(" "), DEFAULT_CONNECT_TIMEOUT_S * 1000);
    assert.equal(DEFAULT_CONNECT_TIMEOUT_S, 300);
});

test("parseConnectTimeout converts seconds to ms and allows 0", () => {
    assert.equal(parseConnectTimeout("120"), 120_000);
    assert.equal(parseConnectTimeout(" 45 "), 45_000);
    assert.equal(parseConnectTimeout("0"), 0);
});

test("parseConnectTimeout rejects values that are not whole seconds", () => {
    for (const bad of ["-1", "5m", "1.5", "abc", "10s", "1e3"])
        assert.throws(() => parseConnectTimeout(bad), /CONNECT_TIMEOUT/, bad);
});

test("parseTimeoutSeconds names the variable in its error", () => {
    assert.throws(() => parseTimeoutSeconds("FOO", "x", 1), /^Error: FOO must be/);
    assert.throws(() => parseStallTimeout("x"), /STALL_TIMEOUT/);
});

test("never connects: exit after the timeout", () => {
    const { wd, fires, advance } = fake();
    /* Failed attempts produce close/offline events every few
     * seconds. They must not restart the clock. */
    for (let n = 0; n < 99; n++) {
        advance(3_000);
        wd.disconnected();
        assert.equal(wd.check(), false);
    }
    advance(2_999);
    assert.equal(wd.check(), false);
    advance(1);
    assert.equal(wd.check(), true);
    assert.deepEqual(fires, [{ state: "disconnected", ms: T }]);

    /* Fires once only. */
    advance(T);
    assert.equal(wd.check(), false);
    assert.equal(fires.length, 1);
});

test("connects, subscription refused: refusal is fatal, watchdog not needed", () => {
    /* The service exits on a refusal itself. The watchdog must not
     * count a refusal as granted, so it would fire too. */
    const { wd, fires, advance } = fake();
    const s = wd.connected();
    const err = Object.assign(new Error("Subscribe error: Not authorized"), { code: 0x87 });
    assert.equal(suback(wd, s, err, GRANTED), "refused");
    assert.equal(wd.state, "connected");
    advance(T);
    assert.equal(wd.check(), true);
    assert.equal(fires[0].state, "connected");
});

test("connects, subscription unconfirmed: exit after the timeout", () => {
    const { wd, fires, advance } = fake();
    advance(1_000);
    const s = wd.connected();
    assert.equal(suback(wd, s, null, []), "unconfirmed");
    assert.equal(suback(wd, s, new Error("Connection closed"), undefined), "unconfirmed");
    assert.equal(wd.state, "connected");
    advance(T - 1_001);
    assert.equal(wd.check(), false);
    advance(1);
    assert.equal(wd.check(), true);
    assert.deepEqual(fires, [{ state: "connected", ms: T }]);
});

test("connects, SUBACK never arrives: exit after the timeout", () => {
    const { wd, fires, advance } = fake();
    wd.connected();
    advance(T);
    assert.equal(wd.check(), true);
    assert.equal(fires[0].state, "connected");
});

test("quiet site: connected and granted, no traffic, keeps running", () => {
    /* Message traffic plays no part. Run well past both default
     * timeouts (connect 300 s, stall 600 s). */
    const { wd, fires, advance } = fake();
    advance(2_000);
    const s = wd.connected();
    assert.equal(suback(wd, s, null, GRANTED), "granted");
    assert.equal(wd.state, "subscribed");
    for (let n = 0; n < 1000; n++) {
        advance(30_000);
        assert.equal(wd.check(), false);
    }
    assert.equal(wd.unhealthyMs(), 0);
    assert.deepEqual(fires, []);
});

test("disconnect then reconnect within the timeout: no exit", () => {
    const { wd, fires, changes, advance } = fake();
    wd.subscribed(wd.connected());
    advance(1_000_000);
    wd.disconnected();
    /* A broker restart: a reconnect storm for a while. */
    for (let n = 0; n < 30; n++) {
        advance(3_000);
        wd.disconnected();
        assert.equal(wd.check(), false);
    }
    const s = wd.connected();
    advance(50);
    assert.equal(suback(wd, s, null, GRANTED), "granted");
    advance(10 * T);
    assert.equal(wd.check(), false);
    assert.deepEqual(fires, []);
    assert.deepEqual(changes, [
        "disconnected->connected", "connected->subscribed",
        "subscribed->disconnected",
        "disconnected->connected", "connected->subscribed",
    ]);
});

test("disconnect longer than the timeout: exit", () => {
    const { wd, fires, advance } = fake();
    wd.subscribed(wd.connected());
    advance(5 * T);
    assert.equal(wd.check(), false);
    wd.disconnected();
    advance(T - 1);
    assert.equal(wd.check(), false);
    advance(1);
    assert.equal(wd.check(), true);
    assert.deepEqual(fires, [{ state: "disconnected", ms: T }]);
});

test("connects that drop before subscribing do not restart the clock", () => {
    /* For example a GSSAPI client whose server check fails, or a
     * broker that accepts and then drops the connection. */
    const { wd, fires, advance } = fake();
    for (let n = 0; n < 99; n++) {
        wd.connected();
        advance(1_000);
        wd.disconnected();
        advance(2_000);
        assert.equal(wd.check(), false);
    }
    advance(3_000);
    assert.equal(wd.check(), true);
    assert.equal(fires.length, 1);
});

test("a SUBACK from an earlier session is ignored", () => {
    const { wd, advance } = fake();
    const old = wd.connected();
    wd.disconnected();
    /* Late callback for the old connection, while disconnected. */
    wd.subscribed(old);
    assert.equal(wd.state, "disconnected");
    /* And after a new connect. */
    const cur = wd.connected();
    wd.subscribed(old);
    assert.equal(wd.state, "connected");
    wd.subscribed(cur);
    assert.equal(wd.state, "subscribed");
    advance(10 * T);
    assert.equal(wd.check(), false);
});

test("a new connect while subscribed needs a new SUBACK", () => {
    /* A new connection has no subscriptions (resubscribe is off). */
    const { wd, fires, advance } = fake();
    wd.subscribed(wd.connected());
    advance(T);
    wd.connected();
    assert.equal(wd.state, "connected");
    advance(T);
    assert.equal(wd.check(), true);
    assert.equal(fires[0].state, "connected");
});

test("state changes are reported once each, not per event", () => {
    const { wd, changes } = fake();
    wd.disconnected();
    wd.disconnected();
    const s = wd.connected();
    wd.subscribed(s);
    wd.subscribed(s);
    wd.disconnected();
    wd.disconnected();
    assert.deepEqual(changes, [
        "disconnected->connected", "connected->subscribed",
        "subscribed->disconnected",
    ]);
});

test("a timeout of 0 disables the connection watchdog", () => {
    const { wd, fires, advance } = fake(0);
    assert.equal(wd.enabled, false);
    advance(1e9);
    assert.equal(wd.check(), false);
    wd.connected();
    advance(1e9);
    assert.equal(wd.check(), false);
    assert.deepEqual(fires, []);
    /* start() must not create a timer when disabled. */
    wd.start();
    wd.stop();
});

test("connection watchdog timer fires in real time", async () => {
    let fired = 0;
    const wd = new ConnectionWatchdog({
        timeoutMs: 50,
        checkEveryMs: 10,
        onTimeout: () => { fired++; },
    }).start();
    await new Promise(r => setTimeout(r, 200));
    wd.stop();
    assert.equal(fired, 1);
});

test("connection watchdog timer does not fire while subscribed", async () => {
    let fired = 0;
    const wd = new ConnectionWatchdog({
        timeoutMs: 50,
        checkEveryMs: 10,
        onTimeout: () => { fired++; },
    }).start();
    wd.subscribed(wd.connected());
    await new Promise(r => setTimeout(r, 200));
    wd.stop();
    assert.equal(fired, 0);
});

test("onChange reports how long the client was without a subscription", () => {
    let t = 0;
    const seen = [];
    const wd = new ConnectionWatchdog({
        timeoutMs: T, now: () => t, onTimeout: () => {},
        onChange: (state, prev, ms) => seen.push([state, ms]),
    });
    t = 5_000; const s = wd.connected();
    t = 6_000; wd.subscribed(s);
    t = 100_000; wd.disconnected();
    t = 160_000; wd.subscribed(wd.connected());
    assert.deepEqual(seen, [
        ["connected", 5_000], ["subscribed", 6_000],
        ["disconnected", 0],
        ["connected", 60_000], ["subscribed", 60_000],
    ]);
});

test("describeConnectionChange gives the time left before exit", () => {
    assert.equal(describeConnectionChange("disconnected", "subscribed", 0, T),
        "MQTT disconnected; exiting in 300s unless connected and subscribed again");
    assert.equal(describeConnectionChange("disconnected", "connected", 120_000, T),
        "MQTT disconnected; exiting in 180s unless connected and subscribed again");
    assert.equal(describeConnectionChange("disconnected", "subscribed", 0, 0),
        "MQTT disconnected");
    assert.match(describeConnectionChange("connected", "disconnected", 1_000, T), /waiting/);
    assert.match(describeConnectionChange("subscribed", "connected", 42_000, T), /after 42s/);
});

test("describeConnectionTimeout says which state the client was stuck in", () => {
    assert.match(describeConnectionTimeout("disconnected", T, T), /not connected .* 300s .*CONNECT_TIMEOUT 300s/);
    assert.match(describeConnectionTimeout("connected", T, T), /no subscription has been granted/);
});

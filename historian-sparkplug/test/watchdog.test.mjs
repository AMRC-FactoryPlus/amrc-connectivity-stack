/*
 * AMRC InfluxDB Sparkplug Historian
 * Tests for the stall watchdog and SUBACK checks
 * Copyright 2026 AMRC
 *
 * Run with `npm test` (Node 22.18 or later strips the TypeScript
 * types from lib/watchdog.ts itself).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    DEFAULT_STALL_TIMEOUT_S, StallWatchdog,
    parseStallTimeout, subscriptionFailures, subscriptionOutcome,
} from "../lib/watchdog.ts";

/* A watchdog on a fake clock. Returns the watchdog, a function to
 * advance the clock and the list of onStall calls. */
function fake (timeoutMs) {
    let t = 1_000_000;
    const stalls = [];
    const arms = [];
    const wd = new StallWatchdog({
        timeoutMs,
        now: () => t,
        onStall: idle => stalls.push(idle),
        onArm: () => arms.push(t),
    });
    return { wd, stalls, arms, advance: ms => { t += ms; } };
}

test("parseStallTimeout defaults when unset or empty", () => {
    assert.equal(parseStallTimeout(undefined), DEFAULT_STALL_TIMEOUT_S * 1000);
    assert.equal(parseStallTimeout(""), DEFAULT_STALL_TIMEOUT_S * 1000);
    assert.equal(parseStallTimeout("  "), DEFAULT_STALL_TIMEOUT_S * 1000);
});

test("parseStallTimeout converts seconds to ms and allows 0", () => {
    assert.equal(parseStallTimeout("300"), 300_000);
    assert.equal(parseStallTimeout(" 60 "), 60_000);
    assert.equal(parseStallTimeout("0"), 0);
});

test("parseStallTimeout rejects values that are not whole seconds", () => {
    for (const bad of ["-1", "5m", "1.5", "abc", "10s"])
        assert.throws(() => parseStallTimeout(bad), /STALL_TIMEOUT/, bad);
});

test("watchdog does not fire while messages keep arriving", () => {
    const { wd, stalls, advance } = fake(10_000);
    for (let n = 0; n < 20; n++) {
        advance(9_000);
        wd.touch();
        assert.equal(wd.check(), false);
    }
    assert.deepEqual(stalls, []);
});

test("watchdog fires once when messages stop for the timeout", () => {
    const { wd, stalls, advance } = fake(10_000);
    wd.touch();
    advance(9_999);
    assert.equal(wd.check(), false);
    advance(1);
    assert.equal(wd.check(), true);
    assert.deepEqual(stalls, [10_000]);

    /* It must not fire repeatedly while the process exits. */
    advance(60_000);
    assert.equal(wd.check(), false);
    assert.equal(stalls.length, 1);
});

test("quiet site: no message ever means no exit", () => {
    /* A site with no traffic at all is not a fault. The watchdog
     * only arms on the first message. */
    const { wd, stalls, arms, advance } = fake(600_000);
    for (let n = 0; n < 100; n++) {
        advance(600_000);
        assert.equal(wd.check(), false);
    }
    assert.equal(wd.armed, false);
    assert.deepEqual(stalls, []);
    assert.deepEqual(arms, []);
});

test("data flows, then silently stops: exit after the timeout", () => {
    /* The failure this guards against: a working consumer whose
     * client never reconnects after the broker goes away. */
    const { wd, stalls, arms, advance } = fake(600_000);
    advance(30_000);
    for (let n = 0; n < 50; n++) {
        wd.touch();
        advance(10_000);
        assert.equal(wd.check(), false);
    }
    assert.equal(arms.length, 1);
    advance(589_999);
    assert.equal(wd.check(), false);
    advance(1);
    assert.equal(wd.check(), true);
    assert.deepEqual(stalls, [600_000]);
});

test("the first message arms the watchdog once", () => {
    const { wd, arms, advance } = fake(10_000);
    assert.equal(wd.armed, false);
    advance(5_000);
    wd.touch();
    advance(1_000);
    wd.touch();
    wd.touch();
    assert.equal(wd.armed, true);
    assert.deepEqual(arms, [1_005_000]);
});

test("a long quiet start does not count once armed", () => {
    /* The idle clock starts at the first message, not at startup. */
    const { wd, stalls, advance } = fake(10_000);
    advance(1_000_000);
    wd.touch();
    advance(9_000);
    assert.equal(wd.check(), false);
    assert.deepEqual(stalls, []);
});

test("watchdog fires when messages stop after a healthy period", () => {
    const { wd, stalls, advance } = fake(10_000);
    advance(5_000); wd.touch();
    advance(5_000); wd.touch();
    advance(12_000);
    assert.equal(wd.check(), true);
    assert.deepEqual(stalls, [12_000]);
});

test("a timeout of 0 disables the watchdog", () => {
    const { wd, stalls, arms, advance } = fake(0);
    assert.equal(wd.enabled, false);
    wd.touch();
    assert.equal(wd.armed, false);
    advance(1e9);
    assert.equal(wd.check(), false);
    assert.deepEqual(stalls, []);
    assert.deepEqual(arms, []);
    /* start() must not create a timer when disabled. */
    wd.start();
    wd.stop();
});

test("watchdog timer fires onStall in real time once armed", async () => {
    let fired = 0;
    const wd = new StallWatchdog({
        timeoutMs: 50,
        checkEveryMs: 10,
        onStall: () => { fired++; },
    }).start();
    /* Not armed: nothing happens however long we wait. */
    await new Promise(r => setTimeout(r, 120));
    assert.equal(fired, 0);
    wd.touch();
    await new Promise(r => setTimeout(r, 200));
    wd.stop();
    assert.equal(fired, 1);
});

test("subscriptionFailures: granted subscription is not a failure", () => {
    assert.deepEqual(subscriptionFailures(null, [{ topic: "spBv1.0/#", qos: 0 }]), []);
    assert.deepEqual(subscriptionFailures(null, [{ topic: "spBv1.0/#", qos: 1 }]), []);
});

test("subscriptionFailures: MQTT.js 5 style error with reason code", () => {
    const err = Object.assign(new Error("Subscribe error: Not authorized"), { code: 0x87 });
    const f = subscriptionFailures(err, { granted: [0x87] });
    assert.ok(f.length >= 1);
    assert.match(f[0], /0x87/);
});

test("subscriptionFailures: ErrorWithSubackPacket with reason codes in the packet", () => {
    /* Newer MQTT.js 5 releases (for example 5.16) wrap the error and
     * drop `code`. The reason codes are in the SUBACK packet; the
     * `granted` argument holds the requested QoS, not the result. */
    const err = Object.assign(new Error("Subscribe error: Not authorized"),
        { packet: { cmd: "suback", granted: [0x87] } });
    const f = subscriptionFailures(err, [{ topic: "spBv1.0/#", qos: 0 }]);
    assert.deepEqual(f, ["Subscribe error: Not authorized (reason code 0x87)"]);
    assert.equal(subscriptionOutcome(err, [{ topic: "spBv1.0/#", qos: 0 }]).status, "refused");
});

test("subscriptionFailures: ErrorWithSubackPacket without a failure code is not a refusal", () => {
    const err = Object.assign(new Error("Protocol error: suback granted 0 reason code(s) for 1 subscription(s)"),
        { packet: { cmd: "suback", granted: [] } });
    assert.deepEqual(subscriptionFailures(err, undefined), []);
    assert.equal(subscriptionOutcome(err, undefined).status, "unconfirmed");
});

test("subscriptionFailures: reason code in granted list (older MQTT.js)", () => {
    const f = subscriptionFailures(null, [{ topic: "spBv1.0/#", qos: 128 }]);
    assert.deepEqual(f, ["spBv1.0/#: reason code 0x80"]);
});

test("subscriptionFailures: connection closed before SUBACK is not a refusal", () => {
    assert.deepEqual(subscriptionFailures(new Error("Connection closed"), undefined), []);
});

test("subscriptionOutcome: granted", () => {
    assert.deepEqual(
        subscriptionOutcome(null, [{ topic: "spBv1.0/#", qos: 0 }]),
        { status: "granted" });
});

test("subscriptionOutcome: refused with a reason code", () => {
    const err = Object.assign(new Error("Subscribe error: Not authorized"), { code: 0x87 });
    const o = subscriptionOutcome(err, [{ topic: "spBv1.0/#", qos: 0 }]);
    assert.equal(o.status, "refused");
    assert.match(o.detail, /0x87/);
});

test("subscriptionOutcome: empty granted list is unconfirmed, not success", () => {
    /* MQTT.js answers (null, []) without sending a SUBSCRIBE when it
     * thinks the topic is already subscribed. */
    assert.equal(subscriptionOutcome(null, []).status, "unconfirmed");
    assert.equal(subscriptionOutcome(null, undefined).status, "unconfirmed");
});

test("subscriptionOutcome: error without reason code is unconfirmed", () => {
    const o = subscriptionOutcome(new Error("Connection closed"), undefined);
    assert.equal(o.status, "unconfirmed");
    assert.match(o.detail, /Connection closed/);
});

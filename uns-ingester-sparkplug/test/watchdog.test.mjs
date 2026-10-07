/*
 * AMRC ACS UNS Ingester (Sparkplug)
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
    parseStallTimeout, subscriptionFailures,
} from "../lib/watchdog.ts";

/* A watchdog on a fake clock. Returns the watchdog, a function to
 * advance the clock and the list of onStall calls. */
function fake (timeoutMs) {
    let t = 1_000_000;
    const stalls = [];
    const wd = new StallWatchdog({
        timeoutMs,
        now: () => t,
        onStall: idle => stalls.push(idle),
    });
    return { wd, stalls, advance: ms => { t += ms; } };
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

test("watchdog fires once when no message arrives for the timeout", () => {
    const { wd, stalls, advance } = fake(10_000);
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

test("watchdog fires if the service never receives anything", () => {
    /* Covers never connecting at all, and connecting with no
     * working subscription: no touch() ever happens. */
    const { wd, stalls, advance } = fake(600_000);
    advance(600_000);
    assert.equal(wd.check(), true);
    assert.equal(stalls.length, 1);
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
    const { wd, stalls, advance } = fake(0);
    assert.equal(wd.enabled, false);
    advance(1e9);
    assert.equal(wd.check(), false);
    assert.deepEqual(stalls, []);
    /* start() must not create a timer when disabled. */
    wd.start();
    wd.stop();
});

test("watchdog timer fires onStall in real time", async () => {
    let fired = 0;
    const wd = new StallWatchdog({
        timeoutMs: 50,
        checkEveryMs: 10,
        onStall: () => { fired++; },
    }).start();
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

test("subscriptionFailures: reason code in granted list (older MQTT.js)", () => {
    const f = subscriptionFailures(null, [{ topic: "spBv1.0/#", qos: 128 }]);
    assert.deepEqual(f, ["spBv1.0/#: reason code 0x80"]);
});

test("subscriptionFailures: connection closed before SUBACK is not a refusal", () => {
    assert.deepEqual(subscriptionFailures(new Error("Connection closed"), undefined), []);
});

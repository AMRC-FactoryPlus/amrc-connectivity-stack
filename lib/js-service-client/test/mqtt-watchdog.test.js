/*
 * Factory+ NodeJS Utilities
 * Tests for the MQTT watchdog
 * Copyright 2026 University of Sheffield AMRC
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { MQTTWatchdog, parse_timeout } from "../lib/service/mqtt-watchdog.js";

const TIMEOUT = 300_000;

/* A watchdog on a fake client, with a clock the test moves by hand.
 * `fired` holds the idle time passed to each on_stuck call. */
function harness () {
    let now = 0;
    const mqtt = new EventEmitter();
    const fired = [];
    const dog = new MQTTWatchdog({
        mqtt,
        timeout:    TIMEOUT,
        on_stuck:   idle => fired.push(idle),
        now:        () => now,
    }).start();
    const advance = ms => { now += ms; return dog.check(); };
    return { mqtt, dog, fired, advance };
}

test("parse_timeout: unset, empty and 0 disable the watchdog", () => {
    for (const v of [undefined, null, "", "  ", "0", 0])
        assert.equal(parse_timeout(v), 0, `value ${JSON.stringify(v)}`);
});

test("parse_timeout: whole seconds become milliseconds", () => {
    assert.equal(parse_timeout("300"), 300_000);
    assert.equal(parse_timeout(" 60 "), 60_000);
    assert.equal(parse_timeout(120), 120_000);
});

test("parse_timeout: anything else throws", () => {
    for (const v of ["5m", "-1", "1.5", "abc", "300s"])
        assert.throws(() => parse_timeout(v), /MQTT_WATCHDOG_TIMEOUT/,
            `value ${JSON.stringify(v)}`);
});

test("fires if the first connection attempt never ends", () => {
    const { fired, advance } = harness();

    assert.equal(advance(TIMEOUT - 1), false);
    assert.equal(advance(1), true);
    assert.deepEqual(fired, [TIMEOUT]);
});

test("does not fire while connected, however long", () => {
    const { mqtt, fired, advance } = harness();

    mqtt.emit("authenticated");
    assert.equal(advance(7 * 24 * 3600_000), false);
    assert.deepEqual(fired, []);
});

test("does not fire while the client keeps trying to reconnect", () => {
    const { mqtt, fired, advance } = harness();

    /* Broker down for an hour: a refused TCP connection every 3s. */
    for (let t = 0; t < 3600_000; t += 3000) {
        mqtt.emit("reconnect");
        mqtt.emit("close");
        assert.equal(advance(3000), false);
    }
    assert.deepEqual(fired, []);
});

test("fires when the client stops reconnecting after a refusal", () => {
    const { mqtt, fired, advance } = harness();

    /* MQTT.js 5.16 without reconnectOnConnackError: the broker
     * refuses the connection and the client never tries again. */
    advance(10_000);
    mqtt.emit("close");
    assert.equal(advance(TIMEOUT - 1), false);
    assert.equal(advance(1), true);
    assert.deepEqual(fired, [TIMEOUT]);
});

test("the clock restarts when a long-lived connection drops", () => {
    const { mqtt, fired, advance } = harness();

    mqtt.emit("authenticated");
    advance(24 * 3600_000);
    mqtt.emit("close");
    assert.equal(advance(TIMEOUT - 1), false);
    assert.equal(advance(1), true);
    assert.deepEqual(fired, [TIMEOUT]);
});

test("does not count 'connect' as connected", () => {
    const { mqtt, fired, advance } = harness();

    /* A GSSAPI client gets 'connect' before the server has proved
     * who it is, and 'authenticated' only once it has. */
    mqtt.emit("connect");
    assert.equal(advance(TIMEOUT), true);
    assert.deepEqual(fired, [TIMEOUT]);
});

test("fires only once", () => {
    const { fired, advance } = harness();

    advance(TIMEOUT);
    assert.equal(advance(TIMEOUT), false);
    assert.equal(fired.length, 1);
});

test("stops when the client is closed on purpose", () => {
    const { mqtt, dog, fired, advance } = harness();

    mqtt.emit("close");
    mqtt.emit("end");
    assert.equal(dog.timer, null);
    assert.equal(advance(TIMEOUT * 10), false);
    assert.deepEqual(fired, []);
});

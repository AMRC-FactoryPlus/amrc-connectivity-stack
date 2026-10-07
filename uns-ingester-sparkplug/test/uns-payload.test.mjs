/*
 * AMRC ACS UNS Ingester (Sparkplug)
 * Tests for buildUnsPayload
 * Copyright 2026 AMRC
 *
 * Run with `npm test` (Node 22.18 or later strips the TypeScript
 * types from lib/uns-payload.ts itself).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildUnsPayload, ns_to_iso } from "../lib/uns-payload.ts";

const at = (iso, value, extraNs) => ({
    value,
    timestamp: new Date(iso),
    ...(extraNs === undefined ? {} : { timestampNs: BigInt(Date.parse(iso)) * 1_000_000n + extraNs }),
});

test("one sample is the value, with no batch", () => {
    assert.deepEqual(buildUnsPayload([at("2026-10-05T12:00:00.000Z", 1)]), {
        timestamp: "2026-10-05T12:00:00.000000000Z",
        value: 1,
    });
});

test("the newest sample is the value, whatever order they arrive in", () => {
    const samples = [
        at("2026-10-05T12:00:01.000Z", "b"),
        at("2026-10-05T12:00:03.000Z", "d"),
        at("2026-10-05T12:00:00.000Z", "a"),
        at("2026-10-05T12:00:02.000Z", "c"),
    ];
    const p = buildUnsPayload(samples);
    assert.equal(p.value, "d");
    assert.equal(p.timestamp, "2026-10-05T12:00:03.000000000Z");
    /* The rest, oldest first. */
    assert.deepEqual(p.batch.map(b => b.value), ["a", "b", "c"]);
    /* The input is not reordered. */
    assert.deepEqual(samples.map(s => s.value), ["b", "d", "a", "c"]);
});

test("nanosecond timestamps decide the order within a millisecond", () => {
    const p = buildUnsPayload([
        at("2026-10-05T12:00:00.000Z", "late", 900n),
        at("2026-10-05T12:00:00.000Z", "early", 100n),
    ]);
    assert.equal(p.value, "late");
    assert.equal(p.timestamp, "2026-10-05T12:00:00.000000900Z");
    assert.deepEqual(p.batch, [{ timestamp: "2026-10-05T12:00:00.000000100Z", value: "early" }]);
});

test("of equal timestamps the last in the payload is the value", () => {
    const p = buildUnsPayload([
        at("2026-10-05T12:00:00.000Z", 1),
        at("2026-10-05T12:00:00.000Z", 2),
    ]);
    assert.equal(p.value, 2);
    assert.deepEqual(p.batch.map(b => b.value), [1]);
});

test("ns_to_iso keeps nanoseconds", () => {
    assert.equal(ns_to_iso(1_759_665_600_123_456_789n), "2025-10-05T12:00:00.123456789Z");
    assert.throws(() => buildUnsPayload([]), RangeError);
});

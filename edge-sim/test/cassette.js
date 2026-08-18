/*
 * ACS simulator driver
 * Cassette validation tests.
 * Copyright 2026 University of Sheffield AMRC
 */

import assert from "node:assert";
import { test } from "node:test";

import { validateCassette } from "../lib/cassette.js";

const good = () => ({
    cassette: { name: "t", version: 1 },
    channels: [{ id: 0, path: "A/B" }],
    samples: [[0, 0, 1], [100, 0, 2]],
});

test("a valid cassette passes and derives duration", () => {
    const c = validateCassette(good());
    assert.strictEqual(c.cassette.duration_ms, 100);
    assert.strictEqual(c.byId.get(0).path, "A/B");
    assert.strictEqual(c.byPath.get("A/B").id, 0);
});

test("bad cassettes are rejected with useful messages", () => {
    const cases = [
        [c => delete c.cassette, /metadata/],
        [c => c.cassette.version = 2, /version/],
        [c => delete c.cassette.name, /name/],
        [c => c.channels = [], /no channels/],
        [c => c.channels.push({ id: 0, path: "X" }), /Duplicate channel id/],
        [c => c.channels.push({ id: 1, path: "A/B" }), /Duplicate channel path/],
        [c => c.samples.push([50, 0, 3]), /not sorted/],
        [c => c.samples.push([200, 9, 3]), /unknown channel/],
        [c => c.samples.push([300, 0]), /Bad sample/],
        [c => c.cassette.duration_ms = 50, /before the last sample/],
    ];
    for (const [mutate, rx] of cases) {
        const c = good();
        mutate(c);
        assert.throws(() => validateCassette(c), rx);
    }
});

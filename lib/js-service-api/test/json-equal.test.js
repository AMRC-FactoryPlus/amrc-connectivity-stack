/*
 * Factory+ Service HTTP API
 * json_equal tests.
 * Copyright 2026 University of Sheffield AMRC
 *
 * Run with `node --test test/`.
 */

import test from "node:test";
import assert from "node:assert/strict";

import deep_equal from "deep-equal";
import * as imm from "immutable";

import { json_equal } from "../lib/util.js";

test("json_equal: primitives", () => {
    for (const v of [0, 1, -1.5, "", "a", true, false, null])
        assert.ok(json_equal(v, v), `${v}`);
    assert.ok(!json_equal(1, "1"));
    assert.ok(!json_equal(0, false));
    assert.ok(!json_equal("", false));
    assert.ok(!json_equal(null, undefined));
    assert.ok(!json_equal(null, {}));
    assert.ok(!json_equal(null, 0));
});

test("json_equal: objects ignore key order, arrays don't", () => {
    assert.ok(json_equal({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 }));
    assert.ok(!json_equal([1, 2], [2, 1]));
    assert.ok(!json_equal({ a: 1 }, { a: 1, b: 2 }));
    assert.ok(!json_equal({ a: 1, b: 2 }, { a: 1 }));
    assert.ok(!json_equal({ a: 1 }, { b: 1 }));
    assert.ok(!json_equal({ a: null }, {}));
    assert.ok(!json_equal([], {}));
    assert.ok(!json_equal({}, []));
    assert.ok(!json_equal({ 0: "a" }, ["a"]));
    assert.ok(json_equal([], []));
    assert.ok(json_equal({}, {}));
    assert.ok(!json_equal([[1]], [[2]]));
});

test("json_equal: undefined members", () => {
    /* JSON.stringify drops these; both sides must agree on the keys. */
    assert.ok(json_equal({ a: undefined }, { a: undefined }));
    assert.ok(!json_equal({ a: undefined }, { b: undefined }));
    assert.ok(json_equal(
        { status: 200, response: { status: 403, headers: {}, body: undefined } },
        { status: 200, response: { status: 403, headers: {}, body: undefined } }));
});

test("json_equal: Dates compare as their JSON", () => {
    const d = new Date("2026-01-01T00:00:00Z");
    /* Dates have no own keys; these must not compare equal. */
    assert.ok(!json_equal(d, new Date("2026-01-02T00:00:00Z")));
    assert.ok(json_equal(d, new Date("2026-01-01T00:00:00Z")));
    /* The wire is the same, so a Date equals its ISO string. */
    assert.ok(json_equal(d, d.toISOString()));
    assert.ok(json_equal(d.toISOString(), d));
    assert.ok(!json_equal(d, "2026-01-02T00:00:00.000Z"));
    assert.ok(!json_equal(d, {}));
    assert.ok(!json_equal({}, d));
});

test("json_equal: nested Dates", () => {
    const range = (from, to) => ({ status: 200, response: { status: 200,
        body: { from: new Date(from), to: new Date(to), tags: [new Date(to)] } } });
    const a = range("2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z");
    assert.ok(json_equal(a, range("2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z")));
    assert.ok(!json_equal(a, range("2026-01-01T00:00:00Z", "2026-03-01T00:00:00Z")));
    assert.ok(!json_equal(a, range("2025-12-01T00:00:00Z", "2026-02-01T00:00:00Z")));
    assert.ok(json_equal(a, JSON.parse(JSON.stringify(a))));
});

test("json_equal: other toJSON values match JSON.stringify", () => {
    const pairs = [
        [imm.Map({ a: 1 }), { a: 1 }],
        [imm.Map({ a: 1 }), imm.Map({ a: 2 })],
        [imm.Map({ a: imm.List([1, 2]) }), { a: [1, 2] }],
        [imm.List([imm.Map({ d: new Date(0) })]), [{ d: new Date(0) }]],
        [imm.List([imm.Map({ d: new Date(0) })]), [{ d: new Date(1) }]],
        [Buffer.from("ab"), Buffer.from("ab")],
        [Buffer.from("ab"), Buffer.from("ac")],
        [{ b: Buffer.from("ab") }, JSON.parse(JSON.stringify({ b: Buffer.from("ab") }))],
    ];
    for (const [a, b] of pairs) {
        const want = JSON.stringify(a) == JSON.stringify(b);
        assert.equal(json_equal(a, b), want, `${JSON.stringify(a)} ${JSON.stringify(b)}`);
        assert.equal(json_equal(b, a), want, `${JSON.stringify(b)} ${JSON.stringify(a)}`);
    }
});

/* Random JSON values, and near-copies with one change somewhere. */
function rand_json (rnd, depth = 0) {
    const r = rnd();
    if (depth > 4 || r < 0.35) {
        const p = rnd();
        return p < 0.2 ? null
            : p < 0.4 ? rnd() < 0.5
            : p < 0.7 ? Math.floor(rnd() * 5)
            : ["", "a", "b", "1", "0"][Math.floor(rnd() * 5)];
    }
    if (r < 0.65)
        return Array.from({ length: Math.floor(rnd() * 4) }, () => rand_json(rnd, depth + 1));
    const o = {};
    for (let i = Math.floor(rnd() * 4); i > 0; i--)
        o[["a", "b", "c", "d"][Math.floor(rnd() * 4)]] = rand_json(rnd, depth + 1);
    return o;
}

function mutate (rnd, v) {
    if (v === null || typeof v != "object")
        return rand_json(rnd, 5);
    const c = Array.isArray(v) ? [...v] : { ...v };
    const keys = Object.keys(c);
    if (!keys.length || rnd() < 0.2) {
        if (Array.isArray(c)) c.push(rand_json(rnd, 5));
        else c.e = rand_json(rnd, 5);
        return c;
    }
    const k = keys[Math.floor(rnd() * keys.length)];
    c[k] = mutate(rnd, c[k]);
    return c;
}

test("json_equal agrees with strict deep-equal on JSON values", () => {
    /* Deterministic PRNG (mulberry32) so failures reproduce. */
    let seed = 12345;
    const rnd = () => {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    let equal = 0, differ = 0;
    for (let i = 0; i < 20000; i++) {
        const a = rand_json(rnd);
        /* Round-trip through JSON so both sides are wire values. */
        const b = JSON.parse(JSON.stringify(rnd() < 0.5 ? a : mutate(rnd, a)));
        const want = deep_equal(a, b, { strict: true });
        assert.equal(json_equal(a, b), want, JSON.stringify([a, b]));
        assert.equal(json_equal(b, a), want, JSON.stringify([b, a]));
        want ? equal++ : differ++;
    }
    /* Make sure both branches were exercised. */
    assert.ok(equal > 5000 && differ > 5000, `${equal} equal, ${differ} differ`);
});

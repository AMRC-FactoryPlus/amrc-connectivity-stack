/*
 * Factory+ Rx interface
 * Tests for NotifyV2#search_changes
 * Copyright 2026 University of Sheffield AMRC
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import * as imm from "immutable";
import * as rx from "rxjs";

import { NotifyV2 } from "../lib/notify-v2.js";

const quiet = () => () => {};

/* A NotifyV2 whose SEARCH updates come from a Subject. Both `search`
 * and `search_changes` subscribe to the same updates. */
function scripted () {
    const notify = new NotifyV2({ log: quiet(), debug: { bound: quiet } });
    const updates = new rx.Subject();
    notify.request = () => updates;
    return { notify, updates };
}

const full = (kids, status = 200) => ({
    status: 201,
    response: { status, headers: {} },
    ...(kids ? { children: Object.fromEntries(
        Object.entries(kids).map(([k, [st, body]]) => [k, { status: st, body }])) }
        : {}),
});
const child = (k, status, body) => ({
    status: 200, child: k, response: { status, body, headers: {} },
});

function run (notify, updates, us) {
    const old = [], neu = [];
    const s1 = notify.search("p/").subscribe(v => old.push(v));
    const s2 = notify.search_changes("p/").subscribe(v => neu.push(v));
    us.forEach(u => updates.next(u));
    s1.unsubscribe(); s2.unsubscribe();
    return { old, neu };
}

test("search_changes reports the snapshot and each child change", () => {
    const { notify, updates } = scripted();
    const { neu } = run(notify, updates, [
        full({ a: [200, 1], b: [200, 2], c: [403, 3] }),
        child("d", 200, 4),
        child("a", 404),
        child("b", 200, 5),
    ]);

    assert.equal(neu.length, 4);
    assert.ok(imm.is(neu[0].map, imm.Map({ a: 1, b: 2 })));
    assert.equal(neu[0].child, null);
    assert.equal(neu[0].previous, null);

    assert.equal(neu[1].child, "d");
    assert.equal(neu[1].previous, neu[0].map);
    assert.ok(imm.is(neu[1].map, imm.Map({ a: 1, b: 2, d: 4 })));

    assert.equal(neu[2].child, "a");
    assert.ok(imm.is(neu[2].map, imm.Map({ b: 2, d: 4 })));

    assert.equal(neu[3].child, "b");
    assert.ok(imm.is(neu[3].map, imm.Map({ b: 5, d: 4 })));
});

test("search_changes emits whenever search emits, with the same Map", () => {
    const { notify, updates } = scripted();
    const { old, neu } = run(notify, updates, [
        /* Child updates before any snapshot are ignored. */
        child("x", 200, 1),
        full({ a: [200, 1] }),
        /* A child error drops the child from the output. */
        child("a", 403),
        child("a", 500),
        child("a", 200, 2),
        /* A parent error suppresses output until the next snapshot. */
        full(undefined, 403),
        child("a", 200, 3),
        full(undefined, 404),
        /* A successful parent with no children is not usable. */
        full(undefined, 200),
        child("a", 200, 4),
        /* Resync. */
        full({ b: [200, 1], c: [404, 2] }),
        full({}),
        child("e", 201, 7),
    ]);

    assert.equal(neu.length, old.length);
    neu.forEach((v, i) => assert.ok(imm.is(v.map, old[i]),
        `emission ${i}: ${v.map} != ${old[i]}`));
});

test("search_changes does not change search", () => {
    /* `search` keeps its old output for the other consumers. */
    const { notify, updates } = scripted();
    const { old } = run(notify, updates, [
        full({ a: [200, 1] }), child("b", 200, 2),
    ]);
    assert.equal(old.length, 2);
    assert.ok(imm.Map.isMap(old[1]));
    assert.ok(imm.is(old[1], imm.Map({ a: 1, b: 2 })));
});

test("a child update does not visit the other children", () => {
    /* Count reads of child bodies. `search` rebuilds the Map, but it
     * only copies references, so count the Response wrappers instead:
     * `search_changes` must not touch existing entries at all. */
    const { notify, updates } = scripted();
    const kids = {};
    for (let i = 0; i < 1000; i++) kids[`k${i}`] = [200, { i }];

    const seen = [];
    const sub = notify.search_changes("p/").subscribe(v => seen.push(v));
    updates.next(full(kids));

    const filter = imm.Map.prototype.filter;
    let filtered = 0;
    imm.Map.prototype.filter = function (...a) {
        filtered += this.size;
        return filter.apply(this, a);
    };
    try {
        updates.next(child("k5", 200, { i: -1 }));
    }
    finally {
        imm.Map.prototype.filter = filter;
    }
    sub.unsubscribe();

    assert.equal(filtered, 0);
    assert.equal(seen.length, 2);
    assert.deepEqual(seen[1].map.get("k5"), { i: -1 });
    assert.equal(seen[1].map.size, 1000);
});

/* search_map must emit where search_changes does, with the same
 * content, for every sequence those tests use. */
function both (us) {
    const { notify, updates } = scripted();
    const neu = [], lean = [];
    const s1 = notify.search_changes("p/").subscribe(v => neu.push({
        entries: [...v.map.entries()].sort(), child: v.child }));
    const s2 = notify.search_map("p/").subscribe(v => lean.push({
        entries: [...v.map.entries()].sort(), child: v.child }));
    us.forEach(u => updates.next(u));
    s1.unsubscribe(); s2.unsubscribe();
    return { neu, lean };
}

test("search_map emits as search_changes does, with the same entries", () => {
    const sequences = [
        [
            full({ a: [200, 1], b: [200, 2], c: [403, 3] }),
            child("d", 200, 4),
            child("a", 404),
            child("b", 200, 5),
        ],
        [
            child("x", 200, 1),
            full({ a: [200, 1] }),
            child("a", 403),
            child("a", 500),
            child("a", 200, 2),
            full(undefined, 403),
            child("a", 200, 3),
            full({ b: [200, 9], c: [201, { n: 1 }] }),
            child("b", 404),
        ],
        [full({}), child("a", 200, null), full({ z: [200, "z"] })],
    ];
    for (const us of sequences) {
        const { neu, lean } = both(us);
        assert.ok(neu.length > 0);
        assert.deepEqual(lean, neu);
    }
});


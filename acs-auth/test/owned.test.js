/*
 * ACS Auth service
 * Tests for the incremental owned-object index
 * Copyright 2026 University of Sheffield AMRC
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import imm from "immutable";

import { DataFlow } from "../lib/dataflow.js";
import { owned_full, owned_apply } from "../lib/owned.js";
import { Special } from "../lib/uuids.js";

import { scripted_notify, fake_cdb, make_dataflow, upd } from "./fixtures.js";

const U = Special.Unowned;
const reg = obj => imm.Map(obj);
const index = obj => imm.Map(obj).map(xs => imm.Set(xs));

/* Apply one child change, as search_changes would report it. */
const step = (owned, previous, child, body) => {
    const map = body === undefined ? previous.delete(child)
        : previous.set(child, body);
    return { map, owned: owned_apply(owned, { map, child, previous }) };
};

test("owned_full groups objects by owner and drops Unowned", () => {
    const got = owned_full(reg({
        a: { owner: "p1" }, b: { owner: "p1" },
        c: { owner: "p2" }, d: { owner: U },
    }));
    assert.ok(imm.is(got, index({ p1: ["a", "b"], p2: ["c"] })));
});

test("owned_apply on a snapshot rebuilds the index", () => {
    const map = reg({ a: { owner: "p1" } });
    const got = owned_apply(index({ old: ["x"] }),
        { map, child: null, previous: null });
    assert.ok(imm.is(got, index({ p1: ["a"] })));
});

test("owned_apply handles add, move, unown, delete", () => {
    let map = reg({ a: { owner: "p1" } });
    let owned = owned_full(map);

    ({ map, owned } = step(owned, map, "b", { owner: "p1" }));
    assert.ok(imm.is(owned, index({ p1: ["a", "b"] })));

    ({ map, owned } = step(owned, map, "b", { owner: "p2" }));
    assert.ok(imm.is(owned, index({ p1: ["a"], p2: ["b"] })));

    ({ map, owned } = step(owned, map, "a", { owner: U }));
    assert.ok(imm.is(owned, index({ p2: ["b"] })),
        "an owner with no objects left disappears");

    ({ map, owned } = step(owned, map, "a", { owner: "p2" }));
    assert.ok(imm.is(owned, index({ p2: ["a", "b"] })));

    ({ map, owned } = step(owned, map, "b", undefined));
    assert.ok(imm.is(owned, index({ p2: ["a"] })));

    ({ map, owned } = step(owned, map, "zz", undefined));
    assert.ok(imm.is(owned, index({ p2: ["a"] })), "deleting a missing child");

    assert.ok(imm.is(owned, owned_full(map)));
});

test("owned_apply keeps the same index when the owner does not change", () => {
    const map = reg({ a: { owner: "p1", deleted: false } });
    const owned = owned_full(map);
    const { owned: after } = step(owned, map, "a", { owner: "p1", deleted: true });
    assert.equal(after, owned);
});

test("owned_apply indexes a missing owner field like owned_full", () => {
    let map = reg({ a: { owner: "p1" } });
    let owned = owned_full(map);
    ({ map, owned } = step(owned, map, "b", { deleted: false }));
    assert.ok(imm.is(owned, owned_full(map)));
    assert.ok(owned.has(undefined));
});

test("owned_apply throws on an entry with no body, like owned_full", () => {
    const map = reg({ a: { owner: "p1" } });
    assert.throws(() => owned_full(map.set("b", null)), TypeError);
    assert.throws(() => step(owned_full(map), map, "b", null), TypeError);
});

/* A Registration body that counts reads of its owner. */
function counted (owner, counter) {
    return {
        get owner () { counter.n++; return owner; },
        toJSON () { return { owner }; },
    };
}

test("a Registration update reads O(1) entries, not all of them", async () => {
    /* On main, DataFlow rebuilt the owned index from the whole
     * Registration map on every update, reading every entry's owner.
     * This test fails there. */
    const { notify, updates } = scripted_notify();
    const cdb = fake_cdb(notify, {
        principals: [], permissions: [],
        principal_groups: {}, permission_groups: {},
    });
    const df = await make_dataflow(DataFlow, cdb, []);

    const counter = { n: 0 };
    const N = 5000;
    const kids = {};
    for (let i = 0; i < N; i++)
        kids[`obj-${i}`] = [200, counted(`p${i % 50}`, counter)];

    const seen = [];
    const sub = df.owned.subscribe(o => seen.push(o));
    updates.next(upd.full(kids));
    assert.equal(seen.length, 1);
    assert.equal(seen[0].get("p0").size, N / 50);

    counter.n = 0;
    for (let i = 0; i < 10; i++)
        updates.next(upd.child(`new-${i}`, 200, counted("p0", counter)));
    sub.unsubscribe();

    assert.equal(seen.length, 11);
    assert.equal(seen.at(-1).get("p0").size, N / 50 + 10);
    assert.ok(counter.n <= 20,
        `10 updates read ${counter.n} owners; want O(1) each, not O(${N})`);
});

test("the owned index emits once per Registration update", async () => {
    const { notify, updates } = scripted_notify();
    const cdb = fake_cdb(notify, {
        principals: [], permissions: [],
        principal_groups: {}, permission_groups: {},
    });
    const df = await make_dataflow(DataFlow, cdb, []);
    const seen = [];
    const sub = df.owned.subscribe(o => seen.push(o));

    updates.next(upd.child("a", 200, { owner: "p1" }));     /* ignored */
    updates.next(upd.full({ a: [200, { owner: "p1" }] }));
    updates.next(upd.child("a", 200, { owner: "p1" }));     /* no change */
    updates.next(upd.child("b", 403));                      /* error child */
    updates.next(upd.full(undefined, 403));                 /* parent error */
    updates.next(upd.child("c", 200, { owner: "p1" }));     /* ignored */
    sub.unsubscribe();

    assert.equal(seen.length, 3);
    assert.ok(imm.is(seen[1], seen[0]));
    assert.ok(imm.is(seen[2], index({ p1: ["a"] })));
});

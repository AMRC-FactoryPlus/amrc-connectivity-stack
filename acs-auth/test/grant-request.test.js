/*
 * ACS Auth service
 * Tests for the permission check on grant requests
 * Copyright 2026 University of Sheffield AMRC
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import Model from "../lib/model.js";

const PERM = "a8f0a7d6-0000-4000-8000-000000000001";
const GRANT = { principal: "p", permission: PERM, target: "t", plural: false };

/* A Model with no database. The txn runs `work` against fake queries
 * that record what was asked of them. */
function model () {
    const m = Object.create(Model.prototype);
    m.calls = [];
    m.txn = work => work({
        grant_new: g => { m.calls.push(["new", g]); return { status: 201 }; },
        grant_find: (uuid, permitted) => [permitted(PERM) ? 200 : 403, 1],
        grant_update: () => m.calls.push(["update"]),
        grant_delete: () => m.calls.push(["delete"]),
    });
    return m;
}

test("a caller with WriteACL on nothing gets 403 for a new grant", async () => {
    const m = model();
    const rv = await m.grant_request({ type: "grant", grant: GRANT, permitted: null });
    assert.deepEqual(rv, { status: 403 });
    assert.deepEqual(m.calls, []);
});

test("a caller with WriteACL on nothing gets 403 deleting a grant", async () => {
    const m = model();
    const rv = await m.grant_request({ type: "grant", uuid: "g", grant: null, permitted: null });
    assert.deepEqual(rv, { status: 403 });
    assert.deepEqual(m.calls, []);
});

test("a caller with WriteACL on the permission can make the grant", async () => {
    const m = model();
    const rv = await m.grant_request({ type: "grant", grant: GRANT, permitted: p => p == PERM });
    assert.deepEqual(rv, { status: 201 });
    assert.deepEqual(m.calls, [["new", GRANT]]);
});

test("a caller with WriteACL on another permission gets 403", async () => {
    const m = model();
    const rv = await m.grant_request({ type: "grant", grant: GRANT, permitted: () => false });
    assert.deepEqual(rv, { status: 403 });
});

/*
 * ACS Auth service
 * Tests for a principal reading its own ACL
 * Copyright 2026 University of Sheffield AMRC
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import * as rx from "rxjs";

import { DataFlow } from "../lib/dataflow.js";

const ALICE = "0c0e3d2a-0000-4000-8000-000000000001";
const PERM = "a8f0a7d6-0000-4000-8000-000000000001";
const TARG = "a8f0a7d6-0000-4000-8000-000000000002";
const ACL = [{ permission: PERM, target: TARG }];

/* A DataFlow with only the pieces track_own_acl uses. */
function dataflow (root) {
    const d = Object.create(DataFlow.prototype);
    d.root = root;
    d.track_kerberos = upn => rx.of(upn == "alice@REALM" ? ALICE : undefined);
    d.acl_for = p => rx.of(p == ALICE ? ACL : undefined);
    return d;
}

const own = (d, caller) => rx.firstValueFrom(d.track_own_acl(caller));

test("a Kerberos caller gets its own ACL and UUID", async () => {
    assert.deepEqual(await own(dataflow("admin@REALM"), "alice@REALM"),
        { principal: ALICE, root: false, acl: ACL });
});

test("a JWT caller is looked up by UUID", async () => {
    assert.deepEqual(await own(dataflow(), ALICE),
        { principal: ALICE, root: false, acl: ACL });
});

test("an unknown caller gets an empty ACL", async () => {
    assert.deepEqual(await own(dataflow(), "bob@REALM"),
        { principal: null, root: false, acl: [] });
});

test("the root principal is flagged as root", async () => {
    const rv = await own(dataflow("admin@REALM"), "admin@REALM");
    assert.equal(rv.root, true);
});

test("no root principal configured means nobody is root", async () => {
    const rv = await own(dataflow(undefined), "alice@REALM");
    assert.equal(rv.root, false);
});

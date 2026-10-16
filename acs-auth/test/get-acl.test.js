/*
 * ACS Auth service
 * Tests for the self-ACL-read bypass in the v2 ACL routes
 * Copyright 2026 University of Sheffield AMRC
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import imm from "immutable";
import * as rx from "rxjs";

import { DataFlow } from "../lib/dataflow.js";
import { APIv2 } from "../lib/api_v2.js";
import { AuthNotify } from "../lib/notify.js";
import { Perm, Special } from "../lib/uuids.js";

import { scripted_notify, fake_cdb } from "./fixtures.js";

const quiet = () => () => {};
const debug = { bound: quiet };

const P = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const p1 = P(1);        /* holds no grants of its own */
const p2 = P(2);        /* holds a wildcard ReadACL grant */
const permA = P(20);
const targA = P(30);
const upn1 = "user1@EXAMPLE.COM";

const classes = {
    principals:         [p1, p2],
    permissions:        [permA, Perm.ReadACL],
    principal_groups:   {},
    permission_groups:  {},
};

/* Like fixtures.js's make_dataflow, but also accepts identities (so
 * Kerberos-UPN callers can be resolved to a principal UUID) and fakes
 * an empty Registration index rather than leaving it unfed: these
 * tests don't exercise ownership, but DataFlow.owned still has to
 * emit once before `_acl_for`'s combineLatest can produce anything. */
async function build_df (grants, identities = []) {
    const { notify } = scripted_notify();
    const cdb = {
        ...fake_cdb(notify, classes),
        search_app_changes: () => rx.of({ map: imm.Map(), child: null, previous: null }),
    };
    const model = {
        grant_get_all:      async () => grants,
        identity_get_all:   async () => identities,
    };
    const fplus = { debug, ConfigDB: cdb };
    const df = new DataFlow({ fplus, model, root_principal: "root@TEST" });
    await rx.firstValueFrom(df.grants);
    await rx.firstValueFrom(df.identities);
    return df;
}

function fake_res () {
    return {
        status (s) { this._status = s; return this; },
        json (b) { this._body = b; return this; },
    };
}

const p1_grant = { principal: p1, permission: permA, target: targA, plural: false };
const p2_readacl_wild = {
    principal: p2, permission: Perm.ReadACL, target: Special.Wildcard, plural: false,
};

test("api_v2: a principal can read their own ACL without ReadACL", async () => {
    const df = await build_df([p1_grant]);
    const api = new APIv2({ data: df, debug });

    const res = fake_res();
    await api._get_acl({ auth: p1 }, res, p1);

    assert.equal(res._status, 200);
    assert.deepEqual(res._body, [{ permission: permA, target: targA }]);
});

test("api_v2: a principal without ReadACL cannot read another principal's ACL", async () => {
    const df = await build_df([p1_grant]);
    const api = new APIv2({ data: df, debug });

    await assert.rejects(
        () => api._get_acl({ auth: p1 }, fake_res(), p2),
        e => e.status === 403);
});

test("api_v2: a principal holding ReadACL still gets the filtered view of another's ACL", async () => {
    const df = await build_df([p1_grant, p2_readacl_wild]);
    const api = new APIv2({ data: df, debug });

    const res = fake_res();
    await api._get_acl({ auth: p2 }, res, p1);

    assert.equal(res._status, 200);
    assert.deepEqual(res._body, [{ permission: permA, target: targA }]);
});

test("api_v2: get_krb_acl self-lookup resolves a UPN caller to the same bypass", async () => {
    const df = await build_df([p1_grant], [{ uuid: p1, kind: "kerberos", name: upn1 }]);
    const api = new APIv2({ data: df, debug });

    const res = fake_res();
    await api.get_krb_acl({ auth: upn1, params: { upn: upn1 } }, res);

    assert.equal(res._status, 200);
    assert.deepEqual(res._body, [{ permission: permA, target: targA }]);
});

test("notify: a principal can watch their own ACL without ReadACL", async () => {
    const df = await build_df([p1_grant]);
    const an = new AuthNotify({ data: df, debug, api: null });

    const u = await rx.firstValueFrom(an.get_acl({ principal: p1 }, p1));
    assert.equal(u.response.status, 200);
    assert.deepEqual(u.response.body, [{ permission: permA, target: targA }]);
});

test("notify: a principal without ReadACL cannot watch another principal's ACL", async () => {
    const df = await build_df([p1_grant]);
    const an = new AuthNotify({ data: df, debug, api: null });

    const u = await rx.firstValueFrom(an.get_acl({ principal: p1 }, p2));
    assert.equal(u.response.status, 403);
});

test("notify: a principal holding ReadACL still gets the filtered view of another's ACL", async () => {
    const df = await build_df([p1_grant, p2_readacl_wild]);
    const an = new AuthNotify({ data: df, debug, api: null });

    const u = await rx.firstValueFrom(an.get_acl({ principal: p2 }, p1));
    assert.equal(u.response.status, 200);
    assert.deepEqual(u.response.body, [{ permission: permA, target: targA }]);
});

test("notify: get_krb_acl self-lookup resolves a UPN caller to the same bypass", async () => {
    const df = await build_df([p1_grant], [{ uuid: p1, kind: "kerberos", name: upn1 }]);
    const an = new AuthNotify({ data: df, debug, api: null });

    const u = await rx.firstValueFrom(an.get_krb_acl({ principal: upn1 }, upn1));
    assert.equal(u.response.status, 200);
    assert.deepEqual(u.response.body, [{ permission: permA, target: targA }]);
});

/*
 * Factory+ / AMRC Connectivity Stack (ACS) Command Escalation component
 * Tests for ACL lookup by caller identity
 * Copyright 2026 University of Sheffield
 */

import { test }             from "node:test";
import assert               from "node:assert/strict";

import * as imm             from "immutable";
import * as rx              from "rxjs";

import { Address, UUIDs }    from "@amrc-factoryplus/service-client";

import CmdEscD                  from "../lib/cmdescd.js";
import ApiV1                    from "../lib/api_v1.js";

const CALLER = "fa45e723-1076-4d2b-99aa-95f7f0208a31";
const UPN = "someone@REALM.EXAMPLE";
const PERM = "0b3c1d33-6f7e-4a3c-9d5e-7f1a2b3c4d5e";
const NODE = "5d7c8f3e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
const TARGET = new Address("Group", "Node");

/* A fake Auth error, as the rx client's notify interface throws one. */
class FakeError extends Error {
    constructor (status) {
        super("Notify request failed");
        this.status = status;
    }
}

/* A CmdEscD with a fake service client. `acl` is called with the
 * identity type and name and returns the ACL or throws. */
function harness (acl) {
    const queries = [];
    const published = [];
    const fplus = {
        debug:  { log: () => {} },
        Auth:   {
            root_principal: "root@REALM.EXAMPLE",
            fetch_auth_acl: async (type, name) => {
                queries.push([type, name]);
                return acl(type, name);
            },
        },
        ConfigDB: {
            search_app: app => rx.of(app == UUIDs.App.SparkplugAddress
                ? imm.Map([[NODE, { group_id: "Group", node_id: "Node" }]])
                : imm.Map([[PERM, [{ name: "Rebirth", type: "Boolean" }]]])),
        },
    };
    const cmdesc = new CmdEscD({ fplus });
    cmdesc.addresses = rx.of(imm.Map([[NODE, TARGET]]));
    cmdesc.templates = rx.of(imm.Map([[PERM,
        [{ name: "Rebirth", type: "Boolean" }]]]));
    cmdesc.mqtt.publish = async opts => {
        published.push(opts);
        return true;
    };
    return { cmdesc, queries, published };
}

const grant = () => [{ permission: PERM, target: NODE }];
const cmd = () => ({ name: "Rebirth", value: true });

test("a UUID caller's ACL is read by principal UUID", async () => {
    const { cmdesc, queries, published } = harness(grant);
    const st = await cmdesc.execute_command(CALLER, TARGET, cmd());
    assert.equal(st, 200);
    assert.deepEqual(queries, [["uuid", CALLER]]);
    assert.equal(published[0].from, `uuid:${CALLER}`);
});

test("a UPN caller's ACL is still read by Kerberos name", async () => {
    const { cmdesc, queries, published } = harness(grant);
    const st = await cmdesc.execute_command(UPN, TARGET, cmd());
    assert.equal(st, 200);
    assert.deepEqual(queries, [["kerberos", UPN]]);
    assert.equal(published[0].from, `kerberos:${UPN}`);
});

test("a caller Auth does not know is refused with 403", async () => {
    const { cmdesc, published } = harness(() => { throw new FakeError(404); });
    const st = await cmdesc.execute_command(CALLER, TARGET, cmd());
    assert.equal(st, 403);
    assert.equal(published.length, 0);
});

test("an Auth failure refuses the request with 503", async () => {
    const { cmdesc, published } = harness(() => { throw new FakeError(500); });
    const st = await cmdesc.execute_command(CALLER, TARGET, cmd());
    assert.equal(st, 503);
    assert.equal(published.length, 0);
});

test("a caller without the permission is refused with 403", async () => {
    const { cmdesc } = harness(() => []);
    const st = await cmdesc.execute_command(CALLER, TARGET, cmd());
    assert.equal(st, 403);
});

test("the HTTP handler answers even if the command throws", async () => {
    const api = new ApiV1({ cmdesc: {
        execute_command: async () => { throw new Error("boom"); },
    } });
    let status;
    const res = {
        status (s) { status = s; return this; },
        end () {},
    };
    const req = {
        headers:    {
            "content-type":     "application/json",
            "content-length":   "2",
        },
        params:     { group: "Group", node: "Node" },
        auth:       CALLER,
        body:       {},
    };
    await api.by_address(req, res);
    assert.equal(status, 503);
});

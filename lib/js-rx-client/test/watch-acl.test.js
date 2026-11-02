/*
 * Factory+ Rx interface
 * Tests for Auth.watch_acl URL selection
 * Copyright 2026 University of Sheffield AMRC
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import * as rx from "rxjs";

import { Auth } from "../lib/auth.js";

const UUID = "2d5f2a7e-8f63-4f8b-9a43-6a0c1f7b3e21";

/* Build an Auth without running its constructor, so no service
 * client or notify socket is needed. `_watch_acl` records the path
 * it was asked for and replies with an empty ACL. */
function harness () {
    const auth = Object.create(Auth.prototype);
    const paths = [];
    auth._watch_acl = path => {
        paths.push(path);
        return rx.of({ status: 200, body: [] });
    };
    return { auth, paths };
}

async function url_for (principal) {
    const { auth, paths } = harness();
    await rx.firstValueFrom(auth.watch_acl(principal));
    assert.equal(paths.length, 1);
    return paths[0];
}

test("a UPN uses the kerberos path", async () => {
    assert.equal(await url_for("svc/host@REALM.EXAMPLE"),
        "v2/acl/kerberos/svc%2Fhost%40REALM.EXAMPLE");
});

test("a UUID string uses the principal UUID path", async () => {
    assert.equal(await url_for(UUID), `v2/acl/${UUID}`);
});

test("a [uuid, name] pair uses the principal UUID path", async () => {
    assert.equal(await url_for(["uuid", UUID]), `v2/acl/${UUID}`);
});

test("a { type: name } object uses that identity type", async () => {
    assert.equal(await url_for({ kerberos: "user@REALM.EXAMPLE" }),
        "v2/acl/kerberos/user%40REALM.EXAMPLE");
});

test("watch_acl_with_perm filters by permission", async () => {
    const { auth } = harness();
    auth._watch_acl = () => rx.of({ status: 200, body: [
        { permission: "p1", target: "t1" },
        { permission: "p2", target: "t2" },
    ] });
    const set = await rx.firstValueFrom(auth.watch_acl_with_perm(UUID, "p1"));
    assert.deepEqual([...set], ["t1"]);
});

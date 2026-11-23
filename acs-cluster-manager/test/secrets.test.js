/*
 * ACS Cluster Manager
 * Tests for the Create secrets permission
 * Copyright 2026 University of Sheffield AMRC
 *
 * Manage secrets lets a client set any key in a sealed secret. Create
 * secrets only lets it add a key which is not there yet. These check
 * the permission choice in the route and the key check made against
 * the manifests read from the cluster repo, and the secret-access
 * route which reports the same decision to the Admin UI.
 */

import assert           from "node:assert/strict";
import { describe, test } from "node:test";

import { EdgeDeploy }       from "../lib/edge-deploy.js";
import { set_sealed_key }   from "../lib/secrets.js";
import { Edge }             from "../lib/uuids.js";

const debug = { bound: () => () => {} };

const opts = { namespace: "fplus-edge", name: "sensitive", key: "__FPSI__new" };

function existing () {
    return [{
        apiVersion: "bitnami.com/v1alpha1",
        kind: "SealedSecret",
        metadata: { namespace: "fplus-edge", name: "sensitive" },
        spec: { encryptedData: { __FPSI__old: "OLD" } },
    }];
}

describe("set_sealed_key", () => {
    test("creates the manifest when the secret file is empty", () => {
        const sss = [];
        assert.equal(set_sealed_key(sss, { ...opts, create_only: true }, "NEW"), true);
        assert.equal(sss.length, 1);
        assert.equal(sss[0].kind, "SealedSecret");
        assert.deepEqual(sss[0].spec.encryptedData, { __FPSI__new: "NEW" });
    });

    test("adds a new key alongside existing ones when create-only", () => {
        const sss = existing();
        assert.equal(set_sealed_key(sss, { ...opts, create_only: true }, "NEW"), true);
        assert.deepEqual(sss[0].spec.encryptedData,
            { __FPSI__old: "OLD", __FPSI__new: "NEW" });
    });

    test("refuses to replace an existing key when create-only", () => {
        const sss = existing();
        const rv = set_sealed_key(sss,
            { ...opts, key: "__FPSI__old", create_only: true }, "NEW");
        assert.equal(rv, false);
        assert.deepEqual(sss[0].spec.encryptedData, { __FPSI__old: "OLD" });
    });

    test("replaces an existing key without create-only", () => {
        const sss = existing();
        const rv = set_sealed_key(sss, { ...opts, key: "__FPSI__old" }, "NEW");
        assert.equal(rv, true);
        assert.deepEqual(sss[0].spec.encryptedData, { __FPSI__old: "NEW" });
    });

    test("does not mistake an inherited property for a key", () => {
        const sss = existing();
        const rv = set_sealed_key(sss,
            { ...opts, key: "constructor", create_only: true }, "NEW");
        assert.equal(rv, true);
        assert.equal(sss[0].spec.encryptedData.constructor, "NEW");
    });
});

/* Run a route handler with a client holding the given permissions.
 * Returns the response status and JSON body, and the opts passed to
 * SealedSecrets, or undefined if the handler never got that far. */
async function call (method, perms, secret_st = 204) {
    const fplus = {
        debug,
        Auth: {
            check_acl: async (principal, perm, target, wild) => {
                assert.equal(principal, "client@EXAMPLE.ORG");
                assert.equal(target, "cluster-uuid");
                assert.equal(wild, true);
                return perms.includes(perm);
            },
        },
    };
    const ed = new EdgeDeploy({ fplus });
    let seen;
    ed.secrets = {
        seal_secret: async o => { seen = o; return secret_st; },
        delete_secret: async o => { seen = o; return secret_st; },
    };

    let status, body;
    const res = {
        status (s) { status = s; return this; },
        end () {},
        json (b) { body = b; },
    };
    const req = {
        auth:   "client@EXAMPLE.ORG",
        params: { cluster: "cluster-uuid", ...opts },
        query:  {},
    };
    await ed[method](req, res);
    return { status, seen, body };
}

describe("PUT secret permissions", () => {
    test("Manage secrets may set any key", async () => {
        const { status, seen } = await call("seal_secret", [Edge.Perm.Secrets]);
        assert.equal(status, 204);
        assert.ok(!seen.create_only);
    });

    test("Manage secrets with Create secrets is not limited", async () => {
        const { seen } = await call("seal_secret",
            [Edge.Perm.Secrets, Edge.Perm.CreateSecrets]);
        assert.ok(!seen.create_only);
    });

    test("Create secrets alone may only add new keys", async () => {
        const { status, seen } = await call("seal_secret",
            [Edge.Perm.CreateSecrets]);
        assert.equal(status, 204);
        assert.equal(seen.create_only, true);
    });

    test("a refused overwrite is passed back as 403", async () => {
        const { status } = await call("seal_secret",
            [Edge.Perm.CreateSecrets], 403);
        assert.equal(status, 403);
    });

    test("no permission is refused before sealing", async () => {
        const { status, seen } = await call("seal_secret", []);
        assert.equal(status, 403);
        assert.equal(seen, undefined);
    });
});

describe("DELETE secret permissions", () => {
    test("Manage secrets may delete", async () => {
        const { status } = await call("delete_sealed_secret",
            [Edge.Perm.Secrets]);
        assert.equal(status, 204);
    });

    test("Create secrets may not delete", async () => {
        const { status, seen } = await call("delete_sealed_secret",
            [Edge.Perm.CreateSecrets]);
        assert.equal(status, 403);
        assert.equal(seen, undefined);
    });
});

describe("GET secret-access", () => {
    test("Manage secrets may manage and create", async () => {
        const { status, body } = await call("secret_access",
            [Edge.Perm.Secrets]);
        assert.equal(status, 200);
        assert.deepEqual(body, { manage: true, create: true });
    });

    test("Create secrets alone may only create", async () => {
        const { status, body } = await call("secret_access",
            [Edge.Perm.CreateSecrets]);
        assert.equal(status, 200);
        assert.deepEqual(body, { manage: false, create: true });
    });

    test("no permission may do neither, and is not refused", async () => {
        const { status, body } = await call("secret_access", []);
        assert.equal(status, 200);
        assert.deepEqual(body, { manage: false, create: false });
    });
});

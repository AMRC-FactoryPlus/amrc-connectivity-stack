/*
 * ACS Files
 * Tests for the v1 file API: DELETE, and the upload's checks and 409
 * Copyright 2026 University of Sheffield
 */

import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { UUIDs } from "@amrc-factoryplus/service-client";

import { App, Class, Perm, Special } from "../lib/constants.js";

import { start_files } from "./harness.js";

/* Edge.Class.ScoutResult, the class of scan snapshots. */
const ScoutResult = "10916e96-f6fe-44cc-8c01-16a775426038";
/* A class of files the Edge Agent must not fill, like
 * Edge.Class.DeliveryFile. */
const OtherClass = "ffffffff-0000-4000-8000-000000000001";

const AGENT = "agent@test";
const AGENT_B = "agent-b@test";
const ADMIN = "admin@test";
const NOBODY = "nobody@test";

const SCOUT_FILE = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER_FILE = "aaaaaaaa-0000-4000-8000-000000000002";
const MISSING = "aaaaaaaa-0000-4000-8000-000000000003";
const SCOUT_FILE_B = "aaaaaaaa-0000-4000-8000-000000000004";

/* The agents hold their snapshot grants on Special.Mine, as
 * dumps/helm.yaml gives them, and each owns the snapshots it made. */
function site () {
    const agent_grants = principal => [Perm.Upload, Perm.Download, Perm.Delete]
        .map(permission => ({ principal, permission, target: UUIDs.Special.Mine }));
    return {
        classes: new Map([
            [Class.File, new Set([SCOUT_FILE, OTHER_FILE, SCOUT_FILE_B])],
            [ScoutResult, new Set([SCOUT_FILE, SCOUT_FILE_B])],
            [OtherClass, new Set([OTHER_FILE])],
        ]),
        owned: new Map([
            [AGENT, new Set([SCOUT_FILE])],
            [AGENT_B, new Set([SCOUT_FILE_B])],
        ]),
        grants: [
            ...agent_grants(AGENT),
            ...agent_grants(AGENT_B),
            { principal: ADMIN, permission: Perm.Delete, target: Special.Null },
            { principal: ADMIN, permission: Perm.Upload, target: Special.Null },
            { principal: ADMIN, permission: Perm.Download, target: Special.Null },
        ],
    };
}

let files;

beforeEach(async () => { files = await start_files(site()); });
afterEach(async () => { await files.close(); });

const exists = p => fs.access(p).then(() => true, () => false);

async function upload (uuid, principal, body) {
    return files.request("PUT", uuid, principal, body);
}

describe("DELETE /v1/file/:uuid", () => {
    test("removes the content and the upload record, and answers 204", async () => {
        assert.equal((await upload(SCOUT_FILE, AGENT, "snapshot")).status, 201);
        const stored = path.join(files.dir, SCOUT_FILE);
        assert.ok(await exists(stored));
        assert.ok(await files.cdb.get_config(App.Config, SCOUT_FILE));

        const res = await files.request("DELETE", SCOUT_FILE, AGENT);
        assert.equal(res.status, 204);
        assert.equal(await res.text(), "");

        assert.equal(await exists(stored), false);
        assert.equal(await files.cdb.get_config(App.Config, SCOUT_FILE), undefined);
    });

    test("answers 204 for a file that was never uploaded", async () => {
        const res = await files.request("DELETE", SCOUT_FILE, AGENT);
        assert.equal(res.status, 204);
        assert.deepEqual(files.cdb.deletes,
            [{ app: App.Config, obj: SCOUT_FILE }]);
    });

    test("is idempotent", async () => {
        await upload(SCOUT_FILE, AGENT, "snapshot");
        assert.equal((await files.request("DELETE", SCOUT_FILE, AGENT)).status, 204);
        assert.equal((await files.request("DELETE", SCOUT_FILE, AGENT)).status, 204);
    });

    test("checks Delete against the file UUID with wildcards, so class grants apply", async () => {
        await files.request("DELETE", SCOUT_FILE, AGENT);
        assert.deepEqual(files.auth.checks.at(-1), {
            principal: AGENT, permission: Perm.Delete,
            target: SCOUT_FILE, wild: true,
        });
    });

    test("refuses a file outside the granted class with 403 and keeps it", async () => {
        assert.equal((await upload(OTHER_FILE, ADMIN, "other")).status, 201);

        const res = await files.request("DELETE", OTHER_FILE, AGENT);
        assert.equal(res.status, 403);
        assert.ok(await exists(path.join(files.dir, OTHER_FILE)));
        assert.ok(await files.cdb.get_config(App.Config, OTHER_FILE));
        assert.deepEqual(files.cdb.deletes, []);
    });

    test("refuses a principal with no grant", async () => {
        await upload(SCOUT_FILE, AGENT, "snapshot");
        const res = await files.request("DELETE", SCOUT_FILE, NOBODY);
        assert.equal(res.status, 403);
        assert.ok(await exists(path.join(files.dir, SCOUT_FILE)));
    });

    test("refuses an object that no longer exists, because class grants no longer match", async () => {
        const res = await files.request("DELETE", MISSING, AGENT);
        assert.equal(res.status, 403);
    });

    test("a wildcard grant may delete any file", async () => {
        await upload(OTHER_FILE, ADMIN, "other");
        assert.equal((await files.request("DELETE", OTHER_FILE, ADMIN)).status, 204);
        assert.equal(await exists(path.join(files.dir, OTHER_FILE)), false);
    });

    test("refuses a UUID that is not valid with 400, before any check", async () => {
        const res = await files.request("DELETE", "not-a-uuid", ADMIN);
        assert.equal(res.status, 400);
        assert.deepEqual(files.auth.checks, []);
    });

    test("does not touch other files or an upload in progress", async () => {
        await upload(SCOUT_FILE, AGENT, "snapshot");
        await upload(OTHER_FILE, ADMIN, "other");
        const temp = path.join(files.dir, `${SCOUT_FILE}.temp`);
        await fs.writeFile(temp, "partial");

        assert.equal((await files.request("DELETE", SCOUT_FILE, AGENT)).status, 204);
        assert.ok(await exists(path.join(files.dir, OTHER_FILE)));
        assert.ok(await exists(temp));
    });

    test("answers 503 when the ConfigDB delete fails, and a retry succeeds", async () => {
        await upload(SCOUT_FILE, AGENT, "snapshot");
        files.cdb.fail_delete = 500;

        assert.equal((await files.request("DELETE", SCOUT_FILE, AGENT)).status, 503);
        assert.equal(await exists(path.join(files.dir, SCOUT_FILE)), false);

        assert.equal((await files.request("DELETE", SCOUT_FILE, AGENT)).status, 204);
        assert.equal(await files.cdb.get_config(App.Config, SCOUT_FILE), undefined);
    });

    test("a deleted file reads as 404", async () => {
        await upload(SCOUT_FILE, AGENT, "snapshot");
        await files.request("DELETE", SCOUT_FILE, AGENT);
        const res = await files.request("GET", SCOUT_FILE, AGENT);
        assert.equal(res.status, 404);
    });
});

describe("PUT /v1/file/:uuid", () => {
    test("stores the content once", async () => {
        assert.equal((await upload(SCOUT_FILE, AGENT, "snapshot")).status, 201);
        const res = await files.request("GET", SCOUT_FILE, AGENT);
        assert.equal(res.status, 200);
        assert.equal(await res.text(), "snapshot");
    });

    test("refuses to overwrite existing content with 409", async () => {
        await upload(SCOUT_FILE, AGENT, "snapshot");
        const res = await upload(SCOUT_FILE, AGENT, "replacement");
        assert.equal(res.status, 409);

        const stored = await fs.readFile(path.join(files.dir, SCOUT_FILE), "utf8");
        assert.equal(stored, "snapshot");
        assert.equal(await exists(path.join(files.dir, `${SCOUT_FILE}.temp`)), false);
    });

    test("accepts new content after a delete", async () => {
        await upload(SCOUT_FILE, AGENT, "first");
        await files.request("DELETE", SCOUT_FILE, AGENT);
        assert.equal((await upload(SCOUT_FILE, AGENT, "second")).status, 201);
    });

    test("refuses an object that is not a File with 404", async () => {
        const res = await upload(MISSING, ADMIN, "snapshot");
        assert.equal(res.status, 404);
    });

    test("refuses a principal without Upload with 403", async () => {
        const res = await upload(SCOUT_FILE, NOBODY, "snapshot");
        assert.equal(res.status, 403);
    });

    test("refuses a UUID that is not valid with 400, before any check", async () => {
        const res = await upload("not-a-uuid", ADMIN, "snapshot");
        assert.equal(res.status, 400);
        assert.deepEqual(files.auth.checks, []);
    });

    test("checks Upload against the file UUID with wildcards", async () => {
        await upload(SCOUT_FILE, AGENT, "snapshot");
        assert.deepEqual(files.auth.checks[0], {
            principal: AGENT, permission: Perm.Upload,
            target: SCOUT_FILE, wild: true,
        });
    });

    test("a wildcard grant may still upload to any File object", async () => {
        assert.equal((await upload(OTHER_FILE, ADMIN, "other")).status, 201);
        assert.equal((await upload(SCOUT_FILE, ADMIN, "snapshot")).status, 201);
    });

    test("refuses to fill a File object the grant does not cover", async () => {
        /* An empty File object of another class, such as a delivery
         * file created before its upload. */
        const res = await upload(OTHER_FILE, AGENT, "not a delivery");
        assert.equal(res.status, 403);
        assert.equal(await exists(path.join(files.dir, OTHER_FILE)), false);
        assert.equal(await files.cdb.get_config(App.Config, OTHER_FILE), undefined);
    });
});

describe("one agent and another agent's snapshot", () => {
    test("cannot delete it, so cannot replace its content", async () => {
        assert.equal((await upload(SCOUT_FILE, AGENT, "A's addresses")).status, 201);

        assert.equal((await files.request("DELETE", SCOUT_FILE, AGENT_B)).status, 403);
        assert.equal((await upload(SCOUT_FILE, AGENT_B, "B's addresses")).status, 403);

        const stored = await fs.readFile(path.join(files.dir, SCOUT_FILE), "utf8");
        assert.equal(stored, "A's addresses");
        assert.ok(await files.cdb.get_config(App.Config, SCOUT_FILE));
    });

    test("cannot fill it before its owner uploads", async () => {
        assert.equal((await upload(SCOUT_FILE, AGENT_B, "B's addresses")).status, 403);
        assert.equal(await exists(path.join(files.dir, SCOUT_FILE)), false);
        assert.equal((await upload(SCOUT_FILE, AGENT, "A's addresses")).status, 201);
    });

    test("cannot read it", async () => {
        await upload(SCOUT_FILE, AGENT, "A's addresses");
        assert.equal((await files.request("GET", SCOUT_FILE, AGENT_B)).status, 403);
        assert.equal((await files.request("GET", SCOUT_FILE, AGENT)).status, 200);
        assert.equal((await files.request("GET", SCOUT_FILE, ADMIN)).status, 200);
    });

    test("each agent still manages its own", async () => {
        assert.equal((await upload(SCOUT_FILE_B, AGENT_B, "B's addresses")).status, 201);
        assert.equal((await files.request("DELETE", SCOUT_FILE_B, AGENT_B)).status, 204);
    });
});

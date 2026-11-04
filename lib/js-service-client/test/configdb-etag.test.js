/*
 * Factory+ NodeJS Utilities
 * Tests for the ConfigDB If-Match option
 * Copyright 2026 University of Sheffield AMRC
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { ConfigDB } from "../lib/service/configdb.js";
import { ServiceError } from "../lib/service/service-interface.js";

const APP = "11111111-1111-1111-1111-111111111111";
const OBJ = "22222222-2222-2222-2222-222222222222";
const ETAG = "33333333-3333-4333-8333-333333333333";

/* A ConfigDB whose fetch records the request and answers `status`. */
function harness (status) {
    const requests = [];
    const cdb = Object.create(ConfigDB.prototype);
    cdb.service = "configdb";
    cdb.fetch = async opts => {
        requests.push(opts);
        return [status];
    };
    return { cdb, requests };
}

test("put_config sends no If-Match by default", async () => {
    const { cdb, requests } = harness(204);
    await cdb.put_config(APP, OBJ, { a: 1 });
    assert.equal(requests[0].headers["If-Match"], undefined);
});

test("put_config sends If-Match with an etag", async () => {
    const { cdb, requests } = harness(204);
    await cdb.put_config(APP, OBJ, { a: 1 }, { etag: ETAG });
    assert.equal(requests[0].headers["If-Match"], `"${ETAG}"`);
});

test("patch_config sends If-Match with an etag", async () => {
    const { cdb, requests } = harness(204);
    await cdb.patch_config(APP, OBJ, "merge", { a: 1 }, { etag: ETAG });
    assert.equal(requests[0].headers["If-Match"], `"${ETAG}"`);
    assert.equal(requests[0].content_type, "application/merge-patch+json");
});

test("a stale etag throws a ServiceError with status 412", async () => {
    const { cdb } = harness(412);
    await assert.rejects(cdb.put_config(APP, OBJ, {}, { etag: ETAG }),
        e => e instanceof ServiceError && e.status == 412);
    await assert.rejects(cdb.patch_config(APP, OBJ, "merge", {}, { etag: ETAG }),
        e => e instanceof ServiceError && e.status == 412);
});

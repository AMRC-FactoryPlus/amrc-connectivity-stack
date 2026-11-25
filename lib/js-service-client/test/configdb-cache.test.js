/*
 * Factory+ NodeJS Utilities
 * Tests for reading the ConfigDB past the HTTP cache
 * Copyright 2026 University of Sheffield AMRC
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { ConfigDB } from "../lib/service/configdb.js";

const APP = "11111111-1111-1111-1111-111111111111";
const OBJ = "22222222-2222-2222-2222-222222222222";

/* A ConfigDB whose requests are recorded. `fetch` is the interface's
 * own request method (get_config), `fplus.fetch` the raw one
 * (search). */
function harness () {
    const requests = [];
    const cdb = Object.create(ConfigDB.prototype);
    cdb.service = "configdb";
    cdb.fetch = async opts => {
        requests.push(opts);
        return [200, { a: 1 }, "etag"];
    };
    cdb.fplus = {
        fetch: async opts => {
            requests.push(opts);
            return { ok: true, status: 200, json: async () => [OBJ] };
        },
    };
    return { cdb, requests };
}

test("search uses the default cache mode unless asked", async () => {
    const { cdb, requests } = harness();
    assert.deepEqual(await cdb.search({ app: APP, query: { a: 1 } }), [OBJ]);
    assert.equal("cache" in requests[0], false);
    await cdb.search(APP, { a: 1 }, {});
    assert.equal("cache" in requests[1], false);
});

test("search passes a cache mode through", async () => {
    const { cdb, requests } = harness();
    await cdb.search({ app: APP, query: { a: 1 }, cache: "no-cache" });
    assert.equal(requests[0].cache, "no-cache");
    assert.equal(requests[0].query.a, "1");
    assert.equal(requests[0].query.cache, undefined);
});

test("get_config passes a cache mode through", async () => {
    const { cdb, requests } = harness();
    assert.deepEqual(await cdb.get_config(APP, OBJ), { a: 1 });
    assert.equal("cache" in requests[0], false);
    await cdb.get_config(APP, OBJ, { cache: "no-cache" });
    assert.equal(requests[1].cache, "no-cache");
});

/*
 * Factory+ NodeJS Utilities
 * Tests for ConfigDB.create_object request bodies
 * Copyright 2026 University of Sheffield AMRC
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { ConfigDB } from "../lib/service/configdb.js";

const KLASS = "11111111-1111-1111-1111-111111111111";
const OBJ = "22222222-2222-2222-2222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";

/* A ConfigDB whose fetch records the request and answers 201. */
function harness () {
    const requests = [];
    const cdb = Object.create(ConfigDB.prototype);
    cdb.fetch = async opts => {
        requests.push(opts);
        return [201, { uuid: OBJ }];
    };
    /* The body as it goes on the wire, after JSON drops undefined. */
    const sent = () => JSON.parse(JSON.stringify(requests.at(-1).body));
    return { cdb, sent };
}

test("class only sends the class", async () => {
    const { cdb, sent } = harness();
    await cdb.create_object(KLASS);
    assert.deepEqual(sent(), { "class": KLASS });
});

test("class and uuid send both, as before", async () => {
    const { cdb, sent } = harness();
    await cdb.create_object(KLASS, OBJ, true);
    assert.deepEqual(sent(), { "class": KLASS, uuid: OBJ });
});

test("an owner is sent when given", async () => {
    const { cdb, sent } = harness();
    await cdb.create_object(KLASS, undefined, false, OWNER);
    assert.deepEqual(sent(), { "class": KLASS, owner: OWNER });
});

test("a null or undefined owner is never sent", async () => {
    for (const owner of [null, undefined]) {
        const { cdb, sent } = harness();
        await cdb.create_object(KLASS, undefined, false, owner);
        assert.deepEqual(sent(), { "class": KLASS });
    }
});

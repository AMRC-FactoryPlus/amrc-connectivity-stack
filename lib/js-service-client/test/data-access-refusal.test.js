/*
 * Factory+ NodeJS Utilities
 * Tests for the refusal bodies of DataAccess.create_dataset and
 * update_dataset
 * Copyright 2026 University of Sheffield AMRC
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { DataAccess } from "../lib/service/data-access.js";
import { ServiceError } from "../lib/service/service-interface.js";

const DATASET = "11111111-1111-1111-1111-111111111111";
const STRUCTURE = "22222222-2222-2222-2222-222222222222";
const DEVICE = "33333333-3333-4333-8333-333333333333";

/* A DataAccess whose fetch answers with the given status and body. */
function harness (status, body) {
    const da = Object.create(DataAccess.prototype);
    da.service = "data-access";
    da.fetch = async () => [status, body];
    return da;
}

const refused = {
    error: "placement_required",
    message: `Device ${DEVICE} has no ISA-95 placement.`,
    device: DEVICE,
};

test("create_dataset passes a refusal's JSON body through", async () => {
    const da = harness(422, refused);
    await assert.rejects(
        da.create_dataset(STRUCTURE, { source: DEVICE }),
        err => {
            assert.ok(err instanceof ServiceError);
            assert.equal(err.status, 422);
            assert.deepEqual(err.body, refused);
            assert.match(err.message, /no ISA-95 placement/);
            return true;
        });
});

test("create_dataset still refuses a plain-text error", async () => {
    const da = harness(422, undefined);
    await assert.rejects(
        da.create_dataset(STRUCTURE, { source: DEVICE }),
        err => err.status == 422 && err.body === undefined
            && err.message == "Can't create a dataset");
});

test("create_dataset keeps its 403 message", async () => {
    const da = harness(403, undefined);
    await assert.rejects(
        da.create_dataset(STRUCTURE, { source: DEVICE }),
        err => err.status == 403 && /Unauthorised/.test(err.message));
});

test("update_dataset passes a refusal's JSON body through", async () => {
    const body = { error: "structure_retired", message: "Use another kind.", use: [STRUCTURE] };
    const da = harness(422, body);
    await assert.rejects(
        da.update_dataset(DATASET, STRUCTURE, { source: DEVICE }),
        err => err.status == 422 && err.body.error == "structure_retired");
});

test("create_dataset returns the new dataset's UUID", async () => {
    const da = harness(200, DATASET);
    assert.equal(await da.create_dataset(STRUCTURE, { source: DEVICE }), DATASET);
});

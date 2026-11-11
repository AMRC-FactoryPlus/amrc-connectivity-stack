/*
 * ACS Briefcase exporter
 * Tests for keeping and recording briefcases
 * Copyright 2026 University of Sheffield
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { App, FileType } from "../lib/constants.js";
import { Store, live_briefcase } from "../lib/store.js";

const DATASET = "11111111-1111-4111-8111-111111111111";
const X = { uuid: "0b5e3a52-7f41-4c2e-a8d6-6a9f3e2d1c40" };
const Y = { uuid: "1c6f4b63-8052-4d3f-b9e7-7ba0f4e3e2d1", replaces: X.uuid };

function make_store (entry) {
    const puts = [];
    const uploads = [];
    const fplus = {
        ConfigDB: {
            get_config: async (app, obj) => {
                assert.equal(app, App.BriefcaseRelease);
                assert.equal(obj, DATASET);
                return structuredClone(entry);
            },
            put_config: async (app, obj, json) => {
                assert.equal(app, App.BriefcaseRelease);
                puts.push({ obj, json });
            },
        },
        Files: {
            upload_file: async (type, file) => {
                uploads.push({ type, file });
                return "f0000000-0000-4000-8000-000000000000";
            },
        },
    };
    return { store: new Store({ fplus }), puts, uploads };
}

test("the live briefcase is the last, if not withdrawn", () => {
    assert.equal(live_briefcase(undefined), null);
    assert.deepEqual(live_briefcase({ briefcases: [{ ...X, withdrawn: "t" }, Y] }), Y);
    assert.equal(live_briefcase({ briefcases: [X, { ...Y, withdrawn: "t" }] }), null);
});

test("uploads a zip as a Briefcase file", async () => {
    const { store, uploads } = make_store();
    assert.equal(await store.upload("/work/b.zip"), "f0000000-0000-4000-8000-000000000000");
    assert.deepEqual(uploads, [{ type: FileType.Briefcase, file: "/work/b.zip" }]);
});

test("records the first briefcase of a dataset", async () => {
    const { store, puts } = make_store(undefined);
    await store.record(DATASET, X);
    assert.deepEqual(puts, [{ obj: DATASET, json: { briefcases: [X] } }]);
});

test("adds a briefcase to the end of the history", async () => {
    const old = { ...X, withdrawn: "2026-10-29T13:00:00Z" };
    const { store, puts } = make_store({ briefcases: [old] });
    await store.record(DATASET, Y);
    assert.deepEqual(puts[0].json, { briefcases: [old, Y] });
});

test("withdraws only the live briefcase", async () => {
    const old = { ...X, withdrawn: "2026-10-29T13:00:00Z" };
    const { store, puts } = make_store({ briefcases: [old, Y] });
    assert.equal(await store.withdraw(DATASET, "2026-10-30T09:00:00Z"), Y.uuid);
    assert.deepEqual(puts[0].json, { briefcases: [
        old, { ...Y, withdrawn: "2026-10-30T09:00:00Z" },
    ] });
});

test("withdrawing with nothing live writes nothing", async () => {
    const { store, puts } = make_store({ briefcases: [{ ...X, withdrawn: "t" }] });
    assert.equal(await store.withdraw(DATASET, "2026-10-30T09:00:00Z"), null);
    assert.deepEqual(puts, []);
});

/*
 * ACS Directory
 * Tests that only the root principal can load a dump
 * Copyright 2026 University of Sheffield
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { Loader } from "../lib/loader.js";

const ROOT = "root@EXAMPLE.COM";

function mk_loader () {
    const loads = [];
    const model = {
        dump_load: async req => { loads.push(req); return 204; },
    };
    const fplus = { opts: { root_principal: ROOT } };
    return { loads, loader: new Loader({ model, fplus }) };
}

function mk_res () {
    const res = { statuses: [], ended: 0 };
    res.status = code => { res.statuses.push(code); return res; };
    res.end = () => { res.ended++; return res; };
    res.json = () => { res.ended++; return res; };
    return res;
}

test("a non-root caller's dump is not loaded", async () => {
    const { loads, loader } = mk_loader();
    const res = mk_res();

    await loader.load({ auth: "someone@EXAMPLE.COM", body: {} }, res);

    assert.equal(loads.length, 0);
    assert.deepEqual(res.statuses, [403]);
    assert.equal(res.ended, 1);
});

test("the root principal's dump is loaded", async () => {
    const { loads, loader } = mk_loader();
    const res = mk_res();

    await loader.load({ auth: ROOT, body: {} }, res);

    assert.equal(loads.length, 1);
    assert.deepEqual(res.statuses, [204]);
});

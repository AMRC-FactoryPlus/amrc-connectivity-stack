/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Deployment operator
 * Tests that a checkout retries a clone which fails in passing
 * Copyright 2026 University of Sheffield
 */

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs_p from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { Checkout } from "../lib/checkout.js";

/* A server which answers with the statuses given, in order. */
let server, url, statuses, hits, tmp;
const logs = [];

before(async () => {
    server = http.createServer((req, res) => {
        hits++;
        res.statusCode = statuses.shift() ?? 404;
        res.end();
    });
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${server.address().port}/uuid/repo`;
    tmp = await fs_p.mkdtemp(path.join(os.tmpdir(), "cm-test-"));
});

after(async () => {
    server.closeAllConnections();
    server.close();
    await fs_p.rm(tmp, { recursive: true, force: true });
});

const fplus = () => ({
    opts:   { git_checkouts: tmp, git_email: "test@example.com" },
    debug:  { bound: () => (...args) => logs.push(args) },
    Git:    { remote: async () => ({ url }) },
});

test("a clone which gets a 503 is tried again, and a 404 is not", async () => {
    statuses = [503, 404];
    hits = 0;
    await assert.rejects(
        Checkout.clone({ fplus: fplus(), uuid: "repo" }),
        err => err.code == "HttpError" && err.data.statusCode == 404);
    assert.equal(hits, 2);
    assert.ok(logs.some(l => /retrying/.test(l[0])), "logged the retry");
    /* Neither try leaves a checkout directory behind. */
    assert.deepEqual(await fs_p.readdir(tmp), []);
});

test("a clone which gets a 403 is not tried again", async () => {
    statuses = [403];
    hits = 0;
    await assert.rejects(
        Checkout.clone({ fplus: fplus(), uuid: "repo" }),
        { code: "HttpError" });
    assert.equal(hits, 1);
});

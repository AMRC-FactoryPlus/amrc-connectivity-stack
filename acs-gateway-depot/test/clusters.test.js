/*
 * ACS Gateway Depot
 * Tests for enrolling edge clusters with the Cluster Manager.
 * Copyright 2026 University of Sheffield AMRC
 */

import assert       from "node:assert/strict";
import { test }     from "node:test";

import { Clusters }     from "../lib/clusters.js";
import { DepotError }   from "../lib/errors.js";

/* A Clusters whose Cluster Manager answers each call with the next
 * entry in replies: a status, or "down" for a failed connection. */
function clusters_with (replies) {
    const calls = [];
    const fplus = {
        ConfigDB:   {},
        debug:      { bound: () => () => {} },
        Fetch: {
            fetch: async (opts) => {
                calls.push(opts);
                const reply = replies.shift() ?? "down";
                if (reply == "down") throw new TypeError("fetch failed");
                return {
                    status: reply,
                    json:   async () => ({ token: "tok", bootstrap: "boot" }),
                };
            },
        },
    };
    return { clusters: new Clusters({ fplus }), calls };
}

test("enrolling tries again when the Cluster Manager cannot be reached", async () => {
    const { clusters, calls } = clusters_with(["down", "down", 404, 200]);
    const res = await clusters.enrol("uuid", 1000, 1);
    assert.deepEqual(res, { token: "tok", bootstrap: "boot" });
    assert.equal(calls.length, 4);
});

test("a Cluster Manager that stays unreachable is reported as unreachable", async () => {
    const { clusters } = clusters_with([]);
    await assert.rejects(clusters.enrol("uuid", 20, 1), e =>
        e instanceof DepotError && /could not reach the Cluster Manager/.test(e.message));
});

test("a cluster that never gets ready is reported as not ready in time", async () => {
    const { clusters } = clusters_with(Array(1000).fill(404));
    await assert.rejects(clusters.enrol("uuid", 20, 1), e =>
        e instanceof DepotError && /did not finish preparing/.test(e.message));
});

test("a refusal is not retried", async () => {
    const { clusters, calls } = clusters_with([500, 200]);
    await assert.rejects(clusters.enrol("uuid", 1000, 1), e =>
        e instanceof DepotError && /status 500/.test(e.message));
    assert.equal(calls.length, 1);
});

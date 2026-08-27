/*
 * ACS simulator driver
 * Cassette-proxy tests: load-by-command through a fake edge agent.
 * Copyright 2026 University of Sheffield AMRC
 */

import assert from "node:assert";
import { test } from "node:test";

import { SimHandler } from "../lib/sim.js";

const UUID = "0e3f4b1c-9a2d-4c5e-8f6a-7b8c9d0e1f2a";
const DOC = {
    cassette: { name: "t", version: 1 },
    channels: [{ id: 0, path: "A/B" }],
    samples: [[0, 0, 1]],
};

/* A fake edge-driver Driver plus the agent on the far side of the
 * local broker. `agent` decides how a req/cassette is answered. */
function fakeDriver (agent) {
    const handlers = new Map();
    const published = [];
    const driver = {
        debug: { bound: () => () => {} },
        topic: (msg, data) => `fpEdge1/test/${msg}` + (data ? `/${data}` : ""),
        message: (k, h) => handlers.set(k, h),
        data: (spec, buf) => published.push([spec.addr, JSON.parse(buf)]),
        mqtt: {
            subscribeAsync: async () => {},
            publishAsync: async (topic, payload) => {
                assert.strictEqual(topic, "fpEdge1/test/req/cassette");
                const body = await agent(payload);
                if (body != null)
                    handlers.get("rsp")(
                        Buffer.from(JSON.stringify(body)), "cassette");
            },
        },
    };
    return { driver, published };
}

test("load command fetches through the agent and loads the player", async () => {
    const { driver, published } = fakeDriver(
        async uuid => ({ uuid, cassette: DOC }));
    const h = SimHandler.create(driver, {});
    await h.connect();
    await h.subscribe([
        h.parseAddr("player:status"), h.parseAddr("A/B")]);

    await h.cmd("player:load", Buffer.from(UUID));

    assert.strictEqual(h.player.status, "LOADED");
    assert.strictEqual(h.player.cassette.cassette.uuid, UUID);
    const status = published.filter(([a]) => a == "player:status").at(-1);
    assert.strictEqual(status[1].value, "LOADED");
    await h.close();
});

test("an agent-side error surfaces on player:error", async () => {
    const { driver, published } = fakeDriver(
        async uuid => ({ uuid, error: "Cassette not found in ConfigDB" }));
    const h = SimHandler.create(driver, {});
    await h.connect();
    await h.subscribe([h.parseAddr("player:error")]);

    await h.cmd("player:load", Buffer.from(UUID));

    assert.strictEqual(h.player.status, "EMPTY");
    const err = published.filter(([a]) => a == "player:error").at(-1);
    assert.match(err[1].value, /not found/);
    await h.close();
});

test("no reply from the agent times out", async () => {
    const { driver } = fakeDriver(async () => null);
    const h = SimHandler.create(driver, {});
    await h.connect();
    await assert.rejects(
        h.requestCassette(UUID, 20),
        /timed out waiting for the edge agent/);
    await h.close();
});

test("stray or mismatched responses are ignored", async () => {
    const { driver } = fakeDriver(async uuid =>
        ({ uuid: "some-other-uuid", cassette: DOC }));
    const h = SimHandler.create(driver, {});
    await h.connect();
    await assert.rejects(
        h.requestCassette(UUID, 20),
        /timed out/);
    await h.close();
});

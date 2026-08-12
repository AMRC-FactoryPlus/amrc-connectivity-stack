/*
 * ACS Pathfindr driver
 * Handler tests.
 * Copyright 2026 University of Sheffield AMRC
 *
 * Run with `node --test test/`.
 *
 * These are mostly about failure mapping. Getting it wrong is expensive in
 * opposite directions: treat a 404 as a connection fault and one bad address
 * takes down every metric on the connection; treat a revoked secret as
 * transient and the connection sits there quietly serving nothing.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { PathfindrHandler } from "../lib/pathfindr.js";
import { PathfindrError } from "../lib/api.js";

function fake_driver () {
    const calls = [];
    return {
        calls,
        debug:       { bound: () => () => {} },
        connUnauth:  () => calls.push("connUnauth"),
        connFailed:  () => calls.push("connFailed"),
    };
}

const CONF = {
    baseURL:      "https://acme.test",
    clientId:     "id",
    clientSecret: "secret",
};

test("create rejects an incomplete config", () => {
    /* Better to report CONF once than to fail every poll forever. */
    for (const conf of [
        undefined,
        {},
        { baseURL: "https://acme.test" },
        { baseURL: "https://acme.test", clientId: "id" },
        { clientId: "id", clientSecret: "secret" },
    ]) {
        assert.equal(PathfindrHandler.create(fake_driver(), conf), undefined);
    }
});

test("create accepts a complete config", () => {
    const h = PathfindrHandler.create(fake_driver(), CONF);
    assert.ok(h instanceof PathfindrHandler);
});

test("parseAddr works detached from the handler", () => {
    /* The driver library stores this function and calls it unbound, so it
     * must never reach for `this`. */
    const h = PathfindrHandler.create(fake_driver(), CONF);
    const detached = h.parseAddr;
    assert.equal(detached("assets/SN1").req.path, "assets");
    assert.equal(detached("rubbish"), undefined);
});

test("a poll returns the selected value as JSON", async () => {
    const h = PathfindrHandler.create(fake_driver(), CONF);
    h.api.fetch = async () => ([
        { serialno: "SN1", enviro: { latest_temperature: 21 } },
    ]);

    const buf = await h.poll({
        addr: "enviro/SN1",
        req:  { key: "assets", path: "assets", query: {}, collection: true },
        select: { ident: "SN1", field: "enviro" },
    });

    assert.deepEqual(JSON.parse(buf.toString()), { latest_temperature: 21 });
});

test("an absent asset yields no data and no connection change", async () => {
    const driver = fake_driver();
    const h = PathfindrHandler.create(driver, CONF);
    h.api.fetch = async () => ([{ serialno: "SN1" }]);

    const buf = await h.poll({
        addr: "enviro/NOPE",
        req:  { key: "assets", path: "assets", query: {}, collection: true },
        select: { ident: "NOPE", field: "enviro" },
    });

    assert.equal(buf, undefined);
    assert.deepEqual(driver.calls, [],
        "a missing serial is not a connection fault");
});

test("an auth failure is reported to the driver", async () => {
    const driver = fake_driver();
    const h = PathfindrHandler.create(driver, CONF);
    h.api.fetch = async () => { throw new PathfindrError("auth", "401"); };

    assert.equal(await h.poll({ addr: "assets", req: {}, select: null }), undefined);
    assert.deepEqual(driver.calls, ["connUnauth"]);
});

test("a connection failure is reported to the driver", async () => {
    const driver = fake_driver();
    const h = PathfindrHandler.create(driver, CONF);
    h.api.fetch = async () => { throw new PathfindrError("conn", "ECONNREFUSED"); };

    assert.equal(await h.poll({ addr: "assets", req: {}, select: null }), undefined);
    assert.deepEqual(driver.calls, ["connFailed"]);
});

test("rate limiting skips the poll without touching the connection", async () => {
    /* Transient by definition. The Edge Agent will ask again shortly. */
    const driver = fake_driver();
    const h = PathfindrHandler.create(driver, CONF);
    h.api.fetch = async () => { throw new PathfindrError("rate", "429"); };

    assert.equal(await h.poll({ addr: "assets", req: {}, select: null }), undefined);
    assert.deepEqual(driver.calls, []);
});

test("an HTTP error on one address does not take down the connection", async () => {
    /* A 404 for a building that was deleted must not stop every other
     * metric on the connection from reporting. */
    const driver = fake_driver();
    const h = PathfindrHandler.create(driver, CONF);
    h.api.fetch = async () => { throw new PathfindrError("http", "404"); };

    assert.equal(await h.poll({ addr: "buildings/99", req: {}, select: null }),
        undefined);
    assert.deepEqual(driver.calls, []);
});

test("an unexpected error is contained", async () => {
    const driver = fake_driver();
    const h = PathfindrHandler.create(driver, CONF);
    h.api.fetch = async () => { throw new TypeError("something odd"); };

    assert.equal(await h.poll({ addr: "assets", req: {}, select: null }), undefined);
    assert.deepEqual(driver.calls, []);
});

test("live: beacon resolves the serial then reads beacon_info", async () => {
    /* Battery is the single most useful field on a BLE tag, and it lives
     * only on the single-asset endpoint. Two fetches: the cached collection
     * to turn the serial into an id, then the asset itself. */
    const h = PathfindrHandler.create(fake_driver(), CONF);
    const seen = [];
    h.api.fetch = async req => {
        seen.push(req.path);
        if (req.path === "assets")
            return [{ id: "3731", serialno: "Tag 1" }];
        return { id: "3731", beacon_info: { battery: 78, serial: "EGRSX" } };
    };

    const buf = await h.poll(h.parseAddr("beacon/Tag 1"));

    assert.deepEqual(seen, ["assets", "assets/3731"]);
    assert.deepEqual(JSON.parse(buf.toString()),
        { battery: 78, serial: "EGRSX" });
});

test("live: beacon for an unknown serial yields nothing, quietly", async () => {
    const driver = fake_driver();
    const h = PathfindrHandler.create(driver, CONF);
    h.api.fetch = async () => ([{ id: "3731", serialno: "Tag 1" }]);

    assert.equal(await h.poll(h.parseAddr("beacon/Nope")), undefined);
    assert.deepEqual(driver.calls, [],
        "an unknown serial is not a connection fault");
});

test("close releases the client", async () => {
    const h = PathfindrHandler.create(fake_driver(), CONF);
    h.api.cache.set("x", { at: Date.now(), value: 1 });
    await h.close();
    assert.equal(h.api.cache.size, 0);
});

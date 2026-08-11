/*
 * ACS Pathfindr driver
 * Address parsing tests.
 * Copyright 2026 University of Sheffield AMRC
 *
 * Run with `node --test test/`.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { parse_addr, select_value } from "../lib/addr.js";

test("collections parse to a paginated request", () => {
    for (const [addr, path] of [
        ["assets",   "assets"],
        ["runtime",  "assets/runtimedata"],
        ["activity", "assets/activitydata"],
    ]) {
        const spec = parse_addr(addr);
        assert.ok(spec, `${addr} should parse`);
        assert.equal(spec.req.path, path);
        assert.equal(spec.req.collection, true);
        assert.equal(spec.select, null);
    }
});

test("a per-asset address rides on the collection request", () => {
    /* This is the whole rate-limit strategy: an asset address must not
     * produce a request of its own. */
    const all = parse_addr("assets");
    const one = parse_addr("assets/SN123");

    assert.equal(one.req.key, all.req.key);
    assert.deepEqual(one.select, { ident: "SN123", field: null });
});

test("projections ride on the asset collection too", () => {
    const assets = parse_addr("assets").req.key;

    for (const [addr, field] of [
        ["enviro/SN1",   "enviro"],
        ["fluid/SN1",    "fluid_level_latest"],
        ["location/SN1", "location_data"],
        ["attrs/SN1",    "attrs"],
    ]) {
        const spec = parse_addr(addr);
        assert.ok(spec, `${addr} should parse`);
        assert.equal(spec.req.key, assets,
            `${addr} must not cost an extra request`);
        assert.equal(spec.select.field, field);
        assert.equal(spec.select.ident, "SN1");
    }
});

test("histories are per-serial requests", () => {
    const spec = parse_addr("envirohistory/SN123");
    assert.equal(spec.req.path, "assets/envirohistory");
    assert.deepEqual(spec.req.query, { serial: "SN123" });
    assert.equal(spec.req.collection, true);
    assert.equal(spec.select, null);

    /* Different serials must not share a cache entry. */
    assert.notEqual(spec.req.key, parse_addr("envirohistory/SN999").req.key);
});

test("all four history endpoints map to documented paths", () => {
    assert.equal(parse_addr("impacthistory/S").req.path, "assets/impacthistory");
    assert.equal(parse_addr("runtimehistory/S").req.path, "assets/runtimehistory");
    assert.equal(parse_addr("activityhistory/S").req.path,
        "assets/activitydatahistory");
});

test("buildings and cells", () => {
    assert.equal(parse_addr("buildings/55").req.path, "buildings/55");
    assert.equal(parse_addr("buildings/55").req.collection, false);
    assert.equal(parse_addr("buildings/55/cells").req.path, "buildings/55/cells");
    assert.equal(parse_addr("buildings/55/assets").req.path, "buildings/55/assets");
    assert.equal(parse_addr("cells/7/zones").req.path, "cells/7/zones");
    assert.equal(parse_addr("cells/7/assets").req.path, "cells/7/assets");
});

test("invalid addresses are rejected", () => {
    for (const addr of [
        "",
        "/",
        "nonsense",
        "assets/",
        "/assets",
        "assets//SN1",
        "assets/SN1/extra",
        "buildings",             // no bare cells or buildings collection
        "cells/7",               // cells have no single-object endpoint
        "buildings/notanumber",
        "buildings/55/widgets",
        "cells/7/widgets",
        "enviro",                // projection needs a serial
        "envirohistory",
        "a/b/c/d",
    ]) {
        assert.equal(parse_addr(addr), undefined, `${addr} should be rejected`);
    }
});

test("non-string input is rejected", () => {
    for (const addr of [null, undefined, 42, {}, []])
        assert.equal(parse_addr(addr), undefined);
});

test("serials that would break the query string are rejected", () => {
    /* A serial is interpolated into a query parameter, so anything that
     * could smuggle in another parameter has to go. */
    for (const bad of ["a?b", "a&b", "a#b", "a/b"])
        assert.equal(parse_addr(`envirohistory/${bad}`), undefined);

    assert.equal(parse_addr(`assets/${"x".repeat(200)}`), undefined);
});

test("ordinary site serials are accepted", () => {
    for (const good of ["SN123", "USSD 34", "F859C1", "A-1/", "abc.def"]) {
        if (good.includes("/")) continue;
        assert.ok(parse_addr(`assets/${good}`), `${good} should be accepted`);
    }
});

test("parse_addr is pure and unbound-safe", () => {
    /* The driver library calls this detached from the handler, so it must
     * never touch `this`, and must give the same answer every time. */
    const detached = parse_addr;
    const a = detached("assets/SN1");
    const b = detached("assets/SN1");
    assert.deepEqual(a, b);
});

test("cache keys are stable regardless of query ordering", () => {
    const spec = parse_addr("envirohistory/SN1");
    assert.equal(spec.req.key, "assets/envirohistory?serial=SN1");
});

test("select_value picks an asset out of a collection", () => {
    const body = [
        { serialno: "SN1", partno: "A", enviro: { latest_temperature: 20 } },
        { serialno: "SN2", partno: "B", enviro: { latest_temperature: 9 } },
    ];

    assert.equal(select_value(body, { ident: "SN2", field: null }).partno, "B");
    assert.deepEqual(select_value(body, { ident: "SN1", field: "enviro" }),
        { latest_temperature: 20 });
});

test("select_value returns undefined for an absent asset or field", () => {
    const body = [{ serialno: "SN1" }];
    assert.equal(select_value(body, { ident: "NOPE", field: null }), undefined);
    assert.equal(select_value(body, { ident: "SN1", field: "enviro" }), undefined);
});

test("select_value compares serials as strings", () => {
    /* An all-digits serial could plausibly come back as a number. */
    const body = [{ serialno: 12345, partno: "A" }];
    assert.equal(select_value(body, { ident: "12345", field: null }).partno, "A");
});

test("select_value handles a single-object body", () => {
    const body = { serialno: "SN1", partno: "A" };
    assert.equal(select_value(body, { ident: "SN1", field: null }).partno, "A");
});

test("select_value with no select returns the body", () => {
    const body = [{ serialno: "SN1" }];
    assert.equal(select_value(body, null), body);
});

test("select_value tolerates nulls in the collection", () => {
    assert.equal(select_value([null, { serialno: "SN1" }],
        { ident: "SN1", field: null }).serialno, "SN1");
});

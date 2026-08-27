/*
 * ACS Pathfindr driver
 * Address parsing tests.
 * Copyright 2026 University of Sheffield AMRC
 *
 * Run with `node --test test/`.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { parse_addr, select_value, resolve_id } from "../lib/addr.js";

/* The tests below marked "live" encode behaviour confirmed against
 * portal.pathfindr.co.uk in August 2026, where the running service and the
 * published documentation disagree. They are the regression guards for what
 * that exercise found. */

test("live: the asset collection asks for the attribute list", () => {
    /* Without include=attributes the `attributes` key is absent from every
     * record, so attrs/<serial> would silently always be empty. `enviro` is
     * not a valid include; the service rejects it outright. */
    const spec = parse_addr("assets");
    assert.equal(spec.req.query.include, "attributes");
    assert.equal(parse_addr("attrs/SN1").req.query.include, "attributes");
});

test("live: history addresses fetch only the first page", () => {
    /* The enviro endpoint ignores per_page and forces 1440 records a page.
     * One tag had 11,089 records over 8 pages, so walking them to read the
     * current temperature would cost 8 calls and 11k records per poll. */
    for (const addr of [
        "envirohistory/SN1", "impacthistory/SN1",
        "runtimehistory/SN1", "activityhistory/SN1",
    ]) {
        assert.equal(parse_addr(addr).req.firstPage, true, addr);
    }
});

test("live: collections are not capped to the first page", () => {
    /* The asset sweep genuinely does need every page. */
    assert.equal(parse_addr("assets").req.firstPage, false);
    assert.equal(parse_addr("runtime").req.firstPage, false);
    assert.equal(parse_addr("buildings/83/cells").req.firstPage, false);
});

test("live: detail projections all share one asset fetch", () => {
    /* /assets/{id} returns enviro, beacon_info and last_known_height_cm in
     * one response. Battery, temperature, humidity and height for the same
     * asset must therefore resolve to the same request, so they cost one
     * call between them rather than one call each. */
    const specs = ["enviro/S6336-UWB", "beacon/S6336-UWB", "height/S6336-UWB"]
        .map(parse_addr);

    for (const s of specs) {
        assert.ok(s, "should parse");
        assert.deepEqual(s.resolve, { ident: "S6336-UWB", path: "assets" });
        assert.equal(s.req.key, parse_addr("assets").req.key,
            "resolution rides on the cached collection");
    }

    assert.deepEqual(specs.map(s => s.select.field),
        ["enviro", "beacon_info", "last_known_height_cm"]);
});

test("live: enviro comes from the asset, not the collection", () => {
    /* The collection carries an `enviro` key but leaves it null; only
     * /assets/{id} fills it in. Serving it from the sweep would publish
     * nulls forever. */
    const spec = parse_addr("enviro/S6336-UWB");
    assert.ok(spec.resolve, "enviro must resolve to the single asset");
    assert.equal(spec.select.ident, null);
});

test("live: location and attrs stay on the cheap collection path", () => {
    /* These are populated in the sweep, so they must not trigger a
     * per-asset fetch. */
    for (const addr of ["location/S6336-UWB", "attrs/S6336-UWB"]) {
        const spec = parse_addr(addr);
        assert.equal(spec.resolve, undefined,
            `${addr} should not need a second call`);
        assert.equal(spec.select.ident, "S6336-UWB");
    }
});

test("live: beacon resolves a serial to an id before fetching", () => {
    /* beacon_info, which carries the battery level, appears only on the
     * single-asset endpoint and never on the collection. */
    const spec = parse_addr("beacon/Tag 1");
    assert.ok(spec, "beacon/<serial> should parse");
    assert.equal(spec.req.key, parse_addr("assets").req.key,
        "resolution rides on the cached collection");
    assert.deepEqual(spec.resolve, { ident: "Tag 1", path: "assets" });
    assert.equal(spec.select.field, "beacon_info");
    assert.equal(spec.select.ident, null);
});

test("resolve_id finds an asset id by serial", () => {
    const body = [
        { id: "3731", serialno: "Tag 1" },
        { id: "4926", serialno: "Tag 2" },
    ];
    assert.equal(resolve_id(body, "Tag 2"), "4926");
    assert.equal(resolve_id(body, "Nope"), undefined);
    assert.equal(resolve_id([], "Tag 1"), undefined);
});

test("select_value with a null ident takes the record as given", () => {
    /* After a resolve step the body is already the one asset we wanted. */
    const body = { id: "3731", beacon_info: { battery: 78 } };
    assert.deepEqual(select_value(body, { ident: null, field: "beacon_info" }),
        { battery: 78 });
});

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

test("collection projections cost nothing beyond the sweep", () => {
    /* Only the fields the collection actually populates. `enviro` and
     * `fluid_level_latest` were once here, but the collection leaves them
     * null; see the detail-projection tests below. */
    const assets = parse_addr("assets").req.key;

    for (const [addr, field] of [
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

/*
 * Factory+ NodeJS Utilities
 * Tests for engineering unit UUIDs, labels and the UNECE table
 * Copyright 2026 University of Sheffield AMRC
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { eng_unit_labels, eng_unit_uuid } from "../lib/eng-units.js";
import { UNECE_UNITS } from "../lib/unece-units.js";
import { Special } from "../lib/uuids.js";
import { uuid_v5 } from "../lib/uuid-v5.js";

test("a unit's UUID is a v5 UUID of its code", () => {
    const kwh = eng_unit_uuid("KWH");
    assert.equal(kwh,
        uuid_v5(`${Special.V5EngineeringUnit}:KWH`, Special.FactoryPlus));
    assert.match(kwh, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(eng_unit_uuid("KWH"), kwh);
    assert.notEqual(eng_unit_uuid("WHR"), kwh);
});

test("a unit's labels are its symbol, then its aliases", () => {
    assert.deepEqual(
        eng_unit_labels({ code: "KWH", symbol: "kW·h", aliases: ["kWh"] }),
        ["kW·h", "kWh"]);
    assert.deepEqual(eng_unit_labels({ code: "CEL", symbol: "°C" }), ["°C"]);
});

test("the UNECE table has one row per code", () => {
    assert.ok(UNECE_UNITS.length > 1800);
    const codes = UNECE_UNITS.map(u => u[0]);
    assert.equal(new Set(codes).size, codes.length);
    for (const [code, symbol, name] of UNECE_UNITS) {
        assert.match(code, /^[A-Z0-9]{2,3}$/);
        assert.equal(typeof symbol, "string");
        assert.equal(typeof name, "string");
    }
});

test("the UNECE table has the OPC UA display names", () => {
    const by_code = new Map(UNECE_UNITS.map(u => [u[0], u]));
    assert.deepEqual(by_code.get("KWH"), ["KWH", "kW·h", "kilowatt hour"]);
    assert.deepEqual(by_code.get("CEL"), ["CEL", "°C", "degree Celsius"]);
    assert.deepEqual(by_code.get("MTQ"), ["MTQ", "m³", "cubic metre"]);
});

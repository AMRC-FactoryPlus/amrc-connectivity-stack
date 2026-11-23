/*
 * Factory+ NodeJS Utilities
 * Tests for UNECE unit lookup and matching
 * Copyright 2026 University of Sheffield AMRC
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { ascii_form, unece_match, unece_unit } from "../lib/unece.js";
import { UNECE_UNITS } from "../lib/unece-units.js";

const code = str => unece_match(str)?.code;

test("a unit is looked up by its code", () => {
    assert.deepEqual(unece_unit("KWH"),
        { code: "KWH", symbol: "kW·h", name: "kilowatt hour" });
    assert.equal(unece_unit("XYZ"), undefined);
});

test("ASCII forms drop middle dots and replace superscripts and micro", () => {
    assert.equal(ascii_form("kW·h"), "kWh");
    assert.equal(ascii_form("m³/h"), "m3/h");
    assert.equal(ascii_form("m/s²"), "m/s2");
    assert.equal(ascii_form("µm"), "um");
    assert.equal(ascii_form("°C"), "°C");
});

test("the unit strings seen on production match the expected codes", () => {
    const want = {
        "V": "VLT", "A": "AMP", "kWh": "KWH", "°C": "CEL", "kW": "KWT",
        "kVA": "KVA", "kVARh": "K3", "kVAR": "KVR", "kVAh": "C79",
        "W": "WTT", "%": "P1", "m3": "MTQ", "K": "KEL", "N/m": "4P",
        "mA": "4K", "m3/h": "MQH", "s": "SEC", "%RH": "P1", "Wh": "WHR",
        "mm": "MMT", "h": "HUR", "Hz": "HTZ",
    };
    for (const [str, c] of Object.entries(want))
        assert.equal(code(str), c, str);
});

test("display names, ASCII forms and spellings all match", () => {
    assert.equal(code("kW·h"), "KWH");
    assert.equal(code("m³"), "MTQ");
    assert.equal(code("degC"), "CEL");
    assert.equal(code("rpm"), "M46");
    assert.equal(code(" kWh "), "KWH");
});

test("case matters", () => {
    assert.equal(code("mW"), "C31");
    assert.equal(code("MW"), "MAW");
    assert.equal(code("KWH"), undefined);
});

test("display names with several codes match the preferred one", () => {
    assert.equal(code("V"), "VLT");
    assert.equal(code("kvar"), "KVR");
    assert.equal(code("rad"), "C81");
    assert.equal(code("MJ/m³"), "JM");
    assert.equal(code("MJ/m3"), "JM");
    assert.equal(code("Nm/m2"), "M34");
});

test("every display name and ASCII form matches at most one code", () => {
    for (const [c, symbol] of UNECE_UNITS) {
        const m = unece_match(symbol);
        assert.ok(m, `${symbol} (${c}) matches nothing`);
        assert.equal(m.symbol, symbol, `${symbol} matches ${m.code}`);
    }
});

test("strings that are not units match nothing", () => {
    assert.equal(unece_match("$.transformedReading"), undefined);
    assert.equal(unece_match(""), undefined);
    assert.equal(unece_match(undefined), undefined);
    assert.equal(unece_match(7), undefined);
});

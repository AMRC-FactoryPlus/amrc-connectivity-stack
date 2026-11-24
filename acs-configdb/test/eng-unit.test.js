/*
 * ACS ConfigDB
 * Tests for the Engineering unit special app's checks
 * Copyright 2026 University of Sheffield AMRC
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { eng_unit_uuid } from "@amrc-factoryplus/service-client";

import { eng_unit_problem } from "../lib/special.js";

const kwh = { code: "KWH", symbol: "kW·h", aliases: ["kWh"] };
const cel = { code: "CEL", symbol: "°C" };
const others = [cel, { code: "WHR", symbol: "W·h", aliases: ["Wh"] }];

test("a unit with a UNECE code, its own UUID and unique labels is accepted", () => {
    assert.equal(eng_unit_problem(eng_unit_uuid("KWH"), kwh, others), undefined);
    assert.equal(eng_unit_problem(eng_unit_uuid("KWH"), kwh, []), undefined);
});

test("a code that is not in the UNECE table is refused", () => {
    const unit = { code: "XYZ", symbol: "xyz" };
    assert.match(eng_unit_problem(eng_unit_uuid("XYZ"), unit, []),
        /XYZ is not a UNECE code/);
});

test("a unit on an object whose UUID is not the one for its code is refused", () => {
    assert.match(eng_unit_problem(eng_unit_uuid("WHR"), kwh, []),
        /is not the UUID for KWH/);
    assert.match(
        eng_unit_problem("0f6a7b4e-6c1b-4c34-9a55-2f3a2f2c2b11", kwh, []),
        /is not the UUID for KWH/);
});

test("a symbol or alias that already means another unit is refused", () => {
    const by_symbol = { code: "KWH", symbol: "°C" };
    assert.match(eng_unit_problem(eng_unit_uuid("KWH"), by_symbol, others),
        /"°C" already means CEL/);

    const by_alias = { code: "KWH", symbol: "kW·h", aliases: ["Wh"] };
    assert.match(eng_unit_problem(eng_unit_uuid("KWH"), by_alias, others),
        /"Wh" already means WHR/);

    const onto_alias = { code: "KWH", symbol: "W·h" };
    assert.match(eng_unit_problem(eng_unit_uuid("KWH"), onto_alias, others),
        /"W·h" already means WHR/);
});

test("labels compare exactly, so units differing only in case are distinct", () => {
    const mw = { code: "C31", symbol: "mW" };
    const big_mw = [{ code: "MAW", symbol: "MW" }];
    assert.equal(eng_unit_problem(eng_unit_uuid("C31"), mw, big_mw), undefined);
});

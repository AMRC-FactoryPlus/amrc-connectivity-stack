/*
 * ACS service setup
 * Tests for seeding the engineering unit vocabulary
 * Copyright 2026 University of Sheffield AMRC
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { UUIDs, eng_unit_uuid } from "@amrc-factoryplus/service-client";

import {
    COMMON_UNITS, MigrateEngUnits, plan_units, schema_units,
} from "../lib/eng-units.js";
import { FakeCDB } from "./fake-cdb.js";

const { App, Class } = UUIDs;

const metric = (unit, type = "Double") =>
    ({ Sparkplug_Type: type, ...(unit === undefined ? {} : { Eng_Unit: unit }) });

/* Units by code, from a plan's vocabulary. */
const by_code = plan => new Map([...plan.units.values()].map(u => [u.code, u]));

test("schema units are the Eng_Unit defaults", () => {
    const counts = schema_units({
        properties: {
            Fill: { allOf: [{ $ref: "metric" },
                { properties: { Eng_Unit: { default: "%" } } }] },
            Load: { allOf: [{ $ref: "metric" },
                { properties: { Eng_Unit: { const: "kW" } } }] },
            Plain: { properties: { Eng_Unit: { type: "string" } } },
        },
    });
    assert.deepEqual(Object.fromEntries(counts), { "%": 1, kW: 1 });
});

test("an empty vocabulary gets the units in use, written as they are used", () => {
    const plan = plan_units(new Map(), new Map([
        ["kWh", 69], ["V", 235], ["%", 30], ["m3", 11], ["kVAR", 44], ["kvar", 2],
        ["$.transformedReading", 1],
    ]), false);
    const units = by_code(plan);

    assert.deepEqual(units.get("KWH"), { code: "KWH", symbol: "kWh", aliases: ["kW·h"] });
    assert.deepEqual(units.get("VLT"), { code: "VLT", symbol: "V" });
    assert.deepEqual(units.get("P1"), { code: "P1", symbol: "%" });
    assert.deepEqual(units.get("MTQ"), { code: "MTQ", symbol: "m3", aliases: ["m³"] });
    /* The most used spelling is the symbol. */
    assert.deepEqual(units.get("KVR"), { code: "KVR", symbol: "kVAR", aliases: ["kvar"] });

    assert.equal(plan.created.length, 5);
    assert.equal(plan.names.get(eng_unit_uuid("KWH")), "kilowatt hour");
    for (const uuid of plan.created)
        assert.equal(uuid, eng_unit_uuid(plan.units.get(uuid).code));
    assert.deepEqual(plan.unresolved, [["$.transformedReading", 1]]);
});

test("the common units are added only when asked, around the units in use", () => {
    const plan = plan_units(new Map(), new Map([["kWh", 3]]), true);
    const units = by_code(plan);
    assert.equal(plan.created.length, COMMON_UNITS.length);
    assert.equal(units.get("KWH").symbol, "kWh");
    assert.deepEqual(units.get("CEL"), { code: "CEL", symbol: "°C" });
    assert.deepEqual(units.get("P1"), { code: "P1", symbol: "%" });

    assert.equal(plan_units(new Map(), new Map(), false).created.length, 0);
});

test("a string the vocabulary resolves changes nothing", () => {
    const existing = new Map([[eng_unit_uuid("KWH"), { code: "KWH", symbol: "kWh" }]]);
    const plan = plan_units(existing, new Map([["kWh", 10]]), false);
    assert.deepEqual(plan.created, []);
    assert.deepEqual(plan.changed, []);
});

test("a new spelling of a unit there is becomes an alias of it", () => {
    const uuid = eng_unit_uuid("KWH");
    const existing = new Map([[uuid, { code: "KWH", symbol: "kWh" }]]);
    const plan = plan_units(existing, new Map([["kWh", 10], ["kW·h", 1]]), false);
    assert.deepEqual(plan.created, []);
    assert.deepEqual(plan.changed, [uuid]);
    assert.deepEqual(plan.units.get(uuid), { code: "KWH", symbol: "kWh", aliases: ["kW·h"] });
    /* The vocabulary it was given is not changed. */
    assert.deepEqual(existing.get(uuid), { code: "KWH", symbol: "kWh" });
});

test("a common unit whose symbol already means another unit is left out", () => {
    const existing = new Map([[eng_unit_uuid("2G"), { code: "2G", symbol: "V AC", aliases: ["V"] }]]);
    const plan = plan_units(existing, new Map(), true);
    assert.equal(by_code(plan).has("VLT"), false);
    assert.equal(by_code(plan).has("AMP"), true);
});

test("the migration writes the units, then does nothing the second time", async () => {
    const cdb = new FakeCDB();
    cdb.set(App.DeviceInformation, "dev-1", { originMap: {
        Energy: metric("kWh"), Voltage: metric("V"), Odd: metric("$.transformedReading"),
    } });
    cdb.set(App.DeviceInformation, "dev-2", { originMap: { Energy: metric("kWh") } });
    cdb.set(App.Schema, "schema-1", {
        properties: { Fill: { properties: { Eng_Unit: { default: "%" } } } },
    });

    const logs = [];
    const migrate = () => new MigrateEngUnits({
        fplus: { ConfigDB: cdb }, log: (...a) => logs.push(a),
    }).run();

    const first = await migrate();
    assert.equal(first.created, COMMON_UNITS.length);
    assert.deepEqual(first.unresolved, [["$.transformedReading", 1]]);

    const kwh = eng_unit_uuid("KWH");
    assert.ok(cdb.objects.some(o => o.klass == Class.EngineeringUnit && o.uuid == kwh));
    assert.deepEqual(cdb.get(App.Info, kwh), { name: "kilowatt hour" });
    assert.deepEqual(cdb.get(App.EngineeringUnit, kwh),
        { code: "KWH", symbol: "kWh", aliases: ["kW·h"] });
    assert.deepEqual(cdb.get(App.EngineeringUnit, eng_unit_uuid("P1")),
        { code: "P1", symbol: "%" });
    /* Origin maps and schemas are never written. */
    assert.ok(cdb.writes.every(w => w.app == App.Info || w.app == App.EngineeringUnit));

    const writes = cdb.writes.length;
    const second = await migrate();
    assert.equal(second.created, 0);
    assert.equal(second.changed, 0);
    assert.equal(cdb.writes.length, writes);
    assert.match(logs.at(-1)[0], /^Engineering units:/);
});

test("a unit that cannot be written is logged and the rest go on", async () => {
    const cdb = new FakeCDB();
    cdb.set(App.DeviceInformation, "dev-1", { originMap: { A: metric("kWh"), B: metric("V") } });
    const put = cdb.put_config.bind(cdb);
    cdb.put_config = async (a, o, c) => {
        if (a == App.EngineeringUnit && c.code == "KWH") throw new Error("422");
        return put(a, o, c);
    };
    const result = await new MigrateEngUnits({
        fplus: { ConfigDB: cdb }, log: () => {},
    }).run();
    assert.equal(result.failed, 1);
    assert.deepEqual(cdb.get(App.EngineeringUnit, eng_unit_uuid("VLT")), { code: "VLT", symbol: "V" });
});

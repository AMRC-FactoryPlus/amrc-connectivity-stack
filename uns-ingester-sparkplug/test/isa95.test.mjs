/*
 * AMRC ACS UNS Ingester (Sparkplug)
 * Tests for the ISA-95 hierarchy read from a birth
 * Copyright 2026 University of Sheffield AMRC
 *
 * Run with `npm test` (Node 22.18 or later strips the TypeScript
 * types from lib/isa95.ts itself).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { birthIsa95, buildUnsTopic } from "../lib/isa95.ts";

const HIERARCHY = "84ac3397-f3a2-440a-99e5-5bb9f6a75091";

/* A birth's hierarchy metrics under a given path. */
function birth (path, levels, schema = HIERARCHY) {
    return [
        { name: "Schema_UUID", value: "11111111-1111-4111-8111-111111111111" },
        { name: "Temperature", value: 21.5 },
        ...(schema ? [{ name: `${path}/Schema_UUID`, value: schema }] : []),
        { name: `${path}/Instance_UUID`, value: "22222222-2222-4222-8222-222222222222" },
        ...Object.entries(levels).map(([k, v]) => ({ name: `${path}/${k}`, value: v })),
    ];
}

const ROOT = "Device_Information/ISA95_Hierarchy";

test("a hierarchy at the root path is read, spaced levels and all", () => {
    const isa95 = birthIsa95(birth(ROOT, {
        Enterprise: "Acme", Site: "Site1", Area: "Area1",
        "Work Center": "Line 1", "Work Unit": "Cell 1",
    }));
    assert.deepEqual(isa95, {
        enterprise: "Acme", site: "Site1", area: "Area1",
        workCenter: "Line 1", workUnit: "Cell 1",
    });
    assert.equal(buildUnsTopic(isa95, "Lathe", "Spindle", "Speed"),
        "UNS/v1/Acme/Site1/Area1/Line 1/Cell 1/Edge/Lathe/Spindle/Speed");
});

test("a nested hierarchy is no longer on the UNS", () => {
    for (const path of [
        "Device_Information/Base_Device_Information/ISA95_Hierarchy",
        "Base_Robot/Device_Information/ISA95_Hierarchy",
    ]) {
        const isa95 = birthIsa95(birth(path, { Enterprise: "Acme", Site: "Site1" }));
        assert.equal(isa95.enterprise, null, path);
        assert.equal(buildUnsTopic(isa95, "Robot", "", "Speed"), null);
    }
});

test("a nested copy beside the root one does not change it", () => {
    const metrics = [
        ...birth(ROOT, { Enterprise: "Acme", Site: "Site1" }),
        ...birth("Safety/Device_Information/ISA95_Hierarchy", { Enterprise: "Other" }),
    ];
    assert.equal(buildUnsTopic(birthIsa95(metrics), "Press", "", "Force"),
        "UNS/v1/Acme/Site1/Edge/Press/Force");
});

test("an empty Site stops the chain instead of leaving an empty segment", () => {
    const isa95 = birthIsa95(birth(ROOT, { Enterprise: " Acme ", Site: "  ", Area: "Area1" }));
    assert.deepEqual(isa95, {
        enterprise: "Acme", site: null, area: null, workCenter: null, workUnit: null,
    });
    assert.equal(buildUnsTopic(isa95, "Lathe", "", "Speed"), "UNS/v1/Acme/Edge/Lathe/Speed");
});

test("no Schema_UUID, or a topic-unsafe value, keeps the device off the UNS", () => {
    assert.equal(birthIsa95(birth(ROOT, { Enterprise: "Acme" }, null)).enterprise, null);
    assert.equal(birthIsa95(birth(ROOT, { Enterprise: "Acme", Site: "A/B" })).enterprise, null);
    assert.equal(birthIsa95(birth(ROOT, { Enterprise: "Edge" })).enterprise, null);
    assert.equal(birthIsa95([]).enterprise, null);
});

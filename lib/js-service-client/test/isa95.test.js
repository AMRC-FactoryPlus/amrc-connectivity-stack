/*
 * Factory+ NodeJS Utilities
 * Tests for the ISA-95 rule, renderer and Edge Agent config merge
 * Copyright 2026 University of Sheffield AMRC
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    ISA95_HIERARCHY_PATH, ISA95_LEVELS,
    find_device_entries, find_isa95_hierarchies, is_uns_hierarchy,
    isa95_chain, isa95_resolve, isa95_segments, isa95_segments_from_metrics,
    isa95_segments_from_values, isa95_subtree, isa95_value_ok,
    isa95_vocabulary, merge_isa95_tags, patch_isa95, render_isa95,
} from "../lib/isa95.js";
import { metric_instance_uuid } from "../lib/uuid-v5.js";

const HIERARCHY = "84ac3397-f3a2-440a-99e5-5bb9f6a75091";
const DEVINFO = "2dd093e9-1450-44c5-be8c-c0d78e48219b";
const DEVICE = "6f1b0d55-7a43-4d2e-9a51-1f0c3b9d2e01";
const OTHER_DEVICE = "6f1b0d55-7a43-4d2e-9a51-1f0c3b9d2e02";

/* Acme / Site1 / Area1 / Line 1 / Cell 1, plus some broken nodes. */
const N = {
    acme:   "00000000-0000-4000-8000-000000000001",
    site1:  "00000000-0000-4000-8000-000000000002",
    area1:  "00000000-0000-4000-8000-000000000003",
    line1:  "00000000-0000-4000-8000-000000000004",
    cell1:  "00000000-0000-4000-8000-000000000005",
    other:  "00000000-0000-4000-8000-000000000006",
    orphan: "00000000-0000-4000-8000-000000000007",
    skip:   "00000000-0000-4000-8000-000000000008",
    shared: "00000000-0000-4000-8000-000000000009",
    site2:  "00000000-0000-4000-8000-00000000000a",
    edge:   "00000000-0000-4000-8000-00000000000b",
};

function vocab () {
    return isa95_vocabulary([
        { uuid: N.acme, name: "Acme", level: "Enterprise", aliases: ["ACME Ltd"],
            children: [N.site1, N.skip, N.site2] },
        { uuid: N.site1, name: "Site1", level: "Site", children: [N.area1, N.shared] },
        { uuid: N.site2, name: "Site2", level: "Site", children: [N.shared, N.edge] },
        { uuid: N.area1, name: "Area1", level: "Area", aliases: ["Area One"], children: [N.line1] },
        { uuid: N.line1, name: "Line 1", level: "Work Center", children: [N.cell1] },
        { uuid: N.cell1, name: "Cell 1", level: "Work Unit" },
        { uuid: N.other, name: "Other Co", level: "Enterprise" },
        { uuid: N.orphan, name: "Lost Area", level: "Area" },
        /* An Area directly under an Enterprise. */
        { uuid: N.skip, name: "Skipped", level: "Area" },
        /* An Area under two Sites. */
        { uuid: N.shared, name: "Shared", level: "Area" },
        { uuid: N.edge, name: "Edge", level: "Area" },
    ]);
}

const hierarchy = (values, extra = {}) => ({
    Schema_UUID: HIERARCHY,
    Instance_UUID: "11111111-1111-4111-8111-111111111111",
    ...Object.fromEntries(values.map((v, i) => [ISA95_LEVELS[i], { Value: v }])),
    ...extra,
});

describe("the UNS rule", () => {
    test("level values must be safe in a topic", () => {
        for (const v of ["Acme", "Work Cell 3", "a.b", "Edge1", "edge"])
            assert.ok(isa95_value_ok(v), v);
        for (const v of ["", "a/b", "a+b", "a#b", "a\0b", "Edge"])
            assert.ok(!isa95_value_ok(v), JSON.stringify(v));
    });

    test("values are trimmed and reading stops at the first empty level", () => {
        assert.deepEqual(isa95_segments_from_values([" Acme ", "Site1", "  ", "Line 1", ""]),
            ["Acme", "Site1"]);
        assert.deepEqual(isa95_segments_from_values(["Acme", null, "Area1"]), ["Acme"]);
    });

    test("an empty Enterprise is not on the UNS", () => {
        assert.equal(isa95_segments_from_values(["   ", "Site1"]), null);
        assert.equal(isa95_segments_from_values([]), null);
    });

    test("a topic-unsafe value takes the device off the UNS", () => {
        assert.equal(isa95_segments_from_values(["Acme", "Site/1"]), null);
        assert.equal(isa95_segments_from_values(["Acme", "Site1", "Edge"]), null);
        assert.equal(isa95_segments_from_values(["Acme+", "Site1"]), null);
        /* An unsafe value below a gap is never read. */
        assert.deepEqual(isa95_segments_from_values(["Acme", "", "a#b"]), ["Acme"]);
    });

    test("only the exact root path counts, with the Hierarchy schema", () => {
        const all = ["Acme", "Site1", "Area1", "Line 1", "Cell 1"];
        assert.deepEqual(isa95_segments({ Device_Information: { ISA95_Hierarchy: hierarchy(all) } }),
            all);
        assert.ok(is_uns_hierarchy({ Device_Information: { ISA95_Hierarchy: hierarchy(["Acme"]) } }));

        /* Nested under another object. */
        assert.equal(isa95_segments({ Device_Information: { Base_Device_Information: {
            ISA95_Hierarchy: hierarchy(all) } } }), null);
        assert.equal(isa95_segments({ Base_Robot: { Device_Information: {
            ISA95_Hierarchy: hierarchy(all) } } }), null);
        /* No Schema_UUID, or the wrong one. */
        assert.equal(isa95_segments({ Device_Information: { ISA95_Hierarchy:
            { Enterprise: { Value: "Acme" } } } }), null);
        assert.equal(isa95_segments({ Device_Information: { ISA95_Hierarchy:
            hierarchy(["Acme"], { Schema_UUID: DEVINFO }) } }), null);
        assert.equal(isa95_segments(null), null);
    });

    test("spaced level keys are read", () => {
        const h = hierarchy(["Acme", "Site1", "Area1"]);
        h["Work Center"] = { Value: "Line 1" };
        h["Work Unit"] = { Value: "Cell 1" };
        /* The unspaced spelling is not a level. */
        h.WorkCenter = { Value: "Wrong" };
        assert.deepEqual(isa95_segments({ Device_Information: { ISA95_Hierarchy: h } }),
            ["Acme", "Site1", "Area1", "Line 1", "Cell 1"]);
    });

    test("births follow the same rule", () => {
        const P = ISA95_HIERARCHY_PATH;
        const metrics = [
            { name: `${P}/Schema_UUID`, value: HIERARCHY },
            { name: `${P}/Enterprise`, value: " Acme" },
            { name: `${P}/Site`, value: "Site1" },
            { name: `${P}/Work Center`, value: "Line 1" },
        ];
        assert.deepEqual(isa95_segments_from_metrics(metrics), ["Acme", "Site1"]);

        const nested = metrics.map(m => ({
            ...m, name: m.name.replace("Device_Information/",
                "Device_Information/Base_Device_Information/") }));
        assert.equal(isa95_segments_from_metrics(nested), null);
        assert.equal(isa95_segments_from_metrics(metrics.slice(1)), null);
    });

    test("every hierarchy in an origin map can be found", () => {
        const om = {
            Schema_UUID: "x",
            Device_Information: {
                Schema_UUID: DEVINFO,
                Base_Device_Information: { ISA95_Hierarchy: hierarchy(["A"]) },
            },
            Safety: { Device_Information: { ISA95_Hierarchy: hierarchy(["B"]) } },
        };
        assert.deepEqual(find_isa95_hierarchies(om).map(f => f.path), [
            "Device_Information/Base_Device_Information/ISA95_Hierarchy",
            "Safety/Device_Information/ISA95_Hierarchy",
        ]);
    });
});

describe("the vocabulary", () => {
    test("the chain walks up to the Enterprise", () => {
        const { chain, error } = isa95_chain(vocab(), N.cell1);
        assert.equal(error, undefined);
        assert.deepEqual(chain.map(n => n.name), ["Acme", "Site1", "Area1", "Line 1", "Cell 1"]);
        assert.deepEqual(isa95_chain(vocab(), N.acme).chain.map(n => n.name), ["Acme"]);
    });

    test("a node with no parent is refused", () => {
        assert.match(isa95_chain(vocab(), N.orphan).error, /no Site above it/);
    });

    test("a chain that skips a level is refused", () => {
        assert.match(isa95_chain(vocab(), N.skip).error, /skips a level/);
    });

    test("a node with more than one parent is refused", () => {
        assert.match(isa95_chain(vocab(), N.shared).error, /more than one parent/);
    });

    test("an unknown node is refused", () => {
        assert.match(isa95_chain(vocab(), OTHER_DEVICE).error, /not an ISA-95 vocabulary node/);
    });

    test("names resolve level by level, by name or alias, ignoring case", () => {
        const v = vocab();
        assert.deepEqual(isa95_resolve(v, ["acme ltd", " SITE1", "area one", "line 1"]),
            [N.acme, N.site1, N.area1, N.line1]);
        /* An Area name does not match at Site level. */
        assert.deepEqual(isa95_resolve(v, ["Acme", "Area1"]), [N.acme]);
        assert.deepEqual(isa95_resolve(v, ["Nobody"]), []);
    });

    test("the subtree of a node holds it and everything below", () => {
        assert.deepEqual([...isa95_subtree(vocab(), N.area1)].sort(),
            [N.area1, N.line1, N.cell1].sort());
    });
});

describe("render_isa95", () => {
    test("renders the hierarchy object down to the placed node", () => {
        const r = render_isa95({ node: N.area1 }, vocab(), DEVICE);
        assert.equal(r.error, undefined);
        assert.deepEqual(r.segments, ["Acme", "Site1", "Area1"]);
        const P = ISA95_HIERARCHY_PATH;
        assert.deepEqual(r.tags.map(t => [t.Name, t.type, t.value, t.recordToDB]), [
            [`${P}/Schema_UUID`, "UUID", HIERARCHY, true],
            [`${P}/Instance_UUID`, "UUID", metric_instance_uuid(DEVICE, P), true],
            [`${P}/Enterprise`, "String", "Acme", false],
            [`${P}/Site`, "String", "Site1", false],
            [`${P}/Area`, "String", "Area1", false],
        ]);
        assert.deepEqual(r.stamp.map(t => [t.Name, t.value]), [
            ["Device_Information/Schema_UUID", DEVINFO],
            ["Device_Information/Instance_UUID",
                metric_instance_uuid(DEVICE, "Device_Information")],
        ]);
    });

    test("the spaced level names are used for the tags", () => {
        const r = render_isa95({ node: N.cell1 }, vocab(), DEVICE);
        assert.deepEqual(r.tags.slice(-2).map(t => t.Name), [
            `${ISA95_HIERARCHY_PATH}/Work Center`,
            `${ISA95_HIERARCHY_PATH}/Work Unit`,
        ]);
    });

    test("is deterministic", () => {
        const a = render_isa95({ node: N.cell1 }, vocab(), DEVICE);
        const b = render_isa95({ node: N.cell1 }, vocab(), DEVICE);
        assert.deepEqual(a, b);
        const c = render_isa95({ node: N.cell1 }, vocab(), OTHER_DEVICE);
        assert.notEqual(a.tags[1].value, c.tags[1].value);
    });

    test("reuses the Instance_UUIDs a placement carries", () => {
        const instances = {
            [ISA95_HIERARCHY_PATH]: "22222222-2222-4222-8222-222222222222",
            Device_Information: "33333333-3333-4333-8333-333333333333",
        };
        const r = render_isa95({ node: N.acme, instances }, vocab(), DEVICE);
        assert.equal(r.tags[1].value, instances[ISA95_HIERARCHY_PATH]);
        assert.equal(r.stamp[1].value, instances.Device_Information);
    });

    test("refuses a broken chain or a topic-unsafe name", () => {
        assert.match(render_isa95({ node: N.shared }, vocab(), DEVICE).error, /more than one parent/);
        /* "Edge" is a vocabulary node but cannot be a topic segment. */
        assert.match(render_isa95({ node: N.edge }, vocab(), DEVICE).error, /reserved word Edge/);
        const v = isa95_vocabulary([{ uuid: N.acme, name: "A/B", level: "Enterprise" }]);
        assert.match(render_isa95({ node: N.acme }, v, DEVICE).error, /contains/);
        assert.match(render_isa95(null, vocab(), DEVICE).error, /no placement/);
    });
});

describe("merge_isa95_tags", () => {
    const other = { Name: "Temperature", type: "Float", method: "GET", address: "1" };
    const devinfo = [
        { Name: "Device_Information/Schema_UUID", type: "UUID", value: "existing-schema" },
        { Name: "Device_Information/Instance_UUID", type: "UUID", value: "existing-instance" },
    ];

    test("removes nested, legacy and root hierarchy tags and adds the rendering", () => {
        const tags = [
            other,
            ...devinfo,
            { Name: "Device_Information/ISA95_Hierarchy/Schema_UUID", value: HIERARCHY },
            { Name: "Device_Information/ISA95_Hierarchy/Enterprise", value: "Old" },
            { Name: "Device_Information/ISA95_Hierarchy/Enterprise/Schema_UUID", value: "m" },
            { Name: "Device_Information/Base_Device_Information/ISA95_Hierarchy/Site", value: "Old" },
            { Name: "Base_Robot/Device_Information/ISA95_Hierarchy/Schema_UUID", value: HIERARCHY },
        ];
        const r = render_isa95({ node: N.site1 }, vocab(), DEVICE);
        const out = merge_isa95_tags(tags, r);
        assert.deepEqual(out.filter(t => t.Name.includes("ISA95_Hierarchy")).map(t => t.Name),
            r.tags.map(t => t.Name));
        assert.deepEqual(out.slice(0, 3), [other, ...devinfo]);
        /* The existing Device_Information stamps are kept, not doubled. */
        assert.equal(out.filter(t => t.Name == "Device_Information/Schema_UUID").length, 1);
        assert.equal(out.find(t => t.Name == "Device_Information/Instance_UUID").value,
            "existing-instance");
    });

    test("adds the Device_Information stamps when the device has none", () => {
        const r = render_isa95({ node: N.acme }, vocab(), DEVICE);
        const out = merge_isa95_tags([other], r);
        assert.deepEqual(out.map(t => t.Name), [
            "Temperature",
            "Device_Information/Schema_UUID",
            "Device_Information/Instance_UUID",
            ...r.tags.map(t => t.Name),
        ]);
    });

    test("with no rendering only removes, and never changes its input", () => {
        const tags = [other, { Name: "Device_Information/ISA95_Hierarchy/Enterprise", value: "x" }];
        const copy = structuredClone(tags);
        assert.deepEqual(merge_isa95_tags(tags, null), [other]);
        assert.deepEqual(tags, copy);
    });

    test("is idempotent", () => {
        const r = render_isa95({ node: N.cell1 }, vocab(), DEVICE);
        const once = merge_isa95_tags([other], r);
        assert.deepEqual(merge_isa95_tags(once, r), once);
    });
});

describe("Edge Agent config entries", () => {
    const config = () => ({
        deviceConnections: [
            { name: "c1", devices: [
                { deviceId: "Same Name", tags: [{ Name: "Instance_UUID", value: OTHER_DEVICE }] },
                { deviceId: "No Instance", tags: [{ Name: "Schema_UUID", value: "x" }] },
            ] },
            { name: "c2", devices: [
                { deviceId: "Same Name", tags: [
                    { Name: "Schema_UUID", value: "x" },
                    { Name: "Instance_UUID", value: DEVICE },
                ] },
            ] },
        ],
    });

    test("devices are found by their Instance_UUID tag, not by name", () => {
        const found = find_device_entries(config(), DEVICE);
        assert.equal(found.length, 1);
        assert.equal(found[0].tags[1].value, DEVICE);
        assert.deepEqual(find_device_entries(config(), "nope"), []);
        assert.deepEqual(find_device_entries({}, DEVICE), []);
    });

    test("patch_isa95 changes only that device, on a copy", () => {
        const before = config();
        const r = render_isa95({ node: N.acme }, vocab(), DEVICE);
        const { found, changed, config: after } = patch_isa95(before, DEVICE, r);
        assert.equal(found, 1);
        assert.ok(changed);
        assert.deepEqual(before, config());
        assert.deepEqual(after.deviceConnections[0], before.deviceConnections[0]);
        assert.ok(after.deviceConnections[1].devices[0].tags
            .some(t => t.Name == `${ISA95_HIERARCHY_PATH}/Enterprise` && t.value == "Acme"));

        const again = patch_isa95(after, DEVICE, r);
        assert.equal(again.changed, false);
        assert.equal(again.config, after);
    });

    test("patch_isa95 reports a device with no entry", () => {
        const r = render_isa95({ node: N.acme }, vocab(), DEVICE);
        const { found, changed } = patch_isa95(config(), "77777777-7777-4777-8777-777777777777", r);
        assert.equal(found, 0);
        assert.equal(changed, false);
    });
});

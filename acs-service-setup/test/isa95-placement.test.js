/*
 * ACS service setup
 * Tests for the migrate_isa95_placement step
 * Copyright 2026 University of Sheffield AMRC
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { UUIDs } from "@amrc-factoryplus/service-client";

import { LEVEL_CLASS, MigratePlacements, pick_hierarchy } from "../lib/isa95-placement.js";

const { App, Class } = UUIDs;
const HIERARCHY = "84ac3397-f3a2-440a-99e5-5bb9f6a75091";
const P = "Device_Information/ISA95_Hierarchy";

/* An in-memory ConfigDB with the calls the step makes. Every write is
 * recorded. */
class FakeCDB {
    constructor () {
        this.configs = new Map();
        this.members = new Map();
        this.writes = [];
    }

    app (a) {
        if (!this.configs.has(a)) this.configs.set(a, new Map());
        return this.configs.get(a);
    }
    set (a, o, c) { this.app(a).set(o, structuredClone(c)); }
    add (klass, obj) {
        if (!this.members.has(klass)) this.members.set(klass, []);
        this.members.get(klass).push(obj);
    }

    async class_members (k) { return [...(this.members.get(k) ?? [])]; }
    async list_configs (a) { return [...this.app(a).keys()]; }
    async get_config (a, o) { return structuredClone(this.app(a).get(o)); }
    async get_all_configs (a) { return new Map(structuredClone([...this.app(a)])); }
    async put_config (a, o, c) {
        this.writes.push({ app: a, obj: o, config: c });
        this.set(a, o, c);
    }
    async create_object (klass) {
        const uuid = crypto.randomUUID();
        this.writes.push({ create: klass, obj: uuid });
        this.add(klass, uuid);
        return uuid;
    }
}

const hierarchy = (values, instance = "11111111-1111-4111-8111-111111111111") => ({
    Schema_UUID: HIERARCHY,
    Instance_UUID: instance,
    ...Object.fromEntries(values.map((v, i) =>
        [["Enterprise", "Site", "Area", "Work Center", "Work Unit"][i], { Value: v }])),
});

/* Acme / Site1 exists already, with an alias. */
function setup () {
    const cdb = new FakeCDB();
    cdb.add(Class.ISA95Enterprise, "acme");
    cdb.add(Class.ISA95Site, "site1");
    cdb.set(App.Info, "acme", { name: "Acme" });
    cdb.set(App.Info, "site1", { name: "Site1" });
    cdb.set(App.ISA95Vocabulary, "acme", { aliases: ["Acme Ltd"], children: ["site1"] });
    return cdb;
}

function device (cdb, uuid, origin_map) {
    cdb.add(Class.Device, uuid);
    cdb.set(App.DeviceInformation, uuid, { node: "n", originMap: origin_map });
}

const run = (cdb, organisation = "Acme") =>
    new MigratePlacements({ fplus: { ConfigDB: cdb }, organisation, log: () => {} }).run();

const placement = (cdb, d) => cdb.app(App.ISA95Placement).get(d);
const name_of = (cdb, u) => cdb.app(App.Info).get(u)?.name;

describe("migrate_isa95_placement", () => {
    test("a root hierarchy is resolved through the vocabulary, aliases and all", async () => {
        const cdb = setup();
        device(cdb, "d1", { Device_Information: { ISA95_Hierarchy:
            hierarchy([" acme ltd", "SITE1"], "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa") } });

        const count = await run(cdb);
        assert.equal(count.root, 1);
        assert.deepEqual(placement(cdb, "d1"), {
            node: "site1",
            instances: { [P]: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
        });
        /* Nothing new was needed. */
        assert.equal(cdb.writes.filter(w => w.create).length, 0);
    });

    test("missing levels are created under the matched parent", async () => {
        const cdb = setup();
        device(cdb, "d1", { Device_Information: { ISA95_Hierarchy:
            hierarchy(["Acme", "Site1", "Area1", "Line 1"]) } });

        await run(cdb);
        const node = placement(cdb, "d1").node;
        assert.equal(name_of(cdb, node), "Line 1");
        assert.ok(cdb.members.get(LEVEL_CLASS["Work Center"]).includes(node));

        const area = cdb.app(App.ISA95Vocabulary).get("site1").children[0];
        assert.equal(name_of(cdb, area), "Area1");
        assert.deepEqual(cdb.app(App.ISA95Vocabulary).get(area).children, [node]);
        /* The parent's aliases were kept. */
        assert.deepEqual(cdb.app(App.ISA95Vocabulary).get("acme").aliases, ["Acme Ltd"]);
    });

    test("a nested hierarchy is used, with its Instance_UUID", async () => {
        const cdb = setup();
        device(cdb, "cnc", { Device_Information: { Base_Device_Information: {
            ISA95_Hierarchy: hierarchy(["Acme", "Site1"], "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb") } } });

        const count = await run(cdb);
        assert.equal(count.nested, 1);
        assert.deepEqual(placement(cdb, "cnc"), {
            node: "site1",
            instances: { [P]: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
        });
    });

    test("a hierarchy under a safety sub-object is found; the last one wins", async () => {
        const cdb = setup();
        device(cdb, "d2", {
            Robot: { Device_Information: { ISA95_Hierarchy: hierarchy(["Acme"]) } },
            Safety: { Device_Information: { ISA95_Hierarchy: hierarchy(["Acme", "Site1"]) } },
            /* No Enterprise: not a candidate. */
            Spare: { ISA95_Hierarchy: hierarchy([""]) },
        });

        await run(cdb);
        assert.equal(placement(cdb, "d2").node, "site1");
    });

    test("the root hierarchy wins over nested ones", () => {
        const om = {
            Device_Information: { ISA95_Hierarchy: hierarchy(["Root Co"]) },
            Safety: { Device_Information: { ISA95_Hierarchy: hierarchy(["Other"]) } },
        };
        const picked = pick_hierarchy(om);
        assert.equal(picked.path, P);
        assert.deepEqual(picked.others, ["Safety/Device_Information/ISA95_Hierarchy"]);
    });

    test("a device with no hierarchy goes to the organisation Enterprise", async () => {
        const cdb = setup();
        device(cdb, "d3", { Schema_UUID: "x", Temperature: { Value: 1 } });
        device(cdb, "d4", null);

        const count = await run(cdb, "acme");
        assert.equal(count.organisation, 2);
        assert.deepEqual(placement(cdb, "d3"), { node: "acme" });
        assert.deepEqual(placement(cdb, "d4"), { node: "acme" });
    });

    test("a missing organisation Enterprise is created once", async () => {
        const cdb = setup();
        device(cdb, "d3", {});
        device(cdb, "d4", {});

        await run(cdb, "New Org");
        const node = placement(cdb, "d3").node;
        assert.equal(placement(cdb, "d4").node, node);
        assert.equal(name_of(cdb, node), "New Org");
        assert.ok(cdb.members.get(Class.ISA95Enterprise).includes(node));
        assert.equal(cdb.writes.filter(w => w.create).length, 1);
    });

    test("a topic-unsafe hierarchy is skipped, not moved to the organisation", async () => {
        const cdb = setup();
        device(cdb, "d5", { Device_Information: { ISA95_Hierarchy: hierarchy(["Acme", "Site/1"]) } });

        const count = await run(cdb);
        assert.equal(count.skipped, 1);
        assert.equal(placement(cdb, "d5"), undefined);
    });

    test("objects with no DeviceInformation are left alone", async () => {
        const cdb = setup();
        cdb.add(Class.Device, "service-device");

        const count = await run(cdb);
        assert.equal(count.no_info, 1);
        assert.equal(placement(cdb, "service-device"), undefined);
    });

    test("an existing placement is never replaced", async () => {
        const cdb = setup();
        device(cdb, "d1", { Device_Information: { ISA95_Hierarchy: hierarchy(["Acme", "Site1"]) } });
        cdb.set(App.ISA95Placement, "d1", { node: "acme" });

        const count = await run(cdb);
        assert.equal(count.existing, 1);
        assert.deepEqual(placement(cdb, "d1"), { node: "acme" });
        assert.equal(cdb.writes.length, 0);
    });

    test("a second run changes nothing", async () => {
        const cdb = setup();
        device(cdb, "d1", { Device_Information: { ISA95_Hierarchy: hierarchy(["Acme", "Site2", "Area9"]) } });
        device(cdb, "d2", { Safety: { ISA95_Hierarchy: hierarchy(["Other Co"]) } });
        device(cdb, "d3", {});

        await run(cdb);
        const before = cdb.writes.length;
        const count = await run(cdb);
        assert.equal(cdb.writes.length, before);
        assert.equal(count.existing, 3);
    });

    test("origin maps are never written", async () => {
        const cdb = setup();
        const om = { Device_Information: { Base_Device_Information: {
            ISA95_Hierarchy: hierarchy(["Acme", "Site1", "New Area"]) } } };
        device(cdb, "d1", om);
        device(cdb, "d2", {});

        await run(cdb);
        assert.deepEqual(cdb.writes.filter(w => w.app == App.DeviceInformation), []);
        assert.deepEqual(cdb.app(App.DeviceInformation).get("d1").originMap, om);
        const apps = new Set(cdb.writes.filter(w => w.app).map(w => w.app));
        assert.deepEqual([...apps].sort(),
            [App.Info, App.ISA95Vocabulary, App.ISA95Placement].sort());
    });

    test("one failed write does not stop the rest", async () => {
        const cdb = setup();
        device(cdb, "bad", {});
        device(cdb, "good", {});
        const put = cdb.put_config.bind(cdb);
        cdb.put_config = async (a, o, c) => {
            if (o == "bad") throw new Error("422");
            return put(a, o, c);
        };

        const count = await run(cdb);
        assert.equal(count.failed, 1);
        assert.equal(count.organisation, 1);
        assert.deepEqual(placement(cdb, "good"), { node: "acme" });
    });
});

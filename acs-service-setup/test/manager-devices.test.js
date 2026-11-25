/*
 * ACS service setup
 * Tests for the managed Edge Agent migration's driver registration
 * Copyright 2026 University of Sheffield AMRC
 *
 * An old edge-agent chart's `values.image` holds a `default` entry
 * (registry, tag and pull policy, with no repository) and an
 * `edgeAgent` entry beside the driver images. The migration used to
 * register every entry as a driver, so `default` became a DriverDef
 * named "(unknown driver)" that the Manager offered first in its driver
 * list. It now registers only driver images, and hides the DriverDefs
 * it made before.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { UUIDs } from "@amrc-factoryplus/service-client";

import {
    is_bogus_driver, is_driver_image, migrate_edge_agent_config,
} from "../lib/manager-devices.js";
import { ACS, Edge } from "../lib/uuids.js";

const { App, Class } = UUIDs;

class FakeCDB {
    constructor () {
        this.configs = new Map();
        this.members = new Map();
        this.writes = [];
        this.created = 0;
    }

    app (a) {
        if (!this.configs.has(a)) this.configs.set(a, new Map());
        return this.configs.get(a);
    }
    set (a, o, c) { this.app(a).set(o, structuredClone(c)); }

    async get_all_configs (a) { return new Map(structuredClone([...this.app(a)])); }
    async get_config (a, o) { return structuredClone(this.app(a).get(o)); }
    async put_config (a, o, c) {
        this.writes.push([a, o, structuredClone(c)]);
        this.set(a, o, c);
    }
    async class_members (k) { return this.members.get(k) ?? []; }
    async create_object (k) { return `new-${++this.created}`; }
}

function setup (cdb) {
    const fplus = { ConfigDB: cdb, debug: { bound: () => () => {} } };
    return migrate_edge_agent_config({ fplus });
}

const OLD_VALUES = {
    image: {
        default:    { registry: "reg.example", tag: "v3.0.0", pullPolicy: "IfNotPresent" },
        edgeAgent:  { repository: "acs-edge" },
        custom:     { registry: "reg.example", repository: "edge-custom", tag: "1.0" },
    },
};

describe("is_driver_image", () => {
    test("takes an entry with a repository", () => {
        assert.equal(is_driver_image("custom", { repository: "edge-custom" }), true);
    });

    test("skips the default and edgeAgent entries, and entries with no repository", () => {
        assert.equal(is_driver_image("default", { registry: "r", tag: "t" }), false);
        assert.equal(is_driver_image("edgeAgent", { repository: "acs-edge" }), false);
        assert.equal(is_driver_image("other", { tag: "t" }), false);
        assert.equal(is_driver_image("other", "IfNotPresent"), false);
    });
});

describe("is_bogus_driver", () => {
    test("knows a DriverDef that can never run", () => {
        assert.equal(is_bogus_driver({ image: { registry: "r", tag: "t" } }), true);
        assert.equal(is_bogus_driver({ image: { repository: "acs-edge" } }), true);
    });

    test("leaves real, internal, external and hidden DriverDefs alone", () => {
        assert.equal(is_bogus_driver({ image: { repository: "edge-modbus" } }), false);
        assert.equal(is_bogus_driver({ internal: { connType: "REST" } }), false);
        assert.equal(is_bogus_driver({ external: true }), false);
        assert.equal(is_bogus_driver({ image: { tag: "t" }, hidden: true }), false);
    });
});

describe("migrate_edge_agent_config", () => {
    test("registers only the driver images of an old Deployment", async () => {
        const cdb = new FakeCDB();
        cdb.members.set(Class.EdgeAgent, ["agent"]);
        cdb.set(Edge.App.Deployment, "agent", { values: structuredClone(OLD_VALUES) });

        await setup(cdb);

        const names = [...cdb.app(App.Info).values()].map(i => i.name);
        assert.deepEqual(names, ["edge-custom"]);
        assert.ok(!names.includes("(unknown driver)"));
        assert.equal(cdb.app(App.DriverDefinition).size, 1);
    });

    test("hides the DriverDefs an earlier version made, and nothing else", async () => {
        const cdb = new FakeCDB();
        const unknown = { image: { registry: "reg.example", tag: "v3.0.0", pullPolicy: "IfNotPresent" } };
        const agent = { image: { repository: "acs-edge" } };
        const custom = { image: { registry: "reg.example", repository: "edge-custom", tag: "1.0" } };
        const modbus = { image: { repository: "edge-modbus" } };
        cdb.set(App.DriverDefinition, "unknown", unknown);
        cdb.set(App.DriverDefinition, "agent", agent);
        cdb.set(App.DriverDefinition, "custom", custom);
        cdb.set(App.DriverDefinition, ACS.Driver.Modbus, modbus);
        cdb.set(App.DriverDefinition, ACS.Driver.External, { external: true });

        await setup(cdb);

        const defs = cdb.app(App.DriverDefinition);
        assert.deepEqual(defs.get("unknown"), { ...unknown, hidden: true });
        assert.deepEqual(defs.get("agent"), { ...agent, hidden: true });
        assert.deepEqual(defs.get("custom"), custom);
        assert.deepEqual(defs.get(ACS.Driver.Modbus), modbus);
        assert.deepEqual(defs.get(ACS.Driver.External), { external: true });
        assert.deepEqual(cdb.writes.map(w => w[1]).sort(), ["agent", "unknown"]);
    });

    test("writes nothing on the next run", async () => {
        const cdb = new FakeCDB();
        cdb.set(App.DriverDefinition, "unknown", { image: { tag: "t" } });
        await setup(cdb);
        cdb.writes = [];
        await setup(cdb);
        assert.deepEqual(cdb.writes, []);
    });
});

/*
 * ACS service setup
 * Tests for the check_retired_drivers step
 * Copyright 2026 University of Sheffield AMRC
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { UUIDs } from "@amrc-factoryplus/service-client";

import { DumpLoader } from "../lib/dumps.js";
import { RetiredDriverCheck, RetiredDrivers } from "../lib/retired-drivers.js";
import { ACS, Edge } from "../lib/uuids.js";

const { App } = UUIDs;
const { Driver } = ACS;
const DriverClass = UUIDs.Class.EdgeAgentDriver;

/* An in-memory ConfigDB with the calls the step makes. */
class FakeCDB {
    constructor () {
        this.configs = new Map();
        this.members = new Set();
        this.deleted = [];
        this.unclassed = [];
    }

    app (a) {
        if (!this.configs.has(a)) this.configs.set(a, new Map());
        return this.configs.get(a);
    }
    set (a, o, c) { this.app(a).set(o, structuredClone(c)); }

    async get_all_configs (a) { return new Map(structuredClone([...this.app(a)])); }
    async get_config (a, o) { return structuredClone(this.app(a).get(o)); }
    async delete_config (a, o) {
        this.deleted.push([a, o]);
        this.app(a).delete(o);
    }
    async class_has_direct_member (k, o) {
        assert.equal(k, DriverClass);
        return this.members.has(o);
    }
    async class_remove_member (k, o) {
        assert.equal(k, DriverClass);
        this.unclassed.push(o);
        this.members.delete(o);
    }
}

const AGENT = "aaaaaaaa-0000-4000-8000-000000000001";
const C = {
    s7:     "cccccccc-0000-4000-8000-000000000001",
    rest:   "cccccccc-0000-4000-8000-000000000002",
    udp:    "cccccccc-0000-4000-8000-000000000003",
    ws:     "cccccccc-0000-4000-8000-000000000004",
};

/* A site as it was before the upgrade: the old DriverDefs and class
 * memberships are still in the ConfigDB, because loading a dump never
 * deletes anything. */
function site () {
    const cdb = new FakeCDB();
    for (const d of [Driver.MTConnect, Driver.S7, Driver.UDP, Driver.REST]) {
        cdb.set(App.DriverDefinition, d, { internal: { connType: "x" } });
        cdb.members.add(d);
    }
    return cdb;
}

function run (cdb) {
    const lines = [];
    const check = new RetiredDriverCheck({
        fplus:  { ConfigDB: cdb },
        log:    (...args) => lines.push(args),
    });
    return check.run().then(res => ({ res, lines }));
}

const warnings = lines => lines.filter(l => l[0].startsWith("WARNING: connection"));

describe("check_retired_drivers", () => {
    test("edge.yaml no longer defines the removed drivers", () => {
        const loader = new DumpLoader({
            dumps: [], acs_config: {}, local: s => s, log: () => {},
        });
        const docs = loader.parse_yaml(
            fs.readFileSync(new URL("../dumps/edge.yaml", import.meta.url), "utf8"),
            "edge.yaml");
        const defs = docs.find(d => d.configs?.[Edge.App.DriverDef])
            .configs[Edge.App.DriverDef];
        const members = docs.find(d => d.objects?.[Edge.Class.Driver])
            .objects[Edge.Class.Driver];
        for (const d of Object.values(RetiredDrivers)) {
            assert.equal(defs[d], undefined);
            assert.equal(members[d], undefined);
        }
        assert.ok(defs[Driver.REST], "REST must stay");
        assert.ok(members[Driver.REST], "REST must stay a driver");
    });

    test("a connection on a removed driver is warned about and keeps its DriverDef", async () => {
        const cdb = site();
        cdb.set(App.ConnectionConfiguration, C.s7,
            { driver: Driver.S7, name: "plc", edgeAgent: AGENT });
        cdb.set(App.ConnectionConfiguration, C.rest,
            { driver: Driver.REST, name: "api", edgeAgent: AGENT });

        const { res, lines } = await run(cdb);

        const warns = warnings(lines);
        assert.equal(warns.length, 1);
        assert.deepEqual(warns[0].slice(1), ["plc", C.s7, AGENT, "S7"]);
        assert.deepEqual(res.warned, [C.s7]);

        assert.ok(cdb.app(App.DriverDefinition).has(Driver.S7));
        assert.ok(cdb.members.has(Driver.S7));
        assert.ok(!res.removed.includes("S7"));
    });

    test("an unused removed driver loses its DriverDef and class membership", async () => {
        const cdb = site();
        cdb.set(App.ConnectionConfiguration, C.s7,
            { driver: Driver.S7, name: "plc", edgeAgent: AGENT });

        const { res } = await run(cdb);

        assert.deepEqual(res.removed.sort(), ["MTConnect", "UDP"]);
        assert.ok(!cdb.app(App.DriverDefinition).has(Driver.MTConnect));
        assert.ok(!cdb.app(App.DriverDefinition).has(Driver.UDP));
        assert.ok(!cdb.members.has(Driver.MTConnect));
        assert.ok(!cdb.members.has(Driver.UDP));
    });

    test("REST and the other kept drivers are never touched", async () => {
        const cdb = site();
        await run(cdb);
        assert.ok(cdb.app(App.DriverDefinition).has(Driver.REST));
        assert.ok(cdb.members.has(Driver.REST));
        assert.ok(cdb.deleted.every(([, o]) => o != Driver.REST));
        assert.ok(cdb.unclassed.every(o => o != Driver.REST));
    });

    test("a hand-written agent config naming a removed type is warned about", async () => {
        const cdb = site();
        cdb.set(App.ConnectionConfiguration, C.udp,
            { driver: Driver.UDP, name: "udp", edgeAgent: AGENT });
        cdb.set(App.EdgeAgentConfig, AGENT, { deviceConnections: [
            { uuid: C.udp, name: "udp", connType: "UDP" },
            { uuid: C.ws, name: "socket", connType: "Websocket" },
            { uuid: C.rest, name: "api", connType: "REST" },
        ] });

        const { res, lines } = await run(cdb);

        /* The UDP connection is warned about once, not twice. */
        assert.deepEqual(warnings(lines).map(l => l[2]), [C.udp, C.ws]);
        assert.deepEqual(res.warned, [C.udp, C.ws]);
    });

    test("a second run after the moves finds nothing to do", async () => {
        const cdb = site();
        await run(cdb);
        cdb.deleted = [];
        cdb.unclassed = [];

        const { res, lines } = await run(cdb);
        assert.deepEqual(res, { warned: [], removed: [] });
        assert.deepEqual(warnings(lines), []);
        assert.deepEqual(cdb.deleted, []);
        assert.deepEqual(cdb.unclassed, []);
    });
});

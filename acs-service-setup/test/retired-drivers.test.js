/*
 * ACS service setup
 * Tests for the check_retired_drivers step
 * Copyright 2026 University of Sheffield AMRC
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { ServiceError, UUIDs } from "@amrc-factoryplus/service-client";

import { DumpLoader } from "../lib/dumps.js";
import {
    check_retired_drivers, MovedDrivers, RetiredDriverCheck, RetiredDrivers,
} from "../lib/retired-drivers.js";
import { ACS, Edge } from "../lib/uuids.js";

const { App } = UUIDs;
const { Driver } = ACS;
const DriverClass = UUIDs.Class.EdgeAgentDriver;

/* An in-memory ConfigDB with the calls the step makes. Every driver
 * object here has the Edge Agent driver class as its primary class, as
 * the dumps create them, and like the real ConfigDB this refuses to
 * take an object out of its primary class with a 409
 * (acs-configdb/lib/model.js, class_remove_member). */
class FakeCDB {
    constructor () {
        this.configs = new Map();
        this.members = new Set();
        this.writes = [];
        this.deleted = [];
    }

    app (a) {
        if (!this.configs.has(a)) this.configs.set(a, new Map());
        return this.configs.get(a);
    }
    set (a, o, c) { this.app(a).set(o, structuredClone(c)); }

    async get_all_configs (a) { return new Map(structuredClone([...this.app(a)])); }
    async get_config (a, o) { return structuredClone(this.app(a).get(o)); }
    get_config_sync (a, o) { return structuredClone(this.app(a).get(o)); }
    async put_config (a, o, c) {
        this.writes.push([a, o, structuredClone(c)]);
        this.set(a, o, c);
    }
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
        throw new ServiceError(UUIDs.Service.ConfigDB,
            `Removing member ${o} from ${k} failed`, 409);
    }
    async delete_object (o) {
        this.deleted.push(["object", o]);
    }
}

const AGENT = "aaaaaaaa-0000-4000-8000-000000000001";
const C = {
    s7:     "cccccccc-0000-4000-8000-000000000001",
    rest:   "cccccccc-0000-4000-8000-000000000002",
    udp:    "cccccccc-0000-4000-8000-000000000003",
    mtc:    "cccccccc-0000-4000-8000-000000000005",
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
        for (const d of [...Object.values(RetiredDrivers), ...Object.values(MovedDrivers)]) {
            assert.equal(defs[d], undefined);
            assert.equal(members[d], undefined);
        }
        /* Nothing loaded is built into the Edge Agent any more. */
        for (const [d, def] of Object.entries(defs))
            assert.equal(def.internal, undefined, `${d} is built in`);
    });

    test("a connection on a removed driver is warned about", async () => {
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
    });

    /* Hidden, not deleted: the ConfigDB won't take a dump-created
     * object out of its primary class, and a class member with no
     * DriverDef would be offered as a driver with no form. */
    test("every removed driver's DriverDef is kept and hidden, used or not", async () => {
        const cdb = site();
        cdb.set(App.ConnectionConfiguration, C.s7,
            { driver: Driver.S7, name: "plc", edgeAgent: AGENT });
        cdb.set(App.ConnectionConfiguration, C.udp,
            { driver: Driver.UDP, name: "robot", edgeAgent: AGENT });

        const { res } = await run(cdb);

        for (const d of [Driver.MTConnect, Driver.S7, Driver.UDP, Driver.REST]) {
            const def = cdb.get_config_sync(App.DriverDefinition, d);
            assert.deepEqual(def, { internal: { connType: "x" }, hidden: true });
            assert.ok(cdb.members.has(d));
        }
        assert.deepEqual(res.hidden.sort(), ["MTConnect", "REST", "S7", "UDP"]);
        assert.deepEqual(res.failed, []);
        assert.deepEqual(cdb.deleted, [], "nothing is deleted");
    });

    /* An earlier run of this step deleted the DriverDef, then failed
     * to take the object out of the class: the state the first real
     * upgrade left. */
    test("a DriverDef an earlier run deleted comes back hidden", async () => {
        const cdb = site();
        cdb.app(App.DriverDefinition).delete(Driver.MTConnect);

        const { res } = await run(cdb);

        assert.deepEqual(cdb.get_config_sync(App.DriverDefinition, Driver.MTConnect),
            { hidden: true });
        assert.ok(res.hidden.includes("MTConnect"));
    });

    test("a driver with no object, such as EtherNet/IP, is left alone", async () => {
        const cdb = site();
        await run(cdb);
        assert.equal(cdb.get_config_sync(App.DriverDefinition, Driver.EtherNetIP), undefined);
        assert.equal(cdb.get_config_sync(App.DriverDefinition, Driver.Websocket), undefined);
    });

    test("the four moved built-in drivers are the ones split-drivers.js moves", () => {
        assert.deepEqual(MovedDrivers, {
            "REST": Driver.REST, "MQTT": Driver.MQTT,
            "OPC UA": Driver.OPCUA, "UDP": Driver.UDP,
        });
    });

    test("a moved built-in driver a connection still uses gets no warning", async () => {
        const cdb = site();
        cdb.set(App.ConnectionConfiguration, C.udp,
            { driver: Driver.UDP, name: "robot", edgeAgent: AGENT });
        cdb.set(App.EdgeAgentConfig, AGENT, { deviceConnections: [
            { uuid: C.udp, name: "robot", connType: "UDP" },
        ] });

        const { res, lines } = await run(cdb);

        assert.deepEqual(warnings(lines), []);
        assert.deepEqual(res.warned, []);
    });

    test("a hand-written agent config naming a removed type is warned about", async () => {
        const cdb = site();
        cdb.set(App.ConnectionConfiguration, C.mtc,
            { driver: Driver.MTConnect, name: "mill", edgeAgent: AGENT });
        cdb.set(App.EdgeAgentConfig, AGENT, { deviceConnections: [
            { uuid: C.mtc, name: "mill", connType: "MTConnect" },
            { uuid: C.ws, name: "socket", connType: "Websocket" },
            { uuid: C.rest, name: "api", connType: "REST" },
        ] });

        const { res, lines } = await run(cdb);

        /* The MTConnect connection is warned about once, not twice. */
        assert.deepEqual(warnings(lines).map(l => l[2]), [C.mtc, C.ws]);
        assert.deepEqual(res.warned, [C.mtc, C.ws]);
    });

    test("a second run writes nothing", async () => {
        const cdb = site();
        await run(cdb);
        cdb.writes = [];

        const { res, lines } = await run(cdb);
        assert.deepEqual(res, { warned: [], hidden: [], failed: [] });
        assert.deepEqual(warnings(lines), []);
        assert.deepEqual(cdb.writes, []);
    });

    /* One driver failing must not stop the others, nor service-setup. */
    test("a failure is logged and the step carries on", async () => {
        const cdb = site();
        const put = cdb.put_config.bind(cdb);
        cdb.put_config = async (a, o, c) => {
            if (o == Driver.S7) throw new ServiceError(UUIDs.Service.ConfigDB, "boom", 500);
            return put(a, o, c);
        };
        const { res, lines } = await run(cdb);
        assert.deepEqual(res.failed, ["S7"]);
        assert.ok(res.hidden.includes("REST"));
        assert.equal(lines.filter(l => /^ERROR: can't hide the %s DriverDef/.test(l[0])).length, 1);
    });

    test("check_retired_drivers never throws", async () => {
        const lines = [];
        const fplus = {
            ConfigDB: { get_all_configs: async () => { throw new Error("ConfigDB down"); } },
            debug: { bound: () => (...args) => lines.push(args) },
        };
        assert.equal(await check_retired_drivers({ fplus }), undefined);
        assert.match(lines[0][0], /^ERROR: the removed-driver check failed/);
    });
});

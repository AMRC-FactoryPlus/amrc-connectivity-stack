/*
 * ACS service setup
 * Tests for the migrate_split_drivers step
 * Copyright 2026 University of Sheffield AMRC
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { UUIDs } from "@amrc-factoryplus/service-client";

import { DumpLoader } from "../lib/dumps.js";
import { MigrateSplitDrivers, SplitDrivers } from "../lib/split-drivers.js";
import { ACS, Edge } from "../lib/uuids.js";

import { FakeCDB } from "./fake-cdb.js";

const { App } = UUIDs;
const { Driver } = ACS;

/* The DriverDefs as edge.yaml loads them, so the tests and the dump
 * cannot drift apart. */
function load_driverdefs () {
    const loader = new DumpLoader({
        dumps: [], acs_config: {}, local: s => s, log: () => {},
    });
    const docs = loader.parse_yaml(
        fs.readFileSync(new URL("../dumps/edge.yaml", import.meta.url), "utf8"),
        "edge.yaml");
    const configs = docs.find(d => d.configs?.[Edge.App.DriverDef]).configs;
    return configs[Edge.App.DriverDef];
}
const DEFS = load_driverdefs();

/* The DriverDefs' names, from the objects section of edge.yaml. */
function load_names () {
    const loader = new DumpLoader({
        dumps: [], acs_config: {}, local: s => s, log: () => {},
    });
    const docs = loader.parse_yaml(
        fs.readFileSync(new URL("../dumps/edge.yaml", import.meta.url), "utf8"),
        "edge.yaml");
    const objs = docs.find(d => d.objects?.[UUIDs.Class.EdgeAgentDriver])
        .objects[UUIDs.Class.EdgeAgentDriver];
    return Object.fromEntries(Object.entries(objs).map(([u, o]) => [u, o.name]));
}

const AGENT = "aaaaaaaa-0000-4000-8000-000000000001";
const C = {
    opcua:  "cccccccc-0000-4000-8000-000000000001",
    mqtt:   "cccccccc-0000-4000-8000-000000000002",
    rest:   "cccccccc-0000-4000-8000-000000000003",
    modbus: "cccccccc-0000-4000-8000-000000000004",
    empty:  "cccccccc-0000-4000-8000-000000000005",
};

const OPCUA_DETAILS = {
    endpoint: "opc.tcp://opc-server:4840", securityMode: "SignAndEncrypt",
    securityPolicy: "Basic256Sha256", useCredentials: true,
    username: "__FPSI__11111111-1111-4111-8111-111111111111",
    password: "__FPSI__22222222-2222-4222-8222-222222222222",
};
const MQTT_DETAILS = {
    host: "broker", port: 8883, protocol: "mqtts", clientId: "",
    username: "user", password: "__FPSI__33333333-3333-4333-8333-333333333333",
    cleanSession: true, keepAlive: 60, useSSL: true,
};
const REST_DETAILS = { baseURL: "http://printer/api", authMethod: "None" };
const MODBUS_DETAILS = { host: "plc", port: 502, protocol: "tcp" };

const cconf = (driver, config, payloadFormat, extra = {}) => ({
    driver, edgeAgent: AGENT, config,
    createdAt: "2026-01-01T00:00:00.000Z",
    deployment: {},
    source: { payloadFormat },
    topology: { cluster: "cluster-uuid", hostname: "edge-1" },
    ...extra,
});

const device = (deviceId, payloadFormat) => ({
    deviceId, deviceType: "schema", templates: [], pubInterval: 0,
    payloadFormat, recordToHistorian: true,
    tags: [{ Name: "Value", type: "Double", method: "GET", address: "ns=2;s=x", path: "" }],
});

const entry = (uuid, name, connType, key, details, payloadFormat, pollInt) => ({
    uuid, name, connType, pollInt, payloadFormat, [key]: details,
    devices: [device(`${name}-1`, payloadFormat), device(`${name}-2`, payloadFormat)],
});

/* One agent with a connection of each kind, all on built-in drivers
 * except Modbus. */
function fixture () {
    const cdb = new FakeCDB();
    for (const [uuid, def] of Object.entries(DEFS))
        cdb.set(App.DriverDefinition, uuid, def);

    cdb.set(App.ConnectionConfiguration, C.opcua,
        cconf(Driver.OPCUA, OPCUA_DETAILS, "Defined by Protocol", { pollInt: 1000 }));
    cdb.set(App.ConnectionConfiguration, C.mqtt,
        cconf(Driver.MQTT, MQTT_DETAILS, "JSON"));
    cdb.set(App.ConnectionConfiguration, C.rest,
        cconf(Driver.REST, REST_DETAILS, "XML", {
            pollInt: 500,
            deployment: { hostPaths: [{ hostPath: "/dev/x", mountPath: "/dev/x" }] },
        }));
    cdb.set(App.ConnectionConfiguration, C.modbus,
        cconf(Driver.Modbus, MODBUS_DETAILS, "Buffer", { pollInt: 1000 }));
    /* A connection with no devices, so no entry in the agent config. */
    cdb.set(App.ConnectionConfiguration, C.empty,
        cconf(Driver.REST, REST_DETAILS, "JSON", { pollInt: 1000 }));

    cdb.set(App.EdgeAgentConfig, AGENT, {
        sparkplug: { asyncPubMode: true },
        deviceConnections: [
            entry(C.opcua, "OPC", "OPC UA", "OPCUAConnDetails", OPCUA_DETAILS, "Defined by Protocol", 1000),
            entry(C.mqtt, "Broker", "MQTT", "MQTTConnDetails", MQTT_DETAILS, "JSON", undefined),
            entry(C.rest, "Printer", "REST", "RESTConnDetails", REST_DETAILS, "XML", 500),
            entry(C.modbus, "PLC", "Driver", "DriverDetails", MODBUS_DETAILS, "Buffer", 1000),
        ],
    });
    cdb.set(Edge.App.Deployment, AGENT, {
        cluster: "cluster-uuid", hostname: "edge-1", chart: "chart-uuid", name: "agent",
        values: {
            name: "agent", uuid: AGENT,
            drivers: { PLC: { image: { repository: "edge-modbus" } } },
        },
    });
    return cdb;
}

const run = (cdb, settings) => new MigrateSplitDrivers({
    fplus: { ConfigDB: cdb }, settings, log: () => {},
}).run();

const conn_entry = (cdb, uuid) =>
    cdb.get(App.EdgeAgentConfig, AGENT).deviceConnections.find(c => c.uuid == uuid);
const drivers = cdb => cdb.get(Edge.App.Deployment, AGENT).values.drivers;

/* What each protocol looks like on the agent before and after. */
const CASES = [
    {
        name: "OPCUA", conn: C.opcua, entry_name: "OPC",
        key: "OPCUAConnDetails", details: OPCUA_DETAILS, image: "edge-opcua",
        format: ["Defined by Protocol", "JSON"],
        /* From the DriverDef: where its client certificate lives. */
        values: { stateDir: "/var/lib/edge-driver" },
    },
    {
        name: "MQTT", conn: C.mqtt, entry_name: "Broker",
        key: "MQTTConnDetails", details: MQTT_DETAILS, image: "edge-mqtt",
        format: ["JSON", "JSON"],
    },
    {
        name: "REST", conn: C.rest, entry_name: "Printer",
        key: "RESTConnDetails", details: REST_DETAILS, image: "edge-rest",
        format: ["XML", "XML"],
        deployment: { hostPaths: [{ hostPath: "/dev/x", mountPath: "/dev/x" }] },
    },
];

describe("the split DriverDefs", () => {
    /* The built-in DriverDefs are no longer loaded, so check the split
     * forms take the details a built-in connection has. UDP's has its
     * own form (udp-move.test.js checks it takes every built-in
     * config). */
    test("take a built-in connection's details field for field", () => {
        const cases = [
            [SplitDrivers.OPCUA, OPCUA_DETAILS], [SplitDrivers.MQTT, MQTT_DETAILS],
            [SplitDrivers.REST, { ...REST_DETAILS, username: "u", password: "p" }],
        ];
        for (const [p, details] of cases) {
            const split = DEFS[p.split];
            assert.ok(split.image?.repository, "the split DriverDef has an image");
            assert.equal(split.internal, undefined);
            for (const k of Object.keys(details))
                assert.ok(k in split.schema.properties, `${p.split} takes ${k}`);
        }
    });

    test("the built-in DriverDefs are not loaded", () => {
        for (const p of Object.values(SplitDrivers))
            assert.equal(DEFS[p.internal], undefined);
        for (const [uuid, def] of Object.entries(DEFS))
            assert.equal(def.internal, undefined, `${uuid} is built in`);
    });

    /* The new-connection form offers DriverDefs that aren't hidden, and
     * picks them by name: one choice per protocol. */
    test("offer every split driver by its plain name, once", () => {
        const { REST, MQTT, OPCUA, UDP } = SplitDrivers;
        const names = load_names();
        for (const [p, name] of [[REST, "REST"], [MQTT, "MQTT"], [OPCUA, "OPC-UA"], [UDP, "UDP"]]) {
            assert.equal(DEFS[p.split].hidden, undefined);
            assert.equal(names[p.split], name);
            assert.equal(names[p.internal], undefined);
        }
        const offered = Object.entries(DEFS)
            .filter(([, d]) => !d.hidden)
            .map(([uuid]) => names[uuid]);
        assert.equal(offered.filter(n => /^REST\b/.test(n)).length, 1);
        assert.equal(offered.filter(n => /^MQTT\b/.test(n)).length, 1);
        assert.equal(offered.filter(n => /^OPC-UA\b/.test(n)).length, 1);
        assert.equal(offered.filter(n => /^UDP\b/.test(n)).length, 1);
        assert.equal(new Set(offered).size, offered.length, "offered names are unique");
    });

    /* The OPC UA split driver's values have nothing for a path to
     * select, and the form already hides the path field. */
    test("OPC UA's split driver takes no metric paths, and its form hides the field", () => {
        const { OPCUA } = SplitDrivers;
        assert.equal(DEFS[OPCUA.split].metricPaths, false);
        assert.equal(DEFS[OPCUA.split].presentation.path.hidden, true);
        for (const [uuid, def] of Object.entries(DEFS))
            if (uuid != OPCUA.split)
                assert.equal(def.metricPaths, undefined, uuid);
    });
});

describe("migrate_split_drivers", () => {
    /* Every built-in connection moves: there is nothing else for it
     * to run on. */
    test("moves every built-in connection, whatever the settings", async () => {
        for (const settings of [undefined, {}, { REST: "yes" },
                                { REST: true, MQTT: true, OPCUA: true, UDP: true }]) {
            const cdb = fixture();
            const count = await run(cdb, settings);
            assert.equal(count.moved, 4);
            for (const c of CASES)
                assert.equal(conn_entry(cdb, c.conn).connType, "Driver");
        }
    });

    /* Version 6 took false (move back) and null (leave alone). Either
     * would leave connections the Edge Agent can't run. */
    test("refuses false and null with an ERROR line, and still moves", async () => {
        const cdb = fixture();
        const lines = [];
        const count = await new MigrateSplitDrivers({
            fplus: { ConfigDB: cdb }, settings: { OPCUA: false, MQTT: null },
            log: (...args) => lines.push(args),
        }).run();

        assert.equal(count.moved, 4);
        const refused = lines.filter(l => /^ERROR: serviceSetup.config.splitDrivers/.test(l[0]));
        assert.deepEqual(refused.map(l => [l[1], l[2]]), [["MQTT", null], ["OPCUA", false]]);
        assert.equal(conn_entry(cdb, C.opcua).connType, "Driver");
        assert.equal(conn_entry(cdb, C.mqtt).connType, "Driver");
    });

    for (const c of CASES) {
        test(`moves ${c.name} connections to the split driver`, async () => {
            const cdb = fixture();
            const before = cdb.get(App.ConnectionConfiguration, c.conn);
            await run(cdb);

            const cc = cdb.get(App.ConnectionConfiguration, c.conn);
            assert.equal(cc.driver, SplitDrivers[c.name].split);
            assert.equal(cc.source.payloadFormat, c.format[1]);
            assert.deepEqual(cc.config, before.config);
            assert.deepEqual(cc.splitMigration,
                { from: SplitDrivers[c.name].internal, payloadFormat: c.format[0] });

            const e = conn_entry(cdb, c.conn);
            assert.equal(e.connType, "Driver");
            assert.deepEqual(e.DriverDetails, c.details);
            assert.equal(e[c.key], undefined);
            assert.equal(e.payloadFormat, c.format[1]);
            assert.deepEqual(e.devices.map(d => d.payloadFormat), [c.format[1], c.format[1]]);
            /* Tags are untouched, but for OPC UA's paths, which its
             * split driver doesn't take. */
            const tags = device("x").tags.map(t => c.name == "OPCUA" ? { ...t, path: "" } : t);
            assert.deepEqual(e.devices.map(d => d.tags), [tags, tags]);
            assert.equal(e.name, c.entry_name);

            assert.deepEqual(drivers(cdb)[c.entry_name],
                { ...(c.deployment ?? {}), image: { repository: c.image }, ...(c.values ?? {}) });
            /* Other connections are untouched. */
            assert.deepEqual(drivers(cdb).PLC, { image: { repository: "edge-modbus" } });
        });
    }

    test("moves the REST connection with no devices too", async () => {
        const cdb = fixture();
        await run(cdb);
        assert.equal(cdb.get(App.ConnectionConfiguration, C.empty).driver, Driver.RESTSplit);
    });

    test("moves every protocol at once", async () => {
        const cdb = fixture();
        await run(cdb);
        assert.deepEqual(Object.keys(drivers(cdb)).sort(), ["Broker", "OPC", "PLC", "Printer"]);
        for (const c of CASES)
            assert.equal(conn_entry(cdb, c.conn).connType, "Driver");
        assert.equal(conn_entry(cdb, C.modbus).connType, "Driver");
    });

    test("a second run changes nothing", async () => {
        for (const settings of [{}, { OPCUA: false, MQTT: null }]) {
            const cdb = fixture();
            await run(cdb);
            const writes = cdb.writes.length;
            const count = await run(cdb, settings);
            assert.equal(cdb.writes.length, writes);
            assert.equal(count.moved + count.repaired + count.failed, 0);
        }
    });

    test("a dry run writes nothing but counts what would move", async () => {
        const cdb = fixture();
        const count = await run(cdb, { dryRun: true });
        assert.deepEqual(cdb.writes, []);
        assert.equal(count.moved, 4);
    });

    test("finishes a move a failed run left half done", async () => {
        const cdb = fixture();
        /* The agent config was written but the connections were not. */
        const half = fixture();
        await run(half);
        cdb.set(App.EdgeAgentConfig, AGENT, half.get(App.EdgeAgentConfig, AGENT));

        await run(cdb);
        for (const app of [App.ConnectionConfiguration, App.EdgeAgentConfig, Edge.App.Deployment])
            assert.deepEqual(
                Object.fromEntries(cdb.app(app)),
                Object.fromEntries(half.app(app)));
    });

    test("repairs an agent entry for a connection already on the split driver", async () => {
        const cdb = fixture();
        await run(cdb);
        /* Someone hand-edits the agent config back to the built-in type. */
        const config = cdb.get(App.EdgeAgentConfig, AGENT);
        const e = config.deviceConnections.find(c => c.uuid == C.rest);
        e.connType = "REST";
        e.RESTConnDetails = e.DriverDetails;
        cdb.set(App.EdgeAgentConfig, AGENT, config);

        const count = await run(cdb);
        assert.equal(count.repaired, 1);
        assert.equal(conn_entry(cdb, C.rest).connType, "Driver");
        assert.equal(conn_entry(cdb, C.rest).RESTConnDetails, undefined);
    });

    test("rebuilds a config someone else saved first", async () => {
        const cdb = fixture();
        cdb.stale.push([App.EdgeAgentConfig, AGENT], [Edge.App.Deployment, AGENT]);
        const count = await run(cdb);
        assert.equal(count.moved, 4);
        assert.equal(conn_entry(cdb, C.opcua).connType, "Driver");
        assert.ok(drivers(cdb).OPC);
    });

    test("keeps an OPC UA connection's JSON format", async () => {
        const cdb = fixture();
        const cc = cdb.get(App.ConnectionConfiguration, C.opcua);
        cc.source.payloadFormat = "JSON";
        cdb.set(App.ConnectionConfiguration, C.opcua, cc);
        const config = cdb.get(App.EdgeAgentConfig, AGENT);
        const e = config.deviceConnections.find(c => c.uuid == C.opcua);
        e.payloadFormat = "JSON";
        e.devices.forEach(d => d.payloadFormat = "JSON");
        cdb.set(App.EdgeAgentConfig, AGENT, config);

        await run(cdb);
        assert.equal(conn_entry(cdb, C.opcua).payloadFormat, "JSON");
        assert.equal(cdb.get(App.ConnectionConfiguration, C.opcua).source.payloadFormat, "JSON");
    });

    test("does not move to a split DriverDef that is missing or has no image", async () => {
        const cdb = fixture();
        cdb.app(App.DriverDefinition).delete(Driver.RESTSplit);
        const def = structuredClone(DEFS[Driver.OPCUASplit]);
        delete def.image;
        cdb.set(App.DriverDefinition, Driver.OPCUASplit, def);
        const lines = [];
        const count = await new MigrateSplitDrivers({
            fplus: { ConfigDB: cdb }, settings: {}, log: (...args) => lines.push(args),
        }).run();

        assert.equal(count.moved, 1);
        assert.equal(conn_entry(cdb, C.mqtt).connType, "Driver");
        assert.equal(conn_entry(cdb, C.rest).connType, "REST");
        assert.equal(conn_entry(cdb, C.opcua).connType, "OPC UA");
        assert.equal(lines.filter(l => /^ERROR: %s: split DriverDef/.test(l[0])).length, 2);
    });

    test("one failed connection does not stop the rest", async () => {
        const cdb = fixture();
        const put = cdb.put_config.bind(cdb);
        cdb.put_config = async (a, o, c, opts) => {
            if (a == App.ConnectionConfiguration && o == C.rest)
                throw new Error("boom");
            return put(a, o, c, opts);
        };
        const count = await run(cdb);
        assert.equal(count.failed, 1);
        assert.equal(count.moved, 3);
        assert.equal(cdb.get(App.ConnectionConfiguration, C.empty).driver, Driver.RESTSplit);
    });
});

/* A connection whose name has a dot, say, can't be a split driver's
 * id, so it gets a driverId, and its deployment values are keyed by
 * that. The UUIDs end the ids, so these are fixed. */
describe("driver ids", () => {
    const PLC_ID = "plc-example-org-cccccccc";
    const WEB_ID = "web-example-org-cccccccc";

    /* The fixture with names that can't be ids, as a site upgrading
     * would have them. */
    function dotted () {
        const cdb = fixture();
        const config = cdb.get(App.EdgeAgentConfig, AGENT);
        const name = (uuid, n) => config.deviceConnections.find(c => c.uuid == uuid).name = n;
        name(C.modbus, "plc.example.org");
        name(C.rest, "web.example.org");
        cdb.set(App.EdgeAgentConfig, AGENT, config);
        const dep = cdb.get(Edge.App.Deployment, AGENT);
        dep.values.drivers = { "plc.example.org": dep.values.drivers.PLC };
        cdb.set(Edge.App.Deployment, AGENT, dep);
        return cdb;
    }

    test("an existing split driver gets an id before the moves", async () => {
        const cdb = dotted();
        const count = await run(cdb, {});

        assert.equal(count.ids, 1);
        assert.equal(conn_entry(cdb, C.modbus).driverId, PLC_ID);
        assert.equal(conn_entry(cdb, C.modbus).name, "plc.example.org");
        assert.deepEqual(drivers(cdb)[PLC_ID], { image: { repository: "edge-modbus" } });
        assert.equal(drivers(cdb)["plc.example.org"], undefined);
    });

    test("a second run changes nothing", async () => {
        const cdb = dotted();
        await run(cdb, {});
        const writes = cdb.writes.length;
        const count = await run(cdb, {});
        assert.equal(cdb.writes.length, writes);
        assert.equal(count.ids, 0);
    });

    test("a dry run writes nothing", async () => {
        const cdb = dotted();
        const count = await run(cdb, { dryRun: true });
        assert.deepEqual(cdb.writes, []);
        assert.equal(count.ids, 1);
    });

    test("an agent whose names all work gets no driver ids", async () => {
        const cdb = fixture();
        const count = await run(cdb, {});
        assert.equal(count.ids, 0);
        for (const e of cdb.get(App.EdgeAgentConfig, AGENT).deviceConnections)
            assert.equal(e.driverId, undefined);
    });

    test("finishes a deployment left keyed by the name", async () => {
        const cdb = dotted();
        await run(cdb, {});
        /* The config was written, the deployment was not. */
        const dep = cdb.get(Edge.App.Deployment, AGENT);
        dep.values.drivers = { "plc.example.org": dep.values.drivers[PLC_ID] };
        cdb.set(Edge.App.Deployment, AGENT, dep);

        assert.equal((await run(cdb, {})).ids, 1);
        assert.ok(drivers(cdb)[PLC_ID]);
        assert.equal(drivers(cdb)["plc.example.org"], undefined);
    });

    test("a connection moved to its split driver uses its id", async () => {
        const cdb = dotted();
        await run(cdb);

        const e = conn_entry(cdb, C.rest);
        assert.equal(e.connType, "Driver");
        assert.equal(e.driverId, WEB_ID);
        assert.deepEqual(Object.keys(drivers(cdb)).sort(), ["Broker", "OPC", PLC_ID, WEB_ID]);
        assert.deepEqual(drivers(cdb)[WEB_ID].image, { repository: "edge-rest" });
    });

    test("a deployment keyed by both name and id keeps the id's values", async () => {
        const cdb = dotted();
        const dep = cdb.get(Edge.App.Deployment, AGENT);
        dep.values.drivers[PLC_ID] = { image: { repository: "edge-modbus" }, hostPaths: [] };
        cdb.set(Edge.App.Deployment, AGENT, dep);

        await run(cdb, {});
        assert.deepEqual(drivers(cdb)[PLC_ID],
            { image: { repository: "edge-modbus" }, hostPaths: [] });
        assert.equal(drivers(cdb)["plc.example.org"], undefined);
    });
});

/* Faults the code review found in the move. Each test failed before
 * its fix. */
describe("connections that share a name on one Edge Agent", () => {
    const PUMP_REST = "cccccccc-0000-4000-8000-0000000000a1";
    const PUMP_REST_2 = "cccccccc-0000-4000-8000-0000000000a2";

    /* The fixture's agent with more connections named "pump". `split`
     * gives a running Modbus split driver of that name and its
     * sidecar; `rest` the number of built-in REST ones. */
    function pumps ({ split, rest }) {
        const cdb = fixture();
        const config = cdb.get(App.EdgeAgentConfig, AGENT);
        const dep = cdb.get(Edge.App.Deployment, AGENT);
        if (split) {
            config.deviceConnections.find(c => c.uuid == C.modbus).name = "pump";
            dep.values.drivers = { pump: { image: { repository: "edge-modbus" } } };
        }
        for (const uuid of [PUMP_REST, PUMP_REST_2].slice(0, rest)) {
            cdb.set(App.ConnectionConfiguration, uuid,
                cconf(Driver.REST, REST_DETAILS, "JSON", { pollInt: 1000 }));
            config.deviceConnections.push(entry(uuid, "pump", "REST",
                "RESTConnDetails", REST_DETAILS, "JSON", 1000));
        }
        cdb.set(App.EdgeAgentConfig, AGENT, config);
        cdb.set(Edge.App.Deployment, AGENT, dep);
        return cdb;
    }

    /* Every split driver entry of the agent has a sidecar under its
     * driver id, and there are no others. */
    function every_sidecar_keyed (cdb) {
        const ids = cdb.get(App.EdgeAgentConfig, AGENT).deviceConnections
            .filter(c => c.connType == "Driver")
            .map(c => c.driverId ?? c.name);
        assert.deepEqual(Object.keys(drivers(cdb)).sort(), ids.sort());
    }

    test("moving a REST connection keeps a split driver's sidecar of the same name", async () => {
        const cdb = pumps({ split: true, rest: 1 });
        await run(cdb);

        const modbus = conn_entry(cdb, C.modbus);
        const rest = conn_entry(cdb, PUMP_REST);
        assert.notEqual(driver_of(modbus), driver_of(rest));
        assert.deepEqual(drivers(cdb)[driver_of(modbus)],
            { image: { repository: "edge-modbus" } });
        assert.equal(drivers(cdb)[driver_of(rest)].image.repository, "edge-rest");
        every_sidecar_keyed(cdb);

        cdb.writes = [];
        await run(cdb);
        assert.deepEqual(cdb.writes, [], "a second run writes nothing");
    });

    test("moving two REST connections of the same name gives each a sidecar", async () => {
        const cdb = pumps({ split: false, rest: 2 });
        await run(cdb);
        every_sidecar_keyed(cdb);

        cdb.writes = [];
        await run(cdb);
        assert.deepEqual(cdb.writes, [], "a second run writes nothing");
    });
});

const driver_of = e => e.driverId ?? e.name;

describe("an Edge Agent with no Deployment", () => {
    /* Nothing would run a sidecar, so its connections stay on their
     * built-in drivers, with an ERROR line each: on version 7 they get
     * no data until the agent is deployed from the Manager. */
    test("holds its connections, writes nothing and says how to fix it", async () => {
        const cdb = fixture();
        cdb.app(Edge.App.Deployment).delete(AGENT);
        const lines = [];
        const count = await new MigrateSplitDrivers({
            fplus: { ConfigDB: cdb }, settings: {},
            log: (...args) => lines.push(args),
        }).run();

        assert.deepEqual(cdb.writes, []);
        assert.equal(count.moved, 0);
        /* OPC, Broker, Printer and the REST connection with no devices. */
        assert.equal(count.no_deployment, 4);
        assert.equal(conn_entry(cdb, C.opcua).connType, "OPC UA");
        const errors = lines.filter(l => /no Edge Agent Deployment config/.test(l[0]));
        assert.equal(errors.length, 4);
        assert.match(errors[0][0], /^ERROR: /);
        assert.match(errors[0][0], /Deploy the Edge Agent from the Manager/);
    });
});

describe("a Manager edit while the move runs", () => {
    test("is kept, and the sidecar is built from it", async () => {
        const cdb = fixture();
        const edited = { baseURL: "http://printer-2/api", authMethod: "None" };
        const mounts = [{ hostPath: "/dev/y", mountPath: "/dev/y" }];

        /* The Manager saves the connection after the run has read every
         * connection but before it writes this one. */
        const put = cdb.put_config.bind(cdb);
        let edit = true;
        cdb.put_config = async (a, o, c, opts) => {
            if (edit && a == App.EdgeAgentConfig) {
                edit = false;
                const cc = cdb.get(App.ConnectionConfiguration, C.rest);
                cc.config = edited;
                cc.deployment = { hostPaths: mounts };
                cdb.set(App.ConnectionConfiguration, C.rest, cc);
            }
            return put(a, o, c, opts);
        };
        await run(cdb);

        const cc = cdb.get(App.ConnectionConfiguration, C.rest);
        assert.equal(cc.driver, Driver.RESTSplit);
        assert.deepEqual(cc.config, edited);
        assert.deepEqual(cc.deployment, { hostPaths: mounts });
        assert.deepEqual(drivers(cdb).Printer.hostPaths, mounts);
    });
});

describe("the host a port clash is checked on", () => {
    const UDP_A = "cccccccc-0000-4000-8000-0000000000b1";
    const UDP_B = "cccccccc-0000-4000-8000-0000000000b2";
    const AGENT_B = "aaaaaaaa-0000-4000-8000-000000000002";

    /* Two agents, each with a built-in UDP connection on port 50205.
     * The first Deployment names edge-1, but its values pin it to
     * edge-2, and edge-sync merges the values last, so both run on
     * edge-2. */
    function two_agents () {
        const cdb = fixture();
        const udp = agent => cconf(Driver.UDP, { port: 50205 }, "JSON",
            { edgeAgent: agent });
        cdb.set(App.ConnectionConfiguration, UDP_A, udp(AGENT));
        cdb.set(App.ConnectionConfiguration, UDP_B, udp(AGENT_B));

        const config = cdb.get(App.EdgeAgentConfig, AGENT);
        config.deviceConnections.push(entry(UDP_A, "Robot", "UDP",
            "UDPConnDetails", { port: 50205 }, "JSON", 1000));
        cdb.set(App.EdgeAgentConfig, AGENT, config);
        cdb.set(App.EdgeAgentConfig, AGENT_B, {
            deviceConnections: [entry(UDP_B, "Arm", "UDP",
                "UDPConnDetails", { port: 50205 }, "JSON", 1000)],
        });

        const dep = cdb.get(Edge.App.Deployment, AGENT);
        dep.values.hostname = "edge-2";
        cdb.set(Edge.App.Deployment, AGENT, dep);
        cdb.set(Edge.App.Deployment, AGENT_B, {
            cluster: "cluster-uuid", hostname: "edge-2", chart: "chart-uuid",
            name: "agent-b", values: { name: "agent-b", uuid: AGENT_B },
        });
        return cdb;
    }

    test("is the host the Deployment's values pin it to", async () => {
        const count = await run(two_agents());
        /* The other built-in connections, and one of the two UDP ones;
         * the other moves without its sidecar. */
        assert.equal(count.moved, 5);
        assert.equal(count.no_sidecar, 1);
    });
});

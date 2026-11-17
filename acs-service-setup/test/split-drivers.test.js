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
    test("share the internal driver's form, so connection details keep their fields", () => {
        for (const p of Object.values(SplitDrivers)) {
            const [internal, split] = [DEFS[p.internal], DEFS[p.split]];
            assert.ok(internal.internal, "the internal DriverDef is internal");
            assert.ok(split.image?.repository, "the split DriverDef has an image");
            assert.equal(split.internal, undefined);
            assert.deepEqual(split.schema, internal.schema);
            assert.deepEqual(split.presentation, internal.presentation);
            assert.equal(split.polled, internal.polled);
        }
    });

    /* The new-connection form offers DriverDefs that aren't hidden, and
     * picks them by name. REST's and MQTT's split drivers have
     * replaced the built-ins; OPC UA's image isn't published yet. */
    test("offer REST's and MQTT's split drivers by their plain names and hide the others", () => {
        const { REST, MQTT, OPCUA } = SplitDrivers;
        for (const p of [REST, MQTT]) {
            assert.equal(DEFS[p.split].hidden, undefined);
            assert.equal(DEFS[p.internal].hidden, true);
        }
        assert.equal(DEFS[OPCUA.split].hidden, true);
        assert.equal(DEFS[OPCUA.internal].hidden, undefined);

        const names = load_names();
        assert.equal(names[REST.split], "REST");
        assert.equal(names[REST.internal], "REST (built-in)");
        assert.equal(names[MQTT.split], "MQTT");
        assert.equal(names[MQTT.internal], "MQTT (built-in)");
        const offered = Object.entries(DEFS)
            .filter(([, d]) => !d.hidden)
            .map(([uuid]) => names[uuid]);
        assert.equal(offered.filter(n => /^REST\b/.test(n)).length, 1);
        assert.equal(offered.filter(n => /^MQTT\b/.test(n)).length, 1);
        assert.equal(new Set(offered).size, offered.length, "offered names are unique");
    });
});

describe("migrate_split_drivers", () => {
    test("does nothing by default", async () => {
        for (const settings of [undefined, {}, { dryRun: true }, { REST: "yes" }]) {
            const cdb = fixture();
            await run(cdb, settings);
            assert.deepEqual(cdb.writes, []);
        }
    });

    for (const c of CASES) {
        test(`moves ${c.name} connections to the split driver`, async () => {
            const cdb = fixture();
            const before = cdb.get(App.ConnectionConfiguration, c.conn);
            const count = await run(cdb, { [c.name]: true });

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
            /* Tags and everything else are untouched. */
            assert.deepEqual(e.devices.map(d => d.tags), [0, 1].map(() => device("x").tags));
            assert.equal(e.name, c.entry_name);

            assert.deepEqual(drivers(cdb)[c.entry_name],
                { ...(c.deployment ?? {}), image: { repository: c.image } });
            /* Other connections are untouched. */
            assert.deepEqual(drivers(cdb).PLC, { image: { repository: "edge-modbus" } });

            if (c.name == "REST") {
                /* The REST connection with no devices moves too. */
                assert.equal(count.moved, 2);
                assert.equal(cdb.get(App.ConnectionConfiguration, C.empty).driver, Driver.RESTSplit);
            }
            else assert.equal(count.moved, 1);
        });

        test(`moves ${c.name} connections back to exactly where they were`, async () => {
            const start = fixture();
            const cdb = fixture();
            await run(cdb, { [c.name]: true });
            await run(cdb, { [c.name]: false });

            for (const app of [App.ConnectionConfiguration, App.EdgeAgentConfig, Edge.App.Deployment])
                assert.deepEqual(
                    Object.fromEntries(cdb.app(app)),
                    Object.fromEntries(start.app(app)));
        });
    }

    test("only touches the protocols it is asked to", async () => {
        const cdb = fixture();
        await run(cdb, { OPCUA: true });
        assert.equal(conn_entry(cdb, C.mqtt).connType, "MQTT");
        assert.equal(conn_entry(cdb, C.rest).connType, "REST");
        assert.equal(cdb.get(App.ConnectionConfiguration, C.rest).driver, Driver.REST);
        assert.deepEqual(Object.keys(drivers(cdb)).sort(), ["OPC", "PLC"]);
    });

    test("moves every protocol at once", async () => {
        const cdb = fixture();
        await run(cdb, { OPCUA: true, MQTT: true, REST: true });
        assert.deepEqual(Object.keys(drivers(cdb)).sort(), ["Broker", "OPC", "PLC", "Printer"]);
        for (const c of CASES)
            assert.equal(conn_entry(cdb, c.conn).connType, "Driver");
    });

    test("a second run changes nothing", async () => {
        for (const settings of [{ OPCUA: true, MQTT: true, REST: true },
                                { OPCUA: false, MQTT: false, REST: false }]) {
            const cdb = fixture();
            await run(cdb, { OPCUA: true, MQTT: true, REST: true });
            await run(cdb, settings);
            const writes = cdb.writes.length;
            const count = await run(cdb, settings);
            assert.equal(cdb.writes.length, writes);
            assert.equal(count.moved + count.repaired + count.failed, 0);
        }
    });

    test("a dry run writes nothing but counts what would move", async () => {
        const cdb = fixture();
        const count = await run(cdb, { OPCUA: true, REST: true, dryRun: true });
        assert.deepEqual(cdb.writes, []);
        assert.equal(count.moved, 3);
    });

    test("finishes a move a failed run left half done", async () => {
        const cdb = fixture();
        /* The agent config was written but the connection was not. */
        const half = fixture();
        await run(half, { OPCUA: true });
        cdb.set(App.EdgeAgentConfig, AGENT, half.get(App.EdgeAgentConfig, AGENT));

        await run(cdb, { OPCUA: true });
        for (const app of [App.ConnectionConfiguration, App.EdgeAgentConfig, Edge.App.Deployment])
            assert.deepEqual(
                Object.fromEntries(cdb.app(app)),
                Object.fromEntries(half.app(app)));
    });

    test("repairs an agent entry for a connection already on the split driver", async () => {
        const cdb = fixture();
        await run(cdb, { REST: true });
        /* Someone hand-edits the agent config back to the internal type. */
        const config = cdb.get(App.EdgeAgentConfig, AGENT);
        const e = config.deviceConnections.find(c => c.uuid == C.rest);
        e.connType = "REST";
        e.RESTConnDetails = e.DriverDetails;
        cdb.set(App.EdgeAgentConfig, AGENT, config);

        const count = await run(cdb, { REST: true });
        assert.equal(count.repaired, 1);
        assert.equal(conn_entry(cdb, C.rest).connType, "Driver");
        assert.equal(conn_entry(cdb, C.rest).RESTConnDetails, undefined);
    });

    test("rebuilds a config someone else saved first", async () => {
        const cdb = fixture();
        cdb.stale.push([App.EdgeAgentConfig, AGENT], [Edge.App.Deployment, AGENT]);
        const count = await run(cdb, { OPCUA: true });
        assert.equal(count.moved, 1);
        assert.equal(conn_entry(cdb, C.opcua).connType, "Driver");
        assert.ok(drivers(cdb).OPC);
    });

    test("keeps an OPC UA connection's JSON format both ways", async () => {
        const cdb = fixture();
        const cc = cdb.get(App.ConnectionConfiguration, C.opcua);
        cc.source.payloadFormat = "JSON";
        cdb.set(App.ConnectionConfiguration, C.opcua, cc);
        const config = cdb.get(App.EdgeAgentConfig, AGENT);
        const e = config.deviceConnections.find(c => c.uuid == C.opcua);
        e.payloadFormat = "JSON";
        e.devices.forEach(d => d.payloadFormat = "JSON");
        cdb.set(App.EdgeAgentConfig, AGENT, config);

        await run(cdb, { OPCUA: true });
        assert.equal(conn_entry(cdb, C.opcua).payloadFormat, "JSON");
        await run(cdb, { OPCUA: false });
        assert.equal(conn_entry(cdb, C.opcua).payloadFormat, "JSON");
        assert.equal(cdb.get(App.ConnectionConfiguration, C.opcua).source.payloadFormat, "JSON");
    });

    test("does not move to a split DriverDef that is missing or has no image", async () => {
        const cdb = fixture();
        cdb.app(App.DriverDefinition).delete(Driver.RESTSplit);
        const def = structuredClone(DEFS[Driver.OPCUASplit]);
        delete def.image;
        cdb.set(App.DriverDefinition, Driver.OPCUASplit, def);
        await run(cdb, { REST: true, OPCUA: true });
        assert.deepEqual(cdb.writes, []);
    });

    test("never creates a Deployment", async () => {
        const cdb = fixture();
        cdb.app(Edge.App.Deployment).delete(AGENT);
        await run(cdb, { OPCUA: true });
        assert.equal(cdb.get(Edge.App.Deployment, AGENT), undefined);
        assert.equal(conn_entry(cdb, C.opcua).connType, "Driver");
    });

    test("one failed connection does not stop the rest", async () => {
        const cdb = fixture();
        const put = cdb.put_config.bind(cdb);
        cdb.put_config = async (a, o, c, opts) => {
            if (a == App.ConnectionConfiguration && o == C.rest)
                throw new Error("boom");
            return put(a, o, c, opts);
        };
        const count = await run(cdb, { REST: true });
        assert.equal(count.failed, 1);
        assert.equal(count.moved, 1);
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

    test("an existing split driver gets an id with no move asked for", async () => {
        const cdb = dotted();
        const count = await run(cdb, {});

        assert.equal(count.ids, 1);
        assert.equal(conn_entry(cdb, C.modbus).driverId, PLC_ID);
        assert.equal(conn_entry(cdb, C.modbus).name, "plc.example.org");
        assert.deepEqual(drivers(cdb), { [PLC_ID]: { image: { repository: "edge-modbus" } } });
        /* The built-in REST connection has no sidecar, so no id. */
        assert.equal(conn_entry(cdb, C.rest).driverId, undefined);
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

    test("an agent whose names all work is not written", async () => {
        const cdb = fixture();
        const count = await run(cdb, {});
        assert.deepEqual(cdb.writes, []);
        assert.equal(count.ids, 0);
    });

    test("finishes a deployment left keyed by the name", async () => {
        const cdb = dotted();
        await run(cdb, {});
        /* The config was written, the deployment was not. */
        const dep = cdb.get(Edge.App.Deployment, AGENT);
        dep.values.drivers = { "plc.example.org": dep.values.drivers[PLC_ID] };
        cdb.set(Edge.App.Deployment, AGENT, dep);

        assert.equal((await run(cdb, {})).ids, 1);
        assert.deepEqual(Object.keys(drivers(cdb)), [PLC_ID]);
    });

    test("a connection moved to its split driver uses its id", async () => {
        const cdb = dotted();
        await run(cdb, { REST: true });

        const e = conn_entry(cdb, C.rest);
        assert.equal(e.connType, "Driver");
        assert.equal(e.driverId, WEB_ID);
        assert.deepEqual(Object.keys(drivers(cdb)).sort(), [PLC_ID, WEB_ID]);
        assert.deepEqual(drivers(cdb)[WEB_ID].image, { repository: "edge-rest" });
    });

    test("a connection moved back loses its id and its sidecar", async () => {
        const start = dotted();
        await run(start, {});
        const cdb = dotted();
        await run(cdb, { REST: true });
        await run(cdb, { REST: false });

        for (const app of [App.ConnectionConfiguration, App.EdgeAgentConfig, Edge.App.Deployment])
            assert.deepEqual(
                Object.fromEntries(cdb.app(app)),
                Object.fromEntries(start.app(app)));
    });

    test("a deployment keyed by both name and id keeps the id's values", async () => {
        const cdb = dotted();
        const dep = cdb.get(Edge.App.Deployment, AGENT);
        dep.values.drivers[PLC_ID] = { image: { repository: "edge-modbus" }, hostPaths: [] };
        cdb.set(Edge.App.Deployment, AGENT, dep);

        await run(cdb, {});
        assert.deepEqual(drivers(cdb),
            { [PLC_ID]: { image: { repository: "edge-modbus" }, hostPaths: [] } });
    });
});

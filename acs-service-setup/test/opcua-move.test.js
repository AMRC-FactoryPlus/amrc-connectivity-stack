/*
 * ACS service setup
 * A whole site's OPC UA connections moved by the chart's defaults, and back
 * Copyright 2026 University of Sheffield AMRC
 *
 * opcua-move/site.json is a site before an upgrade: one Edge Agent with
 * two built-in OPC UA connections beside a Modbus split driver, and a
 * second agent with no OPC UA connection.
 *
 *  - `cell.opcua` has a dot in its name, SignAndEncrypt with
 *    Basic256Sha256, a username and a password secret. Its one device
 *    is the golden-output sample `opcua` from
 *    acs-edge/tests/fixtures/drivers/samples, with Metric_06 writable.
 *  - `Furnace` has security None, no credentials and, as some real
 *    connections have, no payload format of its own. Two of its
 *    devices share the same sample's metrics between them. Two more
 *    have nothing to read, as two real connections have: one has only
 *    a metric with no address, and one has no metrics at all. The
 *    built-in connection crashed the Edge Agent on such a device.
 *
 * Both have a metric with a path the built-in connection never read
 * (`mm`, a unit, and `null`). acs-edge/tests/golden replays
 * opcua-move/moved.json, the site after the move, through the built
 * Edge Agent and edge-opcua.
 *
 * After a deliberate change to the move, rewrite moved.json with
 *   UPDATE_OPCUA_MOVE=1 npm test
 * and check its diff.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import yaml from "yaml";

import { UUIDs } from "@amrc-factoryplus/service-client";

import { DumpLoader } from "../lib/dumps.js";
import { MigrateSplitDrivers } from "../lib/split-drivers.js";
import { ACS, Edge } from "../lib/uuids.js";

import { FakeCDB } from "./fake-cdb.js";

const { App } = UUIDs;
const { Driver } = ACS;

const read_json = name => JSON.parse(fs.readFileSync(
    new URL(`./opcua-move/${name}`, import.meta.url), "utf8"));
const MOVED_FILE = new URL("./opcua-move/moved.json", import.meta.url);

/* The apps the move touches, in the order the snapshots list them. */
const APPS = [App.ConnectionConfiguration, App.EdgeAgentConfig, Edge.App.Deployment];

const SITE = read_json("site.json");
const AGENT = "aaaaaaaa-0000-4000-8000-00000000000a";
const OTHER = "aaaaaaaa-0000-4000-8000-00000000000b";
const C = {
    cell:       "cccccccc-0000-4000-8000-000000000001",
    furnace:    "cccccccc-0000-4000-8000-000000000002",
    plc:        "cccccccc-0000-4000-8000-000000000003",
    plc2:       "cccccccc-0000-4000-8000-000000000004",
};
const OPCUA = [C.cell, C.furnace];

/* serviceSetup.config.splitDrivers as the chart ships it. */
function chart_defaults () {
    const values = yaml.parse(fs.readFileSync(
        new URL("../../deploy/values.yaml", import.meta.url), "utf8"));
    return values.serviceSetup.config.splitDrivers;
}

/* The DriverDefs as edge.yaml loads them on upgrade. */
function driverdefs () {
    const loader = new DumpLoader({
        dumps: [], acs_config: {}, local: s => s, log: () => {},
    });
    const docs = loader.parse_yaml(
        fs.readFileSync(new URL("../dumps/edge.yaml", import.meta.url), "utf8"),
        "edge.yaml");
    return docs.find(d => d.configs?.[Edge.App.DriverDef])
        .configs[Edge.App.DriverDef];
}

function site () {
    const cdb = new FakeCDB();
    for (const [uuid, def] of Object.entries(driverdefs()))
        cdb.set(App.DriverDefinition, uuid, def);
    for (const app of APPS)
        for (const [obj, conf] of Object.entries(SITE.configs[app]))
            cdb.set(app, obj, conf);
    return cdb;
}

/* The configs the move touches, as JSON text, keyed as the snapshots
 * are, in insertion order so that the text compares byte for byte. */
function state (cdb) {
    return Object.fromEntries(APPS.map(app =>
        [app, Object.fromEntries(cdb.app(app))]));
}
const text = s => JSON.stringify(s, null, 2) + "\n";

const run = (cdb, settings) => new MigrateSplitDrivers({
    fplus: { ConfigDB: cdb }, settings, log: () => {},
}).run();

const entry = (cdb, agent, conn) => cdb.get(App.EdgeAgentConfig, agent)
    .deviceConnections.find(c => c.uuid == conn);
const site_entry = (agent, conn) => SITE.configs[App.EdgeAgentConfig][agent]
    .deviceConnections.find(c => c.uuid == conn);
const tags = e => e.devices.flatMap(d => d.tags);
/* A metric without what the move may change. */
const bare = ({ path, ...tag }) => tag;

describe("moving a site's OPC UA connections with the chart's defaults", () => {
    const defaults = chart_defaults();

    test("the chart moves OPC UA", () => {
        assert.equal(defaults.OPCUA, true);
    });

    test("the site's OPC UA connections are the golden-output sample", () => {
        /* The harness replays the sample's recorded values, which only
         * fits if the connection's metrics are the sample's. Furnace
         * shares them between two devices, and cell.opcua makes one
         * writable. */
        for (const [conn, sample] of Object.entries(SITE.samples)) {
            const ours = site_entry(AGENT, conn);
            const theirs = JSON.parse(fs.readFileSync(new URL(
                `../../acs-edge/tests/fixtures/drivers/samples/${sample}/connection.json`,
                import.meta.url), "utf8"));
            const strip = t => ({ ...bare(t), method: undefined });
            const read = e => tags(e).filter(t => t.address);
            assert.deepEqual(read(ours).map(strip), read(theirs).map(strip), conn);
            assert.equal(ours.pollInt, theirs.pollInt, conn);
        }
        const furnace = site_entry(AGENT, C.furnace).devices;
        assert.equal(furnace.length, 4);
        assert.deepEqual(furnace.map(d => d.tags.filter(t => t.address).length),
            [3, 4, 0, 0]);
        assert.deepEqual(furnace[3].tags, []);
        assert.equal(site_entry(AGENT, C.furnace).payloadFormat, undefined);
    });

    test("moves every built-in OPC UA connection and nothing else", async () => {
        const cdb = site();
        const count = await run(cdb, defaults);
        assert.equal(count.moved, 2);
        assert.equal(count.failed, 0);

        /* ConnectionConfigurations: the split driver, JSON, and every
         * connection setting as it was: endpoint, security mode and
         * policy, credentials and the password's secret. */
        for (const conn of OPCUA) {
            const before = SITE.configs[App.ConnectionConfiguration][conn];
            const after = cdb.get(App.ConnectionConfiguration, conn);
            assert.equal(before.driver, Driver.OPCUA);
            assert.equal(after.driver, Driver.OPCUASplit);
            assert.deepEqual(after.config, before.config);
            assert.equal(after.source.payloadFormat, "JSON");
            assert.deepEqual(after.splitMigration,
                { from: Driver.OPCUA, payloadFormat: "Defined by Protocol" });
        }

        /* The Edge Agent config: Driver with the same details, JSON,
         * and no metric paths. */
        const cell = entry(cdb, AGENT, C.cell);
        const furnace = entry(cdb, AGENT, C.furnace);
        for (const [e, conn] of [[cell, C.cell], [furnace, C.furnace]]) {
            const before = site_entry(AGENT, conn);
            assert.equal(e.connType, "Driver");
            assert.equal(e.OPCUAConnDetails, undefined);
            assert.deepEqual(e.DriverDetails, before.OPCUAConnDetails);
            assert.equal(e.payloadFormat, "JSON");
            assert.deepEqual(e.devices.map(d => d.payloadFormat),
                before.devices.map(() => "JSON"));
            assert.deepEqual(e.devices.map(d => d.deviceId),
                before.devices.map(d => d.deviceId));
            assert.ok(tags(before).some(t => t.path), "the site has paths to clear");
            assert.ok(!tags(e).some(t => "path" in t), "every path is cleared");
            assert.deepEqual(tags(e), tags(before).map(bare));
        }
        assert.deepEqual(cell.DriverDetails, {
            endpoint: "opc.tcp://cell-server.local:4840",
            securityMode: "SignAndEncrypt", securityPolicy: "Basic256Sha256",
            useCredentials: true, username: "cell-reader",
            password: "__FPSI__5ec2e7a0-0000-4000-8000-000000000001",
        });
        assert.equal(tags(cell).find(t => t.Name == "Metric_06").method, "GET/SET");

        /* A dotted name can't be a driver id. */
        assert.match(cell.driverId, /^cell-opcua-[0-9a-f]{8}$/);
        assert.equal(furnace.driverId, undefined);

        /* The Modbus drivers and the other agent are untouched. */
        assert.deepEqual(entry(cdb, AGENT, C.plc), site_entry(AGENT, C.plc));
        assert.ok(!cdb.writes.some(w => [OTHER, C.plc, C.plc2].includes(w.obj)),
            "nothing about the other agent or the Modbus drivers is written");

        /* An edge-opcua sidecar per connection, keyed by its driver id,
         * with the chart's default tag. */
        assert.deepEqual(cdb.get(Edge.App.Deployment, AGENT).values.drivers, {
            "PLC-1":            { image: { repository: "edge-modbus" } },
            [cell.driverId]:    { image: { repository: "edge-opcua" } },
            "Furnace":          { image: { repository: "edge-opcua" } },
        });

        if (process.env.UPDATE_OPCUA_MOVE)
            fs.writeFileSync(MOVED_FILE, text(state(cdb)));
        assert.equal(text(state(cdb)), fs.readFileSync(MOVED_FILE, "utf8"),
            "the site after the move is opcua-move/moved.json");
    });

    test("a second run writes nothing", async () => {
        const cdb = site();
        await run(cdb, defaults);
        cdb.writes = [];
        const count = await run(cdb, defaults);
        assert.deepEqual(cdb.writes, []);
        assert.equal(count.moved + count.repaired, 0);
    });

    /* Moving back restores the built-in connection, its details and
     * "Defined by Protocol", and removes the sidecars. It does not put
     * back the cleared paths, which the built-in never read, and it
     * writes out the default format of a connection that had none. */
    test("moving back leaves the site as it was, but for the paths", async () => {
        const cdb = site();
        await run(cdb, defaults);
        const back = { ...defaults, OPCUA: false };
        const count = await run(cdb, back);
        assert.equal(count.moved, 2);

        const want = structuredClone(SITE.configs);
        const agent = want[App.EdgeAgentConfig][AGENT];
        for (const e of agent.deviceConnections.filter(e => OPCUA.includes(e.uuid)))
            for (const t of tags(e)) delete t.path;
        const furnace = agent.deviceConnections.find(e => e.uuid == C.furnace);
        want[App.EdgeAgentConfig][AGENT].deviceConnections[1] = {
            ...furnace, payloadFormat: "Defined by Protocol",
        };
        want[App.ConnectionConfiguration][C.furnace].source =
            { payloadFormat: "Defined by Protocol" };
        assert.deepEqual(state(cdb), want);
        const restored = entry(cdb, AGENT, C.furnace);
        assert.equal(restored.connType, "OPC UA");
        assert.deepEqual(restored.OPCUAConnDetails, furnace.OPCUAConnDetails);

        cdb.writes = [];
        await run(cdb, back);
        assert.deepEqual(cdb.writes, [], "a second run back writes nothing");
    });

    test("moving again after moving back gives the same configs", async () => {
        const cdb = site();
        await run(cdb, defaults);
        await run(cdb, { ...defaults, OPCUA: false });
        await run(cdb, defaults);
        /* Furnace's entry, which had no payload format, now has one, so
         * its keys come in another order: compare the values. */
        assert.deepEqual(state(cdb), read_json("moved.json"));
    });
});

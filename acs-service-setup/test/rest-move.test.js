/*
 * ACS service setup
 * A whole site's REST connections moved by the chart's defaults
 * Copyright 2026 University of Sheffield AMRC
 *
 * rest-move/site.json is a site before an upgrade: one Edge Agent with
 * two built-in REST connections (one named after a web address with
 * Basic auth and JSON payloads, one with capitals in its name and XML
 * payloads) beside a Modbus split driver, and a second agent with no
 * REST connection. The REST connections are the golden-output samples
 * rest-json and rest-xml from acs-edge/tests/fixtures/drivers, so
 * acs-edge/tests/golden can run what this move leaves through the
 * built Edge Agent and edge-rest. rest-move/moved.json is the site after
 * the move, and that harness reads it.
 *
 * After a deliberate change to the move, rewrite moved.json with
 *   UPDATE_REST_MOVE=1 npm test
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
    new URL(`./rest-move/${name}`, import.meta.url), "utf8"));
const MOVED_FILE = new URL("./rest-move/moved.json", import.meta.url);

/* The apps the move touches, in the order the snapshots list them. */
const APPS = [App.ConnectionConfiguration, App.EdgeAgentConfig, Edge.App.Deployment];

const SITE = read_json("site.json");
const AGENT = "aaaaaaaa-0000-4000-8000-00000000000a";
const OTHER = "aaaaaaaa-0000-4000-8000-00000000000b";
const C = {
    json:   "cccccccc-0000-4000-8000-000000000001",
    xml:    "cccccccc-0000-4000-8000-000000000002",
    plc:    "cccccccc-0000-4000-8000-000000000003",
    broker: "cccccccc-0000-4000-8000-000000000004",
};

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

describe("moving a site's REST connections with the chart's defaults", () => {
    const defaults = chart_defaults();

    test("the chart holds no protocol back", () => {
        for (const p of ["REST", "MQTT", "OPCUA", "UDP"])
            assert.ok(!(p in defaults), `splitDrivers.${p} is set`);
    });

    test("the site's REST connections are the golden-output samples", () => {
        /* The harness replays each sample's recorded responses, which
         * only fits if the devices are the sample's. */
        for (const [conn, sample] of Object.entries(SITE.samples)) {
            const ours = site_entry(AGENT, conn);
            const theirs = JSON.parse(fs.readFileSync(new URL(
                `../../acs-edge/tests/fixtures/drivers/samples/${sample}/connection.json`,
                import.meta.url), "utf8"));
            const strip = devs => devs.map(({ deviceId, ...d }) => d);
            assert.deepEqual(strip(ours.devices), strip(theirs.devices), sample);
            assert.equal(ours.pollInt, theirs.pollInt, sample);
            assert.equal(ours.payloadFormat, theirs.payloadFormat, sample);
        }
    });

    test("moves every built-in REST connection", async () => {
        const cdb = site();
        const count = await run(cdb, defaults);
        /* The two REST connections and the other agent's MQTT one. */
        assert.equal(count.moved, 3);
        assert.equal(count.failed, 0);

        /* ConnectionConfigurations: the driver changes, and nothing
         * else, because REST payloads pass through unchanged. */
        for (const conn of [C.json, C.xml]) {
            const before = SITE.configs[App.ConnectionConfiguration][conn];
            const after = cdb.get(App.ConnectionConfiguration, conn);
            assert.equal(before.driver, Driver.REST);
            assert.equal(after.driver, Driver.RESTSplit);
            assert.deepEqual({ ...after, driver: before.driver, splitMigration: undefined },
                { ...before, splitMigration: undefined });
        }

        /* The Edge Agent config: Driver with the same details. */
        const json = entry(cdb, AGENT, C.json);
        const xml = entry(cdb, AGENT, C.xml);
        for (const [e, conn] of [[json, C.json], [xml, C.xml]]) {
            const before = site_entry(AGENT, conn);
            assert.equal(e.connType, "Driver");
            assert.equal(e.RESTConnDetails, undefined);
            assert.deepEqual(e.DriverDetails, before.RESTConnDetails);
            assert.deepEqual(e.devices, before.devices);
            assert.equal(e.payloadFormat, before.payloadFormat);
        }
        /* Basic auth keeps its secret placeholder, which the agent
         * fills in before it hands the details to the driver. */
        assert.equal(json.DriverDetails.authMethod, "Basic");
        assert.match(json.DriverDetails.password, /^__FPSI__/);

        /* A dotted name can't be a driver id; capitals can. */
        assert.match(json.driverId, /^api-example-org-[0-9a-f]{8}$/);
        assert.equal(xml.driverId, undefined);
        assert.equal(xml.name, "WeatherStation");

        /* The Modbus driver is untouched. The other agent's MQTT
         * connection moves too, as every built-in connection does. */
        assert.deepEqual(entry(cdb, AGENT, C.plc), site_entry(AGENT, C.plc));
        assert.ok(!cdb.writes.some(w => w.obj == C.plc), "the Modbus driver is not written");
        assert.equal(cdb.get(App.ConnectionConfiguration, C.broker).driver, Driver.MQTTSplit);
        assert.equal(entry(cdb, OTHER, C.broker).connType, "Driver");

        /* The Deployment gets an edge-rest sidecar per connection,
         * keyed by its driver id, with no tag of its own: the chart's
         * default tag applies, as it does to the agent. */
        assert.deepEqual(cdb.get(Edge.App.Deployment, AGENT).values.drivers, {
            "PLC-1":            { image: { repository: "edge-modbus" } },
            [json.driverId]:    { image: { repository: "edge-rest" } },
            "WeatherStation":   { image: { repository: "edge-rest" } },
        });

        if (process.env.UPDATE_REST_MOVE)
            fs.writeFileSync(MOVED_FILE, text(state(cdb)));
        assert.equal(text(state(cdb)), fs.readFileSync(MOVED_FILE, "utf8"),
            "the site after the move is rest-move/moved.json");
    });

    test("a second run writes nothing", async () => {
        const cdb = site();
        await run(cdb, defaults);
        cdb.writes = [];
        const count = await run(cdb, defaults);
        assert.deepEqual(cdb.writes, []);
        assert.equal(count.moved, 0);
    });
});

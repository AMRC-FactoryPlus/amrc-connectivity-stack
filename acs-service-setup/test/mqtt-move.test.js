/*
 * ACS service setup
 * A whole site's MQTT connections moved by the chart's defaults
 * Copyright 2026 University of Sheffield AMRC
 *
 * mqtt-move/site.json is a site before an upgrade:
 *
 *  - one Edge Agent with three built-in MQTT connections beside a
 *    Modbus split driver: one named after a host name, over TLS
 *    (`mqtts`) with a username, a secret password, its own client id,
 *    no clean session and a 30 s keep-alive, reading JSON; one over
 *    `tcp` with a password but no username, reading Delimited String;
 *    and one with an underscore in its name, over `tls` with
 *    credentials and keep-alive off, reading JSON (Batched) from
 *    topics that carry arrays and topics that carry objects, with
 *    wildcard addresses;
 *  - a second agent with no MQTT connection;
 *  - a third agent with two plain MQTT connections and no split
 *    drivers yet, one with a space in its name reading XML and one
 *    reading Buffer.
 *
 * Each MQTT connection's devices are a golden-output sample from
 * acs-edge/tests (`samples` in site.json), so acs-edge/tests/golden
 * can run what this move leaves through the built Edge Agent and
 * edge-mqtt. mqtt-move/moved.json is the site after the move, and that
 * harness reads it.
 *
 * After a deliberate change to the move, rewrite moved.json with
 *   UPDATE_MQTT_MOVE=1 npm test
 * and check its diff.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import util from "node:util";

import yaml from "yaml";

import { UUIDs } from "@amrc-factoryplus/service-client";

import { DumpLoader } from "../lib/dumps.js";
import { MigrateSplitDrivers } from "../lib/split-drivers.js";
import { ACS, Edge } from "../lib/uuids.js";

import { FakeCDB, jsonb } from "./fake-cdb.js";

const { App } = UUIDs;
const { Driver } = ACS;

const read_json = name => JSON.parse(fs.readFileSync(
    new URL(`./mqtt-move/${name}`, import.meta.url), "utf8"));
const MOVED_FILE = new URL("./mqtt-move/moved.json", import.meta.url);

/* The apps the move touches, in the order the snapshots list them. */
const APPS = [App.ConnectionConfiguration, App.EdgeAgentConfig, Edge.App.Deployment];

const SITE = read_json("site.json");
const LINE = "aaaaaaaa-0000-4000-8000-00000000000a";
const OVEN = "aaaaaaaa-0000-4000-8000-00000000000b";
const CELL = "aaaaaaaa-0000-4000-8000-00000000000c";
const C = {
    json:       "cccccccc-0000-4000-8000-000000000001",
    delimited:  "cccccccc-0000-4000-8000-000000000002",
    batched:    "cccccccc-0000-4000-8000-000000000003",
    xml:        "cccccccc-0000-4000-8000-000000000004",
    buffer:     "cccccccc-0000-4000-8000-000000000005",
    plc:        "cccccccc-0000-4000-8000-000000000006",
    oven:       "cccccccc-0000-4000-8000-000000000007",
};
const MQTT = [C.json, C.delimited, C.batched, C.xml, C.buffer];

/* serviceSetup.config.splitDrivers as the chart ships it. Every built-in
 * connection moves, so the site's OPC UA connection does too. */
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

const agent_of = conn => SITE.configs[App.ConnectionConfiguration][conn].edgeAgent;
const entry = (cdb, conn) => cdb.get(App.EdgeAgentConfig, agent_of(conn))
    .deviceConnections.find(c => c.uuid == conn);
const site_entry = conn => SITE.configs[App.EdgeAgentConfig][agent_of(conn)]
    .deviceConnections.find(c => c.uuid == conn);

describe("moving a site's MQTT connections with the chart's defaults", () => {
    const defaults = chart_defaults();

    test("the chart holds no protocol back", () => {
        for (const p of ["REST", "MQTT", "OPCUA", "UDP"])
            assert.ok(!(p in defaults), `splitDrivers.${p} is set`);
    });

    test("the site's MQTT connections are the golden-output samples", () => {
        /* The harness replays each sample's messages, which only fits
         * if the devices are the sample's. */
        assert.deepEqual(Object.keys(SITE.samples).sort(), [...MQTT].sort());
        for (const [conn, sample] of Object.entries(SITE.samples)) {
            const ours = site_entry(conn);
            const theirs = JSON.parse(fs.readFileSync(new URL(
                `../../acs-edge/tests/${sample}/connection.json`,
                import.meta.url), "utf8"));
            assert.deepEqual(ours.devices, theirs.devices, sample);
            assert.equal(ours.payloadFormat, theirs.payloadFormat, sample);
        }
        const formats = MQTT.map(c => site_entry(c).payloadFormat);
        assert.deepEqual(formats,
            ["JSON", "Delimited String", "JSON (Batched)", "XML", "Buffer"]);
    });

    test("moves every built-in MQTT connection", async () => {
        const cdb = site();
        const count = await run(cdb, defaults);
        /* The five MQTT connections and the oven's OPC UA one. */
        assert.equal(count.moved, 6);
        assert.equal(count.failed, 0);

        for (const conn of MQTT) {
            /* ConnectionConfigurations: the driver changes, and nothing
             * else, because MQTT payloads pass through unchanged. */
            const before = SITE.configs[App.ConnectionConfiguration][conn];
            const after = cdb.get(App.ConnectionConfiguration, conn);
            assert.equal(before.driver, Driver.MQTT);
            assert.equal(after.driver, Driver.MQTTSplit);
            assert.deepEqual({ ...after, driver: before.driver, splitMigration: undefined },
                { ...before, splitMigration: undefined });

            /* The Edge Agent config: Driver with every connection
             * detail as it was (TLS, credentials and their secret
             * placeholder, client id, keep-alive, clean session,
             * protocol and port), the same devices and formats. */
            const was = site_entry(conn);
            const now = entry(cdb, conn);
            assert.equal(now.connType, "Driver");
            assert.equal(now.MQTTConnDetails, undefined);
            assert.deepEqual(now.DriverDetails, was.MQTTConnDetails);
            assert.deepEqual(now.devices, was.devices);
            assert.equal(now.payloadFormat, was.payloadFormat);
        }
        const tls = entry(cdb, C.json).DriverDetails;
        assert.deepEqual(
            [tls.protocol, tls.port, tls.clientId, tls.username, tls.cleanSession, tls.keepAlive],
            ["mqtts", 8883, "line-1-reader", "reader", false, 30]);
        assert.match(tls.password, /^__FPSI__/);
        assert.equal(entry(cdb, C.batched).DriverDetails.keepAlive, 0);

        /* Names that can't be driver ids get one; the others keep
         * their name. */
        const ids = Object.fromEntries(MQTT.map(c => [c, entry(cdb, c).driverId]));
        assert.match(ids[C.json], /^broker-example-org-[0-9a-f]{8}$/);
        assert.match(ids[C.batched], /^cell-gateway-[0-9a-f]{8}$/);
        assert.match(ids[C.xml], /^xml-gateway-[0-9a-f]{8}$/);
        assert.equal(ids[C.delimited], undefined);
        assert.equal(ids[C.buffer], undefined);

        /* The Modbus driver is untouched. The oven's OPC UA connection
         * moves too, as every built-in connection does. */
        assert.deepEqual(entry(cdb, C.plc), site_entry(C.plc));
        assert.ok(!cdb.writes.some(w => w.obj == C.plc), "the Modbus driver is not written");
        assert.equal(cdb.get(App.ConnectionConfiguration, C.oven).driver, Driver.OPCUASplit);

        /* Each Deployment gets an edge-mqtt sidecar per connection,
         * keyed by its driver id, with no tag of its own. The cell
         * agent had no split drivers before. */
        const mqtt = { image: { repository: "edge-mqtt" } };
        assert.deepEqual(cdb.get(Edge.App.Deployment, LINE).values.drivers, {
            "PLC-1":            { image: { repository: "edge-modbus" } },
            [ids[C.json]]:      mqtt,
            "LineSensors":      mqtt,
            [ids[C.batched]]:   mqtt,
        });
        assert.deepEqual(cdb.get(Edge.App.Deployment, CELL).values.drivers, {
            [ids[C.xml]]:       mqtt,
            "Packer-2":         mqtt,
        });

        if (process.env.UPDATE_MQTT_MOVE)
            fs.writeFileSync(MOVED_FILE, text(state(cdb)));
        assert.equal(text(state(cdb)), fs.readFileSync(MOVED_FILE, "utf8"),
            "the site after the move is mqtt-move/moved.json");
    });

    test("a second run writes nothing", async () => {
        const cdb = site();
        await run(cdb, defaults);
        cdb.writes = [];
        const count = await run(cdb, defaults);
        assert.deepEqual(cdb.writes, []);
        assert.equal(count.moved, 0);
    });

    test("false is refused and MQTT connections still move", async () => {
        const cdb = site();
        const { count, lines } = await run_logged(cdb, { ...defaults, MQTT: false });
        assert.equal(count.moved, 6);
        assert.equal(text(state(cdb)), fs.readFileSync(MOVED_FILE, "utf8"));
        assert.equal(lines.filter(l =>
            l.startsWith("ERROR: serviceSetup.config.splitDrivers.MQTT is false.")).length, 1);
    });

    /* A site whose Edge Agents still run version 6 holds MQTT. */
    test("hold keeps every MQTT connection where it is, and says how many", async () => {
        const cdb = site();
        const { count, lines } = await run_logged(cdb, { ...defaults, MQTT: "hold" });
        assert.equal(count.held, 5);
        /* Only the oven's OPC UA connection moves. */
        assert.equal(count.moved, 1);
        for (const conn of MQTT)
            assert.deepEqual(entry(cdb, conn), site_entry(conn));
        assert.equal(lines.filter(l => l.startsWith(
            "ERROR: serviceSetup.config.splitDrivers.MQTT is 'hold', so 5 MQTT")).length, 1);

        const again = await run_logged(cdb, defaults);
        assert.equal(again.count.moved, 5);
        assert.equal(text(state(cdb)), fs.readFileSync(MOVED_FILE, "utf8"));
    });
});

/* A run that keeps what it logs. */
async function run_logged (cdb, settings) {
    const lines = [];
    const count = await new MigrateSplitDrivers({
        fplus: { ConfigDB: cdb }, settings,
        log: (fmt, ...args) => lines.push(util.format(fmt, ...args)),
    }).run();
    return { count, lines };
}

function pin (cdb, agent, image) {
    const dep = cdb.get(Edge.App.Deployment, agent);
    if (image) dep.values.image = image;
    else delete dep.values.image;
    cdb.set(Edge.App.Deployment, agent, dep);
}

describe("an Edge Agent whose Deployment pins its image", () => {
    const defaults = chart_defaults();
    const CELL_MQTT = [C.xml, C.buffer];

    for (const [what, image] of [
        ["the default tag", { default: { tag: "batch.2" } }],
        ["the default registry", { default: { registry: "registry.example.org" } }],
        ["the Edge Agent's tag", { edgeAgent: { tag: "v6.24.2" } }],
    ]) {
        test(`pinning ${what} holds back that agent's connections and no others`, async () => {
            const cdb = site();
            pin(cdb, CELL, image);
            const { count, lines } = await run_logged(cdb, defaults);
            assert.equal(count.held, 2);
            assert.equal(count.moved, 4);

            for (const conn of CELL_MQTT) {
                assert.equal(cdb.get(App.ConnectionConfiguration, conn).driver, Driver.MQTT);
                assert.deepEqual(entry(cdb, conn), site_entry(conn));
            }
            assert.equal(cdb.get(Edge.App.Deployment, CELL).values.drivers, undefined);
            const held = lines.filter(l => /not moving to the split driver/.test(l));
            assert.equal(held.length, 2, "one line per connection");
            assert.match(held[0], /Deployment sets image\./);
            assert.match(held[0], /keeps running the connection itself/);
            assert.match(held[0], /Remove the setting from the Deployment's values/);

            /* Removing the pin lets the next run move them, and the
             * result is the same as moving without a pin. */
            pin(cdb, CELL);
            const again = await run_logged(cdb, defaults);
            assert.equal(again.count.moved, 2);
            assert.equal(again.count.held, 0);
            assert.equal(text(state(cdb)), fs.readFileSync(MOVED_FILE, "utf8"));
        });
    }

    test("a pin without a tag or registry doesn't hold anything back", async () => {
        const cdb = site();
        pin(cdb, CELL, { default: { pullPolicy: "Always" } });
        const { count } = await run_logged(cdb, defaults);
        assert.equal(count.moved, 6);
        assert.equal(count.held, 0);
    });
});

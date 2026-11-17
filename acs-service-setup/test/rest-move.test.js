/*
 * ACS service setup
 * A whole site's REST connections moved by the chart's defaults, and back
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
import util from "node:util";

import yaml from "yaml";

import { UUIDs } from "@amrc-factoryplus/service-client";

import { DumpLoader } from "../lib/dumps.js";
import { MigrateSplitDrivers } from "../lib/split-drivers.js";
import { ACS, Edge } from "../lib/uuids.js";

import { FakeCDB } from "./fake-cdb.js";
import { FakeCharts, chart_values, ready_charts } from "./fake-charts.js";

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

const run = (cdb, settings, edge_charts = ready_charts()) => new MigrateSplitDrivers({
    fplus: { ConfigDB: cdb }, settings, edge_charts, log: () => {},
}).run();

const entry = (cdb, agent, conn) => cdb.get(App.EdgeAgentConfig, agent)
    .deviceConnections.find(c => c.uuid == conn);
const site_entry = (agent, conn) => SITE.configs[App.EdgeAgentConfig][agent]
    .deviceConnections.find(c => c.uuid == conn);

describe("moving a site's REST connections with the chart's defaults", () => {
    const defaults = chart_defaults();

    test("the chart moves REST and no other protocol", () => {
        assert.deepEqual(defaults, { REST: true });
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

    test("moves every built-in REST connection and nothing else", async () => {
        const cdb = site();
        const count = await run(cdb, defaults);
        assert.equal(count.moved, 2);
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

        /* The Modbus driver and the other agent are untouched. */
        assert.deepEqual(entry(cdb, AGENT, C.plc), site_entry(AGENT, C.plc));
        assert.ok(!cdb.writes.some(w => w.obj == OTHER || w.obj == C.plc || w.obj == C.broker),
            "nothing about the other agent, its MQTT connection or the Modbus driver is written");

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

    test("moving back leaves every config as it was, byte for byte", async () => {
        const cdb = site();
        await run(cdb, defaults);
        /* A site sets REST to false in its own values; Helm merges that
         * over the chart's. */
        const back = { ...defaults, REST: false };
        const count = await run(cdb, back);
        assert.equal(count.moved, 2);
        assert.equal(text(state(cdb)), text(SITE.configs));

        cdb.writes = [];
        await run(cdb, back);
        assert.deepEqual(cdb.writes, [], "a second run back writes nothing");
    });

    test("moving again after moving back gives the same configs", async () => {
        const cdb = site();
        await run(cdb, defaults);
        await run(cdb, { ...defaults, REST: false });
        await run(cdb, defaults);
        assert.equal(text(state(cdb)), fs.readFileSync(MOVED_FILE, "utf8"));
    });
});

/* A run that keeps what it logs. */
async function run_logged (cdb, settings, edge_charts) {
    const lines = [];
    const count = await new MigrateSplitDrivers({
        fplus: { ConfigDB: cdb }, settings, edge_charts,
        log: (fmt, ...args) => lines.push(util.format(fmt, ...args)),
    }).run();
    return { count, lines };
}

const NEW = chart_values("v9.0.0");
const OLD = chart_values("v8.5.0");
const held_line = lines => lines.filter(l => l.startsWith("Not moving"));

describe("moving to a split driver only when the edge clusters can run it", () => {
    const defaults = chart_defaults();

    test("a customised main branch moves nothing and writes nothing", async () => {
        const cdb = site();
        const { count, lines } = await run_logged(cdb, defaults,
            new FakeCharts({ main: OLD, acs: NEW }));
        assert.deepEqual(cdb.writes, []);
        assert.equal(count.moved, 0);
        assert.equal(text(state(cdb)), text(SITE.configs));

        const held = held_line(lines);
        assert.equal(held.length, 1, "one line says why");
        assert.match(held[0], /^Not moving REST connections to split drivers/);
        assert.match(held[0], /main deploys ghcr.io\/amrc-factoryplus tag v8.5.0 but this release is ghcr.io\/amrc-factoryplus tag v9.0.0/);
        assert.match(held[0], /merge branch acs into main in the edge Helm chart repo shared\/helm/);
    });

    test("identical branches move", async () => {
        const cdb = site();
        const { count } = await run_logged(cdb, defaults,
            new FakeCharts({ main: NEW, acs: NEW }));
        assert.equal(count.moved, 2);
        assert.equal(text(state(cdb)), fs.readFileSync(MOVED_FILE, "utf8"));
    });

    test("a customised main that has merged acs moves", async () => {
        /* A merge adds a commit acs lacks; what counts is the images
         * main deploys. Other customisation is kept. */
        const cdb = site();
        const merged = NEW + "# a site's own change\nverbosity: ALL\n";
        const { count } = await run_logged(cdb, defaults,
            new FakeCharts({ main: merged, acs: NEW }));
        assert.equal(count.moved, 2);
    });

    test("the next run after the site merges does the move by itself", async () => {
        const cdb = site();
        const charts = new FakeCharts({ main: OLD, acs: NEW });
        await run_logged(cdb, defaults, charts);
        assert.deepEqual(cdb.writes, []);

        charts.branches.main = NEW;
        const { count } = await run_logged(cdb, defaults, charts);
        assert.equal(count.moved, 2);
        assert.equal(text(state(cdb)), fs.readFileSync(MOVED_FILE, "utf8"));
    });

    test("a registry that differs holds the move back", async () => {
        const cdb = site();
        await run_logged(cdb, defaults, new FakeCharts({
            main: chart_values("v9.0.0", "registry.example.org/mirror"), acs: NEW,
        }));
        assert.deepEqual(cdb.writes, []);
    });

    for (const [why, branches] of [
        ["the repo can't be read", { main: new Error("connection refused"), acs: NEW }],
        ["main is missing", { acs: NEW }],
        ["acs is missing", { main: NEW }],
        ["main has no image tag", { main: "image: {}\n", acs: NEW }],
    ]) {
        test(`nothing moves when ${why}`, async () => {
            const cdb = site();
            const { count, lines } = await run_logged(cdb, defaults, new FakeCharts(branches));
            assert.deepEqual(cdb.writes, []);
            assert.equal(count.moved, 0);
            assert.equal(held_line(lines).length, 1);
        });
    }

    test("nothing moves without a chart check", async () => {
        const cdb = site();
        const { lines } = await run_logged(cdb, defaults, undefined);
        assert.deepEqual(cdb.writes, []);
        assert.match(held_line(lines)[0], /no edge chart check was given/);
    });

    test("every protocol is held back together", async () => {
        const cdb = site();
        const { lines } = await run_logged(cdb, { REST: true, MQTT: true },
            new FakeCharts({ main: OLD, acs: NEW }));
        assert.deepEqual(cdb.writes, []);
        assert.match(held_line(lines)[0], /^Not moving REST, MQTT connections/);
    });

    test("moving back still runs while main is customised", async () => {
        const cdb = site();
        await run(cdb, defaults);
        const { count, lines } = await run_logged(cdb, { ...defaults, REST: false },
            new FakeCharts({ main: OLD, acs: NEW }));
        assert.equal(count.moved, 2);
        assert.equal(held_line(lines).length, 0, "a move back needs no check");
        assert.equal(text(state(cdb)), text(SITE.configs));
    });

    test("driver ids are still repaired while main is customised", async () => {
        const cdb = site();
        /* A split driver from before driver ids, with a dotted name. */
        const ea = cdb.get(App.EdgeAgentConfig, AGENT);
        ea.deviceConnections.find(c => c.uuid == C.plc).name = "plc.example";
        cdb.set(App.EdgeAgentConfig, AGENT, ea);
        const dep = cdb.get(Edge.App.Deployment, AGENT);
        dep.values.drivers = { "plc.example": dep.values.drivers["PLC-1"] };
        cdb.set(Edge.App.Deployment, AGENT, dep);

        const { count } = await run_logged(cdb, defaults, new FakeCharts({ main: OLD, acs: NEW }));
        assert.equal(count.ids, 1);
        assert.equal(count.moved, 0);
        assert.match(entry(cdb, AGENT, C.plc).driverId, /^plc-example-/);
    });

    for (const [where, image] of [
        ["the default tag", { default: { tag: "v8.5.0" } }],
        ["the default registry", { default: { registry: "registry.example.org" } }],
        ["the Edge Agent's tag", { edgeAgent: { tag: "v8.5.0" } }],
    ]) {
        test(`a Deployment that pins ${where} holds back its agent's connections`, async () => {
            const cdb = site();
            const dep = cdb.get(Edge.App.Deployment, AGENT);
            dep.values.image = image;
            cdb.set(Edge.App.Deployment, AGENT, dep);

            const { count, lines } = await run_logged(cdb, defaults, ready_charts());
            assert.equal(count.moved, 0);
            assert.equal(count.held, 2);
            assert.deepEqual(cdb.writes, []);
            const held = lines.filter(l => /not moving to the split driver/.test(l));
            assert.equal(held.length, 2);
            assert.match(held[0], /Deployment sets image\./);

            /* Removing the pin lets the next run move them. */
            delete dep.values.image;
            cdb.set(Edge.App.Deployment, AGENT, dep);
            const again = await run_logged(cdb, defaults, ready_charts());
            assert.equal(again.count.moved, 2);
        });
    }

    test("a pinned Deployment still moves back", async () => {
        const cdb = site();
        await run(cdb, defaults);
        const dep = cdb.get(Edge.App.Deployment, AGENT);
        dep.values.image = { default: { tag: "v8.5.0" } };
        cdb.set(Edge.App.Deployment, AGENT, dep);

        const { count } = await run_logged(cdb, { ...defaults, REST: false }, ready_charts());
        assert.equal(count.moved, 2);
    });
});

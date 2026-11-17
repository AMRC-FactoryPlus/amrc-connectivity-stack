/*
 * ACS service setup
 * A whole site's UDP connections moved by the chart's defaults, and back
 * Copyright 2026 University of Sheffield AMRC
 *
 * udp-move/site.json is a site before an upgrade: three Edge Agents
 * on three hosts of one cluster, each with one built-in UDP connection
 * on port 50205 (the only port the built-in form allowed), and a fourth
 * agent with no UDP connection. The Deployments have the `drivers` map
 * the Manager writes on every save. The first agent also has a Modbus split
 * driver, and the second connection's name has a dot. The UDP
 * connections are the golden-output samples udp-json, udp-buffer and
 * udp-delimited from acs-edge/tests/fixtures/drivers, one for each
 * payload format the built-in connection reads, so acs-edge/tests/golden
 * can run what this move leaves through the built Edge Agent and
 * edge-udp. udp-move/moved.json is the site after the move, and that
 * harness reads it.
 *
 * After a deliberate change to the move, rewrite moved.json with
 *   UPDATE_UDP_MOVE=1 npm test
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
import { ready_charts } from "./fake-charts.js";

const { App } = UUIDs;
const { Driver } = ACS;

const read_json = name => JSON.parse(fs.readFileSync(
    new URL(`./udp-move/${name}`, import.meta.url), "utf8"));
const MOVED_FILE = new URL("./udp-move/moved.json", import.meta.url);

/* The apps the move touches, in the order the snapshots list them. */
const APPS = [App.ConnectionConfiguration, App.EdgeAgentConfig, Edge.App.Deployment];

const SITE = read_json("site.json");
const A = {
    arm:    "aaaaaaaa-0000-4000-8000-00000000000a",
    cell:   "aaaaaaaa-0000-4000-8000-00000000000b",
    gauge:  "aaaaaaaa-0000-4000-8000-00000000000d",
    line:   "aaaaaaaa-0000-4000-8000-00000000000c",
};
const C = {
    json:   "cccccccc-0000-4000-8000-000000000001",
    buffer: "cccccccc-0000-4000-8000-000000000002",
    delim:  "cccccccc-0000-4000-8000-000000000003",
    plc:    "cccccccc-0000-4000-8000-000000000004",
    broker: "cccccccc-0000-4000-8000-000000000005",
};
/* Each UDP connection and its agent. */
const UDP = [[C.json, A.arm], [C.buffer, A.cell], [C.delim, A.gauge]];

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
const DEFS = driverdefs();

/* The site, with `change` applied to its configs first. */
function site (change) {
    const configs = structuredClone(SITE.configs);
    change?.(configs);
    const cdb = new FakeCDB();
    for (const [uuid, def] of Object.entries(DEFS))
        cdb.set(App.DriverDefinition, uuid, def);
    for (const app of APPS)
        for (const [obj, conf] of Object.entries(configs[app]))
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

/* A run that keeps what it logs. */
async function run (cdb, settings) {
    const lines = [];
    const count = await new MigrateSplitDrivers({
        fplus: { ConfigDB: cdb }, settings, edge_charts: ready_charts(),
        log: (fmt, ...args) => lines.push(util.format(fmt, ...args)),
    }).run();
    return { count, lines };
}

const entry = (cdb, agent, conn) => cdb.get(App.EdgeAgentConfig, agent)
    .deviceConnections.find(c => c.uuid == conn);
const site_entry = (agent, conn) => SITE.configs[App.EdgeAgentConfig][agent]
    .deviceConnections.find(c => c.uuid == conn);
const drivers = (cdb, agent) => cdb.get(Edge.App.Deployment, agent).values.drivers;

/* Does a connection's details fit a DriverDef's schema? Only what
 * these schemas use: required fields, number type, range and enum. */
function fits (details, schema) {
    for (const f of schema.required ?? [])
        if (details[f] === undefined) return `${f} missing`;
    for (const [f, v] of Object.entries(details)) {
        const p = schema.properties[f];
        if (!p) return `${f} not in the schema`;
        if (p.type == "number" && typeof v != "number") return `${f} not a number`;
        if (p.minimum !== undefined && v < p.minimum) return `${f} below ${p.minimum}`;
        if (p.maximum !== undefined && v > p.maximum) return `${f} above ${p.maximum}`;
        if (p.enum && !p.enum.includes(v)) return `${f} not one of ${p.enum}`;
    }
}

describe("moving a site's UDP connections with the chart's defaults", () => {
    const defaults = chart_defaults();

    test("the chart moves UDP", () => {
        assert.equal(defaults.UDP, true);
    });

    test("the site's UDP connections are the golden-output samples", () => {
        /* The harness replays each sample's recorded datagrams, which
         * only fits if the devices are the sample's. */
        const formats = [];
        for (const [conn, sample] of Object.entries(SITE.samples)) {
            const agent = UDP.find(([c]) => c == conn)[1];
            const ours = site_entry(agent, conn);
            const theirs = JSON.parse(fs.readFileSync(new URL(
                `../../acs-edge/tests/fixtures/drivers/samples/${sample}/connection.json`,
                import.meta.url), "utf8"));
            const strip = devs => devs.map(({ deviceId, ...d }) => d);
            assert.deepEqual(strip(ours.devices), strip(theirs.devices), sample);
            assert.equal(ours.payloadFormat, theirs.payloadFormat, sample);
            assert.equal(ours.delimiter, theirs.delimiter, sample);
            assert.deepEqual(ours.UDPConnDetails, theirs.UDPConnDetails, sample);
            formats.push(ours.payloadFormat);
        }
        /* Every format the built-in connection reads. */
        assert.deepEqual(formats.sort(), ["Buffer", "Delimited String", "JSON"]);
    });

    test("the split driver's form takes every built-in UDP connection's details", () => {
        const internal = DEFS[Driver.UDP].schema;
        const split = DEFS[Driver.UDPSplit].schema;
        /* The field names are the same, so the details move as they are. */
        assert.deepEqual(Object.keys(split.properties), Object.keys(internal.properties));
        /* Every port the built-in form allowed. */
        for (const port of internal.properties.port.enum)
            assert.equal(fits({ port }, split), undefined, `port ${port}`);
        for (const [conn] of UDP) {
            const config = SITE.configs[App.ConnectionConfiguration][conn].config;
            assert.equal(fits(config, internal), undefined);
            assert.equal(fits(config, split), undefined);
        }
        /* The split driver opens the port on the host. */
        assert.deepEqual(DEFS[Driver.UDPSplit].hostPorts, [{ protocol: "UDP", field: "port" }]);
    });

    test("moves every built-in UDP connection and nothing else", async () => {
        const cdb = site();
        const { count } = await run(cdb, defaults);
        assert.equal(count.moved, 3);
        assert.equal(count.held, 0);
        assert.equal(count.failed, 0);

        /* ConnectionConfigurations: the driver changes, and nothing
         * else, because UDP datagrams pass through unchanged. */
        for (const [conn] of UDP) {
            const before = SITE.configs[App.ConnectionConfiguration][conn];
            const after = cdb.get(App.ConnectionConfiguration, conn);
            assert.equal(before.driver, Driver.UDP);
            assert.equal(after.driver, Driver.UDPSplit);
            assert.deepEqual({ ...after, driver: before.driver, splitMigration: undefined },
                { ...before, splitMigration: undefined });
        }

        /* The Edge Agent config: Driver with the same details, payload
         * formats and delimiters. */
        for (const [conn, agent] of UDP) {
            const before = site_entry(agent, conn);
            const e = entry(cdb, agent, conn);
            assert.equal(e.connType, "Driver");
            assert.equal(e.UDPConnDetails, undefined);
            assert.deepEqual(e.DriverDetails, before.UDPConnDetails);
            assert.deepEqual(e.devices, before.devices);
            assert.equal(e.payloadFormat, before.payloadFormat);
            assert.equal(e.delimiter, before.delimiter);
            /* Every metric has the empty address, which is where
             * edge-udp sends every datagram. */
            for (const d of e.devices)
                for (const t of d.tags) assert.equal(t.address, "");
        }

        /* A dotted name can't be a driver id; the others can. */
        const cell = entry(cdb, A.cell, C.buffer);
        assert.match(cell.driverId, /^cell2-robot-[0-9a-f]{8}$/);
        assert.equal(entry(cdb, A.arm, C.json).driverId, undefined);
        assert.equal(entry(cdb, A.gauge, C.delim).driverId, undefined);

        /* Each Deployment gets an edge-udp sidecar that opens the port
         * on its host, keyed by the driver id, beside any other
         * driver. */
        const sidecar = {
            image:      { repository: "edge-udp" },
            hostPorts:  [{ protocol: "UDP", port: 50205 }],
        };
        assert.deepEqual(drivers(cdb, A.arm), {
            "PLC-1":    { image: { repository: "edge-modbus" } },
            "RobotArm": sidecar,
        });
        assert.deepEqual(drivers(cdb, A.cell), { [cell.driverId]: sidecar });
        assert.deepEqual(drivers(cdb, A.gauge), { "Gauges": sidecar });

        /* The Modbus driver and the agent with no UDP are untouched. */
        assert.deepEqual(entry(cdb, A.arm, C.plc), site_entry(A.arm, C.plc));
        assert.ok(!cdb.writes.some(w => [A.line, C.plc, C.broker].includes(w.obj)),
            "nothing about the line agent, its MQTT connection or the Modbus driver is written");

        if (process.env.UPDATE_UDP_MOVE)
            fs.writeFileSync(MOVED_FILE, text(state(cdb)));
        assert.equal(text(state(cdb)), fs.readFileSync(MOVED_FILE, "utf8"),
            "the site after the move is udp-move/moved.json");
    });

    test("a second run writes nothing", async () => {
        const cdb = site();
        await run(cdb, defaults);
        cdb.writes = [];
        const { count } = await run(cdb, defaults);
        assert.deepEqual(cdb.writes, []);
        assert.equal(count.moved, 0);
    });

    test("moving back leaves every config as it was, byte for byte", async () => {
        const cdb = site();
        await run(cdb, defaults);
        /* A site sets UDP to false in its own values; Helm merges that
         * over the chart's. The sidecars, and so the host ports, go. */
        const back = { ...defaults, UDP: false };
        const { count } = await run(cdb, back);
        assert.equal(count.moved, 3);
        assert.equal(text(state(cdb)), text(SITE.configs));

        cdb.writes = [];
        await run(cdb, back);
        assert.deepEqual(cdb.writes, [], "a second run back writes nothing");
    });

    test("a Deployment with no drivers map gets an empty one back", async () => {
        /* One the Manager has not saved since it learned about split
         * drivers. The chart renders the two the same. */
        const cdb = site(configs => {
            delete configs[Edge.App.Deployment][A.gauge].values.drivers;
        });
        await run(cdb, defaults);
        await run(cdb, { ...defaults, UDP: false });
        const expected = structuredClone(SITE.configs);
        expected[Edge.App.Deployment][A.gauge].values.drivers = {};
        assert.equal(text(state(cdb)), text(expected));
    });

    test("moving again after moving back gives the same configs", async () => {
        const cdb = site();
        await run(cdb, defaults);
        await run(cdb, { ...defaults, UDP: false });
        await run(cdb, defaults);
        assert.equal(text(state(cdb)), fs.readFileSync(MOVED_FILE, "utf8"));
    });
});

/* Change where a connection and its agent run. */
const place = (conn, agent, topology) => configs => {
    configs[App.ConnectionConfiguration][conn].topology = topology;
    const dep = configs[Edge.App.Deployment][agent];
    dep.cluster = topology.cluster;
    if (topology.hostname) dep.hostname = topology.hostname;
    else delete dep.hostname;
};
const CLUSTER = "bbbbbbbb-0000-4000-8000-000000000001";
const held_lines = lines => lines.filter(l => /not moving to the split driver/.test(l));

describe("moving UDP connections whose ports would clash on a host", () => {
    const defaults = chart_defaults();

    test("two agents on one host: the first moves and the second stays built-in", async () => {
        const cdb = site(place(C.buffer, A.cell, { cluster: CLUSTER, hostname: "edge-1" }));
        const { count, lines } = await run(cdb, defaults);
        assert.equal(count.moved, 2);
        assert.equal(count.held, 1);

        /* Nothing about the held connection is written, so it keeps
         * running on the built-in driver. */
        assert.ok(!cdb.writes.some(w => w.obj == C.buffer || w.obj == A.cell));
        assert.equal(entry(cdb, A.cell, C.buffer).connType, "UDP");
        assert.equal(cdb.get(App.ConnectionConfiguration, C.buffer).driver, Driver.UDP);

        const held = held_lines(lines);
        assert.equal(held.length, 1);
        assert.equal(held[0], `Connection ${C.buffer}: not moving to the split driver, `
            + `because connection ${C.json}, which can run on the same host, already `
            + "opens UDP port 50205 there. Give one of them another port; the next "
            + "service-setup run then moves it.");

        /* The next run holds it again and writes nothing. */
        cdb.writes = [];
        const again = await run(cdb, defaults);
        assert.equal(again.count.held, 1);
        assert.deepEqual(cdb.writes, []);
    });

    test("the held connection moves once the other has another port", async () => {
        const cdb = site(place(C.buffer, A.cell, { cluster: CLUSTER, hostname: "edge-1" }));
        await run(cdb, defaults);

        /* Someone gives the moved connection another port in the
         * Manager. */
        const cc = cdb.get(App.ConnectionConfiguration, C.json);
        cc.config.port = 50300;
        cdb.set(App.ConnectionConfiguration, C.json, cc);

        const { count } = await run(cdb, defaults);
        assert.equal(count.moved, 1);
        assert.equal(count.held, 0);
        assert.deepEqual(drivers(cdb, A.cell)[entry(cdb, A.cell, C.buffer).driverId].hostPorts,
            [{ protocol: "UDP", port: 50205 }]);
    });

    test("an agent not pinned to a host clashes with every host in its cluster", async () => {
        const cdb = site(place(C.delim, A.gauge, { cluster: CLUSTER }));
        const { count, lines } = await run(cdb, defaults);
        assert.equal(count.moved, 2);
        assert.equal(count.held, 1);
        assert.match(held_lines(lines)[0], new RegExp(`^Connection ${C.delim}: `));
    });

    test("agents on one host name in different clusters don't clash", async () => {
        const cdb = site(place(C.buffer, A.cell, {
            cluster: "bbbbbbbb-0000-4000-8000-000000000002", hostname: "edge-1",
        }));
        const { count } = await run(cdb, defaults);
        assert.equal(count.moved, 3);
        assert.equal(count.held, 0);
    });

    test("a dry run holds back the same connections", async () => {
        const cdb = site(place(C.buffer, A.cell, { cluster: CLUSTER, hostname: "edge-1" }));
        const { count } = await run(cdb, { ...defaults, dryRun: true });
        assert.deepEqual(cdb.writes, []);
        assert.equal(count.moved, 2);
        assert.equal(count.held, 1);
    });

    test("moving back is never held", async () => {
        /* Two moved connections already clash, say from hand edits;
         * moving back must still take both back. */
        const cdb = site(place(C.buffer, A.cell, { cluster: CLUSTER, hostname: "edge-1" }));
        await run(cdb, defaults);
        const cc = cdb.get(App.ConnectionConfiguration, C.buffer);
        cdb.set(App.ConnectionConfiguration, C.buffer,
            { ...cc, driver: Driver.UDPSplit, splitMigration: { from: Driver.UDP, payloadFormat: "Buffer" } });

        const { count } = await run(cdb, { ...defaults, UDP: false });
        assert.equal(count.moved, 3);
        assert.equal(count.held, 0);
        for (const [conn] of UDP)
            assert.equal(cdb.get(App.ConnectionConfiguration, conn).driver, Driver.UDP);
    });
});

/*
 * ACS service setup
 * A whole site's UDP connections moved by the chart's defaults
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

import { UUIDs, driver_id } from "@amrc-factoryplus/service-client";

import { DumpLoader } from "../lib/dumps.js";
import { MigrateSplitDrivers } from "../lib/split-drivers.js";
import { ACS, Edge } from "../lib/uuids.js";

import { FakeCDB } from "./fake-cdb.js";

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
        fplus: { ConfigDB: cdb }, settings,
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

    test("the chart holds no protocol back", () => {
        for (const p of ["REST", "MQTT", "OPCUA", "UDP"])
            assert.ok(!(p in defaults), `splitDrivers.${p} is set`);
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
        const split = DEFS[Driver.UDPSplit].schema;
        /* The built-in form had one field, port, and allowed only
         * 50205. The field name is the same, so the details move as
         * they are. */
        assert.deepEqual(Object.keys(split.properties), ["port"]);
        assert.equal(fits({ port: 50205 }, split), undefined, "port 50205");
        for (const [conn] of UDP) {
            const config = SITE.configs[App.ConnectionConfiguration][conn].config;
            assert.equal(fits(config, split), undefined);
        }
        /* The split driver opens the port on the host. */
        assert.deepEqual(DEFS[Driver.UDPSplit].hostPorts, [{ protocol: "UDP", field: "port" }]);
    });

    test("moves every built-in UDP connection", async () => {
        const cdb = site();
        const { count } = await run(cdb, defaults);
        /* The three UDP connections and the line agent's MQTT one. */
        assert.equal(count.moved, 4);
        assert.equal(count.held, 0);
        assert.equal(count.no_sidecar, 0);
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

        /* The Modbus driver is untouched. The line agent's MQTT
         * connection moves too, as every built-in connection does. */
        assert.deepEqual(entry(cdb, A.arm, C.plc), site_entry(A.arm, C.plc));
        assert.ok(!cdb.writes.some(w => w.obj == C.plc), "the Modbus driver is not written");
        assert.equal(cdb.get(App.ConnectionConfiguration, C.broker).driver, Driver.MQTTSplit);

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
});

/* Change where a connection's Edge Agent runs. The move reads it from
 * the agent's Deployment, as the Manager does; the connection's own
 * `topology` copy is changed to match. */
const place = (conn, agent, topology) => configs => {
    configs[App.ConnectionConfiguration][conn].topology = topology;
    const dep = configs[Edge.App.Deployment][agent];
    dep.cluster = topology.cluster;
    if (topology.hostname) dep.hostname = topology.hostname;
    else delete dep.hostname;
};
const CLUSTER = "bbbbbbbb-0000-4000-8000-000000000001";
const clash_lines = lines => lines.filter(l => /moved to the split driver without its container/.test(l));

/* The built-in UDP connection only allowed port 50205, so two on one
 * host both want it. Both move, because neither has anything else to
 * run on. The one that gets the port first keeps it; the other moves
 * without its sidecar, so its Edge Agent's pod can still start. */
describe("moving UDP connections whose ports would clash on a host", () => {
    const defaults = chart_defaults();
    const sidecar = (cdb, agent, conn) => drivers(cdb, agent)?.[driver_id(entry(cdb, agent, conn))];

    test("two agents on one host: both move, the second without its sidecar", async () => {
        const cdb = site(place(C.buffer, A.cell, { cluster: CLUSTER, hostname: "edge-1" }));
        const { count, lines } = await run(cdb, defaults);
        assert.equal(count.moved, 3);
        assert.equal(count.no_sidecar, 1);

        /* The connection is moved, so nothing is left on a built-in
         * driver, but its Deployment has no sidecar for it. */
        assert.equal(entry(cdb, A.cell, C.buffer).connType, "Driver");
        assert.equal(cdb.get(App.ConnectionConfiguration, C.buffer).driver, Driver.UDPSplit);
        assert.equal(sidecar(cdb, A.cell, C.buffer), undefined);
        /* The first keeps the port. */
        assert.deepEqual(sidecar(cdb, A.arm, C.json).hostPorts, [{ protocol: "UDP", port: 50205 }]);

        const clash = clash_lines(lines);
        assert.equal(clash.length, 1);
        assert.equal(clash[0], `ERROR: Connection ${C.buffer}: moved to the split driver `
            + `without its container, because connection ${C.json}, which can run on `
            + "the same host, already opens UDP port 50205 there. Its devices get no "
            + "data until it has another port: change the port in the Manager and "
            + "save the connection.");

        /* The next run says so again, writes nothing, and doesn't take
         * the port from the first. */
        cdb.writes = [];
        const again = await run(cdb, defaults);
        assert.equal(again.count.no_sidecar, 1);
        assert.equal(clash_lines(again.lines).length, 1);
        assert.deepEqual(cdb.writes, []);
        assert.ok(sidecar(cdb, A.arm, C.json));
    });

    test("the second gets its sidecar once it has another port", async () => {
        const cdb = site(place(C.buffer, A.cell, { cluster: CLUSTER, hostname: "edge-1" }));
        await run(cdb, defaults);

        /* Someone gives the second connection another port in the
         * Manager. Saving it there adds the sidecar; a service-setup
         * run before that does the same. */
        const cc = cdb.get(App.ConnectionConfiguration, C.buffer);
        cc.config.port = 50300;
        cdb.set(App.ConnectionConfiguration, C.buffer, cc);

        const { count } = await run(cdb, defaults);
        assert.equal(count.no_sidecar, 0);
        assert.equal(count.repaired, 1);
        assert.deepEqual(sidecar(cdb, A.cell, C.buffer).hostPorts,
            [{ protocol: "UDP", port: 50300 }]);
        assert.deepEqual(sidecar(cdb, A.arm, C.json).hostPorts,
            [{ protocol: "UDP", port: 50205 }]);
    });

    test("two on one agent: the agent keeps the first sidecar only", async () => {
        /* A second built-in UDP connection on the arm's agent. */
        const C2 = "cccccccc-0000-4000-8000-0000000000aa";
        const cdb = site(configs => {
            const cc = structuredClone(configs[App.ConnectionConfiguration][C.json]);
            configs[App.ConnectionConfiguration][C2] = cc;
            const agent = configs[App.EdgeAgentConfig][A.arm];
            const e = structuredClone(agent.deviceConnections.find(e => e.uuid == C.json));
            agent.deviceConnections.push({ ...e, uuid: C2, name: "RobotArm2",
                devices: e.devices.map(d => ({ ...d, deviceId: `${d.deviceId}_2` })) });
        });
        const { count } = await run(cdb, defaults);
        assert.equal(count.no_sidecar, 1);
        assert.deepEqual(Object.keys(drivers(cdb, A.arm)).sort(), ["PLC-1", "RobotArm"]);
        assert.equal(entry(cdb, A.arm, C2).connType, "Driver");
    });

    test("an agent not pinned to a host clashes with every host in its cluster", async () => {
        const cdb = site(place(C.delim, A.gauge, { cluster: CLUSTER }));
        const { count, lines } = await run(cdb, defaults);
        assert.equal(count.moved, 3);
        assert.equal(count.no_sidecar, 1);
        assert.match(clash_lines(lines)[0], new RegExp(`^ERROR: Connection ${C.delim}: `));
    });

    test("an empty topology copy on the connection doesn't matter", async () => {
        /* The Manager wrote every connection's copy empty until ACS-44,
         * so where each agent runs comes from its Deployment. */
        const cdb = site(configs => {
            for (const [conn] of UDP)
                configs[App.ConnectionConfiguration][conn].topology = {};
        });
        const { count } = await run(cdb, defaults);
        assert.equal(count.moved, 4);
        assert.equal(count.no_sidecar, 0);
    });

    test("a Deployment on \"Floating\" is not pinned to a host", async () => {
        const cdb = site(place(C.delim, A.gauge, { cluster: CLUSTER, hostname: "Floating" }));
        const { count } = await run(cdb, defaults);
        assert.equal(count.no_sidecar, 1);
    });

    test("agents on one host name in different clusters don't clash", async () => {
        const cdb = site(place(C.buffer, A.cell, {
            cluster: "bbbbbbbb-0000-4000-8000-000000000002", hostname: "edge-1",
        }));
        const { count } = await run(cdb, defaults);
        assert.equal(count.moved, 4);
        assert.equal(count.no_sidecar, 0);
    });

    test("a dry run finds the same clash", async () => {
        const cdb = site(place(C.buffer, A.cell, { cluster: CLUSTER, hostname: "edge-1" }));
        const { count } = await run(cdb, { ...defaults, dryRun: true });
        assert.deepEqual(cdb.writes, []);
        assert.equal(count.moved, 3);
        assert.equal(count.no_sidecar, 1);
    });
});

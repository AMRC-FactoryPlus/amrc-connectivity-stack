/*
 * ACS Edge Agent
 * Golden-output harness: split drivers against the recorded runs of the
 * built-in connections they replaced
 * Copyright 2026 University of Sheffield
 */

import dgram from "dgram";
import fs from "fs";
import path from "path";

import type { Fixture } from "../fixtures/drivers/fixture.js";
import { Kinds } from "./devices/index.js";
import { UdpDevice } from "./devices/udp.js";
import { DriverSpec, env_driver, reference_ready, rest_reference } from "./driver.js";
import { compare_runs, GoldenResult, run_agent, RunOpts, RunResult } from "./harness.js";
import { inproc_rest } from "./inproc-rest.js";
import { PayloadFormatMap } from "./migrate.js";
import {
    ALL, DATETIME_KEY, DATETIMES, datetime_fixture, dotted_key,
    DOTTED_NAME, MoveCase, move_key, MQTT_MOVE, of_protocol, OPCUA_MOVE,
    opcua_writes, read_sample, recorded, references, REST_MOVE, sample_key,
    several_key, UDP_MOVE,
} from "./references.js";
import { read_snapshot, snapshot_path } from "./snapshot.js";
import { tamper } from "./tamper.js";

jest.setTimeout(180_000);

/* GOLDEN_DRIVER runs a real driver against GOLDEN_PROTOCOL fixtures.
 * Without it the reference REST driver runs against REST fixtures. */
const DRIVER = env_driver();
const DRIVER_PROTOCOL = DRIVER ? process.env.GOLDEN_PROTOCOL ?? "REST" : "REST";

/* The driver under test, which needs lib/js-edge-driver's dependencies
 * when it is the reference REST driver. */
function driver (): DriverSpec {
    if (DRIVER) return DRIVER;
    if (!reference_ready())
        throw new Error("The reference REST driver needs lib/js-edge-driver's "
            + "dependencies: run `npm ci` in lib/js-edge-driver");
    return rest_reference();
}
const DRIVER_NAME = DRIVER?.name ?? "the reference REST driver";

/* Run `fixture` and compare it with the recorded built-in run `key`, at
 * the speed that run was recorded at. */
async function against (key: string, fixture: Fixture, opts: RunOpts) {
    const ref = recorded(key, fixture);
    const run = await run_agent(fixture, { ...opts, speed: ref.speed });
    return compare_runs(ref.run, run);
}

/* What the fake MQTT broker records for a connection's details: see
 * session() in devices/mqtt.ts. */
function mqtt_session (d: any, secrets: { [k: string]: string }) {
    const id = d.clientId ? d.clientId : "NO-ID-*";
    const creds = d.username
        ? `username ${d.username} password ${secrets[d.password] ?? d.password}`
        : "no credentials";
    const tls = ["mqtts", "tls", "wss"].includes(d.protocol);
    return `MQTT client ${id}, ${creds}, keepalive ${d.keepAlive}, `
        + `clean ${d.cleanSession}, ${tls ? "TLS" : "plain"}`;
}

function show (name: string, r: GoldenResult) {
    process.stdout.write(`\n[${name}] ${r.summary}\n`);
}

/* Empty when the runs match; otherwise the diff and both runs' logs. */
function explain (r: GoldenResult) {
    return r.comparison.ok ? "" : r.summary
        + `\n\n--- ${r.a.label} output ---\n${r.a.log.slice(-4000)}`
        + `\n\n--- ${r.b.label} output ---\n${r.b.log.slice(-4000)}`;
}

/* describe.each, but defining nothing for an empty table, which jest
 * refuses. */
function each<T extends any[]> (table: T[]) {
    return table.length ? describe.each(table)
        : (_name: string, _fn: (...args: T) => void) => {};
}

/* Each protocol's move cases, when that protocol's driver is under
 * test. */
const moves = (p: string, cases: MoveCase[]): [string, MoveCase][] =>
    DRIVER_PROTOCOL == p ? cases.map(c => [c.name, c]) : [];

describe("Golden-output harness", () => {
    it("has a fake device for every fixture protocol", () => {
        const missing = ALL.filter(([, f]) => !Kinds[f.meta.protocol])
            .map(([d, f]) => `${d} (${f.meta.protocol})`);
        expect(missing).toEqual([]);
    });

    it("has a recorded built-in run for every comparison", () => {
        const missing = references().map(r => r.key)
            .filter(k => !read_snapshot(k))
            .map(k => snapshot_path(k));
        expect(missing).toEqual([]);
    });

    it("moves connections with service-setup's payload format maps", () => {
        /* migrate.ts keeps a copy of these; check it against the
         * source it was copied from. */
        const src = fs.readFileSync(path.join(__dirname,
            "../../../acs-service-setup/lib/split-drivers.js"), "utf8");
        const maps = [...src.matchAll(/payloadFormat:\s*(\{[^}]*\})/g)]
            .map(m => JSON.parse(m[1].replace(/,\s*\}/, "}")));
        expect(maps).toEqual([
            PayloadFormatMap["REST"],
            PayloadFormatMap["MQTT"],
            PayloadFormatMap["OPC UA"],
            PayloadFormatMap["UDP"],
        ]);
    });

    it("the UDP sender delivers each datagram in order once the port is bound", async () => {
        const events = ["a", "b", "c"].map((p, i) => ({ t: i * 100, type: "udp", payload: p }));
        const fixture: any = { meta: { interval_ms: 100, duration_ms: 300 }, events };
        const dev = new UdpDevice(fixture, { speed: 10 });
        await dev.start();
        const conn = dev.connection({ UDPConnDetails: { port: 1 } });
        const got: string[] = [];
        const sock = dgram.createSocket("udp4");
        sock.on("message", m => got.push(m.toString()));
        await new Promise<void>(r => sock.bind(conn.UDPConnDetails.port, "127.0.0.1", () => r()));
        await dev.finished();
        await dev.stop();
        await new Promise<void>(r => sock.close(() => r()));
        expect(got).toEqual(["a", "b", "c"]);
        expect(dev.delivered).toBe(3);
    });

    /* The driver twice on one sample: the runs must match, which shows
     * the harness and the driver are deterministic. */
    each(of_protocol(DRIVER_PROTOCOL).slice(0, 1))("self-check %s", (name, fixture) => {
        it(`${DRIVER_NAME} matches itself`, async () => {
            const a = await run_agent(fixture, { driver: driver() });
            const b = await run_agent(fixture, { driver: driver() });
            const r = compare_runs(a, b);
            show(`${name} self-check`, r);
            expect(r.comparison.values).toBeGreaterThan(0);
            expect(explain(r)).toBe("");
        });
    });

    /* One recorded value changed: the comparison with the recorded run
     * must fail and name the metric. */
    each(of_protocol(DRIVER_PROTOCOL).slice(0, 1))("negative check %s", (name, fixture) => {
        it("a changed value fails with a diff naming the metric", async () => {
            const changed = tamper(fixture);
            const ref = recorded(sample_key(name), fixture);
            const run = await run_agent(changed.fixture, { driver: driver(), speed: ref.speed });
            const r = compare_runs(ref.run, run);
            show(`${name} negative check`, r);
            expect(r.comparison.ok).toBe(false);
            const text = r.comparison.diffs.join("\n");
            expect(text).toContain(`DDATA ${changed.device}/${changed.metric} `);
            expect(text).toContain("<-- value");
        });
    });

    each(of_protocol(DRIVER_PROTOCOL))("split driver %s", (name, fixture) => {
        it(`${DRIVER_NAME} matches the recorded built-in ${DRIVER_PROTOCOL}`, async () => {
            const r = await against(sample_key(name), fixture, { driver: driver() });
            show(`${name} split`, r);
            expect(r.comparison.values).toBeGreaterThan(0);
            expect(explain(r)).toBe("");
        });
    });

    /* A connection named after a web address can't use its name as
     * its driver id, because the driver broker drops a dotted id. The
     * move gives it a driverId, and the driver runs under that. */
    describe.each(of_protocol("REST").slice(0, 1))("dotted connection name %s", (name, fixture) => {
        it(`${DRIVER_PROTOCOL == "REST" ? DRIVER_NAME : "the reference REST driver"} matches the recorded built-in REST`, async () => {
            const r = await against(dotted_key(name), fixture, {
                connection_name: DOTTED_NAME,
                driver: DRIVER_PROTOCOL == "REST" ? driver() : rest_reference(),
            });
            show(`${name} dotted name`, r);
            expect(r.comparison.values).toBeGreaterThan(0);
            expect(explain(r)).toBe("");
        });
    });

    /* The connections of the site service-setup's REST move test moves,
     * as the move left them, against the built-in connections as the
     * site had them. */
    each(moves("REST", REST_MOVE.cases))(
        "split driver after service-setup's move %s", (name, c) => {
            it(`${DRIVER_NAME} matches the recorded built-in REST`, async () => {
                const { secrets } = REST_MOVE;
                const r = await against(move_key("rest-move", name), read_sample(c.sample),
                    { entry: c.after, secrets, driver: driver() });
                show(`${name} after the move`, r);
                expect(c.after.connType).toBe("Driver");
                expect(r.comparison.values).toBeGreaterThan(0);
                expect(explain(r)).toBe("");

                /* The driver sends the credentials the built-in did, with
                 * the secret filled in from its placeholder. */
                const details = c.before.RESTConnDetails;
                const expected = details.authMethod == "Basic"
                    ? ["Basic " + Buffer.from(
                        `${details.username}:${secrets[details.password]}`).toString("base64")]
                    : [];
                expect(r.a.credentials).toEqual(expected);
                expect(r.b.credentials).toEqual(expected);
            });
        });

    /* The same for service-setup's MQTT move test. The fake broker serves
     * TLS where the connection uses it, and records the client id,
     * credentials, keep-alive and clean session each run connected
     * with, which must be the connection's details in both runs. */
    each(moves("MQTT", MQTT_MOVE.cases))(
        "split driver after service-setup's move %s", (name, c) => {
            it(`${DRIVER_NAME} matches the recorded built-in MQTT`, async () => {
                const { secrets } = MQTT_MOVE;
                const r = await against(move_key("mqtt-move", name), read_sample(c.sample),
                    { entry: c.after, secrets, driver: driver() });
                show(`${name} after the move`, r);
                expect(c.after.connType).toBe("Driver");
                expect(r.comparison.values).toBeGreaterThan(0);
                expect(explain(r)).toBe("");

                const expected = [mqtt_session(c.before.MQTTConnDetails, secrets)];
                expect(r.a.credentials).toEqual(expected);
                expect(r.b.credentials).toEqual(expected);
            });
        });

    /* The same for service-setup's UDP move test: three UDP connections,
     * one in each payload format, on three agents. Each runs with its
     * port opened on the host in the real cluster; here the sender
     * sends to the driver's port on localhost. */
    each(moves("UDP", UDP_MOVE.cases))(
        "split driver after service-setup's move %s", (name, c) => {
            it(`${DRIVER_NAME} matches the recorded built-in UDP`, async () => {
                const r = await against(move_key("udp-move", name), read_sample(c.sample),
                    { entry: c.after, driver: driver() });
                show(`${name} after the move`, r);
                expect(c.before.connType).toBe("UDP");
                expect(c.after.connType).toBe("Driver");
                expect(c.after.DriverDetails).toEqual(c.before.UDPConnDetails);
                expect(r.comparison.values).toBeGreaterThan(0);
                expect(explain(r)).toBe("");
            });
        });

    /* The same for service-setup's OPC UA move test. Both runs kept the
     * connection's security and credentials, and sent the same write,
     * so the fake server saw what each sent. The built-in connection
     * gave several devices' values to the wrong device, so where a
     * connection has several devices the recorded run is the built-in
     * run with one device at a time. */
    each(moves("OPC UA", OPCUA_MOVE.cases))(
        "split driver after service-setup's move %s", (name, c) => {
            const { secrets } = OPCUA_MOVE;
            const details = c.before.OPCUAConnDetails;
            const { writable, commands } = opcua_writes(c.before);

            it(`${DRIVER_NAME} matches the recorded built-in OPC UA`, async () => {
                expect(c.before.connType).toBe("OPC UA");
                expect(c.after.connType).toBe("Driver");
                expect(c.after.DriverDetails).toEqual(details);

                const r = await against(move_key("opcua-move", name), read_sample(c.sample),
                    { entry: c.after, secrets, secure: true, commands, driver: driver() });
                show(`${name} after the move`, r);
                expect(r.comparison.values).toBeGreaterThan(0);
                expect(explain(r)).toBe("");
                const reference: RunResult = r.a, split: RunResult = r.b;

                /* The driver logs in as the built-in did, with the same
                 * security and the secret filled in. */
                const logins = [
                    `channel ${details.securityMode} ${details.securityPolicy}`,
                    ...(details.useCredentials
                        ? [`user ${details.username}:${secrets[details.password]}`] : []),
                ];
                expect(reference.credentials).toEqual(logins);
                expect(split.credentials).toEqual(logins);

                /* The write reached the server, and the agent published
                 * the written value once the driver confirmed it. */
                for (const { device, tag } of writable) {
                    const wrote = `${tag.address}=300.25`;
                    expect(reference.writes).toContain(wrote);
                    expect(split.writes).toEqual(reference.writes);
                    const values = split.output.data.get(`${device}/${tag.Name}`)!
                        .map(m => m.value);
                    expect(values).toContain("300.25");
                }
            });

            if (c.before.devices.length > 1)
                it("the built-in connection gave values to the wrong device", async () => {
                    /* Why the recorded run above is one device at a
                     * time. The release notes warn that such devices
                     * start publishing values after the move. */
                    const r = await against(several_key(name), read_sample(c.sample),
                        { entry: c.after, secrets, driver: driver() });
                    show(`${name} built-in with several devices`, r);
                    expect(r.comparison.ok).toBe(false);
                });
        });

    /* The built-in connection handed the agent node-opcua's Date for a
     * DateTime node, which the agent published as 0. The driver sends
     * milliseconds, which the agent publishes as the date. One real
     * metric is a DateTime, so this pins the difference rather than
     * leaving DateTime out of the comparison unremarked. */
    each(DRIVER_PROTOCOL == "OPC UA" ? [["DateTime"]] : [])("split driver %s", () => {
        it("publishes the date where the built-in published 0", async () => {
            const fixture = datetime_fixture();
            const values = (r: RunResult) => r.output.data
                .get("Device_1/Types/DateTime")?.map(m => m.value);
            const r = await against(DATETIME_KEY, fixture, { driver: driver() });
            show("DateTime", r);
            expect(values(r.a)).toEqual(DATETIMES.map(() => "0"));
            expect(values(r.b)).toEqual(DATETIMES.map(d => String(Date.parse(d))));
        });
    });

    describe.each(of_protocol("REST").slice(0, 1))("in-process driver %s", (name, fixture) => {
        it("an in-process REST driver matches the recorded built-in REST", async () => {
            const r = await against(sample_key(name), fixture, { driver: inproc_rest() });
            show(`${name} in-process`, r);
            expect(explain(r)).toBe("");
        });
    });
});

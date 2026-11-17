/*
 * ACS Edge Agent
 * Golden-output harness: the built-in connections against themselves,
 * and split drivers against the built-in connections they replace
 * Copyright 2026 University of Sheffield
 */

import dgram from "dgram";
import fs from "fs";
import path from "path";

import * as UUIDs from "../../lib/uuids.js";

import { Fixture, read_fixture } from "../fixtures/drivers/fixture.js";
import { Kinds } from "./devices/index.js";
import { UdpDevice } from "./devices/udp.js";
import { env_driver, reference_ready, rest_reference } from "./driver.js";
import { compare_runs, golden, GoldenResult, merge_runs, run_agent } from "./harness.js";
import { inproc_rest } from "./inproc-rest.js";
import { PayloadFormatMap } from "./migrate.js";
import { tamper } from "./tamper.js";

jest.setTimeout(180_000);

const SAMPLES = path.join(__dirname, "../fixtures/drivers/samples");

/* The committed samples, or every fixture in GOLDEN_FIXTURES. */
function fixtures (): [string, Fixture][] {
    const dir = process.env.GOLDEN_FIXTURES || SAMPLES;
    const cap = Number(process.env.GOLDEN_DURATION_MS) || Infinity;
    return fs.readdirSync(dir).sort()
        .filter(d => fs.existsSync(path.join(dir, d, "fixture.json")))
        .map(d => [d, truncate(read_fixture(path.join(dir, d)), cap)]);
}

/* A fixture cut to its first `cap` ms, for long private fixtures. */
function truncate (f: Fixture, cap: number): Fixture {
    if (f.meta.duration_ms <= cap) return f;
    return {
        ...f,
        meta: { ...f.meta, duration_ms: cap },
        events: f.events.filter(e => e.t <= cap),
    };
}

const ALL = fixtures();
const RUNNABLE = ALL.filter(([, f]) => Kinds[f.meta.protocol]);
const of_protocol = (p: string) => RUNNABLE.filter(([, f]) => f.meta.protocol == p);
/* The first fixture of each protocol. */
const ONE_EACH = RUNNABLE.filter(([, f], i) =>
    RUNNABLE.findIndex(([, g]) => g.meta.protocol == f.meta.protocol) == i);

/* GOLDEN_DRIVER runs a real driver against GOLDEN_PROTOCOL fixtures.
 * Without it the reference REST driver runs against REST fixtures. */
const DRIVER = env_driver();
const DRIVER_PROTOCOL = DRIVER ? process.env.GOLDEN_PROTOCOL ?? "REST" : "REST";

/* The site one of service-setup's move tests starts from, and the
 * configs the move leaves. Each case is a connection of the protocol on
 * one of the site's agents: [name, sample, entry before, entry after]. */
const move_cases = (test: string) => {
    const dir = path.join(__dirname, "../../../acs-service-setup/test", test);
    const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const site = read("site.json");
    const moved = read("moved.json");
    const agent_configs = (configs: any) =>
        Object.values(configs[UUIDs.App.AgentConfig]) as any[];
    const find = (configs: any, uuid: string) => agent_configs(configs)
        .flatMap(c => c.deviceConnections)
        .find((e: any) => e.uuid == uuid);
    const cases = Object.entries(site.samples as { [uuid: string]: string })
        .map(([uuid, sample]): [string, string, any, any] => {
            const before = find(site.configs, uuid);
            return [before.name, sample, before, find(moved, uuid)];
        });
    return { cases, secrets: site.secrets as { [k: string]: string } };
};
const REST_MOVE = move_cases("rest-move");
const OPCUA_MOVE = move_cases("opcua-move");

function show (name: string, r: GoldenResult) {
    process.stdout.write(`\n[${name}] ${r.summary}\n`);
}

/* Empty when the runs match; otherwise the diff and both runs' logs. */
function explain (r: GoldenResult) {
    return r.comparison.ok ? "" : r.summary
        + `\n\n--- ${r.a.label} output ---\n${r.a.log.slice(-4000)}`
        + `\n\n--- ${r.b.label} output ---\n${r.b.log.slice(-4000)}`;
}

describe("Golden-output harness", () => {
    it("has a fake device for every fixture protocol", () => {
        const missing = ALL.filter(([, f]) => !Kinds[f.meta.protocol])
            .map(([d, f]) => `${d} (${f.meta.protocol})`);
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

    describe.each(RUNNABLE)("self-check %s", (name, fixture) => {
        it("built-in matches built-in", async () => {
            const r = await golden({ a: fixture });
            show(`${name} self-check`, r);
            expect(r.comparison.values).toBeGreaterThan(0);
            expect(explain(r)).toBe("");
        });
    });

    describe.each(ONE_EACH)("negative check %s", (name, fixture) => {
        it("a changed value fails with a diff naming the metric", async () => {
            const changed = tamper(fixture);
            const r = await golden({ a: fixture, b: changed.fixture });
            show(`${name} negative check`, r);
            expect(r.comparison.ok).toBe(false);
            const text = r.comparison.diffs.join("\n");
            expect(text).toContain(`DDATA ${changed.device}/${changed.metric} `);
            expect(text).toContain("<-- value");
        });
    });

    describe.each(of_protocol(DRIVER_PROTOCOL))("split driver %s", (name, fixture) => {
        const driver = DRIVER ?? rest_reference();
        it(`${driver.name} matches built-in ${DRIVER_PROTOCOL}`, async () => {
            if (!DRIVER && !reference_ready())
                throw new Error("The reference REST driver needs lib/js-edge-driver's "
                    + "dependencies: run `npm ci` in lib/js-edge-driver");
            const r = await golden({ a: fixture }, { b: { driver } });
            show(`${name} split`, r);
            expect(r.comparison.values).toBeGreaterThan(0);
            expect(explain(r)).toBe("");
        });
    });

    /* A connection named after a web address can't use its name as
     * its driver id, because the driver broker drops a dotted id. The
     * move gives it a driverId, and the driver runs under that. */
    describe.each(of_protocol("REST").slice(0, 1))("dotted connection name %s", (name, fixture) => {
        it("the reference REST driver matches built-in REST", async () => {
            if (!reference_ready())
                throw new Error("The reference REST driver needs lib/js-edge-driver's "
                    + "dependencies: run `npm ci` in lib/js-edge-driver");
            const connection_name = "api.example.org";
            const r = await golden({ a: fixture }, {
                a: { connection_name },
                b: { connection_name, driver: rest_reference() },
            });
            show(`${name} dotted name`, r);
            expect(r.comparison.values).toBeGreaterThan(0);
            expect(explain(r)).toBe("");
        });
    });

    /* The site acs-service-setup/test/rest-move.test.js moves with the
     * chart's defaults: the built-in REST connections as the site had
     * them, against the Edge Agent config entries service-setup left.
     * That test checks the move gives exactly moved.json, so this runs
     * what an upgrade writes, not a copy of the move. */
    /* jest refuses an empty table, so only define these for REST. */
    if (DRIVER_PROTOCOL == "REST") describe.each(REST_MOVE.cases)(
        "split driver after service-setup's move %s",
        (name, sample, before, after) => {
            const driver = DRIVER ?? rest_reference();
            it(`${driver.name} matches built-in REST`, async () => {
                if (!DRIVER && !reference_ready())
                    throw new Error("The reference REST driver needs lib/js-edge-driver's "
                        + "dependencies: run `npm ci` in lib/js-edge-driver");
                const cap = Number(process.env.GOLDEN_DURATION_MS) || Infinity;
                const fixture = truncate(read_fixture(path.join(SAMPLES, sample)), cap);
                const { secrets } = REST_MOVE;
                const r = await golden({ a: fixture }, {
                    a: { entry: before, secrets },
                    b: { entry: after, secrets, driver },
                });
                show(`${name} after the move`, r);
                expect(after.connType).toBe("Driver");
                expect(r.comparison.values).toBeGreaterThan(0);
                expect(explain(r)).toBe("");

                /* The driver sends the credentials the built-in did, with
                 * the secret filled in from its placeholder. */
                const details = before.RESTConnDetails;
                const expected = details.authMethod == "Basic"
                    ? ["Basic " + Buffer.from(
                        `${details.username}:${secrets[details.password]}`).toString("base64")]
                    : [];
                expect(r.a.credentials).toEqual(expected);
                expect(r.b.credentials).toEqual(expected);
            });
        });

    /* The same for acs-service-setup/test/opcua-move.test.js. Both
     * runs keep the connection's security and credentials, and send
     * the same write, so the fake server sees what each sent. */
    if (DRIVER_PROTOCOL == "OPC UA") describe.each(OPCUA_MOVE.cases)(
        "split driver after service-setup's move %s",
        (name, sample, before, after) => {
            const cap = Number(process.env.GOLDEN_DURATION_MS) || Infinity;
            const fixture = () => truncate(read_fixture(path.join(SAMPLES, sample)), cap);
            const { secrets } = OPCUA_MOVE;
            const details = before.OPCUAConnDetails;

            /* A metric the move left writable. */
            const writable = before.devices.flatMap((d: any) => d.tags
                .filter((t: any) => /SET/.test(t.method))
                .map((t: any) => ({ device: d.deviceId, tag: t })));
            const commands = writable.map(({ device, tag }: any) => ({
                t: 1500, device, metric: tag.Name, type: "Double", value: 300.25,
            }));

            it(`${DRIVER!.name} matches built-in OPC UA`, async () => {
                expect(before.connType).toBe("OPC UA");
                expect(after.connType).toBe("Driver");
                expect(after.DriverDetails).toEqual(details);

                const split = await run_agent(fixture(), {
                    entry: after, secrets, secure: true, commands, driver: DRIVER!,
                });
                /* The built-in connection gives several devices' values
                 * to the wrong device, so with several devices the
                 * reference is the built-in run with one device at a
                 * time. Runs share the process's environment, so they
                 * go one after another. */
                const runs = [];
                for (const d of before.devices.length == 1 ? [] : before.devices)
                    runs.push(await run_agent(fixture(), {
                        entry: { ...before, devices: [d] }, secrets, secure: true, commands,
                    }));
                const reference = runs.length
                    ? merge_runs(runs, "built-in, one device at a time")
                    : await run_agent(fixture(), { entry: before, secrets, secure: true, commands });
                const r = compare_runs(reference, split);
                show(`${name} after the move`, r);
                expect(r.comparison.values).toBeGreaterThan(0);
                expect(explain(r)).toBe("");

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

            if (before.devices.length > 1)
                it("the built-in connection gives values to the wrong device", async () => {
                    /* Why the reference above runs one device at a time.
                     * The release notes warn that such devices start
                     * publishing values after the move. */
                    const built_in = await run_agent(fixture(), { entry: before, secrets });
                    const split = await run_agent(fixture(), { entry: after, secrets, driver: DRIVER! });
                    const r = compare_runs(built_in, split);
                    show(`${name} built-in with several devices`, r);
                    expect(r.comparison.ok).toBe(false);
                });
        });

    /* The built-in connection hands the agent node-opcua's Date for a
     * DateTime node, which the agent publishes as 0. The driver sends
     * milliseconds, which the agent publishes as the date. One real
     * metric is a DateTime, so this pins the difference rather than
     * leaving DateTime out of the comparison unremarked. */
    if (DRIVER_PROTOCOL == "OPC UA") describe("split driver DateTime", () => {
        it("publishes the date where the built-in published 0", async () => {
            const base = read_fixture(path.join(SAMPLES, "opcua-types"));
            const id = "ns=2;s=Types/DateTime";
            const dates = ["2026-01-01T00:00:00.000Z", "2026-03-01T12:30:00.000Z"];
            const fixture: Fixture = {
                meta: { ...base.meta, name: "sample-opcua-datetime" },
                connection: {
                    ...base.connection,
                    devices: [{
                        ...base.connection.devices[0],
                        tags: [{ Name: "Types/DateTime", type: "DateTime", method: "GET",
                            address: id, value: null, recordToDB: true }],
                    }],
                },
                events: dates.map((value, i) => ({
                    t: i * 2000, type: "opcua",
                    values: { [id]: { dataType: "DateTime", value } },
                })) as any,
            };
            const values = (r: any) => r.output.data.get("Device_1/Types/DateTime")
                ?.map((m: any) => m.value);
            const built_in = await run_agent(fixture);
            const split = await run_agent(fixture, { driver: DRIVER! });
            show("DateTime", compare_runs(built_in, split));
            expect(values(built_in)).toEqual(dates.map(() => "0"));
            expect(values(split)).toEqual(dates.map(d => String(Date.parse(d))));
        });
    });

    describe.each(of_protocol("REST").slice(0, 1))("in-process driver %s", (name, fixture) => {
        it("an in-process REST driver matches built-in REST", async () => {
            const r = await golden({ a: fixture }, { b: { driver: inproc_rest() } });
            show(`${name} in-process`, r);
            expect(explain(r)).toBe("");
        });
    });
});

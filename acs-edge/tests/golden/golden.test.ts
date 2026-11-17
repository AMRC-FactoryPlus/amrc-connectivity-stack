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
import { golden, GoldenResult } from "./harness.js";
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
const UDP_MOVE = move_cases("udp-move");

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

    /* The same for acs-service-setup/test/udp-move.test.js: three UDP
     * connections, one in each payload format, on three agents. Each
     * runs with its port opened on the host in the real cluster; here
     * the sender sends to the driver's port on localhost. */
    if (DRIVER_PROTOCOL == "UDP") describe.each(UDP_MOVE.cases)(
        "split driver after service-setup's move %s",
        (name, sample, before, after) => {
            it(`${DRIVER!.name} matches built-in UDP`, async () => {
                const cap = Number(process.env.GOLDEN_DURATION_MS) || Infinity;
                const fixture = truncate(read_fixture(path.join(SAMPLES, sample)), cap);
                const r = await golden({ a: fixture }, {
                    a: { entry: before },
                    b: { entry: after, driver: DRIVER! },
                });
                show(`${name} after the move`, r);
                expect(before.connType).toBe("UDP");
                expect(after.connType).toBe("Driver");
                expect(after.DriverDetails).toEqual(before.UDPConnDetails);
                expect(r.comparison.values).toBeGreaterThan(0);
                expect(explain(r)).toBe("");
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

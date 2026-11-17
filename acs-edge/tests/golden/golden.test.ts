/*
 * ACS Edge Agent
 * Golden-output harness: the built-in connections against themselves,
 * and split drivers against the built-in connections they replace
 * Copyright 2026 University of Sheffield
 */

import dgram from "dgram";
import fs from "fs";
import path from "path";

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

    describe.each(of_protocol("REST").slice(0, 1))("in-process driver %s", (name, fixture) => {
        it("an in-process REST driver matches built-in REST", async () => {
            const r = await golden({ a: fixture }, { b: { driver: inproc_rest() } });
            show(`${name} in-process`, r);
            expect(explain(r)).toBe("");
        });
    });
});

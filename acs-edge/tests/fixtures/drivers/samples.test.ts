/*
 * ACS Edge Agent
 * Driver fixtures: every metric in each committed sample resolves
 * Copyright 2026 University of Sheffield
 */

import fs from "fs";
import path from "path";
import { event_address, read_fixture } from "./fixture.js";
import { connection_metrics } from "./metrics.js";
import { verify } from "./verify.js";

const SAMPLES = path.join(__dirname, "samples");
const KINDS = [
    "opcua", "mqtt-json", "mqtt-delimited", "rest-json", "rest-xml",
    "udp-buffer", "udp-delimited", "udp-json",
];

const dirs = fs.readdirSync(SAMPLES).sort();

describe("Driver fixture samples", () => {
    it("has a sample of each kind", () => {
        for (const k of KINDS) expect(dirs).toContain(k);
    });

    describe.each(dirs)("%s", (dir) => {
        const fixture = read_fixture(path.join(SAMPLES, dir));
        const cm = connection_metrics(fixture.connection);

        it("reads some metrics and lists no findings", () => {
            expect(cm.read.length).toBeGreaterThan(0);
            expect(cm.findings).toEqual([]);
            expect(fixture.meta.findings).toEqual([]);
            expect(fixture.meta.counts.events).toBe(fixture.events.length);
        });

        it("resolves every metric path with the Edge Agent's parser", () => {
            const res = verify(fixture, {}, cm);
            expect(res.findings).toEqual([]);
            expect(res.resolved).toBe(cm.read.length);
            expect(res.checked_events).toBe(fixture.events.length);
        });

        it("has input that changes over time", () => {
            const seen = new Map<string, Set<string>>();
            for (const ev of fixture.events) {
                const [addr, body] = ev.type == "opcua"
                    ? ["", JSON.stringify(ev.values)]
                    : [event_address(ev), ev.type == "http" ? ev.body : ev.payload];
                if (!seen.has(addr)) seen.set(addr, new Set());
                seen.get(addr)!.add(body);
            }
            /* Analogue values change every tick; states and counts
             * may hold still over a short sample, as on a device. */
            const changing = [...seen.values()].filter(b => b.size > 1);
            expect(changing.length).toBeGreaterThan(0);
        });

        it("is in time order", () => {
            const ts = fixture.events.map(e => e.t);
            expect(ts).toEqual([...ts].sort((a, b) => a - b));
        });
    });
});

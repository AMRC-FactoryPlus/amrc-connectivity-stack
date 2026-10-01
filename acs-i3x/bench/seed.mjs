#!/usr/bin/env node
/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Seed an InfluxDB 2.x bucket with the synthetic fleet in dataset.mjs.
 *
 *   node bench/seed.mjs --url http://localhost:58086 --token bench-token \
 *       --org default --bucket default --devices 2000 --points 24 [--wide 1000]
 *
 * Creates the bucket if it does not exist. Writes a `seeded_at` marker
 * so later runs use the same "now" as the data.
 */

import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { lines } from "./dataset.mjs";

const { values: a } = parseArgs({
    options: {
        url: { type: "string", default: "http://localhost:58086" },
        token: { type: "string", default: "bench-token" },
        org: { type: "string", default: "default" },
        bucket: { type: "string", default: "default" },
        devices: { type: "string", default: "2000" },
        points: { type: "string", default: "24" },
        /* Extra top-level metrics per device (see dataset.mjs). */
        wide: { type: "string", default: "0" },
        batch: { type: "string", default: "20000" },
        parallel: { type: "string", default: "4" },
        out: { type: "string" },
    },
});

const headers = { Authorization: `Token ${a.token}` };

async function ensureBucket() {
    const orgs = await (await fetch(`${a.url}/api/v2/orgs?org=${encodeURIComponent(a.org)}`, { headers })).json();
    const orgID = orgs.orgs[0].id;
    const b = await (await fetch(`${a.url}/api/v2/buckets?name=${encodeURIComponent(a.bucket)}&orgID=${orgID}`, { headers })).json();
    if (b.buckets?.length) return;
    const res = await fetch(`${a.url}/api/v2/buckets`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ orgID, name: a.bucket, retentionRules: [] }),
    });
    if (!res.ok) throw new Error(`create bucket: ${res.status} ${await res.text()}`);
}

async function write(body) {
    /* Writes are idempotent. InfluxDB can time out while it creates
     * many new series, so retry. */
    for (let attempt = 1; ; attempt++) {
        try { return await writeOnce(body); }
        catch (e) {
            if (attempt >= 8) throw e;
            process.stderr.write(`  retrying write (${e.message.slice(0, 80)})\n`);
            await new Promise((r) => setTimeout(r, 2000 * attempt));
        }
    }
}

async function writeOnce(body) {
    const res = await fetch(
        `${a.url}/api/v2/write?org=${encodeURIComponent(a.org)}&bucket=${encodeURIComponent(a.bucket)}&precision=ms`,
        { method: "POST", headers: { ...headers, "Content-Type": "text/plain" }, body },
    );
    if (!res.ok) throw new Error(`write: ${res.status} ${await res.text()}`);
}

await ensureBucket();
const now = Date.now();
const n = Number(a.devices);
const points = Number(a.points);
const wide = Number(a.wide);
const batch = Number(a.batch);
const parallel = Number(a.parallel);

let buf = [];
let total = 0;
const inflight = new Set();
const started = Date.now();

async function flush() {
    if (buf.length === 0) return;
    const body = buf.join("\n");
    total += buf.length;
    buf = [];
    const p = write(body).finally(() => inflight.delete(p));
    inflight.add(p);
    if (inflight.size >= parallel) await Promise.race(inflight);
}

for (let i = 0; i < n; i++) {
    for (const line of lines(i, now, points, wide)) {
        buf.push(line);
        if (buf.length >= batch) await flush();
    }
    if (i % 1000 === 999) process.stderr.write(`  ${i + 1} devices, ${total} lines\n`);
}
await flush();
await Promise.all(inflight);

const meta = { bucket: a.bucket, devices: n, points, wide, lines: total, seededAt: new Date(now).toISOString(), seconds: (Date.now() - started) / 1000 };
console.log(JSON.stringify(meta));
if (a.out) writeFileSync(a.out, JSON.stringify(meta, null, 2));

#!/usr/bin/env node
/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Benchmark a long history read: one metric at --hz for --hours,
 * requested whole through POST /v1/objects/history (or GET with
 * --get). For each build it starts this script with --serve as a child
 * process, running the real i3X routes and History from that build's
 * dist against a real InfluxDB, then records per request:
 *   - time to the first body byte and to the end of the response
 *   - bytes received (compressed, as sent) and values in the body
 *   - the server's peak RSS during the request, sampled every 10 ms
 *
 *   node bench/history.mjs --seed --hours 24 --hz 25
 *   node bench/history.mjs --build before=/tmp/i3x-before/acs-i3x/dist \
 *       --build after=./dist --runs 3
 *
 * Only the object tree and auth are stand-ins: one device "dev" with
 * UNS device segment "Dev" and one leaf "speed", and a fixed principal.
 */

import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import zlib from "node:zlib";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = fileURLToPath(import.meta.url);
const { values: a } = parseArgs({
    options: {
        serve: { type: "boolean", default: false },
        seed: { type: "boolean", default: false },
        dist: { type: "string", default: "./dist" },
        build: { type: "string", multiple: true },
        port: { type: "string", default: "58120" },
        influx: { type: "string", default: "http://127.0.0.1:58087" },
        token: { type: "string", default: "bench-token" },
        org: { type: "string", default: "default" },
        bucket: { type: "string", default: "history" },
        hours: { type: "string", default: "24" },
        hz: { type: "string", default: "25" },
        start: { type: "string", default: "2026-11-01T00:00:00Z" },
        runs: { type: "string", default: "3" },
        gzip: { type: "string", default: "1" },
        get: { type: "boolean", default: false },
        timeout: { type: "string", default: "300" },
    },
});

const T0 = Date.parse(a.start);
const END = new Date(T0 + Number(a.hours) * 3600_000).toISOString();
const headers = { Authorization: `Token ${a.token}` };

if (a.serve) await serve();
else if (a.seed) await seed();
else await run();

/** Write the metric into a fresh bucket. */
async function seed() {
    const org = (await (await fetch(`${a.influx}/api/v2/orgs?org=${a.org}`, { headers })).json()).orgs[0].id;
    const old = (await (await fetch(`${a.influx}/api/v2/buckets?name=${a.bucket}`, { headers })).json()).buckets;
    for (const b of old ?? []) await fetch(`${a.influx}/api/v2/buckets/${b.id}`, { method: "DELETE", headers });
    await fetch(`${a.influx}/api/v2/buckets`, {
        method: "POST", headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ orgID: org, name: a.bucket, retentionRules: [] }),
    });
    const n = Math.round(Number(a.hours) * 3600 * Number(a.hz));
    const step = 1000 / Number(a.hz);
    for (let i = 0; i < n; i += 50_000) {
        let body = "";
        for (let j = i; j < Math.min(n, i + 50_000); j++)
            body += `Speed:d,topLevelInstance=dev,path=Dev value=${(Math.sin(j / 500) * 1000).toFixed(3)} ${Math.round(T0 + j * step)}\n`;
        const res = await fetch(`${a.influx}/api/v2/write?org=${a.org}&bucket=${a.bucket}&precision=ms`,
            { method: "POST", headers, body });
        if (!res.ok) throw new Error(`write failed: ${res.status} ${await res.text()}`);
    }
    console.log(`seeded ${n} points into ${a.bucket}`);
}

/** Run one build's routes on --port. */
async function serve() {
    const dist = path.resolve(a.dist);
    const load = (m) => import(pathToFileURL(path.join(dist, "lib", m)).href);
    const { History } = await load("history.js");
    const { routes } = await load("routes.js");
    const express = (await import("express")).default;

    const objectTree = {
        isReady: () => true,
        getObject: (id) => id === "speed" ? { elementId: id, isComposition: false, parentId: "dev" } : undefined,
        getMetricMeta: (id) => id === "speed" ? { topLevelInstanceUuid: "dev", metricPath: "",
            metricName: "Speed", sparkplugType: "Double", typeSuffix: "d" } : undefined,
        unsDeviceSegment: () => "Dev",
    };
    const access = { grants: async () => ({ all: true, targets: new Set() }), visible: () => undefined };
    const history = new History({ influxUrl: a.influx, influxToken: a.token, influxOrg: a.org,
        influxBucket: a.bucket, objectTree });

    let peak = 0;
    setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 10).unref();

    const app = express();
    app.post("/bench/reset", (_req, res) => {
        global.gc?.();
        peak = process.memoryUsage().rss;
        res.json({ rssMB: peak / 1e6 });
    });
    app.get("/bench/stats", (_req, res) => res.json({ peakMB: peak / 1e6 }));
    app.use(express.json({ limit: "100kb" }));
    app.use((req, _res, next) => { req.auth = "bench@REALM"; next(); });
    routes({ objectTree, access, history, valueCache: {}, subscriptions: {} })(app);
    app.listen(Number(a.port), () => console.error(`history bench server on :${a.port} dist=${dist}`));
}

/** Send one history request; time it and count what comes back. */
function request(port) {
    return new Promise((resolve) => {
        const t0 = performance.now();
        let ttfb = null;
        let bytes = 0;
        const chunks = [];
        const body = JSON.stringify({ elementIds: ["speed"], startTime: a.start, endTime: END });
        const opts = a.get
            ? { port, method: "GET", path: `/v1/objects/speed/history?startTime=${a.start}&endTime=${END}` }
            : { port, method: "POST", path: "/v1/objects/history", headers: { "content-type": "application/json" } };
        opts.headers = { ...opts.headers, "accept-encoding": a.gzip === "1" ? "gzip" : "identity" };
        const req = http.request(opts, (res) => {
            res.on("data", (c) => {
                if (ttfb === null) ttfb = performance.now() - t0;
                bytes += c.length;
                chunks.push(c);
            });
            res.on("end", () => finish(res, null));
            res.on("error", (err) => finish(res, err));
        });
        req.setTimeout(Number(a.timeout) * 1000, () => req.destroy(new Error("client timeout")));
        req.on("error", (err) => finish(null, err));
        req.end(a.get ? undefined : body);

        let done = false;
        function finish(res, err) {
            if (done) return;
            done = true;
            const total = performance.now() - t0;
            let values = null;
            try {
                let buf = Buffer.concat(chunks);
                if (res?.headers["content-encoding"] === "gzip") buf = zlib.gunzipSync(buf);
                const j = JSON.parse(buf.toString("utf8"));
                values = (a.get ? j.result : j.results[0].result).values.length;
            } catch (e) {
                err ??= e;
            }
            resolve({ status: res?.statusCode ?? null, ttfbMs: ttfb, totalMs: total, bytes, values,
                error: err ? String(err.message ?? err) : null });
        }
    });
}

async function run() {
    const port = Number(a.port);
    const out = [];
    for (const spec of a.build ?? []) {
        const [label, dist] = spec.split("=");
        const child = spawn(process.execPath, ["--expose-gc", here, "--serve", "--dist", dist,
            "--port", String(port), "--influx", a.influx, "--token", a.token, "--org", a.org,
            "--bucket", a.bucket], { stdio: ["ignore", "inherit", "inherit"] });
        try {
            for (let i = 0; ; i++) {
                try { await fetch(`http://127.0.0.1:${port}/bench/stats`); break; }
                catch { if (i > 100) throw new Error("server did not start"); await new Promise(r => setTimeout(r, 100)); }
            }
            for (let r = 0; r < Number(a.runs); r++) {
                const base = await (await fetch(`http://127.0.0.1:${port}/bench/reset`, { method: "POST" })).json();
                const res = await request(port);
                const { peakMB } = await (await fetch(`http://127.0.0.1:${port}/bench/stats`)).json();
                const row = { build: label, run: r + 1, ...res, baseRssMB: Math.round(base.rssMB), peakRssMB: Math.round(peakMB) };
                out.push(row);
                console.log(JSON.stringify(row));
            }
        } finally {
            child.kill();
            await new Promise(r => child.once("exit", r));
        }
    }
    console.table(out.map(r => ({ build: r.build, run: r.run, status: r.status,
        "ttfb s": r.ttfbMs === null ? "-" : (r.ttfbMs / 1000).toFixed(2), "total s": (r.totalMs / 1000).toFixed(2),
        "MB sent": (r.bytes / 1e6).toFixed(1), values: r.values, "base RSS MB": r.baseRssMB,
        "peak RSS MB": r.peakRssMB, error: r.error ?? "" })));
}

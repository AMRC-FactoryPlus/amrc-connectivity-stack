#!/usr/bin/env node
/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Subscription load benchmark: does a large subscription, registered
 * the way the Explorer registers it while UNS values pour in, stall
 * the live SSE streams?
 *
 * The script runs in two processes. The server process runs the real
 * i3X routes (routes.js -> APIv1) from a compiled dist directory, with
 * a real ObjectTree, ValueCache and SubscriptionManager on a SQLite
 * file, as in a pod. Only these are replaced:
 *   - ConfigDB: the tree comes from the synthetic fleet in dataset.mjs,
 *     plus two "busy" devices with `--wide` extra metrics each;
 *   - MQTT: UNS messages go straight into ValueCache.onUnsMessage, at
 *     `--rate` per second across the busy devices' changing metrics,
 *     `--bg-rate` across the rest of the fleet and `--base-rate` on
 *     the device the stream watches from the start;
 *   - InfluxDB: History is a fake that streams `--hist-points` points
 *     per id in batches of 1,000, so the cost of Flux and of parsing
 *     its CSV is not included;
 *   - Auth: every caller sees everything.
 *
 * The driver (this process) opens an SSE stream on a subscription to
 * one ordinary device and records when each event arrives. At
 * `--burst-at` seconds it does what the Explorer does when someone
 * subscribes to the two busy devices at once: registers each device at
 * maxDepth 0 and then each of its leaves at maxDepth 1 on the same
 * subscription, reads the leaves' values, reads a trend's history for
 * every leaf (one request each, `--hist-conc` at a time) and lists
 * every object. Every request asks for br, gzip like a browser.
 *
 *   npx tsc -p . && node bench/subscription-load.mjs [--dist ./dist]
 *       [--duration 70] [--burst-at 10] [--rate 2000] [--json out.json]
 *
 * It prints the event-loop delay in the server (max and p99, over the
 * whole run and per second), the longest gap between SSE events, the
 * SSE events per second around the burst, and any process warnings.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const { values: a } = parseArgs({
    options: {
        server: { type: "boolean", default: false },
        dist: { type: "string", default: "./dist" },
        port: { type: "string", default: "58210" },
        /* Ordinary devices in the tree, about 30 objects each. */
        devices: { type: "string", default: "700" },
        /* Extra live metrics on each of the two busy devices. */
        wide: { type: "string", default: "240" },
        /* How many of each busy device's extra metrics change. */
        changing: { type: "string", default: "140" },
        rate: { type: "string", default: "2000" },
        "bg-rate": { type: "string", default: "500" },
        "base-rate": { type: "string", default: "50" },
        "hist-points": { type: "string", default: "3600" },
        "hist-conc": { type: "string", default: "16" },
        duration: { type: "string", default: "70" },
        "burst-at": { type: "string", default: "10" },
        json: { type: "string" },
        /* Driver only: print each burst request as it completes. */
        verbose: { type: "boolean", default: false },
    },
});

const SELF = fileURLToPath(import.meta.url);
const BUSY = 2;
const ACCEPT = "br, gzip, deflate";

if (a.server) await server();
else await driver();

/* ================================================================
 * Server process
 * ================================================================ */

async function server() {
    const { device, snapshotOf } = await import("./dataset.mjs");
    const { default: express } = await import("express");
    const dist = path.resolve(a.dist);
    const load = (m) => import(pathToFileURL(path.join(dist, "lib", m)).href);
    const { I3xStore } = await load("store.js");
    const { ObjectTree } = await load("object-tree.js");
    const { ValueCache } = await load("value-cache.js");
    const { SubscriptionManager } = await load("subscriptions.js");
    const { routes } = await load("routes.js");

    const warnings = [];
    process.on("warning", (w) => warnings.push(`${w.name}: ${w.message}`));

    const n = Number(a.devices);
    const wide = Number(a.wide);
    const fleet = [];
    for (let i = 0; i < n; i++) fleet.push(device(i));
    const busy = [];
    for (let k = 0; k < BUSY; k++) busy.push(device(n + k, wide));

    const dir = mkdtempSync(path.join(tmpdir(), "i3x-subload-"));
    process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
    const store = new I3xStore({ path: path.join(dir, "i3x.db") });
    const fplus = { debug: { bound: () => () => {} } };
    const objectTree = new ObjectTree({ fplus, namespaceName: "Bench", namespaceUri: "https://example.com/i3x", store });
    objectTree.buildNamespace();
    objectTree.buildRelationshipTypes();
    objectTree.refreshFromSnapshot(snapshotOf([...fleet, ...busy]));
    objectTree.ready = true;

    const valueCache = new ValueCache({ objectTree, store, staleThreshold: 300000 });

    /* Every UNS metric of a device: [segments, instance path]. */
    const metricsOf = (d, only) => {
        const out = [];
        for (const [key, val] of Object.entries(d.originMap)) {
            if (val?.Sparkplug_Type) {
                if (!only || only(key)) out.push([[key], [d.uuid]]);
            } else if (val && typeof val === "object" && val.Instance_UUID && key !== "Address") {
                for (const [m, mv] of Object.entries(val))
                    if (mv?.Sparkplug_Type && (!only || only(m))) out.push([[key, m], [d.uuid, val.Instance_UUID]]);
            }
        }
        return out;
    };
    const live = new Set(["Network_Connected", "Fault_Count", "Lamp_Current", "Temperature", "Uptime"]);
    const changing = Number(a.changing);
    const isChanging = (m) => live.has(m)
        || (m.startsWith("Wide_") && Number(m.slice(5)) < changing);
    const msg = (d, [segments, inst]) => ({
        topic: `UNS/v1/Bench/Site/Area/Line/Edge/${d.name.replace(/ /g, "_")}/${segments.join("/")}`,
        props: { properties: { userProperties: { InstanceUUIDPath: inst.join(":"), SchemaUUIDPath: "" } } },
    });

    /* Every metric once, so each leaf has a value before the run. */
    for (const d of [...fleet, ...busy])
        for (const m of metricsOf(d)) publish(msg(d, m), 0);
    valueCache.flush();

    const feeds = [
        { rate: Number(a.rate), msgs: busy.flatMap(d => metricsOf(d, isChanging).map(m => msg(d, m))) },
        { rate: Number(a["bg-rate"]), msgs: fleet.slice(1).flatMap(d => metricsOf(d, (m) => live.has(m)).map(m => msg(d, m))) },
        { rate: Number(a["base-rate"]), msgs: metricsOf(fleet[0], (m) => live.has(m)).map(m => msg(fleet[0], m)) },
    ].map(f => ({ ...f, next: 0, owed: 0 }));
    let sent = 0;
    let seq = 0;

    function publish(m, value) {
        const payload = Buffer.from(JSON.stringify({ timestamp: new Date().toISOString(), value }));
        valueCache.onUnsMessage(m.topic, payload, m.props);
    }

    /* MQTT delivers whatever arrived while the loop was busy in one
     * go, so the feed owes the messages it missed rather than
     * skipping them. */
    let feedTimer = null;
    let lastTick = 0;
    function startFeed() {
        lastTick = performance.now();
        feedTimer = setInterval(() => {
            const now = performance.now();
            const dt = (now - lastTick) / 1000;
            lastTick = now;
            for (const f of feeds) {
                if (!f.msgs.length) continue;
                f.owed += f.rate * dt;
                for (; f.owed >= 1; f.owed--) {
                    publish(f.msgs[f.next], ++seq);
                    f.next = (f.next + 1) % f.msgs.length;
                    sent++;
                }
            }
        }, 10);
    }

    /* A History with the shape APIv1 uses, without InfluxDB. */
    const histPoints = Number(a["hist-points"]);
    const history = {
        async getValues() { return new Map(); },
        async *streamHistory(_id, startTime, endTime, opts = {}) {
            const t0 = Date.parse(startTime);
            const step = (Date.parse(endTime) - t0) / histPoints;
            for (let i = 0; i < histPoints; i += 1000) {
                await new Promise(r => setImmediate(r));
                if (opts.signal?.aborted) return;
                const batch = [];
                for (let j = i; j < Math.min(i + 1000, histPoints); j++)
                    batch.push({ value: j * 0.5, quality: "Good", timestamp: new Date(t0 + j * step).toISOString() });
                yield batch;
            }
        },
    };

    const access = {
        grants: async () => ({ all: true, targets: new Set() }),
        visible: () => undefined,
        track: () => ({ visible: () => true, stop: () => {} }),
    };
    const subscriptions = new SubscriptionManager({ valueCache, objectTree, viewers: access, ttl: 300000 });

    const eld = monitorEventLoopDelay({ resolution: 10 });
    const win = monitorEventLoopDelay({ resolution: 10 });
    eld.enable();
    win.enable();
    const t0 = performance.now();
    const timeline = [];
    setInterval(() => {
        timeline.push({ t: Math.round((performance.now() - t0) / 100) / 10,
            maxMs: win.max / 1e6, p99Ms: win.percentile(99) / 1e6, sent });
        win.reset();
    }, 1000).unref();

    const leavesOf = (id) => {
        const out = [];
        for (const c of objectTree.getChildElementIds(id)) {
            if (objectTree.getObject(c)?.isComposition) out.push(...leavesOf(c));
            else out.push(c);
        }
        return out;
    };

    const app = express();
    app.get("/bench/ids", (_req, res) => res.json({
        base: fleet[0].uuid,
        busy: busy.map(d => ({ uuid: d.uuid, leaves: leavesOf(d.uuid) })),
        objects: objectTree.getObjects().length,
    }));
    app.post("/bench/start", (_req, res) => {
        eld.reset(); win.reset(); timeline.length = 0;
        if (!feedTimer) startFeed();
        res.json({ ok: true, at: performance.now() - t0 });
    });
    app.get("/bench/stats", (_req, res) => res.json({
        eldMaxMs: eld.max / 1e6, eldP99Ms: eld.percentile(99) / 1e6, eldMeanMs: eld.mean / 1e6,
        sent, timeline, warnings, rssMB: process.memoryUsage().rss / 1e6,
    }));
    app.use(express.json({ limit: "100kb", strict: false }));
    app.use((req, _res, next) => { req.auth = "bench@REALM"; next(); });
    routes({ objectTree, access, valueCache, history, subscriptions })(app);

    app.listen(Number(a.port), "127.0.0.1", () => {
        process.stdout.write(`ready ${objectTree.getObjects().length}\n`);
    });
}

/* ================================================================
 * Driver process
 * ================================================================ */

async function driver() {
    const base = `http://127.0.0.1:${a.port}`;
    const args = [SELF, "--server", "--dist", a.dist, "--port", a.port, "--devices", a.devices,
        "--wide", a.wide, "--changing", a.changing, "--rate", a.rate, "--bg-rate", a["bg-rate"],
        "--base-rate", a["base-rate"], "--hist-points", a["hist-points"]];
    const child = spawn(process.execPath, [...process.execArgv, ...args], { stdio: ["ignore", "pipe", "inherit"] });
    process.on("exit", () => child.kill());
    await new Promise((resolve, reject) => {
        child.stdout.on("data", (b) => { if (String(b).startsWith("ready")) resolve(); });
        child.on("exit", (code) => reject(new Error(`server exited ${code}`)));
    });

    const post = async (p, body) => {
        const r = await fetch(base + p, {
            method: "POST", body: JSON.stringify(body),
            headers: { "content-type": "application/json", "accept-encoding": ACCEPT },
        });
        const text = await r.text();
        if (!r.ok) throw new Error(`${p}: ${r.status} ${text.slice(0, 200)}`);
        return text ? JSON.parse(text) : null;
    };
    const ids = await (await fetch(base + "/bench/ids")).json();
    const leafCount = ids.busy.reduce((n, d) => n + d.leaves.length, 0);
    console.error(`tree: ${ids.objects} objects; busy devices: ${ids.busy.map(d => d.leaves.length).join(" + ")} leaves`);

    const clientId = "bench";
    const { subscriptionId } = (await post("/v1/subscriptions", { clientId, displayName: "bench" })).result;
    await post("/v1/subscriptions/register", { clientId, subscriptionId, elementIds: [ids.base], maxDepth: 0 });

    /* The SSE stream, read as the browser reads it. */
    const T0 = performance.now();
    const now = () => (performance.now() - T0) / 1000;
    const sse = { events: 0, last: null, gaps: [], perSec: [], lagPerSec: [], maxLag: { lag: 0, at: 0 } };
    const streamRes = await fetch(base + "/v1/subscriptions/stream", {
        method: "POST", body: JSON.stringify({ clientId, subscriptionId }),
        headers: { "content-type": "application/json", "accept-encoding": ACCEPT, accept: "text/event-stream" },
    });
    sse.encoding = streamRes.headers.get("content-encoding") ?? "identity";
    const reading = (async () => {
        const dec = new TextDecoder();
        let tail = "";
        for await (const chunk of streamRes.body) {
            const t = now();
            tail += dec.decode(chunk, { stream: true });
            const parts = tail.split("\n\n");
            tail = parts.pop();
            if (!parts.length) continue;
            sse.events += parts.length;
            const s = Math.floor(t);
            sse.perSec[s] = (sse.perSec[s] ?? 0) + parts.length;
            /* How old the newest value in this read is: the feed
             * stamps each value when it publishes it. */
            const last = JSON.parse(parts[parts.length - 1].replace(/^data: /, ""));
            const lag = Date.now() - Date.parse(last[0].timestamp);
            sse.lagPerSec[s] = Math.max(sse.lagPerSec[s] ?? 0, lag);
            if (lag > sse.maxLag.lag) sse.maxLag = { lag, at: t };
            if (sse.last !== null) sse.gaps.push({ at: sse.last, gap: t - sse.last });
            sse.last = t;
        }
    })().catch((err) => console.error("SSE read failed:", err));

    await post("/bench/start", {});
    const burstAt = Number(a["burst-at"]);
    const duration = Number(a.duration);
    await sleep(burstAt * 1000);

    /* The burst, as the Explorer sends it. */
    const log = (s) => a.verbose && console.error(`  ${now().toFixed(2)}s ${s}`);
    const burst = [];
    const burstT = now();
    const timed = async (name, f) => {
        const t = now();
        try { await f(); } catch (err) { log(`${name} failed: ${err.message}`); }
        burst.push({ name, start: t, ms: Math.round((now() - t) * 1000) });
        log(`${name} ${Math.round((now() - t) * 1000)} ms`);
    };
    const endTime = new Date().toISOString();
    const startTime = new Date(Date.now() - 3600_000).toISOString();
    const leaves = ids.busy.flatMap(d => d.leaves);
    const histQueue = [...leaves];
    await Promise.all([
        ...ids.busy.map(d => timed(`register ${d.leaves.length + 1}`, async () => {
            await post("/v1/subscriptions/register", { clientId, subscriptionId, elementIds: [d.uuid], maxDepth: 0 });
            for (let i = 0; i < d.leaves.length; i += 500)
                await post("/v1/subscriptions/register",
                    { clientId, subscriptionId, elementIds: d.leaves.slice(i, i + 500), maxDepth: 1 });
        })),
        ...ids.busy.map(d => timed("value", () => post("/v1/objects/value", { elementIds: d.leaves, maxDepth: 1 }))),
        timed("objects", async () => {
            const r = await fetch(base + "/v1/objects", { headers: { "accept-encoding": ACCEPT } });
            await r.arrayBuffer();
        }),
        timed(`history x${leaves.length}`, async () => {
            const worker = async () => {
                for (let id; (id = histQueue.shift());)
                    await post("/v1/objects/history", { elementIds: [id], startTime, endTime });
            };
            await Promise.all(Array.from({ length: Number(a["hist-conc"]) }, worker));
        }),
    ]);

    const left = duration - now();
    if (left > 0) await sleep(left * 1000);
    const stats = await (await fetch(base + "/bench/stats")).json();
    child.kill();
    await Promise.race([reading, sleep(500)]);

    /* Report */
    const after = sse.gaps.filter(g => g.at >= burstT);
    const worst = (gs) => gs.reduce((m, g) => g.gap > m.gap ? g : m, { at: 0, gap: 0 });
    const before = worst(sse.gaps.filter(g => g.at < burstT));
    const afterW = worst(after);
    const slowSecs = [...stats.timeline].sort((x, y) => y.maxMs - x.maxMs).slice(0, 5);
    const fmt = (x) => x.toFixed(1);

    console.log(`\nSubscription load: ${ids.objects} objects, ${leafCount} leaves registered, `
        + `feed ${a.rate}/s busy + ${a["bg-rate"]}/s fleet + ${a["base-rate"]}/s watched, burst at ${fmt(burstT)} s`);
    console.log(`SSE stream encoding:        ${sse.encoding}`);
    console.log(`Event-loop delay, run:      max ${fmt(stats.eldMaxMs)} ms, p99 ${fmt(stats.eldP99Ms)} ms, mean ${fmt(stats.eldMeanMs)} ms`);
    console.log(`Worst seconds (max ms):     ${slowSecs.map(s => `${fmt(s.maxMs)} @${fmt(s.t)}s`).join(", ")}`);
    console.log(`Longest SSE gap:            before burst ${fmt(before.gap * 1000)} ms, `
        + `after ${fmt(afterW.gap * 1000)} ms (from ${fmt(afterW.at)} s)`);
    console.log(`Oldest value on arrival:    ${sse.maxLag.lag} ms (at ${fmt(sse.maxLag.at)} s); per second from the burst: `
        + sse.lagPerSec.slice(Math.floor(burstT), Math.floor(burstT) + 15).map(x => x ?? "-").join(" "));
    console.log(`SSE events:                 ${sse.events}; per second from the burst: `
        + sse.perSec.slice(Math.floor(burstT), Math.floor(burstT) + 15).map(x => x ?? 0).join(" "));
    console.log(`UNS messages fed:           ${stats.sent}`);
    console.log(`Burst requests:             ${burst.map(b => `${b.name} ${b.ms} ms`).join(", ")}`);
    console.log(`Warnings:                   ${stats.warnings.length ? [...new Set(stats.warnings)].join(" | ") : "none"}`);

    if (a.json) writeFileSync(a.json, JSON.stringify({
        args: a, objects: ids.objects, leaves: leafCount, burstAt: burstT,
        eld: { maxMs: stats.eldMaxMs, p99Ms: stats.eldP99Ms, meanMs: stats.eldMeanMs },
        timeline: stats.timeline, sse: { encoding: sse.encoding, events: sse.events, perSec: sse.perSec,
            longestGapBeforeMs: before.gap * 1000, longestGapAfterMs: afterW.gap * 1000, longestGapAfterAt: afterW.at,
            maxLagMs: sse.maxLag.lag, maxLagAt: sse.maxLag.at, lagPerSec: sse.lagPerSec },
        burst, warnings: stats.warnings,
    }, null, 2));
    process.exit(0);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

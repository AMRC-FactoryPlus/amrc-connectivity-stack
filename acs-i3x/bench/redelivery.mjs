#!/usr/bin/env node
/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Benchmark: ConfigDB delivering configs again without a change, as
 * after a notify-v2 reconnect.
 *
 * Runs the real ObjectTreeRefresh, ObjectTree, I3xRag and HTTP routes
 * from a compiled dist directory. ConfigDB is an in-memory stand-in
 * that delivers each notify message on a later macrotask, as a
 * WebSocket would. InfluxDB and MQTT are not used.
 *
 *   npx tsc -p .
 *   node bench/redelivery.mjs --dist ./dist --devices 24000 \
 *       --redeliveries 2000 --rate 100 --window 60
 *
 * After the first snapshot, the script re-delivers --redeliveries
 * unchanged configs at --rate per second, and measures for --window
 * seconds from the start of the storm. A child process polls
 * GET /v1/objecttypes every 100 ms.
 *
 * With --uns D, it then sends UNS messages for the first D devices
 * (every config leaf, plus one metric per device that is not in the
 * config) at --uns-rate messages per second, and measures how long the
 * new metrics take to appear in RAG search. It prints one JSON line.
 */

import express from "express";
import path from "node:path";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import * as rx from "rxjs";

import { pipelineSnapshot } from "./dataset.mjs";

const { values: a } = parseArgs({ options: {
    dist:           { type: "string", default: "./dist" },
    port:           { type: "string", default: "58110" },
    devices:        { type: "string", default: "24000" },
    redeliveries:   { type: "string", default: "2000" },
    rate:           { type: "string", default: "100" },
    window:         { type: "string", default: "60" },
    uns:            { type: "string", default: "0" },
    "uns-rate":     { type: "string", default: "2000" },
    "uns-wait":     { type: "string", default: "30" },
} });

const dist = path.resolve(a.dist);
const load = m => import(pathToFileURL(path.join(dist, "lib", m)).href);
const { ObjectTree } = await load("object-tree.js");
const { ValueCache } = await load("value-cache.js");
const { History } = await load("history.js");
const { SubscriptionManager } = await load("subscriptions.js");
const { I3xRag } = await load("rag/i3x-rag.js");
const { ObjectTreeRefresh } = await load("refresh.js");
const { routes } = await load("routes.js");
const C = await load("constants.js");

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* The duck-typed immutable.js Set that refresh.ts expects. */
class MemberSet {
    constructor (items) { this.items = items; }
    isEmpty () { return this.items.length === 0; }
    [Symbol.iterator] () { return this.items[Symbol.iterator](); }
}

/* In-memory ConfigDB. Configs are held as JSON text, and every
 * delivery parses a fresh copy, as a WebSocket message would. */
class FakeConfigDB {
    configs = new Map();
    subs = new Map();
    members = new rx.ReplaySubject(1);

    put (app, obj, value) { this.configs.set(`${app}:${obj}`, JSON.stringify(value)); }

    deliver (key, sub) {
        setImmediate(() => {
            if (!sub.closed) sub.next(JSON.parse(this.configs.get(key) ?? "null"));
        });
    }

    watch_config (app, obj) {
        const key = `${app}:${obj}`;
        return new rx.Observable(sub => {
            let set = this.subs.get(key);
            if (!set) this.subs.set(key, set = new Set());
            set.add(sub);
            this.deliver(key, sub);
            return () => set.delete(sub);
        });
    }

    watch_members () { return this.members; }

    redeliver (key) {
        for (const sub of this.subs.get(key) ?? []) this.deliver(key, sub);
    }
}

const N = Number(a.devices);
const snap = pipelineSnapshot(N);
const cdb = new FakeConfigDB();
for (const [uuid, { devInfo, info }] of snap.devices) {
    cdb.put(C.DEVICE_INFORMATION_APP_UUID, uuid, devInfo);
    cdb.put(C.INFO_APP_UUID, uuid, info);
}
for (const [uuid, { schema, info }] of snap.schemas) {
    cdb.put(C.SCHEMA_APP_UUID, uuid, schema);
    cdb.put(C.INFO_APP_UUID, uuid, info);
}

const fplus = {
    ConfigDB: cdb,
    Directory: { get_device_info: async () => ({ online: false }) },
    debug: { bound: () => () => {} },
};
const objectTree = new ObjectTree({ fplus, namespaceName: "AMRC", namespaceUri: "https://example.com/i3x" });
objectTree.buildNamespace();
objectTree.buildRelationshipTypes();
objectTree.ready = true;
const valueCache = new ValueCache({ objectTree, staleThreshold: 300000 });
const history = new History({
    influxUrl: "http://127.0.0.1:1", influxToken: "x", influxOrg: "x",
    influxBucket: "x", objectTree,
});
const subscriptions = new SubscriptionManager({ valueCache, ttl: 300000 });
const rag = new I3xRag(objectTree, valueCache, history);
rag.init();

/* Count rebuilds by wrapping the instance method. */
const m = { rebuilds: 0, rebuild_ms: 0, rebuild_max_ms: 0 };
const rebuild = rag.rebuild.bind(rag);
rag.rebuild = () => {
    const t = performance.now();
    rebuild();
    const d = performance.now() - t;
    m.rebuilds++; m.rebuild_ms += d; m.rebuild_max_ms = Math.max(m.rebuild_max_ms, d);
};

const app = express();
app.use((req, _res, next) => { req.auth = "bench@REALM"; next(); });
routes({ objectTree, valueCache, history, subscriptions })(app);
const server = app.listen(Number(a.port));

/* First snapshot. */
const t_start = performance.now();
new ObjectTreeRefresh({ fplus, objectTree, i3xRag: rag, valueCache }).run();
cdb.members.next(new MemberSet([...snap.devices.keys()]));
while (m.rebuilds === 0) await sleep(5);
const first_snapshot_ms = performance.now() - t_start;
await sleep(500);
Object.assign(m, { rebuilds: 0, rebuild_ms: 0, rebuild_max_ms: 0 });

/* Poller in a child process, so its timing is not held up by this
 * process's event loop. */
const POLL = `
const url = process.argv[1], end = Date.now() + Number(process.argv[2]);
const lat = [], errs = [];
(async () => {
  while (Date.now() < end) {
    const t = performance.now();
    try { const r = await fetch(url); await r.arrayBuffer(); if (!r.ok) errs.push(r.status); }
    catch (e) { errs.push(String(e)); }
    lat.push(performance.now() - t);
    const wait = 100 - (performance.now() - t);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
  }
  console.log(JSON.stringify({ lat, errs }));
})();`;
const WINDOW_MS = Number(a.window) * 1000;
const poller = spawn(process.execPath,
    ["-e", POLL, `http://127.0.0.1:${a.port}/v1/objecttypes`, `${WINDOW_MS}`],
    { stdio: ["ignore", "pipe", "inherit"] });
let poll_out = "";
poller.stdout.on("data", d => poll_out += d);
const poll_done = new Promise(r => poller.on("exit", r));

/* The storm: unchanged device configs, alternating Info and
 * DeviceInformation, at --rate per second. */
const keys = [];
for (const uuid of snap.devices.keys()) {
    keys.push(`${C.INFO_APP_UUID}:${uuid}`, `${C.DEVICE_INFORMATION_APP_UUID}:${uuid}`);
}
const R = Number(a.redeliveries), RATE = Number(a.rate);
const eld = monitorEventLoopDelay({ resolution: 10 });
eld.enable();
const cpu0 = process.cpuUsage();
const t0 = performance.now();
let k = 0;
await new Promise(resolve => {
    const tick = () => {
        const now = performance.now() - t0;
        while (k < R && k * 1000 / RATE <= now) cdb.redeliver(keys[k++ % keys.length]);
        if (k >= R) return resolve();
        setTimeout(tick, Math.max(0, k * 1000 / RATE - (performance.now() - t0)));
    };
    tick();
});
while (performance.now() - t0 < WINDOW_MS) await sleep(50);
const wall_s = (performance.now() - t0) / 1000;
const cpu = process.cpuUsage(cpu0);
eld.disable();
await poll_done;

const { lat, errs } = JSON.parse(poll_out);
lat.sort((x, y) => x - y);
const pct = p => lat[Math.min(lat.length - 1, Math.floor(p / 100 * lat.length))];

const storm = { ...m };
const storm_nodes = rag.nodeCount();

/* Optional UNS phase. */
const uns = {};
const U = Number(a.uns);
if (U > 0) {
    const msgs = [];
    const devs = [...snap.devices.keys()].slice(0, U);
    for (const uuid of devs) {
        const isa = [];
        for (let p = objectTree.getObject(uuid)?.parentId; p && p !== "/";
                p = objectTree.getObject(p)?.parentId)
            isa.unshift(objectTree.getObject(p).displayName);
        const name = objectTree.getObject(uuid).displayName.replace(/ /g, "_");
        const walk = (id, segs) => {
            for (const c of objectTree.getChildElementIds(id)) {
                const o = objectTree.getObject(c);
                const next = [...segs, o.displayName];
                if (o.isComposition) walk(c, next);
                else msgs.push([isa, name, next, uuid]);
            }
        };
        walk(uuid, []);
        msgs.push([isa, name, ["Extra_UNS_Metric"], uuid]);
    }
    const payload = Buffer.from(JSON.stringify({ timestamp: new Date().toISOString(), value: 1 }));
    const send = ([isa, name, segs, uuid]) => valueCache.onUnsMessage(
        ["UNS", "v1", ...isa, "Edge", name, ...segs].join("/"), payload,
        { properties: { userProperties: { InstanceUUIDPath: uuid, SchemaUUIDPath: "" } } });

    Object.assign(m, { rebuilds: 0, rebuild_ms: 0, rebuild_max_ms: 0 });
    const nodes0 = objectTree.getObjects().length;
    const eld2 = monitorEventLoopDelay({ resolution: 10 });
    eld2.enable();
    const URATE = Number(a["uns-rate"]);
    const u0 = performance.now();
    let j = 0;
    await new Promise(resolve => {
        const tick = () => {
            const now = performance.now() - u0;
            while (j < msgs.length && j * 1000 / URATE <= now) send(msgs[j++]);
            if (j >= msgs.length) return resolve();
            setTimeout(tick, Math.max(0, j * 1000 / URATE - (performance.now() - u0)));
        };
        tick();
    });
    const sent = performance.now();
    const found = () => rag.search("Extra_UNS_Metric", Infinity).length;
    let found_ms = null;
    while (performance.now() - sent < Number(a["uns-wait"]) * 1000) {
        if (found() >= U) { found_ms = performance.now() - sent; break; }
        await sleep(20);
    }
    eld2.disable();
    Object.assign(uns, {
        uns_devices: U,
        uns_messages: msgs.length,
        uns_new_nodes: objectTree.getObjects().length - nodes0,
        uns_send_s: +((sent - u0) / 1000).toFixed(1),
        uns_rebuilds: m.rebuilds,
        uns_rebuild_max_ms: +m.rebuild_max_ms.toFixed(0),
        uns_in_rag: found(),
        uns_in_rag_after_last_msg_s: found_ms === null ? null : +(found_ms / 1000).toFixed(2),
        uns_eld_p99_ms: +(eld2.percentile(99) / 1e6).toFixed(1),
        uns_eld_max_ms: +(eld2.max / 1e6).toFixed(1),
    });
}

console.log(JSON.stringify({
    dist: a.dist,
    devices: N,
    nodes: storm_nodes,
    first_snapshot_s: +(first_snapshot_ms / 1000).toFixed(2),
    redeliveries: R,
    rate: RATE,
    window_s: +wall_s.toFixed(1),
    rebuilds: storm.rebuilds,
    rebuild_mean_ms: storm.rebuilds ? +(storm.rebuild_ms / storm.rebuilds).toFixed(0) : 0,
    rebuild_max_ms: +storm.rebuild_max_ms.toFixed(0),
    cpu_cores: +((cpu.user + cpu.system) / 1e6 / wall_s).toFixed(2),
    eld_p99_ms: +(eld.percentile(99) / 1e6).toFixed(1),
    eld_max_ms: +(eld.max / 1e6).toFixed(1),
    objecttypes_polls: lat.length,
    objecttypes_p50_ms: +pct(50).toFixed(1),
    objecttypes_p99_ms: +pct(99).toFixed(1),
    objecttypes_max_ms: +lat[lat.length - 1].toFixed(1),
    objecttypes_errors: errs.length,
    ...uns,
}));
server.close();
process.exit(0);

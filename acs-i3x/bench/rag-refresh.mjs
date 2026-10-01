#!/usr/bin/env node
/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Measure what a ConfigDB change costs the i3X refresh pipeline, and
 * what the next RAG query costs. Runs the real ObjectTreeRefresh,
 * ObjectTree and I3xRag from a compiled dist directory. ConfigDB is
 * replaced by one BehaviorSubject per config, filled from the
 * synthetic fleet in dataset.mjs.
 *
 *   node --expose-gc --max-old-space-size=8192 bench/rag-refresh.mjs \
 *       --dist ./dist --devices 24000 [--storm 20] [--gap 50] [--json]
 *
 * --check prints a hash of every RAG query's answers after a fixed
 * sequence of config and UNS changes. Two builds that print the same
 * hash give identical answers.
 */

import path from "node:path";
import crypto from "node:crypto";
import { parseArgs } from "node:util";
import { monitorEventLoopDelay, PerformanceObserver, performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import * as rx from "rxjs";
import { device, deviceUuid, pipelineSnapshot } from "./dataset.mjs";

const { values: a } = parseArgs({
    options: {
        dist: { type: "string", default: "./dist" },
        devices: { type: "string", default: "24000" },
        storm: { type: "string", default: "20" },
        gap: { type: "string", default: "50" },
        check: { type: "boolean", default: false },
        json: { type: "boolean", default: false },
    },
});

const dist = path.resolve(a.dist);
const load = (m) => import(pathToFileURL(path.join(dist, "lib", m)).href);
const { ObjectTree } = await load("object-tree.js");
const { I3xRag } = await load("rag/i3x-rag.js");
const { ObjectTreeRefresh } = await load("refresh.js");
const C = await load("constants.js");

const n = Number(a.devices);
const snap = pipelineSnapshot(n);

/* ---- Fake ConfigDB ---- */
const configs = new Map();
const config = (app, obj) => {
    const key = `${app}:${obj}`;
    if (!configs.has(key)) configs.set(key, new rx.BehaviorSubject(null));
    return configs.get(key);
};
const memberSet = (uuids) => ({
    isEmpty: () => uuids.length === 0,
    [Symbol.iterator]: () => uuids[Symbol.iterator](),
});
let uuids = [...snap.devices.keys()];
for (const [uuid, { devInfo, info }] of snap.devices) {
    config(C.DEVICE_INFORMATION_APP_UUID, uuid).next(devInfo);
    config(C.INFO_APP_UUID, uuid).next(info);
}
for (const [uuid, { schema, info }] of snap.schemas) {
    config(C.SCHEMA_APP_UUID, uuid).next(schema);
    config(C.INFO_APP_UUID, uuid).next(info);
}
const members = new rx.BehaviorSubject(memberSet(uuids));

const fplus = {
    debug: { bound: () => () => {} },
    ConfigDB: {
        watch_members: () => members,
        watch_config: (app, obj) => config(app, obj),
    },
};

const objectTree = new ObjectTree({ fplus, namespaceName: "AMRC", namespaceUri: "https://example.com/i3x" });
const i3xRag = new I3xRag(objectTree, { getValue: () => null }, {
    queryHistory: async () => [], getCurrentValue: async () => null, getCompositionValue: async () => null,
});
i3xRag.init();

/* The first emission seeds the tree. */
await new ObjectTreeRefresh({ fplus, objectTree, i3xRag }).run();
i3xRag.search("Signal");

const ms = (t0) => performance.now() - t0;
const median = (xs) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
const gc = () => globalThis.gc?.();
const heapMB = () => process.memoryUsage().heapUsed / 1048576;
const rename = (i, k) => config(C.INFO_APP_UUID, deviceUuid(i)).next({ name: `Traffic Signal ${i} r${k}` });

if (a.check) {
    await check();
    process.exit(0);
}

const out = { build: a.dist, devices: n, nodes: objectTree.getObjects().length };

/* 1. One config change (a device rename), synchronous cost. */
{
    const t = [];
    for (let k = 0; k < 7; k++) {
        const t0 = performance.now();
        rename(k, k);
        t.push(ms(t0));
    }
    out.configEmissionMs = median(t);
}

/* 2. One membership change (a device added), synchronous cost. */
{
    const t = [];
    for (let k = 0; k < 3; k++) {
        const d = device(n + k);
        const uuid = d.uuid;
        config(C.DEVICE_INFORMATION_APP_UUID, uuid)
            .next({ schema: d.originMap.Schema_UUID, sparkplugName: d.name, originMap: d.originMap });
        config(C.INFO_APP_UUID, uuid).next(d.info);
        uuids = [...uuids, uuid];
        const t0 = performance.now();
        members.next(memberSet(uuids));
        t.push(ms(t0));
    }
    out.membershipEmissionMs = median(t);
}

/* 3. First query after a change, then a second query. */
{
    rename(1, "q");
    let t0 = performance.now();
    i3xRag.search("Signal");
    out.firstQueryAfterChangeMs = ms(t0);
    t0 = performance.now();
    i3xRag.search("Signal");
    out.nextQueryMs = ms(t0);
}

/* 4. A storm of config changes, one every --gap ms: event-loop delay,
 *    heap, GC time. Ends with one query. */
{
    const storm = Number(a.storm), gap = Number(a.gap);
    gc();
    const heapBase = heapMB();
    let heapPeak = heapBase;
    let gcMs = 0;
    const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) gcMs += e.duration;
    });
    obs.observe({ entryTypes: ["gc"] });
    const h = monitorEventLoopDelay({ resolution: 10 });
    h.enable();
    const t0 = performance.now();
    let blocked = 0;
    for (let k = 0; k < storm; k++) {
        await new Promise((r) => setTimeout(r, gap));
        const s = performance.now();
        rename(k % 50, `s${k}`);
        blocked += ms(s);
        heapPeak = Math.max(heapPeak, heapMB());
    }
    await new Promise((r) => setTimeout(r, gap));
    h.disable();
    const wall = ms(t0);
    await new Promise((r) => setTimeout(r, 200));
    obs.disconnect();
    const q0 = performance.now();
    i3xRag.search("Signal");
    out.storm = {
        emissions: storm, gapMs: gap, wallMs: Math.round(wall),
        blockedMs: Math.round(blocked),
        loopDelayMaxMs: Math.round(h.max / 1e6),
        loopDelayP99Ms: Math.round(h.percentile(99) / 1e6),
        loopDelayMeanMs: Math.round(h.mean / 1e6),
        heapBaseMB: Math.round(heapBase), heapPeakMB: Math.round(heapPeak),
        gcMs: Math.round(gcMs),
        queryAfterStormMs: Math.round(ms(q0)),
    };
}

for (const k of ["configEmissionMs", "membershipEmissionMs", "firstQueryAfterChangeMs", "nextQueryMs"])
    out[k] = Math.round(out[k] * 10) / 10;
console.log(a.json ? JSON.stringify(out) : out);
process.exit(0);

/* ---- --check: identical answers across builds ---- */
async function check () {
    const leafOf = (i) => objectTree.getChildElementIds(deviceUuid(i))
        .find((id) => objectTree.getObject(id)?.isComposition === false);
    const uns = (i, p) => objectTree.addCompositionFromUns([deviceUuid(i)], [device(i).originMap.Schema_UUID], p);
    const hashes = [];
    const answer = async (tag, unsId) => {
        const types = [...new Set(i3xRag.relationshipMap().map((e) => e.fromType))].sort();
        const r = {
            nodes: i3xRag.nodeCount(), edges: i3xRag.edgeCount(),
            s1: i3xRag.search("Traffic Signal 12"), s2: i3xRag.search("Temprature", 100),
            s3: i3xRag.search("Brake_Pressure"),
            st: i3xRag.searchByType(types[0], "Signal", 100),
            sr: i3xRag.searchRelated("Status", 2, 10),
            tr: i3xRag.traverse(deviceUuid(2), 2), nb: i3xRag.neighborhood(leafOf(4)),
            nu: unsId ? i3xRag.neighborhood(unsId, 3) : null,
            fp: i3xRag.findPath(leafOf(4), deviceUuid(n - 1)),
            ct: i3xRag.compositionTree(deviceUuid(2)), ct1: i3xRag.compositionTree(deviceUuid(9), 1),
            rm: i3xRag.relationshipMap(), ts: types.map((t) => i3xRag.typeSchema(t)),
            vf: i3xRag.valueFilter({ missing: true }).length, sv: i3xRag.staleValues(0),
            gv: await i3xRag.getValues([deviceUuid(2), leafOf(4)]),
        };
        hashes.push([tag, crypto.createHash("sha256").update(JSON.stringify(r)).digest("hex").slice(0, 16)]);
    };
    await answer("initial");
    rename(3, "c1"); rename(4, "c2");
    await answer("renames");
    uns(2, ["Brakes", "Front", "Brake_Pressure"]);
    const unsId = uns(9, ["Brakes", "Rear", "Brake_Pressure"]);
    rename(5, "c3"); // an emission after the UNS nodes, so the old build rebuilds too
    await answer("uns", unsId);
    uuids = uuids.filter((u) => u !== deviceUuid(7));
    members.next(memberSet(uuids));
    await answer("remove", unsId);
    const d = device(n);
    config(C.DEVICE_INFORMATION_APP_UUID, d.uuid)
        .next({ schema: d.originMap.Schema_UUID, sparkplugName: d.name, originMap: d.originMap });
    config(C.INFO_APP_UUID, d.uuid).next(d.info);
    uuids = [...uuids, d.uuid];
    members.next(memberSet(uuids));
    await answer("add", unsId);
    const all = crypto.createHash("sha256").update(JSON.stringify(hashes)).digest("hex").slice(0, 16);
    console.log(JSON.stringify({ build: a.dist, devices: n, steps: hashes, all }));
}

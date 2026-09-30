/*
 * ACS i3X
 * Benchmark: the ConfigDB refresh pipeline under a bulk device import
 * Copyright 2026 University of Sheffield
 */

/*
 * Drives the real ObjectTreeRefresh, ObjectTree and I3xRag (from dist/)
 * with a simulated notify stream: N devices, each created with three
 * writes (create object, PUT Info, PUT DeviceInformation), paced at
 * --rate writes per second. Prints one JSON line of measurements.
 *
 *   npm run build
 *   node --expose-gc bench/refresh-burst.mjs --devices 2000 --rate 3
 *
 * Run it through bench/run.mjs to get repeated runs and medians.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { FakeConfigDB, mk_fplus } from "./fake-configdb.mjs";
import { device_gen } from "./device-gen.mjs";

const { values: args } = parseArgs({ options: {
    devices:    { type: "string", default: "2000" },
    rate:       { type: "string", default: "3" },
    timeout:    { type: "string", default: "7200" },
    /* Build output to test, relative to acs-i3x/. Point this at a copy
     * of an older build to compare two versions side by side. */
    dist:       { type: "string", default: "dist" },
    reference:  { type: "boolean", default: false },
} });

const dist = new URL(`../${args.dist}/lib/`, import.meta.url);
const { ObjectTree } = await import(new URL("object-tree.js", dist));
const { I3xRag } = await import(new URL("rag/i3x-rag.js", dist));
const { ObjectTreeRefresh } = await import(new URL("refresh.js", dist));
const { device_uuid, import_ops, info, seed_schemas } =
    device_gen(await import(new URL("constants.js", dist)));
const N = parseInt(args.devices);
const RATE = parseFloat(args.rate);
const TIMEOUT_MS = parseFloat(args.timeout) * 1000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

const value_cache = { getValue: () => null };
const history = {
    queryHistory: async () => [],
    getCurrentValue: async () => null,
    getCompositionValue: async () => null,
};

async function mk_stack (cdb) {
    const fplus = mk_fplus(cdb);
    const tree = await new ObjectTree({
        fplus, namespaceName: "Bench", namespaceUri: "urn:bench",
    }).init();
    const rag = new I3xRag(tree, value_cache, history);
    rag.init();
    return { fplus, tree, rag };
}

/* Stable fingerprint of the tree and index, for the correctness check. */
function fingerprint (tree, rag) {
    const objs = tree.getObjects()
        .map(o => `${o.elementId}|${o.displayName}|${o.parentId}|${o.typeElementId}|${o.isComposition}`)
        .sort();
    const types = tree.getObjectTypes()
        .map(t => `${t.elementId}|${t.displayName}`).sort();
    const hits = ["Device 7", "Latitude", "WC1", "Cyber", "Site_1"]
        .map(q => rag.search(q, Infinity)
            .map(r => `${r.elementId}:${r.score.toFixed(6)}`).sort());
    return createHash("sha256")
        .update(JSON.stringify({ objs, types, hits,
            nodes: rag.nodeCount(), edges: rag.edgeCount() }))
        .digest("hex");
}

/* Reference: the final state built from scratch in one pass, with no
 * pipeline. Runs in a child process so it does not count towards this
 * process's memory figures. */
async function reference () {
    const cdb = new FakeConfigDB();
    seed_schemas(cdb);
    for (let i = 0; i < N; i++) for (const op of import_ops(cdb, i)) op();
    const { tree, rag } = await mk_stack(cdb);
    return { fp: fingerprint(tree, rag), nodes: rag.nodeCount() };
}

async function main () {
    const ref = JSON.parse(execFileSync(process.execPath,
        [fileURLToPath(import.meta.url), "--reference",
            "--devices", `${N}`, "--dist", args.dist],
        { encoding: "utf8" }));

    const cdb = new FakeConfigDB();
    seed_schemas(cdb);
    const { fplus, tree, rag } = await mk_stack(cdb);

    /* Instrumentation. Wrapping methods on the instances/prototype
     * means the same script measures the code before and after the
     * fix without changes to lib/. */
    const m = {
        rebuilds: 0, rebuild_ms: 0, rebuild_max_ms: 0,
        pipeline_runs: 0, last_rebuild_end: 0, heap_peak: 0,
    };
    const sample_heap = () => {
        const h = process.memoryUsage().heapUsed;
        if (h > m.heap_peak) m.heap_peak = h;
    };
    const orig_rebuild = rag.rebuild.bind(rag);
    rag.rebuild = () => {
        const t = performance.now();
        orig_rebuild();
        const d = performance.now() - t;
        m.rebuilds++;
        m.rebuild_ms += d;
        m.rebuild_max_ms = Math.max(m.rebuild_max_ms, d);
        m.last_rebuild_end = performance.now();
        sample_heap();
    };
    const proto = ObjectTreeRefresh.prototype;
    const orig_collect = proto.collectAllSchemaUuids;
    proto.collectAllSchemaUuids = function (...a) {
        m.pipeline_runs++;
        return orig_collect.apply(this, a);
    };

    /* Start the pipeline and wait for its first snapshot. */
    const t_start = performance.now();
    new ObjectTreeRefresh({ fplus, objectTree: tree, i3xRag: rag }).run();
    while (m.rebuilds === 0) await sleep(1);
    const first_snapshot_ms = performance.now() - t_start;
    m.rebuilds = 0; m.rebuild_ms = 0; m.rebuild_max_ms = 0; m.pipeline_runs = 0;

    const heap_timer = setInterval(sample_heap, 50);
    global.gc?.();
    const heap_before = process.memoryUsage().heapUsed;

    /* The burst. Op k is due at t0 + k/RATE. If the event loop is
     * busy, overdue ops go out together when it frees up, and their
     * notify messages queue behind each other, as they would in a real
     * socket buffer. Lag is measured from when the last write was due,
     * not from when a busy event loop got round to sending it. */
    const ops = [];
    for (let i = 0; i < N; i++) ops.push(...import_ops(cdb, i));
    const cpu0 = process.cpuUsage();
    const t0 = performance.now();
    await new Promise(resolve => {
        let k = 0;
        const tick = () => {
            const now = performance.now() - t0;
            while (k < ops.length && k * 1000 / RATE <= now) ops[k++]();
            if (k >= ops.length) return resolve();
            setTimeout(tick, Math.max(0, k * 1000 / RATE - (performance.now() - t0)));
        };
        tick();
    });
    const writes_ms = (ops.length - 1) * 1000 / RATE;

    /* Settled: the index holds the final tree and the last device has
     * its final name. */
    const last = device_uuid(N - 1);
    const final_name = info(N - 1).name;
    const settled = () => rag.nodeCount() === ref.nodes
        && tree.getObject(last)?.displayName === final_name;
    while (!settled()) {
        if (performance.now() - t0 > TIMEOUT_MS) {
            console.log(JSON.stringify({ error: "timeout", devices: N, rate: RATE }));
            process.exit(2);
        }
        await sleep(20);
    }
    const settle_ms = m.last_rebuild_end - t0;
    const cpu = process.cpuUsage(cpu0);
    clearInterval(heap_timer);

    /* Nothing may still be pending: wait, then compare to reference. */
    const rebuilds_at_settle = m.rebuilds;
    await sleep(3000);
    const correct = fingerprint(tree, rag) === ref.fp;
    global.gc?.();
    const heap_after = process.memoryUsage().heapUsed;

    console.log(JSON.stringify({
        devices: N,
        rate: RATE,
        nodes: ref.nodes,
        correct,
        first_snapshot_ms: +first_snapshot_ms.toFixed(1),
        rebuilds: m.rebuilds,
        late_rebuilds: m.rebuilds - rebuilds_at_settle,
        pipeline_runs: m.pipeline_runs,
        rebuild_s: +(m.rebuild_ms / 1000).toFixed(2),
        rebuild_max_ms: +m.rebuild_max_ms.toFixed(1),
        cpu_s: +((cpu.user + cpu.system) / 1e6).toFixed(2),
        writes_s: +(writes_ms / 1000).toFixed(2),
        settle_s: +(settle_ms / 1000).toFixed(2),
        lag_after_last_write_s: +((settle_ms - writes_ms) / 1000).toFixed(2),
        heap_peak_mb: +(m.heap_peak / 2**20).toFixed(1),
        heap_before_mb: +(heap_before / 2**20).toFixed(1),
        heap_after_gc_mb: +(heap_after / 2**20).toFixed(1),
        max_rss_mb: +(process.resourceUsage().maxRSS / 1024).toFixed(1),
        deliveries: cdb.stats.deliveries,
        watches: cdb.stats.watches,
    }));
    process.exit(correct ? 0 : 1);
}

if (args.reference)
    console.log(JSON.stringify(await reference()));
else
    await main();

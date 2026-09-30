#!/usr/bin/env node
/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Run the real i3X HTTP routes (routes.js -> APIv1) from a compiled
 * dist directory, against a real InfluxDB, with the object tree built
 * from the synthetic fleet in dataset.mjs. Only Factory+ auth, ConfigDB
 * and MQTT are replaced: auth by a fixed principal, ConfigDB by
 * ObjectTree.refreshFromSnapshot(), and MQTT by feeding UNS messages
 * straight into ValueCache.onUnsMessage() when --warm is given.
 *
 *   node bench/server.mjs --dist ./dist --port 58100 --devices 2000 \
 *       --influx http://localhost:58086 --bucket default [--warm 1.0] \
 *       [--uns-time 2026-09-30T16:00:00.000Z]
 *
 * Extra endpoints for the benchmark driver:
 *   GET  /bench/stats  process CPU, Flux query count, event-loop delay
 *   POST /bench/reset  reset the event-loop delay histogram
 */

import express from "express";
import path from "node:path";
import { parseArgs } from "node:util";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { device, pipelineSnapshot } from "./dataset.mjs";

const { values: a } = parseArgs({
    options: {
        dist: { type: "string", default: "./dist" },
        port: { type: "string", default: "58100" },
        devices: { type: "string", default: "2000" },
        influx: { type: "string", default: "http://localhost:58086" },
        token: { type: "string", default: "bench-token" },
        org: { type: "string", default: "default" },
        bucket: { type: "string", default: "default" },
        warm: { type: "string", default: "0" },
        /* Timestamp for warm UNS values. Give two servers the same one
         * when comparing their responses. */
        "uns-time": { type: "string" },
        /* History bulk tuning (new build only; the old build ignores them). */
        chunk: { type: "string" },
        concurrency: { type: "string" },
    },
});

const dist = path.resolve(a.dist);
const load = (m) => import(pathToFileURL(path.join(dist, "lib", m)).href);
const { ObjectTree } = await load("object-tree.js");
const { ValueCache } = await load("value-cache.js");
const { History } = await load("history.js");
const { SubscriptionManager } = await load("subscriptions.js");
const { routes } = await load("routes.js");

/* Match production: the service-client Debug logger with VERBOSE unset
 * prints nothing. The old code's [VALUE] lines use console.log
 * directly and still print. */
const fplus = { debug: { bound: () => () => {} } };
const n = Number(a.devices);

const objectTree = new ObjectTree({ fplus, namespaceName: "AMRC", namespaceUri: "https://example.com/i3x" });
objectTree.buildNamespace();
objectTree.buildRelationshipTypes();
objectTree.refreshFromSnapshot(pipelineSnapshot(n));
objectTree.ready = true;

const valueCache = new ValueCache({ objectTree, staleThreshold: 300000 });

/* Warm the UNS cache for the first `warm` fraction of devices, the way
 * MQTT would, with values newer than anything in InfluxDB. */
const warmCount = Math.round(Number(a.warm) * n);
const unsNow = a["uns-time"] ?? new Date().toISOString();
for (let i = 0; i < warmCount; i++) {
    const d = device(i);
    for (const [key, val] of Object.entries(d.originMap)) {
        if (val?.Sparkplug_Type) publish(d, [key], [d.uuid]);
        else if (val && typeof val === "object" && val.Instance_UUID && key !== "Address") {
            for (const [m, mv] of Object.entries(val)) {
                if (mv?.Sparkplug_Type) publish(d, [key, m], [d.uuid, val.Instance_UUID]);
            }
        }
    }
}
function publish(d, segments, instancePath) {
    const topic = `UNS/v1/AMRC/Bristol/Central/Signals/Edge/${d.name.replace(/ /g, "_")}/${segments.join("/")}`;
    const payload = Buffer.from(JSON.stringify({ timestamp: unsNow, value: `uns-${d.i}-${segments.join(".")}` }));
    valueCache.onUnsMessage(topic, payload, {
        properties: { userProperties: { InstanceUUIDPath: instancePath.join(":"), SchemaUUIDPath: "" } },
    });
}

const history = new History({
    influxUrl: a.influx, influxToken: a.token, influxOrg: a.org, influxBucket: a.bucket, objectTree,
    bulkChunkSize: a.chunk ? Number(a.chunk) : undefined,
    bulkConcurrency: a.concurrency ? Number(a.concurrency) : undefined,
});

/* Count every Flux query the service issues. Old and new code both
 * go through QueryApi.collectRows. */
let queries = 0;
const qa = history.queryApi;
const collect = qa.collectRows.bind(qa);
qa.collectRows = (...args) => { queries++; return collect(...args); };

const subscriptions = new SubscriptionManager({ valueCache, ttl: 300000 });

const eld = monitorEventLoopDelay({ resolution: 10 });
eld.enable();

const app = express();
app.get("/bench/stats", (_req, res) => {
    res.json({
        cpu: process.cpuUsage(),
        queries,
        eldMaxMs: eld.max / 1e6,
        eldP99Ms: eld.percentile(99) / 1e6,
        rssMB: process.memoryUsage().rss / 1e6,
    });
});
app.post("/bench/reset", (_req, res) => { eld.reset(); res.json({ ok: true }); });
/* Same body parsing as WebAPI (service-api: 100kb limit). */
app.use(express.json({ limit: "100kb", strict: false }));
app.use((req, _res, next) => { req.auth = "bench@REALM"; next(); });
routes({ objectTree, valueCache, history, subscriptions })(app);

app.listen(Number(a.port), () => {
    console.error(`bench server on :${a.port} dist=${dist} devices=${n} warm=${warmCount} objects=${objectTree.getObjects().length}`);
});

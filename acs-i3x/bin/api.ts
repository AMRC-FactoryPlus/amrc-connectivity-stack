#!/usr/bin/env node
/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { UUIDs } from "@amrc-factoryplus/service-client";
import { RxClient } from "@amrc-factoryplus/rx-client";
import { WebAPI } from "@amrc-factoryplus/service-api";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { routes } from "../lib/routes.js";
import { ObjectTree } from "../lib/object-tree.js";
import { ValueCache } from "../lib/value-cache.js";
import { History } from "../lib/history.js";
import { SubscriptionManager } from "../lib/subscriptions.js";
import { I3xRag } from "../lib/rag/i3x-rag.js";
import { registerRagTools } from "../lib/mcp/tools.js";
import { Version } from "../lib/constants.js";
import { GIT_VERSION } from "../lib/git-version.js";

import { I3xStore } from "../lib/store.js";
import { ConfigSync, configSyncFeeds } from "../lib/sync.js";

const { env } = process;

/** A positive integer setting, or `dflt` if unset or not one. */
function positiveInt(name: string, dflt: number): number {
    const v = env[name];
    if (v === undefined || v === "") return dflt;
    const n = Number(v);
    if (Number.isInteger(n) && n > 0) return n;
    console.warn(`Ignoring ${name}=${v}: not a positive integer, using ${dflt}`);
    return dflt;
}

// Init Factory+ service client (RxClient adds notify-v2 Observables on ConfigDB)
const fplus = await new RxClient({ env }).init();

const namespaceName = env.I3X_NAMESPACE_NAME || "Default";
const namespaceUri = env.I3X_NAMESPACE_URI || "https://example.com";

// The namespace and last values live in SQLite, not on the heap. The
// database is a cache of ConfigDB: a new namespace starts it afresh.
const store = new I3xStore({
    path: env.I3X_DB_PATH || "/data/i3x.db",
    cacheMb: positiveInt("I3X_DB_CACHE_MB", 64),
    fingerprint: JSON.stringify([namespaceName, namespaceUri]),
    log: fplus.debug.bound("store"),
});

// The object tree. ConfigSync (below) fills it from ConfigDB.
const objectTree = await new ObjectTree({
    fplus,
    namespaceName,
    namespaceUri,
    store,
}).init();

// The value cache. Last values go to the same database, in batches.
const valueCache = new ValueCache({
    objectTree,
    store,
    staleThreshold: parseInt(env.I3X_STALE_THRESHOLD || "300000"),
    // After a restart or MQTT reconnect, stored values are caught up
    // from InfluxDB rather than cleared, unless the gap is too long.
    catchUpMargin: positiveInt("I3X_CATCHUP_MARGIN_MS", 60_000),
    catchUpMaxGap: positiveInt("I3X_CATCHUP_MAX_GAP_MS", 24 * 3600_000),
    // Values kept from InfluxDB are refreshed the same way while
    // connected: their devices may not publish to the UNS.
    refreshInterval: positiveInt("I3X_INFLUX_REFRESH_MS", 300_000),
});

// History module (InfluxDB)
const history = new History({
    influxUrl: env.INFLUX_URL || "http://localhost:8086",
    influxToken: env.INFLUX_TOKEN || "",
    influxOrg: env.INFLUX_ORG || "default",
    influxBucket: env.INFLUX_BUCKET || "default",
    objectTree,
    // Flux queries in flight across the whole process.
    influxConcurrency: positiveInt("I3X_INFLUX_CONCURRENCY", 4),
    // Current values read from InfluxDB are kept for the next read.
    valueCache,
});

// Subscribe to UNS/v1/#, catching up stored values from InfluxDB.
await valueCache.init(fplus, history);

// Subscription manager
const subscriptions = new SubscriptionManager({
    valueCache,
    ttl: parseInt(env.I3X_SUBSCRIPTION_TTL || "300000"),
    maxQueue: positiveInt("I3X_SUBSCRIPTION_QUEUE_MAX", 10_000),
});

// The MCP endpoint and its RAG index (a graph and a search index of
// the whole tree, about 47 KB of heap per device) are opt-in. When
// off, nothing is built and /mcp answers 404.
let mcpServer: McpServer | undefined;
if (env.I3X_MCP_ENABLED === "true") {
    // Built on the first MCP query, and again on the first query
    // after any change to the tree.
    const i3xRag = new I3xRag(objectTree, valueCache, history);
    objectTree.onChange(() => i3xRag.markDirty());

    mcpServer = new McpServer({ name: "acs-i3x-rag", version: "1.0.0" });
    registerRagTools(mcpServer, i3xRag);
}

const api = await new WebAPI({
    ping: {
        version: Version,
        service: UUIDs.Service.i3x,
        software: {
            vendor: "AMRC",
            application: "acs-i3x",
            revision: GIT_VERSION,
        },
    },
    debug: fplus.debug,
    realm: env.REALM,
    hostname: env.HOSTNAME,
    keytab: env.SERVER_KEYTAB,
    http_port: env.PORT,
    public: "/v1/info",
    routes: routes({
        objectTree,
        valueCache,
        history,
        subscriptions,
        mcpServer,
        maxDepthCap: parseInt(env.I3X_MAX_DEPTH_CAP || "0"),
        debug: fplus.debug,
    }),
}).init();

api.run();

// Keep the tree in step with ConfigDB. The API answers 503 until the
// first sync completes, or at once with a database from an earlier run.
new ConfigSync({
    objectTree,
    store,
    ...configSyncFeeds(fplus),
    valueCache,
    concurrency: positiveInt("I3X_SYNC_CONCURRENCY", 16),
    readyGrace: positiveInt("I3X_READY_GRACE_MS", 120_000),
    log: fplus.debug.bound("sync"),
}).run();
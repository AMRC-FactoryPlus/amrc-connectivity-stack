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

import { ObjectTreeRefresh } from "../lib/refresh.js";

const { env } = process;

// Init Factory+ service client (RxClient adds notify-v2 Observables on ConfigDB)
const fplus = await new RxClient({ env }).init();

// Build object tree from ConfigDB + Directory
const objectTree = await new ObjectTree({
    fplus,
    namespaceName: env.I3X_NAMESPACE_NAME || "Default",
    namespaceUri: env.I3X_NAMESPACE_URI || "https://example.com"
}).init();

// Start value cache (subscribes to UNS/v1/#)
const valueCache = await new ValueCache({
    objectTree,
    staleThreshold: parseInt(env.I3X_STALE_THRESHOLD || "300000")
}).init(fplus);

// History module (InfluxDB)
const history = new History({
    influxUrl: env.INFLUX_URL || "http://localhost:8086",
    influxToken: env.INFLUX_TOKEN || "",
    influxOrg: env.INFLUX_ORG || "default",
    influxBucket: env.INFLUX_BUCKET || "default",
    objectTree,
});

// Subscription manager
const subscriptions = new SubscriptionManager({
    valueCache,
    ttl: parseInt(env.I3X_SUBSCRIPTION_TTL || "300000"),
});

// Build RAG engine (graph + search index)
const i3xRag = new I3xRag(objectTree, valueCache, history);
i3xRag.init();

// MCP server
const mcpServer = new McpServer({ name: "acs-i3x-rag", version: "1.0.0" });
registerRagTools(mcpServer, i3xRag);

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
    }),
}).init();

api.run();
new ObjectTreeRefresh({fplus, objectTree, i3xRag}).run()
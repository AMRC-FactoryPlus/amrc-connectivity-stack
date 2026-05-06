/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { UUIDs } from "@amrc-factoryplus/service-client";
import { RxClient } from "@amrc-factoryplus/rx-client";
import { WebAPI } from "@amrc-factoryplus/service-api";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as rx from "rxjs";
import { routes } from "../lib/routes.js";
import { ObjectTree } from "../lib/object-tree.js";
import { ValueCache } from "../lib/value-cache.js";
import { History } from "../lib/history.js";
import { SubscriptionManager } from "../lib/subscriptions.js";
import { I3xRag } from "../lib/rag/i3x-rag.js";
import { registerRagTools } from "../lib/mcp/tools.js";
import {
    Version,
    DEVICE_CLASS_UUID,
    CONFIG_SCHEMA_APP_UUID,
    INFO_APP_UUID,
    DEVICE_INFORMATION_APP_UUID,
} from "../lib/constants.js";
import { GIT_VERSION } from "../lib/git-version.js";
import pino from "pino";

let dotenv: any = null;
try { dotenv = await import("dotenv"); } catch (e) {}
dotenv?.config();

const { env } = process;
const logger = pino({ name: "acs-i3x", level: env.LOG_LEVEL || "info" });

logger.info("Starting acs-i3x service...");
logger.debug({ directoryUrl: env.DIRECTORY_URL, realm: env.REALM, user: env.SERVICE_USERNAME }, "Configuration");

// Init Factory+ service client (RxClient adds notify-v2 Observables on ConfigDB)
logger.debug("Initialising RxClient...");
const fplus = await new RxClient({ env }).init();
logger.debug("RxClient initialised");

// Build object tree from ConfigDB + Directory
logger.debug("Building object tree from ConfigDB + Directory...");
const objectTree = await new ObjectTree({
    fplus,
    namespaceName: env.I3X_NAMESPACE_NAME || "Default",
    namespaceUri: env.I3X_NAMESPACE_URI || "https://example.com",
    logger,
}).init();
logger.debug("Object tree built");

// Start value cache (subscribes to UNS/v1/#)
logger.debug("Starting value cache (subscribing to UNS/v1/#)...");
const valueCache = await new ValueCache({
    objectTree,
    staleThreshold: parseInt(env.I3X_STALE_THRESHOLD || "300000"),
    logger,
}).init(fplus);
logger.debug("Value cache started");

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
logger.debug("Building RAG engine...");
const i3xRag = new I3xRag(objectTree, valueCache, history);
i3xRag.init();
logger.debug({ nodes: i3xRag.nodeCount(), edges: i3xRag.edgeCount() }, "RAG engine built");

// MCP server
const mcpServer = new McpServer({ name: "acs-i3x-rag", version: "1.0.0" });
registerRagTools(mcpServer, i3xRag);
logger.info("MCP server registered with 13 RAG tools");

// Start HTTP server via WebAPI
// In dev mode, make all paths public (no Kerberos keytab needed)
const devNoAuth = env.DEV_NO_AUTH === "true";
if (devNoAuth) {
    logger.warn("DEV_NO_AUTH is set — all endpoints are unauthenticated. Do not use in production.");
}

const api = await new WebAPI({
    ping: {
        version: Version,
        service: UUIDs.Service.Registry,
        device: env.DEVICE_UUID,
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
    http_port: env.PORT || 8080,
    public: devNoAuth ? "(.*)" : "/v1/info",
    routes: routes({
        objectTree,
        valueCache,
        history,
        subscriptions,
        mcpServer,
        logger,
    }),
}).init();

api.run();
logger.info(`acs-i3x server running on port ${env.PORT || 8080}`);

// A `dirty` flag coalesces events that arrive during an in-flight refresh, so a
// burst of changes collapses into at most two rebuilds (leading + trailing).
const cdb = fplus.ConfigDB;
const trigger$ = rx.merge(
    cdb.watch_members(DEVICE_CLASS_UUID),
    cdb.search_app(DEVICE_INFORMATION_APP_UUID, {}),
    cdb.search_app(INFO_APP_UUID, {}),
    cdb.search_app(CONFIG_SCHEMA_APP_UUID, {}),
);
let inFlight = false;
let dirty = false;
const runRefresh = async () => {
    inFlight = true;
    try {
        do {
            dirty = false;
            await objectTree.refresh();
            i3xRag.rebuild();
            logger.debug({ nodes: i3xRag.nodeCount() },
                "Object tree refreshed via ConfigDB notify");
        } while (dirty);
    } catch (err) {
        logger.error({ err }, "Failed to refresh object tree");
    } finally {
        inFlight = false;
    }
};
trigger$.subscribe({
    next: () => {
        if (inFlight) { dirty = true; return; }
        void runRefresh();},
    error: (err: unknown) => logger.error({ err }, "ConfigDB notify stream errored"),
});
logger.info("Object tree refresh: ConfigDB notify subscriptions active");


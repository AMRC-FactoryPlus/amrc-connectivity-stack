import { ServiceClient, UUIDs } from "@amrc-factoryplus/service-client";
import { WebAPI } from "@amrc-factoryplus/service-api";
import { routes } from "../src/routes.js";
import { ObjectTree } from "../src/object-tree.js";
import { ValueCache } from "../src/value-cache.js";
import { History } from "../src/history.js";
import { SubscriptionManager } from "../src/subscriptions.js";
import { Version } from "../src/constants.js";
import { GIT_VERSION } from "../src/git-version.js";
import pino from "pino";

let dotenv: any = null;
try { dotenv = await import("dotenv"); } catch (e) {}
dotenv?.config();

const { env } = process;
const logger = pino({ name: "acs-i3x", level: env.LOG_LEVEL || "info" });

logger.info("Starting acs-i3x service...");
logger.debug({ directoryUrl: env.DIRECTORY_URL, realm: env.REALM, user: env.SERVICE_USERNAME }, "Configuration");

// Init Factory+ service client
logger.debug("Initialising ServiceClient...");
const fplus = await new ServiceClient({ env }).init();
logger.debug("ServiceClient initialised");

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
        namespaceName: env.I3X_NAMESPACE_NAME || "Default",
        namespaceUri: env.I3X_NAMESPACE_URI || "https://example.com",
    }),
}).init();

api.run();
logger.info(`acs-i3x server running on port ${env.PORT || 8080}`);

// Re-poll ConfigDB/Directory periodically
const pollInterval = parseInt(env.I3X_POLL_INTERVAL || "60000");
setInterval(() => {
    objectTree.refresh().catch(err => {
        logger.error({ err }, "Failed to refresh object tree");
    });
}, pollInterval);

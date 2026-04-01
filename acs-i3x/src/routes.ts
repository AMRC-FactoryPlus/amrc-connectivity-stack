import compression from "compression";
import { APIv1 } from "./api-v1.js";
import type { ObjectTree } from "./object-tree.js";
import type { ValueCache } from "./value-cache.js";
import type { History } from "./history.js";
import type { SubscriptionManager } from "./subscriptions.js";

export function routes(opts: {
    objectTree: ObjectTree;
    valueCache: ValueCache;
    history: History;
    subscriptions: SubscriptionManager;
    namespaceName: string;
    namespaceUri: string;
}) {
    const api = new APIv1(opts);

    return (app: any) => {
        // Gzip compression (MUST per i3X spec)
        // Skip compression for SSE streams — compression buffers chunks
        // which prevents real-time delivery.
        app.use(compression({
            filter: (req: any, res: any) => {
                if (req.path === "/v1/subscriptions/stream") return false;
                return compression.filter(req, res);
            },
        }));

        // Mount info endpoint (unauthenticated — goes through WebAPI's
        // public path pattern, see bin/api.ts `public: "/v1/info"`)
        app.use("/v1", api.infoRoute);

        // Mount all other i3X endpoints (authenticated)
        app.use("/v1", api.routes);
    };
}

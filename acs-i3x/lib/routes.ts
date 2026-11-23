import compression from "compression";
import { APIv1 } from "./api-v1.js";
import type { AccessLike } from "./api-v1.js";
import type { ObjectTree } from "./object-tree.js";
import type { ValueCache } from "./value-cache.js";
import type { History } from "./history.js";
import type { SubscriptionManager } from "./subscriptions.js";

/** True for a Content-Type of text/event-stream, with or without
 * parameters. */
export function isEventStream(type: unknown): boolean {
    return typeof type === "string"
        && type.split(";")[0].trim().toLowerCase() === "text/event-stream";
}

export function routes(opts: {
    objectTree: ObjectTree;
    access: AccessLike;
    valueCache: ValueCache;
    history: History;
    subscriptions: SubscriptionManager;
    maxDepthCap?: number;
    debug?: any;
}) {
    const api = new APIv1(opts);

    return (app: any) => {
        // Gzip compression (MUST per i3X spec), except for SSE streams.
        // A compressed stream sends each event through a zlib stream,
        // which takes one write per turn of the event loop. While other
        // requests keep the loop busy that is a few dozen events a
        // second, and the rest queue in memory until the loop is idle:
        // live values stop for as long as the other work lasts.
        //
        // The filter runs when the headers are written, inside the
        // router mounted on /v1, where req.path no longer starts with
        // /v1. So it goes by the response's content type, which the
        // stream sets before it writes anything.
        app.use(compression({
            filter: (req: any, res: any) => {
                if (isEventStream(res.getHeader("Content-Type"))) return false;
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

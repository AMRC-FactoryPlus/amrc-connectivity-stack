/*
 * APIv1 — Express router for all i3X v1 endpoints.
 *
 * Wires ObjectTree, ValueCache, History, and SubscriptionManager
 * together behind HTTP endpoints with the i3X envelope middleware.
 */

import { Router } from "express";
import type { Request, Response, NextFunction } from "express";

import { I3X_SPEC_VERSION, Version } from "./constants.js";
import { i3xEnvelope, i3xErrorHandler } from "./middleware/envelope.js";
import type { ObjectTree } from "./object-tree.js";
import type { ValueCache } from "./value-cache.js";
import type { History } from "./history.js";
import type { SubscriptionManager } from "./subscriptions.js";

interface APIv1Opts {
    objectTree: ObjectTree;
    valueCache: ValueCache;
    history: History;
    subscriptions: SubscriptionManager;
    namespaceName: string;
    namespaceUri: string;
}

/**
 * Wraps an async route handler so that thrown errors are forwarded to
 * the Express error-handling middleware via next(err).
 */
function asyncHandler(
    fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
    return (req: Request, res: Response, next: NextFunction) => {
        fn(req, res, next).catch(next);
    };
}

/**
 * Creates an HTTP 404 error with a status property.
 */
function notFound(message: string): Error & { status: number } {
    const err = new Error(message) as Error & { status: number };
    err.status = 404;
    return err;
}

/**
 * Creates an HTTP 400 error with a status property.
 */
function badRequest(message: string): Error & { status: number } {
    const err = new Error(message) as Error & { status: number };
    err.status = 400;
    return err;
}

export class APIv1 {
    public routes: Router;
    public infoRoute: Router;

    constructor(opts: APIv1Opts) {
        const { objectTree, valueCache, history, subscriptions } = opts;

        /* ---- /info router (unauthenticated) ---- */

        this.infoRoute = Router();
        this.infoRoute.get("/info", (_req: Request, res: Response) => {
            res.json({
                specVersion: I3X_SPEC_VERSION,
                serverName: "AMRC Connectivity Stack",
                serverVersion: Version,
                capabilities: {
                    query: { history: true },
                    update: { current: false, history: false },
                    subscribe: { stream: true },
                },
            });
        });
        /* ---- Main router (authenticated) ---- */

        this.routes = Router();
        this.routes.use(i3xEnvelope);

        /* Readiness check middleware */
        this.routes.use((req: Request, res: Response, next: NextFunction) => {
            if (!objectTree.isReady()) {
                const err = new Error("Service not ready") as any;
                err.status = 503;
                return next(err);
            }
            next();
        });

        /* ---- Explore: Namespaces ---- */

        this.routes.get("/namespaces", (_req: Request, res: Response) => {
            res.json(objectTree.getNamespaces());
        });

        /* ---- Explore: Object Types ---- */

        this.routes.get("/objecttypes", (req: Request, res: Response) => {
            const ns = req.query.namespaceUri as string | undefined;
            res.json(objectTree.getObjectTypes(ns));
        });

        this.routes.get("/objecttypes/:elementId", (req: Request, res: Response, next: NextFunction) => {
            const result = objectTree.getObjectType(req.params.elementId);
            if (!result) return next(notFound(`Object type ${req.params.elementId} not found`));
            res.json(result);
        });

        this.routes.post("/objecttypes/query", (req: Request, res: Response) => {
            const { elementIds } = req.body;
            const results = (elementIds as string[]).map(id => {
                const item = objectTree.getObjectType(id);
                if (item) {
                    return { success: true, elementId: id, result: item };
                }
                return { success: false, elementId: id, error: { message: `Object type ${id} not found` } };
            });
            const allSuccess = results.every(r => r.success);
            ((res as any)._originalJson || res.json.bind(res))({ success: allSuccess, results });
        });

        /* ---- Explore: Relationship Types ---- */

        this.routes.get("/relationshiptypes", (req: Request, res: Response) => {
            const ns = req.query.namespaceUri as string | undefined;
            res.json(objectTree.getRelationshipTypes(ns));
        });

        this.routes.get("/relationshiptypes/:elementId", (req: Request, res: Response, next: NextFunction) => {
            const result = objectTree.getRelationshipType(req.params.elementId);
            if (!result) return next(notFound(`Relationship type ${req.params.elementId} not found`));
            res.json(result);
        });

        this.routes.post("/relationshiptypes/query", (req: Request, res: Response) => {
            const { elementIds } = req.body;
            const results = (elementIds as string[]).map(id => {
                const item = objectTree.getRelationshipType(id);
                if (item) {
                    return { success: true, elementId: id, result: item };
                }
                return { success: false, elementId: id, error: { message: `Relationship type ${id} not found` } };
            });
            const allSuccess = results.every(r => r.success);
            ((res as any)._originalJson || res.json.bind(res))({ success: allSuccess, results });
        });

        /* ---- Explore: Objects ---- */

        this.routes.get("/objects", (req: Request, res: Response) => {
            res.json(objectTree.getObjects({
                typeElementId: req.query.typeElementId as string | undefined,
                root: req.query.root === "true",
                includeMetadata: req.query.includeMetadata === "true",
            }));
        });

        /* Value and history sub-routes must be declared before the
         * /:elementId catch-all to avoid path conflicts. */

        this.routes.post("/objects/list", (req: Request, res: Response) => {
            const { elementIds, includeMetadata } = req.body;
            const results = (elementIds as string[]).map(id => {
                const item = objectTree.getObject(id);
                if (item) {
                    return { success: true, elementId: id, result: item };
                }
                return { success: false, elementId: id, error: { message: `Object ${id} not found` } };
            });
            const allSuccess = results.every(r => r.success);
            ((res as any)._originalJson || res.json.bind(res))({ success: allSuccess, results });
        });

        this.routes.post("/objects/value", asyncHandler(async (req: Request, res: Response) => {
            const { elementIds, maxDepth } = req.body;
            const results = await Promise.all((elementIds as string[]).map(async (id) => {
                // Try UNS cache first (real-time), fall back to InfluxDB last()
                const cached = valueCache.getValue(id);
                if (cached) {
                    console.log(`[VALUE] ${id.slice(0,16)} → UNS cache hit: value=${JSON.stringify(cached.value)} age=${Date.now() - new Date(cached.timestamp).getTime()}ms`);
                    return { success: true, elementId: id, result: cached };
                }
                console.log(`[VALUE] ${id.slice(0,16)} → UNS cache miss, querying InfluxDB...`);
                const obj = objectTree.getObject(id);
                const item = obj?.isComposition
                    ? await history.getCompositionValue(id, maxDepth ?? 1)
                    : await history.getCurrentValue(id);
                if (item) {
                    console.log(`[VALUE] ${id.slice(0,16)} → InfluxDB hit: value=${JSON.stringify(item.value)} ts=${item.timestamp}`);
                    return { success: true, elementId: id, result: item };
                }
                console.log(`[VALUE] ${id.slice(0,16)} → no data`);
                return { success: false, elementId: id, error: { message: `No value for ${id}` } };
            }));
            const allSuccess = results.every(r => r.success);
            ((res as any)._originalJson || res.json.bind(res))({ success: allSuccess, results });
        }));

        this.routes.post("/objects/history", asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
            const { elementIds, startTime, endTime, maxDepth } = req.body;
            if (!startTime || !endTime) {
                return next(badRequest("startTime and endTime are required"));
            }
            const results = await Promise.all(
                (elementIds as string[]).map(async id => {
                    try {
                        const values = await history.queryHistory(id, startTime, endTime, maxDepth);
                        return { success: true, elementId: id, result: { elementId: id, values } };
                    } catch (err: any) {
                        return { success: false, elementId: id, error: { message: err.message } };
                    }
                }),
            );
            const allSuccess = results.every(r => r.success);
            ((res as any)._originalJson || res.json.bind(res))({ success: allSuccess, results });
        }));

        this.routes.post("/objects/related", (req: Request, res: Response) => {
            const { elementIds, relationshiptype } = req.body;
            const results = (elementIds as string[]).map(id => {
                const obj = objectTree.getObject(id);
                if (!obj) {
                    return { success: false, elementId: id, error: { message: `Object ${id} not found` } };
                }
                const related = objectTree.getRelated(id, relationshiptype);
                return { success: true, elementId: id, result: related };
            });
            const allSuccess = results.every(r => r.success);
            ((res as any)._originalJson || res.json.bind(res))({ success: allSuccess, results });
        });

        this.routes.get("/objects/:elementId/value", asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
            const id = req.params.elementId;
            const obj = objectTree.getObject(id);
            // Try UNS cache first (real-time), fall back to InfluxDB last()
            const cached = valueCache.getValue(id);
            if (cached) {
                console.log(`[VALUE] ${id} → UNS cache hit: value=${JSON.stringify(cached.value)} ts=${cached.timestamp} age=${Date.now() - new Date(cached.timestamp).getTime()}ms`);
                res.json(cached);
                return;
            }
            console.log(`[VALUE] ${id} → UNS cache miss, querying InfluxDB...`);
            const result = obj?.isComposition
                ? await history.getCompositionValue(id)
                : await history.getCurrentValue(id);
            if (result) {
                console.log(`[VALUE] ${id} → InfluxDB hit: value=${JSON.stringify(result.value)} ts=${result.timestamp}`);
            } else {
                console.log(`[VALUE] ${id} → InfluxDB miss: no data`);
            }
            if (!result) return next(notFound(`No value for ${id}`));
            res.json(result);
        }));

        this.routes.get("/objects/:elementId/history", asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
            const { startTime, endTime } = req.query as { startTime?: string; endTime?: string };
            if (!startTime || !endTime) {
                return next(badRequest("startTime and endTime query parameters are required"));
            }
            const values = await history.queryHistory(req.params.elementId, startTime, endTime);
            res.json({ elementId: req.params.elementId, values });
        }));

        this.routes.get("/objects/:elementId/related", (req: Request, res: Response, next: NextFunction) => {
            const obj = objectTree.getObject(req.params.elementId);
            if (!obj) return next(notFound(`Object ${req.params.elementId} not found`));
            const rt = req.query.relationshiptype as string | undefined;
            res.json(objectTree.getRelated(req.params.elementId, rt));
        });

        this.routes.get("/objects/:elementId", (req: Request, res: Response, next: NextFunction) => {
            const result = objectTree.getObject(req.params.elementId);
            if (!result) return next(notFound(`Object ${req.params.elementId} not found`));
            res.json(result);
        });

        /* ---- Subscriptions ---- */

        this.routes.post("/subscriptions/list", (req: Request, res: Response) => {
            const { clientId, subscriptionIds } = req.body;
            res.json(subscriptions.list(clientId, subscriptionIds));
        });

        this.routes.post("/subscriptions/delete", (req: Request, res: Response) => {
            const { clientId, subscriptionIds } = req.body;
            subscriptions.delete(clientId, subscriptionIds);
            res.json({ deleted: subscriptionIds });
        });

        this.routes.post("/subscriptions/register", (req: Request, res: Response) => {
            const { clientId, subscriptionId, elementIds, maxDepth } = req.body;
            subscriptions.register(clientId, subscriptionId, elementIds, maxDepth);
            res.json({ registered: elementIds });
        });

        this.routes.post("/subscriptions/unregister", (req: Request, res: Response) => {
            const { clientId, subscriptionId, elementIds } = req.body;
            subscriptions.unregister(clientId, subscriptionId, elementIds);
            res.json({ unregistered: elementIds });
        });

        this.routes.post("/subscriptions/stream", asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
            const { clientId, subscriptionId } = req.body;
            /* The subscription manager takes over the response for SSE.
             * Do NOT call res.json — the manager handles the response directly. */
            subscriptions.stream(clientId, subscriptionId, res);
        }));

        this.routes.post("/subscriptions/sync", (req: Request, res: Response) => {
            const { clientId, subscriptionId, lastSequenceNumber } = req.body;
            res.json(subscriptions.sync(clientId, subscriptionId, lastSequenceNumber));
        });

        this.routes.post("/subscriptions", (req: Request, res: Response) => {
            const { clientId, displayName } = req.body;
            res.json(subscriptions.create(clientId, displayName));
        });

        /* ---- Error handler (must be last) ---- */

        this.routes.use(i3xErrorHandler);
    }
}

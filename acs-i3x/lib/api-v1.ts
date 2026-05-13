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
import validator from 'validator';

interface APIv1Opts {
    objectTree: ObjectTree;
    valueCache: ValueCache;
    history: History;
    subscriptions: SubscriptionManager;
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

    private objectTree: ObjectTree;
    private valueCache: ValueCache;
    private history: History;
    private subscriptions: SubscriptionManager;

    /**
     * Stores the collaborator services and builds both routers.
     **/
    constructor(opts: APIv1Opts) {
        this.objectTree = opts.objectTree;
        this.valueCache = opts.valueCache;
        this.history = opts.history;
        this.subscriptions = opts.subscriptions;

        this.routes = Router();
        this.infoRoute = Router();

        this.setup_routes();
    }

    /**
     * Builds the unauthenticated /info router and the authenticated
     * main router. The main router applies the i3X envelope, gates
     * requests on object-tree readiness, mounts every endpoint, and
     * terminates with the i3X error handler.
     */
    setup_routes() {
        /* ---- /info router (unauthenticated) ---- */

        this.infoRoute.get("/info", this.get_info.bind(this));

        /* ---- Main router (authenticated) ---- */

        const api = this.routes;
        api.use(i3xEnvelope);
        api.use(this.check_ready.bind(this));

        /* ---- Explore: Namespaces ---- */
        api.get("/namespaces", this.get_namespaces.bind(this));

        /* ---- Explore: Object Types ---- */
        api.get("/objecttypes", this.get_object_types.bind(this));
        api.get("/objecttypes/:elementId", this.get_object_type.bind(this));
        api.post("/objecttypes/query", this.query_object_types.bind(this));

        /* ---- Explore: Relationship Types ---- */
        api.get("/relationshiptypes", this.get_relationship_types.bind(this));
        api.get("/relationshiptypes/:elementId", this.get_relationship_type.bind(this));
        api.post("/relationshiptypes/query", this.query_relationship_types.bind(this));

        /* ---- Explore: Objects ---- */
        api.get("/objects", this.get_objects.bind(this));

        /* Value and history sub-routes must be declared before the
         * /:elementId catch-all to avoid path conflicts. */
        api.post("/objects/list", this.list_objects.bind(this));
        api.post("/objects/value", asyncHandler(this.value_objects.bind(this)));
        api.post("/objects/history", asyncHandler(this.history_objects.bind(this)));
        api.post("/objects/related", this.related_objects.bind(this));

        api.get("/objects/:elementId/value", asyncHandler(this.get_object_value.bind(this)));
        api.get("/objects/:elementId/history", asyncHandler(this.get_object_history.bind(this)));
        api.get("/objects/:elementId/related", this.get_object_related.bind(this));
        api.get("/objects/:elementId", this.get_object.bind(this));

        /* ---- Subscriptions ---- */
        api.post("/subscriptions/list", this.list_subscriptions.bind(this));
        api.post("/subscriptions/delete", this.delete_subscriptions.bind(this));
        api.post("/subscriptions/register", this.register_subscriptions.bind(this));
        api.post("/subscriptions/unregister", this.unregister_subscriptions.bind(this));
        api.post("/subscriptions/stream", asyncHandler(this.stream_subscription.bind(this)));
        api.post("/subscriptions/sync", this.sync_subscription.bind(this));
        api.post("/subscriptions", this.create_subscription.bind(this));

        /* ---- Error handler (must be last) ---- */
        api.use(i3xErrorHandler);
    }

    /**
     * Middleware that returns 503 until the object tree finishes its initial sync.
     **/
    check_ready(req: Request, res: Response, next: NextFunction): void {
        if (!this.objectTree.isReady()) {
            const err = new Error("Service not ready") as any;
            err.status = 503;
            return next(err);
        }
        next();
    }

    /**
     * GET /info — returns spec version, server name/version, and capability flags.
     **/
    get_info(_req: Request, res: Response): void {
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
    }

    /**
     * GET /namespaces — returns every namespace known to the object tree.
     **/
    get_namespaces(_req: Request, res: Response): void {
        res.json(this.objectTree.getNamespaces());
    }

    /**
     * GET /objecttypes — returns object types, optionally filtered by `namespaceUri`.
     **/
    get_object_types(req: Request, res: Response): void {
        const ns = req.query.namespaceUri as string | undefined;
        res.json(this.objectTree.getObjectTypes(ns));
    }

    /**
     * GET /objecttypes/:elementId — returns one object type, or 404 if unknown.
     **/
    get_object_type(req: Request, res: Response, next: NextFunction): void {
        const result = this.objectTree.getObjectType(req.params.elementId);
        if (!result) return next(notFound(`Object type ${req.params.elementId} not found`));
        res.json(result);
    }

    /**
     * POST /objecttypes/query — bulk lookup of object types by id list.
     * Returns a per-id success/error envelope; missing ids are reported
     * as failures rather than aborting the batch. Uses the
     * `_originalJson` escape hatch to avoid double-wrapping by the
     * envelope middleware (the response is already a complete envelope).
     */
    query_object_types(req: Request, res: Response): void {
        const { elementIds } = req.body;
        const results = (elementIds as string[]).map(id => {
            const item = this.objectTree.getObjectType(id);
            if (item) {
                return { success: true, elementId: id, result: item };
            }
            return { success: false, elementId: id, error: { code: 404, message: `Object type ${id} not found` } };
        });
        const allSuccess = results.every(r => r.success);
        ((res as any)._originalJson || res.json.bind(res))({ success: allSuccess, results });
    }

    /**
     * GET /relationshiptypes — returns relationship types, optionally filtered by `namespaceUri`.
     **/
    get_relationship_types(req: Request, res: Response): void {
        const ns = req.query.namespaceUri as string | undefined;
        res.json(this.objectTree.getRelationshipTypes(ns));
    }

    /**
     * GET /relationshiptypes/:elementId — returns one relationship type, or 404 if unknown.
     **/
    get_relationship_type(req: Request, res: Response, next: NextFunction): void {
        const result = this.objectTree.getRelationshipType(req.params.elementId);
        if (!result) return next(notFound(`Relationship type ${req.params.elementId} not found`));
        res.json(result);
    }

    /**
     * POST /relationshiptypes/query — bulk lookup of relationship types
     * by id list, mirroring `query_object_types`: per-id success/error
     * envelope with the same `_originalJson` escape hatch.
     */
    query_relationship_types(req: Request, res: Response): void {
        const { elementIds } = req.body;
        const results = (elementIds as string[]).map(id => {
            const item = this.objectTree.getRelationshipType(id);
            if (item) {
                return { success: true, elementId: id, result: item };
            }
            return { success: false, elementId: id, error: { code: 404, message: `Relationship type ${id} not found` } };
        });
        const allSuccess = results.every(r => r.success);
        ((res as any)._originalJson || res.json.bind(res))({ success: allSuccess, results });
    }

    /**
     * GET /objects — lists objects with optional `typeElementId`, `root`, and `includeMetadata` filters.
     **/
    get_objects(req: Request, res: Response): void {
        res.json(this.objectTree.getObjects({
            typeElementId: req.query.typeElementId as string | undefined,
            root: req.query.root === "true",
            includeMetadata: req.query.includeMetadata === "true",
        }));
    }

    /**
     * POST /objects/list — bulk lookup of objects by id list. Returns
     * a per-id success/error envelope; missing ids are reported as
     * failures rather than aborting the batch.
     */
    list_objects(req: Request, res: Response): void {
        const { elementIds, includeMetadata } = req.body;
        const results = (elementIds as string[]).map(id => {
            const item = this.objectTree.getObject(id);
            if (item) {
                return { success: true, elementId: id, result: item };
            }
            return { success: false, elementId: id, error: { code: 404, message: `Object ${id} not found` } };
        });
        const allSuccess = results.every(r => r.success);
        ((res as any)._originalJson || res.json.bind(res))({ success: allSuccess, results });
    }

    /**
     * POST /objects/value — bulk current-value lookup. For each id,
     * tries the real-time UNS `valueCache` first, then falls back to
     * InfluxDB via `history.getCurrentValue` (or `getCompositionValue`
     * for composition objects). `maxDepth` controls composition
     * recursion; defaults to 1 for compositions.
     */
    async value_objects(req: Request, res: Response): Promise<void> {
        const { elementIds, maxDepth } = req.body;
        const results = await Promise.all((elementIds as string[]).map(async (id) => {
            // Try UNS cache first (real-time), fall back to InfluxDB last()
            const cached = this.valueCache.getValue(id);
            if (cached) {
                console.log(`[VALUE] ${id.slice(0,16)} → UNS cache hit: value=${JSON.stringify(cached.value)} age=${Date.now() - new Date(cached.timestamp).getTime()}ms`);
                return { success: true, elementId: id, result: cached };
            }
            console.log(`[VALUE] ${id.slice(0,16)} → UNS cache miss, querying InfluxDB...`);
            const obj = this.objectTree.getObject(id);
            const item = obj?.isComposition
                ? await this.history.getCompositionValue(id, maxDepth ?? 1)
                : await this.history.getCurrentValue(id);
            if (item) {
                console.log(`[VALUE] ${id.slice(0,16)} → InfluxDB hit: value=${JSON.stringify(item.value)} ts=${item.timestamp}`);
                return { success: true, elementId: id, result: item };
            }
            console.log(`[VALUE] ${id.slice(0,16)} → no data`);
            return { success: false, elementId: id, error: { code: 404, message: `No value for ${id}` } };
        }));
        const allSuccess = results.every(r => r.success);
        ((res as any)._originalJson || res.json.bind(res))({ success: allSuccess, results });
    }

    /**
     * POST /objects/history — bulk history lookup over `[startTime,
     * endTime]`. Both bounds are required (400 otherwise). Per-id
     * errors are caught and reported in the envelope rather than
     * failing the whole batch.
     */
    async history_objects(req: Request, res: Response, next: NextFunction): Promise<void> {
        const { elementIds, startTime, endTime, maxDepth } = req.body;
        if (!startTime || !endTime) {
            return next(badRequest("startTime and endTime are required"));
        }
        if(!validator.isRFC3339(startTime) || !validator.isRFC3339(endTime)) {
            return next(badRequest("startTime and endTime must be an RFC 3339 timestamp"));
        }
        const results = await Promise.all(
            (elementIds as string[]).map(async id => {
                try {
                    const values = await this.history.queryHistory(id, startTime, endTime, maxDepth);
                    return { success: true, elementId: id, result: { elementId: id, values } };
                } catch (err: any) {
                    return { success: false, elementId: id, error: { code: err.status ?? 500, message: err.message } };
                }
            }),
        );
        const allSuccess = results.every(r => r.success);
        ((res as any)._originalJson || res.json.bind(res))({ success: allSuccess, results });
    }

    /**
     * POST /objects/related — bulk related-object lookup, optionally
     * filtered by `relationshiptype`. Per-id success/error envelope:
     * missing ids are reported as failures.
     */
    related_objects(req: Request, res: Response): void {
        const { elementIds, relationshiptype } = req.body;
        const results = (elementIds as string[]).map(id => {
            const obj = this.objectTree.getObject(id);
            if (!obj) {
                return { success: false, elementId: id, error: { code: 404, message: `Object ${id} not found` } };
            }
            const related = this.objectTree.getRelated(id, relationshiptype);
            return { success: true, elementId: id, result: related };
        });
        const allSuccess = results.every(r => r.success);
        ((res as any)._originalJson || res.json.bind(res))({ success: allSuccess, results });
    }

    /**
     * GET /objects/:elementId/value — single-id current value. Same
     * cache-then-InfluxDB strategy as `value_objects` (UNS cache,
     * then `history.getCompositionValue`/`getCurrentValue`); 404 if
     * neither source has a value.
     */
    async get_object_value(req: Request, res: Response, next: NextFunction): Promise<void> {
        const id = req.params.elementId;
        const obj = this.objectTree.getObject(id);
        // Try UNS cache first (real-time), fall back to InfluxDB last()
        const cached = this.valueCache.getValue(id);
        if (cached) {
            console.log(`[VALUE] ${id} → UNS cache hit: value=${JSON.stringify(cached.value)} ts=${cached.timestamp} age=${Date.now() - new Date(cached.timestamp).getTime()}ms`);
            res.json(cached);
            return;
        }
        console.log(`[VALUE] ${id} → UNS cache miss, querying InfluxDB...`);
        const result = obj?.isComposition
            ? await this.history.getCompositionValue(id)
            : await this.history.getCurrentValue(id);
        if (result) {
            console.log(`[VALUE] ${id} → InfluxDB hit: value=${JSON.stringify(result.value)} ts=${result.timestamp}`);
        } else {
            console.log(`[VALUE] ${id} → InfluxDB miss: no data`);
        }
        if (!result) return next(notFound(`No value for ${id}`));
        res.json(result);
    }

    /**
     * GET /objects/:elementId/history — requires `startTime`/`endTime` query params (400 otherwise).
     **/
    async get_object_history(req: Request, res: Response, next: NextFunction): Promise<void> {
        const { startTime, endTime } = req.query as { startTime?: string; endTime?: string };
        if (!startTime || !endTime) {
            return next(badRequest("startTime and endTime query parameters are required"));
        }
        const values = await this.history.queryHistory(req.params.elementId, startTime, endTime);
        res.json({ elementId: req.params.elementId, values });
    }

    /**
     * GET /objects/:elementId/related — related objects, optionally filtered by `relationshiptype`. 404 if the source object is unknown.
     **/
    get_object_related(req: Request, res: Response, next: NextFunction): void {
        const obj = this.objectTree.getObject(req.params.elementId);
        if (!obj) return next(notFound(`Object ${req.params.elementId} not found`));
        const rt = req.query.relationshiptype as string | undefined;
        res.json(this.objectTree.getRelated(req.params.elementId, rt));
    }

    /**
     * GET /objects/:elementId — returns one object, or 404 if unknown.
     **/
    get_object(req: Request, res: Response, next: NextFunction): void {
        const result = this.objectTree.getObject(req.params.elementId);
        if (!result) return next(notFound(`Object ${req.params.elementId} not found`));
        res.json(result);
    }

    /**
     * POST /subscriptions/list — lists subscriptions for a client, optionally filtered by ids.
     **/
    list_subscriptions(req: Request, res: Response): void {
        const { clientId, subscriptionIds } = req.body;
        res.json(this.subscriptions.list(clientId, subscriptionIds));
    }

    /**
     * POST /subscriptions/delete — deletes the listed subscriptions for
     * a client. Per-id success/error envelope: missing or wrong-client
     * ids are reported as failures rather than aborting the batch.
     */
    delete_subscriptions(req: Request, res: Response): void {
        const { clientId, subscriptionIds } = req.body;
        const results = (subscriptionIds as string[]).map(id => {
            try {
                this.subscriptions.deleteOne(clientId, id);
                return { success: true, subscriptionId: id, result: null };
            } catch (err: any) {
                return {
                    success: false,
                    subscriptionId: id,
                    error: { code: err.status ?? 500, message: err.message },
                };
            }
        });
        const allSuccess = results.every(r => r.success);
        ((res as any)._originalJson || res.json.bind(res))({ success: allSuccess, results });
    }

    /**
     * POST /subscriptions/register — adds element ids to an existing
     * subscription, with optional composition `maxDepth`. Per-id
     * success/error envelope: unknown ids are reported as 404, sub-level
     * errors (missing sub / wrong client) surface from `registerOne` as
     * 404/403 per-id rather than aborting the batch.
     */
    register_subscriptions(req: Request, res: Response): void {
        const { clientId, subscriptionId, elementIds, maxDepth } = req.body;
        const results = (elementIds as string[]).map(id => {
            if (!this.objectTree.getObject(id)) {
                return { success: false, elementId: id, error: { code: 404, message: `Object ${id} not found` } };
            }
            try {
                this.subscriptions.registerOne(clientId, subscriptionId, id, maxDepth);
                return { success: true, elementId: id, result: null };
            } catch (err: any) {
                return {
                    success: false,
                    elementId: id,
                    error: { code: err.status ?? 500, message: err.message },
                };
            }
        });
        const allSuccess = results.every(r => r.success);
        ((res as any)._originalJson || res.json.bind(res))({ success: allSuccess, results });
    }

    /**
     * POST /subscriptions/unregister — removes element ids from an existing subscription.
     **/
    unregister_subscriptions(req: Request, res: Response): void {
        const { clientId, subscriptionId, elementIds } = req.body;
        this.subscriptions.unregister(clientId, subscriptionId, elementIds);
        res.json({ unregistered: elementIds });
    }

    /**
     * POST /subscriptions/stream — opens a Server-Sent Events stream
     * for the subscription. Hands the response off to
     * `SubscriptionManager.stream`, which owns the response lifecycle;
     * do NOT call `res.json` here.
     */
    async stream_subscription(req: Request, res: Response, _next: NextFunction): Promise<void> {
        const { clientId, subscriptionId } = req.body;
        this.subscriptions.stream(clientId, subscriptionId, res);
    }

    /**
     * POST /subscriptions/sync — replays missed updates after `lastSequenceNumber`.
     **/
    sync_subscription(req: Request, res: Response): void {
        const { clientId, subscriptionId, lastSequenceNumber } = req.body;
        res.json(this.subscriptions.sync(clientId, subscriptionId, lastSequenceNumber));
    }

    /**
     * POST /subscriptions — creates a new subscription for the given client.
     **/
    create_subscription(req: Request, res: Response): void {
        const { clientId, displayName } = req.body;
        res.json(this.subscriptions.create(clientId, displayName));
    }
}

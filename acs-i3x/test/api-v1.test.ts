import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import express from "express";
import request from "supertest";
import { APIv1 } from "../lib/api-v1.js";
import { I3X_SPEC_VERSION, Version } from "../lib/constants.js";
import type {
    I3xNamespace,
    I3xObjectType,
    I3xObject,
    I3xRelationshipType,
    I3xValueResponse,
    I3xVqt,
    I3xSubscription,
    I3xSyncItem,
} from "../lib/types/i3x.js";

/* ---- Mock factories ---- */

function mockObjectTree() {
    return {
        isReady: jest.fn<() => boolean>().mockReturnValue(true),
        getNamespaces: jest.fn<() => I3xNamespace[]>().mockReturnValue([]),
        getObjectTypes: jest.fn<(ns?: string) => I3xObjectType[]>().mockReturnValue([]),
        getObjectType: jest.fn<(id: string) => I3xObjectType | undefined>().mockReturnValue(undefined),
        getRelationshipTypes: jest.fn<(ns?: string) => I3xRelationshipType[]>().mockReturnValue([]),
        getRelationshipType: jest.fn<(id: string) => I3xRelationshipType | undefined>().mockReturnValue(undefined),
        getObjects: jest.fn<(opts?: any) => I3xObject[]>().mockReturnValue([]),
        getObject: jest.fn<(id: string) => I3xObject | undefined>().mockReturnValue(undefined),
        getRelated: jest.fn<(id: string, rt?: string) => I3xObject[]>().mockReturnValue([]),
        getChildElementIds: jest.fn<(id: string) => string[]>().mockReturnValue([]),
        addCompositionFromUns: jest.fn(),
    };
}

function mockValueCache() {
    return {
        getValue: jest.fn<(id: string) => I3xValueResponse | null>().mockReturnValue(null),
    };
}

function mockHistory() {
    return {
        getCurrentValue: jest.fn<(id: string) => Promise<I3xValueResponse | null>>()
            .mockResolvedValue(null),
        getCompositionValue: jest.fn<(id: string, maxDepth?: number) => Promise<I3xValueResponse | null>>()
            .mockResolvedValue(null),
        queryHistory: jest.fn<(id: string, start: string, end: string, maxDepth?: number) => Promise<I3xVqt[]>>()
            .mockResolvedValue([]),
    };
}

function mockSubscriptions() {
    return {
        create: jest.fn<(clientId: string, displayName?: string) => I3xSubscription>()
            .mockReturnValue({
                clientId: "c1",
                subscriptionId: "sub-1",
                displayName: "Test",
            }),
        list: jest.fn<(clientId: string, ids: string[]) => I3xSubscription[]>()
            .mockReturnValue([]),
        getOne: jest.fn<(clientId: string, id: string) => I3xSubscription>(),
        deleteOne: jest.fn<(clientId: string, id: string) => void>(),
        register: jest.fn<(clientId: string, subId: string, ids: string[], maxDepth?: number) => void>(),
        registerOne: jest.fn<(clientId: string, subId: string, id: string, maxDepth?: number) => void>(),
        unregister: jest.fn<(clientId: string, subId: string, ids: string[]) => void>(),
        unregisterOne: jest.fn<(clientId: string, subId: string, id: string) => void>(),
        stream: jest.fn<(clientId: string, subId: string, res: any) => void>(),
        sync: jest.fn<(clientId: string, subId: string, lastSeq?: number) => I3xSyncItem[]>()
            .mockReturnValue([]),
    };
}

const NS_NAME = "TestNamespace";
const NS_URI = "urn:test:namespace";

function createApp(opts: { maxDepthCap?: number } = {}) {
    const objectTree = mockObjectTree();
    const valueCache = mockValueCache();
    const history = mockHistory();
    const subscriptions = mockSubscriptions();

    const api = new APIv1({
        objectTree: objectTree as any,
        valueCache: valueCache as any,
        history: history as any,
        subscriptions: subscriptions as any,
        maxDepthCap: opts.maxDepthCap,
    });

    const app = express();
    app.use(express.json());
    app.use("/", api.infoRoute);
    app.use("/", api.routes);

    return { app, objectTree, valueCache, history, subscriptions, api };
}

/* ---- Test helpers ---- */

const sampleNamespace: I3xNamespace = { uri: NS_URI, displayName: NS_NAME };

const sampleType: I3xObjectType = {
    elementId: "type-1",
    displayName: "SensorType",
    namespaceUri: NS_URI,
    sourceTypeId: "st-1",
    schema: {},
};

const sampleType2: I3xObjectType = {
    elementId: "type-2",
    displayName: "ActuatorType",
    namespaceUri: NS_URI,
    sourceTypeId: "st-2",
    schema: {},
};

const sampleObject: I3xObject = {
    elementId: "obj-1",
    displayName: "Sensor1",
    typeElementId: "type-1",
    parentId: "/",
    isComposition: true,
    isExtended: false,
};

const sampleObject2: I3xObject = {
    elementId: "obj-2",
    displayName: "Sensor2",
    typeElementId: "type-1",
    parentId: "obj-1",
    isComposition: false,
    isExtended: false,
};

const sampleRelType: I3xRelationshipType = {
    elementId: "rel-1",
    displayName: "Has Parent",
    namespaceUri: NS_URI,
    relationshipId: "i3x:rel:has-parent",
    reverseOf: "i3x:rel:has-children",
};

const sampleVqt: I3xVqt = {
    value: 42,
    quality: "Good",
    timestamp: "2026-04-01T12:00:00Z",
};

const sampleValueResponse: I3xValueResponse = {
    elementId: "obj-1",
    isComposition: false,
    ...sampleVqt,
};

/* ========== Tests ========== */

describe("APIv1", () => {

    /* ---- Info ---- */

    describe("GET /info", () => {
        it("returns correct capabilities shape", async () => {
            const { app } = createApp();
            const res = await request(app).get("/info");

            expect(res.status).toBe(200);
            expect(res.body).toEqual({
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

        it("advertises maxDepthCap when configured", async () => {
            const { app } = createApp({ maxDepthCap: 5 });
            const res = await request(app).get("/info");

            expect(res.status).toBe(200);
            expect(res.body.capabilities.query).toEqual({
                history: true,
                maxDepthCap: 5,
            });
        });

        it("omits maxDepthCap when unconfigured (0)", async () => {
            const { app } = createApp();
            const res = await request(app).get("/info");

            expect(res.body.capabilities.query).not.toHaveProperty("maxDepthCap");
        });
    });

    /* ---- Readiness ---- */

    describe("Readiness check", () => {
        it("returns 503 when objectTree is not ready", async () => {
            const { app, objectTree } = createApp();
            objectTree.isReady.mockReturnValue(false);

            const res = await request(app).get("/namespaces");

            expect(res.status).toBe(503);
            expect(res.body.success).toBe(false);
        });

        it("allows /info even when not ready", async () => {
            const { app, objectTree } = createApp();
            objectTree.isReady.mockReturnValue(false);

            const res = await request(app).get("/info");

            expect(res.status).toBe(200);
        });
    });

    /* ---- Explore: Namespaces ---- */

    describe("GET /namespaces", () => {
        it("returns namespaces in envelope", async () => {
            const { app, objectTree } = createApp();
            objectTree.getNamespaces.mockReturnValue([sampleNamespace]);

            const res = await request(app).get("/namespaces");

            expect(res.status).toBe(200);
            expect(res.body).toEqual({
                success: true,
                result: [sampleNamespace],
            });
        });
    });

    /* ---- Explore: Object Types ---- */

    describe("GET /objecttypes", () => {
        it("returns types", async () => {
            const { app, objectTree } = createApp();
            objectTree.getObjectTypes.mockReturnValue([sampleType, sampleType2]);

            const res = await request(app).get("/objecttypes");

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.result).toHaveLength(2);
        });

        it("filters by namespaceUri query param", async () => {
            const { app, objectTree } = createApp();
            objectTree.getObjectTypes.mockReturnValue([sampleType]);

            const res = await request(app)
                .get("/objecttypes")
                .query({ namespaceUri: NS_URI });

            expect(res.status).toBe(200);
            expect(objectTree.getObjectTypes).toHaveBeenCalledWith(NS_URI);
        });
    });

    describe("GET /objecttypes/:elementId", () => {
        it("returns single object type", async () => {
            const { app, objectTree } = createApp();
            objectTree.getObjectType.mockReturnValue(sampleType);

            const res = await request(app).get("/objecttypes/type-1");

            expect(res.status).toBe(200);
            expect(res.body.result).toEqual(sampleType);
        });

        it("returns 404 for missing type", async () => {
            const { app } = createApp();

            const res = await request(app).get("/objecttypes/nonexistent");

            expect(res.status).toBe(404);
            expect(res.body.success).toBe(false);
        });
    });

    describe("POST /objecttypes/query", () => {
        it("returns bulk response preserving order", async () => {
            const { app, objectTree } = createApp();
            objectTree.getObjectType
                .mockImplementation((id: string) => {
                    if (id === "type-1") return sampleType;
                    if (id === "type-2") return sampleType2;
                    return undefined;
                });

            const res = await request(app)
                .post("/objecttypes/query")
                .send({ elementIds: ["type-2", "type-1", "missing"] });

            expect(res.status).toBe(200);
            const results = res.body.results;
            expect(results).toHaveLength(3);
            expect(results[0].elementId).toBe("type-2");
            expect(results[0].success).toBe(true);
            expect(results[1].elementId).toBe("type-1");
            expect(results[1].success).toBe(true);
            expect(results[2].elementId).toBe("missing");
            expect(results[2].success).toBe(false);
        });
    });

    /* ---- Explore: Relationship Types ---- */

    describe("GET /relationshiptypes", () => {
        it("returns relationship types", async () => {
            const { app, objectTree } = createApp();
            objectTree.getRelationshipTypes.mockReturnValue([sampleRelType]);

            const res = await request(app).get("/relationshiptypes");

            expect(res.status).toBe(200);
            expect(res.body.result).toEqual([sampleRelType]);
        });
    });

    describe("GET /relationshiptypes/:elementId", () => {
        it("returns single relationship type", async () => {
            const { app, objectTree } = createApp();
            objectTree.getRelationshipType.mockReturnValue(sampleRelType);

            const res = await request(app).get("/relationshiptypes/rel-1");

            expect(res.status).toBe(200);
            expect(res.body.result).toEqual(sampleRelType);
        });

        it("returns 404 for missing", async () => {
            const { app } = createApp();

            const res = await request(app).get("/relationshiptypes/nonexistent");

            expect(res.status).toBe(404);
            expect(res.body.success).toBe(false);
        });
    });

    describe("POST /relationshiptypes/query", () => {
        it("returns bulk response", async () => {
            const { app, objectTree } = createApp();
            objectTree.getRelationshipType
                .mockImplementation((id: string) => {
                    if (id === "rel-1") return sampleRelType;
                    return undefined;
                });

            const res = await request(app)
                .post("/relationshiptypes/query")
                .send({ elementIds: ["rel-1", "missing"] });

            expect(res.status).toBe(200);
            const results = res.body.results;
            expect(results).toHaveLength(2);
            expect(results[0].success).toBe(true);
            expect(results[1].success).toBe(false);
        });
    });

    /* ---- Explore: Objects ---- */

    describe("GET /objects", () => {
        it("returns objects", async () => {
            const { app, objectTree } = createApp();
            objectTree.getObjects.mockReturnValue([sampleObject]);

            const res = await request(app).get("/objects");

            expect(res.status).toBe(200);
            expect(res.body.result).toEqual([sampleObject]);
        });

        it("supports root=true filter", async () => {
            const { app, objectTree } = createApp();
            objectTree.getObjects.mockReturnValue([sampleObject]);

            await request(app).get("/objects").query({ root: "true" });

            expect(objectTree.getObjects).toHaveBeenCalledWith(
                expect.objectContaining({ root: true }),
            );
        });

        it("supports typeElementId filter", async () => {
            const { app, objectTree } = createApp();
            objectTree.getObjects.mockReturnValue([]);

            await request(app).get("/objects").query({ typeElementId: "type-1" });

            expect(objectTree.getObjects).toHaveBeenCalledWith(
                expect.objectContaining({ typeElementId: "type-1" }),
            );
        });

        it("supports includeMetadata filter", async () => {
            const { app, objectTree } = createApp();
            objectTree.getObjects.mockReturnValue([]);

            await request(app).get("/objects").query({ includeMetadata: "true" });

            expect(objectTree.getObjects).toHaveBeenCalledWith(
                expect.objectContaining({ includeMetadata: true }),
            );
        });
    });

    describe("GET /objects/:elementId", () => {
        it("returns single object", async () => {
            const { app, objectTree } = createApp();
            objectTree.getObject.mockReturnValue(sampleObject);

            const res = await request(app).get("/objects/obj-1");

            expect(res.status).toBe(200);
            expect(res.body.result).toEqual(sampleObject);
        });

        it("returns 404 for missing object", async () => {
            const { app } = createApp();

            const res = await request(app).get("/objects/nonexistent");

            expect(res.status).toBe(404);
            expect(res.body.success).toBe(false);
        });
    });

    describe("POST /objects/list", () => {
        it("returns bulk preserving order", async () => {
            const { app, objectTree } = createApp();
            objectTree.getObject
                .mockImplementation((id: string) => {
                    if (id === "obj-1") return sampleObject;
                    if (id === "obj-2") return sampleObject2;
                    return undefined;
                });

            const res = await request(app)
                .post("/objects/list")
                .send({ elementIds: ["obj-2", "obj-1", "missing"] });

            expect(res.status).toBe(200);
            const results = res.body.results;
            expect(results).toHaveLength(3);
            expect(results[0].elementId).toBe("obj-2");
            expect(results[0].success).toBe(true);
            expect(results[1].elementId).toBe("obj-1");
            expect(results[1].success).toBe(true);
            expect(results[2].elementId).toBe("missing");
            expect(results[2].success).toBe(false);
        });
    });

    describe("GET /objects/:elementId/related", () => {
        it("returns related objects", async () => {
            const { app, objectTree } = createApp();
            objectTree.getObject.mockReturnValue(sampleObject);
            objectTree.getRelated.mockReturnValue([sampleObject2]);

            const res = await request(app).get("/objects/obj-1/related");

            expect(res.status).toBe(200);
            expect(res.body.result).toEqual([sampleObject2]);
        });

        it("passes relationshiptype query param", async () => {
            const { app, objectTree } = createApp();
            objectTree.getObject.mockReturnValue(sampleObject);
            objectTree.getRelated.mockReturnValue([]);

            await request(app)
                .get("/objects/obj-1/related")
                .query({ relationshiptype: "i3x:rel:has-children" });

            expect(objectTree.getRelated).toHaveBeenCalledWith(
                "obj-1",
                "i3x:rel:has-children",
            );
        });

        it("returns 404 if object not found", async () => {
            const { app } = createApp();

            const res = await request(app).get("/objects/nonexistent/related");

            expect(res.status).toBe(404);
            expect(res.body.success).toBe(false);
        });
    });

    describe("POST /objects/related", () => {
        it("returns bulk related objects", async () => {
            const { app, objectTree } = createApp();
            objectTree.getObject
                .mockImplementation((id: string) => {
                    if (id === "obj-1") return sampleObject;
                    return undefined;
                });
            objectTree.getRelated.mockReturnValue([sampleObject2]);

            const res = await request(app)
                .post("/objects/related")
                .send({ elementIds: ["obj-1", "missing"] });

            expect(res.status).toBe(200);
            const results = res.body.results;
            expect(results).toHaveLength(2);
            expect(results[0].elementId).toBe("obj-1");
            expect(results[0].success).toBe(true);
            expect(results[0].result).toEqual([sampleObject2]);
            expect(results[1].elementId).toBe("missing");
            expect(results[1].success).toBe(false);
        });
    });

    /* ---- Values ---- */

    describe("GET /objects/:elementId/value", () => {
        it("returns VQT value for a non-composition object", async () => {
            const { app, history, objectTree } = createApp();
            objectTree.getObject.mockReturnValue(sampleObject2); // isComposition: false
            history.getCurrentValue.mockResolvedValue(sampleValueResponse);

            const res = await request(app).get("/objects/obj-2/value");

            expect(res.status).toBe(200);
            expect(res.body.result).toEqual(sampleValueResponse);
        });

        it("returns VQT value for a composition object", async () => {
            const { app, history, objectTree } = createApp();
            objectTree.getObject.mockReturnValue(sampleObject); // isComposition: true
            const compositionResponse: I3xValueResponse = {
                ...sampleValueResponse,
                isComposition: true,
            };
            history.getCompositionValue.mockResolvedValue(compositionResponse);

            const res = await request(app).get("/objects/obj-1/value");

            expect(res.status).toBe(200);
            expect(res.body.result).toEqual(compositionResponse);
        });

        it("returns 404 for missing value", async () => {
            const { app } = createApp();

            const res = await request(app).get("/objects/obj-1/value");

            expect(res.status).toBe(404);
            expect(res.body.success).toBe(false);
        });
    });

    describe("POST /objects/value", () => {
        it("returns bulk VQTs", async () => {
            const { app, history, objectTree } = createApp();
            const resp1: I3xValueResponse = { ...sampleValueResponse, elementId: "obj-1" };
            // obj-1 is not a composition in this context (getObject returns undefined by default)
            history.getCurrentValue
                .mockImplementation(async (id: string) => {
                    if (id === "obj-1") return resp1;
                    return null;
                });

            const res = await request(app)
                .post("/objects/value")
                .send({ elementIds: ["obj-1", "missing"] });

            expect(res.status).toBe(200);
            const results = res.body.results;
            expect(results).toHaveLength(2);
            expect(results[0].elementId).toBe("obj-1");
            expect(results[0].success).toBe(true);
            expect(results[1].elementId).toBe("missing");
            expect(results[1].success).toBe(false);
        });

        it("returns 200 when requested maxDepth is within cap", async () => {
            const { app, history, objectTree } = createApp({ maxDepthCap: 5 });
            objectTree.getObject.mockReturnValue(sampleObject);
            history.getCompositionValue.mockResolvedValue(sampleValueResponse);

            const res = await request(app)
                .post("/objects/value")
                .send({ elementIds: ["obj-1"], maxDepth: 3 });

            expect(res.status).toBe(200);
            expect(history.getCompositionValue).toHaveBeenCalledWith("obj-1", 3);
        });

        it("returns 206 with clamped depth when maxDepth exceeds cap", async () => {
            const { app, history, objectTree } = createApp({ maxDepthCap: 2 });
            objectTree.getObject.mockReturnValue(sampleObject);
            history.getCompositionValue.mockResolvedValue(sampleValueResponse);

            const res = await request(app)
                .post("/objects/value")
                .send({ elementIds: ["obj-1"], maxDepth: 10 });

            expect(res.status).toBe(206);
            expect(history.getCompositionValue).toHaveBeenCalledWith("obj-1", 2);
            expect(res.body.success).toBe(true);
        });

        it("returns 200 when no maxDepthCap is configured even for deep requests", async () => {
            const { app, history, objectTree } = createApp();
            objectTree.getObject.mockReturnValue(sampleObject);
            history.getCompositionValue.mockResolvedValue(sampleValueResponse);

            const res = await request(app)
                .post("/objects/value")
                .send({ elementIds: ["obj-1"], maxDepth: 999 });

            expect(res.status).toBe(200);
            expect(history.getCompositionValue).toHaveBeenCalledWith("obj-1", 999);
        });
    });

    /* ---- History ---- */

    describe("GET /objects/:elementId/history", () => {
        it("returns history array", async () => {
            const { app, history } = createApp();
            history.queryHistory.mockResolvedValue([sampleVqt]);

            const res = await request(app)
                .get("/objects/obj-1/history")
                .query({ startTime: "2026-01-01T00:00:00Z", endTime: "2026-04-01T00:00:00Z" });

            expect(res.status).toBe(200);
            expect(res.body.result).toEqual({
                elementId: "obj-1",
                values: [sampleVqt],
            });
        });

        it("returns 400 for missing params", async () => {
            const { app } = createApp();

            const res = await request(app).get("/objects/obj-1/history");

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });

        it("returns 400 if only startTime provided", async () => {
            const { app } = createApp();

            const res = await request(app)
                .get("/objects/obj-1/history")
                .query({ startTime: "2026-01-01T00:00:00Z" });

            expect(res.status).toBe(400);
        });
    });

    describe("POST /objects/history", () => {
        it("returns bulk history", async () => {
            const { app, history } = createApp();
            history.queryHistory.mockResolvedValue([sampleVqt]);

            const res = await request(app)
                .post("/objects/history")
                .send({
                    elementIds: ["obj-1", "obj-2"],
                    startTime: "2026-01-01T00:00:00Z",
                    endTime: "2026-04-01T00:00:00Z",
                });

            expect(res.status).toBe(200);
            const results = res.body.results;
            expect(results).toHaveLength(2);
            expect(results[0].elementId).toBe("obj-1");
            expect(results[0].success).toBe(true);
            expect(results[0].result.values).toEqual([sampleVqt]);
            expect(results[1].elementId).toBe("obj-2");
            expect(results[1].success).toBe(true);
        });

        it("returns 400 if startTime or endTime missing", async () => {
            const { app } = createApp();

            const res = await request(app)
                .post("/objects/history")
                .send({ elementIds: ["obj-1"] });

            expect(res.status).toBe(400);
        });
    });

    /* ---- Subscriptions ---- */

    describe("POST /subscriptions", () => {
        it("creates subscription", async () => {
            const { app, subscriptions } = createApp();

            const res = await request(app)
                .post("/subscriptions")
                .send({ clientId: "c1", displayName: "Test" });

            expect(res.status).toBe(200);
            expect(subscriptions.create).toHaveBeenCalledWith("c1", "Test");
            expect(res.body.result).toEqual({
                clientId: "c1",
                subscriptionId: "sub-1",
                displayName: "Test",
            });
        });
    });

    describe("POST /subscriptions/list", () => {
        it("returns bulk envelope with monitoredObjects per subscription", async () => {
            const { app, subscriptions } = createApp();
            subscriptions.getOne.mockImplementation((clientId: string, id: string) => ({
                clientId,
                subscriptionId: id,
                displayName: `Sub ${id}`,
                monitoredObjects: [{ elementId: "obj-1", maxDepth: 2 }],
            }));

            const res = await request(app)
                .post("/subscriptions/list")
                .send({ clientId: "c1", subscriptionIds: ["sub-1", "sub-2"] });

            expect(res.status).toBe(200);
            expect(subscriptions.getOne).toHaveBeenCalledWith("c1", "sub-1");
            expect(subscriptions.getOne).toHaveBeenCalledWith("c1", "sub-2");
            expect(res.body).toEqual({
                success: true,
                results: [
                    {
                        success: true,
                        subscriptionId: "sub-1",
                        result: {
                            clientId: "c1",
                            subscriptionId: "sub-1",
                            displayName: "Sub sub-1",
                            monitoredObjects: [{ elementId: "obj-1", maxDepth: 2 }],
                        },
                    },
                    {
                        success: true,
                        subscriptionId: "sub-2",
                        result: {
                            clientId: "c1",
                            subscriptionId: "sub-2",
                            displayName: "Sub sub-2",
                            monitoredObjects: [{ elementId: "obj-1", maxDepth: 2 }],
                        },
                    },
                ],
            });
        });

        it("reports missing subscriptions as 404 without aborting the batch", async () => {
            const { app, subscriptions } = createApp();
            subscriptions.getOne.mockImplementation((clientId: string, id: string) => {
                if (id === "missing") {
                    const err: any = new Error(`Subscription ${id} not found`);
                    err.status = 404;
                    throw err;
                }
                return {
                    clientId,
                    subscriptionId: id,
                    displayName: `Sub ${id}`,
                    monitoredObjects: [],
                };
            });

            const res = await request(app)
                .post("/subscriptions/list")
                .send({ clientId: "c1", subscriptionIds: ["sub-1", "missing"] });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(false);
            expect(res.body.results).toEqual([
                {
                    success: true,
                    subscriptionId: "sub-1",
                    result: {
                        clientId: "c1",
                        subscriptionId: "sub-1",
                        displayName: "Sub sub-1",
                        monitoredObjects: [],
                    },
                },
                {
                    success: false,
                    subscriptionId: "missing",
                    error: { code: 404, message: "Subscription missing not found" },
                },
            ]);
        });

        it("reports wrong-client subscriptions as 403", async () => {
            const { app, subscriptions } = createApp();
            subscriptions.getOne.mockImplementation((_clientId: string, _id: string) => {
                const err: any = new Error("Subscription sub-1 does not belong to client c1");
                err.status = 403;
                throw err;
            });

            const res = await request(app)
                .post("/subscriptions/list")
                .send({ clientId: "c1", subscriptionIds: ["sub-1"] });

            expect(res.status).toBe(200);
            expect(res.body).toEqual({
                success: false,
                results: [
                    {
                        success: false,
                        subscriptionId: "sub-1",
                        error: { code: 403, message: "Subscription sub-1 does not belong to client c1" },
                    },
                ],
            });
        });
    });

    describe("POST /subscriptions/register", () => {
        it("returns bulk envelope on success", async () => {
            const { app, objectTree, subscriptions } = createApp();
            objectTree.getObject.mockImplementation((id: string) => {
                if (id === "obj-1") return sampleObject;
                if (id === "obj-2") return sampleObject2;
                return undefined;
            });

            const res = await request(app)
                .post("/subscriptions/register")
                .send({
                    clientId: "c1",
                    subscriptionId: "sub-1",
                    elementIds: ["obj-1", "obj-2"],
                    maxDepth: 2,
                });

            expect(res.status).toBe(200);
            expect(subscriptions.registerOne).toHaveBeenCalledWith("c1", "sub-1", "obj-1", 2);
            expect(subscriptions.registerOne).toHaveBeenCalledWith("c1", "sub-1", "obj-2", 2);
            expect(res.body).toEqual({
                success: true,
                results: [
                    { success: true, elementId: "obj-1", result: null },
                    { success: true, elementId: "obj-2", result: null },
                ],
            });
        });

        it("reports unknown elementIds as 404 without aborting the batch", async () => {
            const { app, objectTree, subscriptions } = createApp();
            objectTree.getObject.mockImplementation((id: string) => {
                if (id === "obj-1") return sampleObject;
                if (id === "obj-2") return sampleObject2;
                return undefined;
            });

            const res = await request(app)
                .post("/subscriptions/register")
                .send({
                    clientId: "c1",
                    subscriptionId: "sub-1",
                    elementIds: ["obj-1", "missing", "obj-2"],
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(false);
            expect(res.body.results).toEqual([
                { success: true, elementId: "obj-1", result: null },
                {
                    success: false,
                    elementId: "missing",
                    error: { code: 404, message: "Object missing not found" },
                },
                { success: true, elementId: "obj-2", result: null },
            ]);
            expect(subscriptions.registerOne).not.toHaveBeenCalledWith(
                "c1", "sub-1", "missing", expect.anything(),
            );
        });

        it("reports sub-level errors with code from err.status per id", async () => {
            const { app, objectTree, subscriptions } = createApp();
            objectTree.getObject.mockReturnValue(sampleObject);
            subscriptions.registerOne.mockImplementation(() => {
                const err: any = new Error("Subscription sub-1 not found");
                err.status = 404;
                throw err;
            });

            const res = await request(app)
                .post("/subscriptions/register")
                .send({
                    clientId: "c1",
                    subscriptionId: "sub-1",
                    elementIds: ["obj-1"],
                });

            expect(res.status).toBe(200);
            expect(res.body).toEqual({
                success: false,
                results: [
                    {
                        success: false,
                        elementId: "obj-1",
                        error: { code: 404, message: "Subscription sub-1 not found" },
                    },
                ],
            });
        });
    });

    describe("POST /subscriptions/unregister", () => {
        it("returns bulk envelope on success", async () => {
            const { app, objectTree, subscriptions } = createApp();
            objectTree.getObject.mockImplementation((id: string) => {
                if (id === "obj-1") return sampleObject;
                if (id === "obj-2") return sampleObject2;
                return undefined;
            });

            const res = await request(app)
                .post("/subscriptions/unregister")
                .send({
                    clientId: "c1",
                    subscriptionId: "sub-1",
                    elementIds: ["obj-1", "obj-2"],
                });

            expect(res.status).toBe(200);
            expect(subscriptions.unregisterOne).toHaveBeenCalledWith("c1", "sub-1", "obj-1");
            expect(subscriptions.unregisterOne).toHaveBeenCalledWith("c1", "sub-1", "obj-2");
            expect(res.body).toEqual({
                success: true,
                results: [
                    { success: true, elementId: "obj-1", result: null },
                    { success: true, elementId: "obj-2", result: null },
                ],
            });
        });

        it("reports unknown elementIds as 404 without aborting the batch", async () => {
            const { app, objectTree, subscriptions } = createApp();
            objectTree.getObject.mockImplementation((id: string) => {
                if (id === "obj-1") return sampleObject;
                if (id === "obj-2") return sampleObject2;
                return undefined;
            });

            const res = await request(app)
                .post("/subscriptions/unregister")
                .send({
                    clientId: "c1",
                    subscriptionId: "sub-1",
                    elementIds: ["obj-1", "missing", "obj-2"],
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(false);
            expect(res.body.results).toEqual([
                { success: true, elementId: "obj-1", result: null },
                {
                    success: false,
                    elementId: "missing",
                    error: { code: 404, message: "Object missing not found" },
                },
                { success: true, elementId: "obj-2", result: null },
            ]);
            expect(subscriptions.unregisterOne).not.toHaveBeenCalledWith(
                "c1", "sub-1", "missing",
            );
        });

        it("reports sub-level errors with code from err.status per id", async () => {
            const { app, objectTree, subscriptions } = createApp();
            objectTree.getObject.mockReturnValue(sampleObject);
            subscriptions.unregisterOne.mockImplementation(() => {
                const err: any = new Error("Subscription sub-1 not found");
                err.status = 404;
                throw err;
            });

            const res = await request(app)
                .post("/subscriptions/unregister")
                .send({
                    clientId: "c1",
                    subscriptionId: "sub-1",
                    elementIds: ["obj-1"],
                });

            expect(res.status).toBe(200);
            expect(res.body).toEqual({
                success: false,
                results: [
                    {
                        success: false,
                        elementId: "obj-1",
                        error: { code: 404, message: "Subscription sub-1 not found" },
                    },
                ],
            });
        });
    });

    describe("POST /subscriptions/sync", () => {
        it("returns queued items", async () => {
            const { app, subscriptions } = createApp();
            const syncItem: I3xSyncItem = {
                sequenceNumber: 1,
                elementId: "obj-1",
                ...sampleVqt,
            };
            subscriptions.sync.mockReturnValue([syncItem]);

            const res = await request(app)
                .post("/subscriptions/sync")
                .send({
                    clientId: "c1",
                    subscriptionId: "sub-1",
                    lastSequenceNumber: 0,
                });

            expect(res.status).toBe(200);
            expect(res.body.result).toEqual([syncItem]);
        });

        it("returns 404 envelope when subscription is unknown", async () => {
            const { app, subscriptions } = createApp();
            subscriptions.sync.mockImplementation(() => {
                const err: any = new Error("Subscription sub-1 not found");
                err.status = 404;
                throw err;
            });

            const res = await request(app)
                .post("/subscriptions/sync")
                .send({ clientId: "c1", subscriptionId: "sub-1" });

            expect(res.status).toBe(404);
            expect(res.body).toEqual({
                success: false,
                error: { code: 404, message: "Subscription sub-1 not found" },
            });
        });

        it("returns 403 envelope when clientId mismatches", async () => {
            const { app, subscriptions } = createApp();
            subscriptions.sync.mockImplementation(() => {
                const err: any = new Error("Subscription sub-1 does not belong to client c1");
                err.status = 403;
                throw err;
            });

            const res = await request(app)
                .post("/subscriptions/sync")
                .send({ clientId: "c1", subscriptionId: "sub-1" });

            expect(res.status).toBe(403);
            expect(res.body).toEqual({
                success: false,
                error: { code: 403, message: "Subscription sub-1 does not belong to client c1" },
            });
        });
    });

    describe("POST /subscriptions/delete", () => {
        it("returns bulk envelope on success", async () => {
            const { app, subscriptions } = createApp();

            const res = await request(app)
                .post("/subscriptions/delete")
                .send({ clientId: "c1", subscriptionIds: ["sub-1", "sub-2"] });

            expect(res.status).toBe(200);
            expect(subscriptions.deleteOne).toHaveBeenCalledWith("c1", "sub-1");
            expect(subscriptions.deleteOne).toHaveBeenCalledWith("c1", "sub-2");
            expect(res.body).toEqual({
                success: true,
                results: [
                    { success: true, subscriptionId: "sub-1", result: null },
                    { success: true, subscriptionId: "sub-2", result: null },
                ],
            });
        });

        it("reports per-id errors with code from err.status", async () => {
            const { app, subscriptions } = createApp();
            subscriptions.deleteOne.mockImplementation((_clientId: string, id: string) => {
                if (id === "missing") {
                    const err: any = new Error("Subscription missing not found");
                    err.status = 404;
                    throw err;
                }
            });

            const res = await request(app)
                .post("/subscriptions/delete")
                .send({ clientId: "c1", subscriptionIds: ["sub-1", "missing"] });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(false);
            expect(res.body.results).toEqual([
                { success: true, subscriptionId: "sub-1", result: null },
                {
                    success: false,
                    subscriptionId: "missing",
                    error: { code: 404, message: "Subscription missing not found" },
                },
            ]);
        });
    });

    describe("POST /subscriptions/stream", () => {
        it("delegates to subscriptions.stream without calling res.json", async () => {
            const { app, subscriptions } = createApp();
            // Mock stream to immediately end the response (simulating SSE setup)
            subscriptions.stream.mockImplementation(
                (_clientId: string, _subId: string, res: any) => {
                    res.setHeader("Content-Type", "text/event-stream");
                    res.status(200).end();
                },
            );

            const res = await request(app)
                .post("/subscriptions/stream")
                .send({ clientId: "c1", subscriptionId: "sub-1" });

            expect(subscriptions.stream).toHaveBeenCalled();
        });

        it("returns 404 envelope when subscription is unknown", async () => {
            const { app, subscriptions } = createApp();
            subscriptions.stream.mockImplementation(() => {
                const err: any = new Error("Subscription sub-1 not found");
                err.status = 404;
                throw err;
            });

            const res = await request(app)
                .post("/subscriptions/stream")
                .send({ clientId: "c1", subscriptionId: "sub-1" });

            expect(res.status).toBe(404);
            expect(res.body).toEqual({
                success: false,
                error: { code: 404, message: "Subscription sub-1 not found" },
            });
        });

        it("returns 403 envelope when clientId mismatches", async () => {
            const { app, subscriptions } = createApp();
            subscriptions.stream.mockImplementation(() => {
                const err: any = new Error("Subscription sub-1 does not belong to client c1");
                err.status = 403;
                throw err;
            });

            const res = await request(app)
                .post("/subscriptions/stream")
                .send({ clientId: "c1", subscriptionId: "sub-1" });

            expect(res.status).toBe(403);
            expect(res.body).toEqual({
                success: false,
                error: { code: 403, message: "Subscription sub-1 does not belong to client c1" },
            });
        });
    });

    /* ---- Error handling ---- */

    describe("Error handling", () => {
        it("wraps thrown errors in i3X error envelope", async () => {
            const { app, objectTree } = createApp();
            objectTree.getNamespaces.mockImplementation(() => {
                throw new Error("Boom");
            });

            const res = await request(app).get("/namespaces");

            expect(res.status).toBe(500);
            expect(res.body).toEqual({
                success: false,
                error: { code: 500, message: "Boom" },
            });
        });

        it("returns status from errors with status property", async () => {
            const { app, subscriptions } = createApp();
            subscriptions.create.mockImplementation(() => {
                const err: any = new Error("Not found");
                err.status = 404;
                throw err;
            });

            const res = await request(app)
                .post("/subscriptions")
                .send({ clientId: "c1" });

            expect(res.status).toBe(404);
        });
    });
});

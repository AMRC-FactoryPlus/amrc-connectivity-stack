import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import express from "express";
import request from "supertest";
import { APIv1 } from "../src/api-v1.js";
import { I3X_SPEC_VERSION, Version } from "../src/constants.js";
import type {
    I3xNamespace,
    I3xObjectType,
    I3xObject,
    I3xRelationshipType,
    I3xValueResponse,
    I3xVqt,
    I3xSubscription,
    I3xSyncItem,
} from "../src/types/i3x.js";

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
        delete: jest.fn<(clientId: string, ids: string[]) => void>(),
        register: jest.fn<(clientId: string, subId: string, ids: string[], maxDepth?: number) => void>(),
        unregister: jest.fn<(clientId: string, subId: string, ids: string[]) => void>(),
        stream: jest.fn<(clientId: string, subId: string, res: any) => void>(),
        sync: jest.fn<(clientId: string, subId: string, lastSeq?: number) => I3xSyncItem[]>()
            .mockReturnValue([]),
    };
}

const NS_NAME = "TestNamespace";
const NS_URI = "urn:test:namespace";

function createApp() {
    const objectTree = mockObjectTree();
    const valueCache = mockValueCache();
    const history = mockHistory();
    const subscriptions = mockSubscriptions();

    const api = new APIv1({
        objectTree: objectTree as any,
        valueCache: valueCache as any,
        history: history as any,
        subscriptions: subscriptions as any,
        namespaceName: NS_NAME,
        namespaceUri: NS_URI,
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
        it("returns VQT value", async () => {
            const { app, valueCache } = createApp();
            valueCache.getValue.mockReturnValue(sampleValueResponse);

            const res = await request(app).get("/objects/obj-1/value");

            expect(res.status).toBe(200);
            expect(res.body.result).toEqual(sampleValueResponse);
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
            const { app, valueCache } = createApp();
            const resp1: I3xValueResponse = { ...sampleValueResponse, elementId: "obj-1" };
            valueCache.getValue
                .mockImplementation((id: string) => {
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
        it("lists subscriptions", async () => {
            const { app, subscriptions } = createApp();
            subscriptions.list.mockReturnValue([{
                clientId: "c1",
                subscriptionId: "sub-1",
                displayName: "Test",
            }]);

            const res = await request(app)
                .post("/subscriptions/list")
                .send({ clientId: "c1", subscriptionIds: ["sub-1"] });

            expect(res.status).toBe(200);
            expect(res.body.result).toHaveLength(1);
        });
    });

    describe("POST /subscriptions/register", () => {
        it("registers elementIds", async () => {
            const { app, subscriptions } = createApp();

            const res = await request(app)
                .post("/subscriptions/register")
                .send({
                    clientId: "c1",
                    subscriptionId: "sub-1",
                    elementIds: ["obj-1", "obj-2"],
                    maxDepth: 2,
                });

            expect(res.status).toBe(200);
            expect(subscriptions.register).toHaveBeenCalledWith(
                "c1", "sub-1", ["obj-1", "obj-2"], 2,
            );
        });
    });

    describe("POST /subscriptions/unregister", () => {
        it("unregisters elementIds", async () => {
            const { app, subscriptions } = createApp();

            const res = await request(app)
                .post("/subscriptions/unregister")
                .send({
                    clientId: "c1",
                    subscriptionId: "sub-1",
                    elementIds: ["obj-1"],
                });

            expect(res.status).toBe(200);
            expect(subscriptions.unregister).toHaveBeenCalledWith(
                "c1", "sub-1", ["obj-1"],
            );
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
    });

    describe("POST /subscriptions/delete", () => {
        it("removes subscription", async () => {
            const { app, subscriptions } = createApp();

            const res = await request(app)
                .post("/subscriptions/delete")
                .send({ clientId: "c1", subscriptionIds: ["sub-1"] });

            expect(res.status).toBe(200);
            expect(subscriptions.delete).toHaveBeenCalledWith("c1", ["sub-1"]);
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
                error: { message: "Boom" },
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

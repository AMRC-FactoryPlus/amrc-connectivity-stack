/*
 * End-to-end compliance tests for the i3X API.
 *
 * These tests create a fully wired Express app with pre-loaded mock
 * data and fire HTTP requests at every endpoint, validating complete
 * response shapes, envelope compliance, content-type headers, and
 * cross-cutting concerns (readiness, error envelopes, bulk ordering).
 *
 * This complements the unit tests in api-v1.test.ts by exercising the
 * full HTTP layer as a client would see it.
 */

import { jest, describe, it, expect, beforeAll } from "@jest/globals";
import express from "express";
import request from "supertest";
import { APIv1 } from "../src/api-v1.js";
import { I3X_SPEC_VERSION, Version, RelType } from "../src/constants.js";
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

/* ================================================================
 * Realistic test data
 * ================================================================ */

const NS_URI = "urn:amrc:test:factory";
const NS_NAME = "TestFactory";

const namespace: I3xNamespace = { uri: NS_URI, displayName: NS_NAME };

/* Object types */
const typeCnc: I3xObjectType = {
    elementId: "type-cnc",
    displayName: "CNC Machine",
    namespaceUri: NS_URI,
    sourceTypeId: "src-cnc",
    schema: { type: "object", properties: { speed: { type: "number" } } },
};

const typeRobot: I3xObjectType = {
    elementId: "type-robot",
    displayName: "Robot",
    namespaceUri: NS_URI,
    sourceTypeId: "src-robot",
    schema: { type: "object", properties: { position: { type: "array" } } },
};

const typesById = new Map<string, I3xObjectType>([
    [typeCnc.elementId, typeCnc],
    [typeRobot.elementId, typeRobot],
]);

/* Objects */
const objCnc1: I3xObject = {
    elementId: "obj-cnc-1",
    displayName: "CNC-001",
    typeElementId: "type-cnc",
    parentId: null,
    isComposition: true,
    isExtended: false,
};

const objCnc2: I3xObject = {
    elementId: "obj-cnc-2",
    displayName: "CNC-002",
    typeElementId: "type-cnc",
    parentId: null,
    isComposition: true,
    isExtended: false,
};

const objRobot: I3xObject = {
    elementId: "obj-robot-1",
    displayName: "Robot-001",
    typeElementId: "type-robot",
    parentId: "obj-cnc-1",
    isComposition: false,
    isExtended: false,
};

const allObjects = [objCnc1, objCnc2, objRobot];
const objectsById = new Map<string, I3xObject>(
    allObjects.map(o => [o.elementId, o]),
);

/* Relationship types */
const relHasParent: I3xRelationshipType = {
    elementId: "rel-has-parent",
    displayName: "Has Parent",
    namespaceUri: NS_URI,
    relationshipId: RelType.HasParent,
    reverseOf: RelType.HasChildren,
};

const relHasChildren: I3xRelationshipType = {
    elementId: "rel-has-children",
    displayName: "Has Children",
    namespaceUri: NS_URI,
    relationshipId: RelType.HasChildren,
    reverseOf: RelType.HasParent,
};

const relHasComponent: I3xRelationshipType = {
    elementId: "rel-has-component",
    displayName: "Has Component",
    namespaceUri: NS_URI,
    relationshipId: RelType.HasComponent,
    reverseOf: RelType.ComponentOf,
};

const relComponentOf: I3xRelationshipType = {
    elementId: "rel-component-of",
    displayName: "Component Of",
    namespaceUri: NS_URI,
    relationshipId: RelType.ComponentOf,
    reverseOf: RelType.HasComponent,
};

const allRelTypes = [relHasParent, relHasChildren, relHasComponent, relComponentOf];
const relTypesById = new Map<string, I3xRelationshipType>(
    allRelTypes.map(r => [r.elementId, r]),
);

/* Values */
const vqtCnc1: I3xVqt = {
    value: 1200,
    quality: "Good",
    timestamp: "2026-03-15T10:00:00Z",
};
const valueCnc1: I3xValueResponse = {
    elementId: "obj-cnc-1",
    isComposition: true,
    ...vqtCnc1,
};

const vqtRobot: I3xVqt = {
    value: [1.0, 2.5, 3.0],
    quality: "Good",
    timestamp: "2026-03-15T10:00:01Z",
};
const valueRobot: I3xValueResponse = {
    elementId: "obj-robot-1",
    isComposition: false,
    ...vqtRobot,
};

const valuesById = new Map<string, I3xValueResponse>([
    ["obj-cnc-1", valueCnc1],
    ["obj-robot-1", valueRobot],
]);

/* History data */
const historyCnc1: I3xVqt[] = [
    { value: 1100, quality: "Good", timestamp: "2026-01-01T00:00:00Z" },
    { value: 1150, quality: "Good", timestamp: "2026-01-01T06:00:00Z" },
    { value: 1200, quality: "Good", timestamp: "2026-01-01T12:00:00Z" },
];

/* Relationships: obj-cnc-1 has child obj-robot-1 */
const relationships = new Map<string, Map<string | undefined, I3xObject[]>>([
    [
        "obj-cnc-1",
        new Map<string | undefined, I3xObject[]>([
            [undefined, [objRobot]],
            [RelType.HasChildren, [objRobot]],
        ]),
    ],
    [
        "obj-robot-1",
        new Map<string | undefined, I3xObject[]>([
            [undefined, [objCnc1]],
            [RelType.HasParent, [objCnc1]],
        ]),
    ],
]);

/* ================================================================
 * Mock factories with pre-loaded data
 * ================================================================ */

let readyFlag = true;

function createPreloadedMocks() {
    readyFlag = true;

    const objectTree = {
        isReady: jest.fn<() => boolean>().mockImplementation(() => readyFlag),

        getNamespaces: jest.fn<() => I3xNamespace[]>()
            .mockReturnValue([namespace]),

        getObjectTypes: jest.fn<(ns?: string) => I3xObjectType[]>()
            .mockImplementation((ns?: string) => {
                if (ns && ns !== NS_URI) return [];
                return [typeCnc, typeRobot];
            }),

        getObjectType: jest.fn<(id: string) => I3xObjectType | undefined>()
            .mockImplementation((id: string) => typesById.get(id)),

        getRelationshipTypes: jest.fn<(ns?: string) => I3xRelationshipType[]>()
            .mockReturnValue(allRelTypes),

        getRelationshipType: jest.fn<(id: string) => I3xRelationshipType | undefined>()
            .mockImplementation((id: string) => relTypesById.get(id)),

        getObjects: jest.fn<(opts?: any) => I3xObject[]>()
            .mockImplementation((opts?: any) => {
                let result = [...allObjects];
                if (opts?.root) result = result.filter(o => o.parentId === null);
                if (opts?.typeElementId) result = result.filter(o => o.typeElementId === opts.typeElementId);
                return result;
            }),

        getObject: jest.fn<(id: string) => I3xObject | undefined>()
            .mockImplementation((id: string) => objectsById.get(id)),

        getRelated: jest.fn<(id: string, rt?: string) => I3xObject[]>()
            .mockImplementation((id: string, rt?: string) => {
                const objRels = relationships.get(id);
                if (!objRels) return [];
                return objRels.get(rt) ?? objRels.get(undefined) ?? [];
            }),

        getChildElementIds: jest.fn<(id: string) => string[]>()
            .mockReturnValue([]),

        addCompositionFromUns: jest.fn(),
    };

    const valueCache = {
        getValue: jest.fn<(id: string) => I3xValueResponse | null>()
            .mockImplementation((id: string) => valuesById.get(id) ?? null),
    };

    const history = {
        queryHistory: jest.fn<(id: string, start: string, end: string, maxDepth?: number) => Promise<I3xVqt[]>>()
            .mockImplementation(async (id: string) => {
                if (id === "obj-cnc-1") return historyCnc1;
                return [];
            }),
    };

    const subscriptions = {
        create: jest.fn<(clientId: string, displayName?: string) => I3xSubscription>()
            .mockImplementation((clientId: string, displayName?: string) => ({
                clientId,
                subscriptionId: "sub-generated-1",
                displayName: displayName ?? "Default",
            })),
        list: jest.fn<(clientId: string, ids: string[]) => I3xSubscription[]>()
            .mockImplementation((clientId: string, ids: string[]) =>
                ids.map(id => ({
                    clientId,
                    subscriptionId: id,
                    displayName: "Sub " + id,
                })),
            ),
        delete: jest.fn<(clientId: string, ids: string[]) => void>(),
        register: jest.fn<(clientId: string, subId: string, ids: string[], maxDepth?: number) => void>(),
        unregister: jest.fn<(clientId: string, subId: string, ids: string[]) => void>(),
        stream: jest.fn<(clientId: string, subId: string, res: any) => void>(),
        sync: jest.fn<(clientId: string, subId: string, lastSeq?: number) => I3xSyncItem[]>()
            .mockReturnValue([
                { sequenceNumber: 1, elementId: "obj-cnc-1", ...vqtCnc1 },
                { sequenceNumber: 2, elementId: "obj-robot-1", ...vqtRobot },
            ]),
    };

    return { objectTree, valueCache, history, subscriptions };
}

/* ================================================================
 * App setup
 * ================================================================ */

function createE2eApp() {
    const mocks = createPreloadedMocks();

    const api = new APIv1({
        objectTree: mocks.objectTree as any,
        valueCache: mocks.valueCache as any,
        history: mocks.history as any,
        subscriptions: mocks.subscriptions as any,
        namespaceName: NS_NAME,
        namespaceUri: NS_URI,
    });

    const app = express();
    app.use(express.json());

    /* Mount exactly as the real routes.ts does */
    app.use("/v1/info", api.infoRoute);
    app.use("/v1", api.routes);

    return { app, ...mocks };
}

/* ================================================================
 * Tests
 * ================================================================ */

describe("E2E Compliance Tests", () => {

    /* ---- Server Info ---- */

    describe("GET /v1/info", () => {
        it("returns complete server info with all required fields", async () => {
            const { app } = createE2eApp();
            const res = await request(app).get("/v1/info");

            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toMatch(/application\/json/);

            const body = res.body;
            expect(body.success).toBe(true);

            const info = body.result;
            expect(info).toHaveProperty("specVersion");
            expect(info).toHaveProperty("serverName");
            expect(info).toHaveProperty("serverVersion");
            expect(info).toHaveProperty("capabilities");

            expect(typeof info.specVersion).toBe("string");
            expect(typeof info.serverName).toBe("string");
            expect(typeof info.serverVersion).toBe("string");
        });

        it("reports correct capability flags", async () => {
            const { app } = createE2eApp();
            const res = await request(app).get("/v1/info");

            const caps = res.body.result.capabilities;
            expect(caps.query.history).toBe(true);
            expect(caps.update.current).toBe(false);
            expect(caps.subscribe.stream).toBe(true);
        });

        it("reports correct version strings", async () => {
            const { app } = createE2eApp();
            const res = await request(app).get("/v1/info");

            expect(res.body.result.specVersion).toBe(I3X_SPEC_VERSION);
            expect(res.body.result.serverVersion).toBe(Version);
        });
    });

    /* ---- Explore: Namespaces ---- */

    describe("GET /v1/namespaces", () => {
        it("returns namespace list in success envelope", async () => {
            const { app } = createE2eApp();
            const res = await request(app).get("/v1/namespaces");

            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.body.success).toBe(true);

            const namespaces = res.body.result;
            expect(Array.isArray(namespaces)).toBe(true);
            expect(namespaces).toHaveLength(1);
            expect(namespaces[0]).toEqual(
                expect.objectContaining({ uri: NS_URI, displayName: NS_NAME }),
            );
        });
    });

    /* ---- Explore: Object Types ---- */

    describe("GET /v1/objecttypes", () => {
        it("returns all types with correct shape", async () => {
            const { app } = createE2eApp();
            const res = await request(app).get("/v1/objecttypes");

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            const types = res.body.result;
            expect(types).toHaveLength(2);

            for (const t of types) {
                expect(t).toHaveProperty("elementId");
                expect(t).toHaveProperty("displayName");
                expect(t).toHaveProperty("namespaceUri");
                expect(t).toHaveProperty("sourceTypeId");
                expect(t).toHaveProperty("schema");
                expect(typeof t.elementId).toBe("string");
                expect(typeof t.displayName).toBe("string");
            }
        });

        it("filters by namespaceUri", async () => {
            const { app } = createE2eApp();
            const res = await request(app)
                .get("/v1/objecttypes")
                .query({ namespaceUri: NS_URI });

            expect(res.status).toBe(200);
            expect(res.body.result).toHaveLength(2);
        });

        it("returns empty for unknown namespace", async () => {
            const { app } = createE2eApp();
            const res = await request(app)
                .get("/v1/objecttypes")
                .query({ namespaceUri: "urn:unknown" });

            expect(res.status).toBe(200);
            expect(res.body.result).toHaveLength(0);
        });
    });

    describe("GET /v1/objecttypes/:elementId", () => {
        it("returns single type with all fields", async () => {
            const { app } = createE2eApp();
            const res = await request(app).get("/v1/objecttypes/type-cnc");

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.result).toEqual(typeCnc);
        });

        it("returns 404 error envelope for nonexistent type", async () => {
            const { app } = createE2eApp();
            const res = await request(app).get("/v1/objecttypes/nonexistent");

            expect(res.status).toBe(404);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toHaveProperty("message");
            expect(typeof res.body.error.message).toBe("string");
        });
    });

    describe("POST /v1/objecttypes/query", () => {
        it("returns bulk response preserving input order and size", async () => {
            const { app } = createE2eApp();
            const ids = ["type-robot", "type-cnc", "nonexistent"];

            const res = await request(app)
                .post("/v1/objecttypes/query")
                .send({ elementIds: ids });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            const results = res.body.result.results;
            expect(results).toHaveLength(ids.length);
            expect(results[0].elementId).toBe("type-robot");
            expect(results[0].success).toBe(true);
            expect(results[0].result).toEqual(typeRobot);
            expect(results[1].elementId).toBe("type-cnc");
            expect(results[1].success).toBe(true);
            expect(results[2].elementId).toBe("nonexistent");
            expect(results[2].success).toBe(false);
            expect(results[2].error).toHaveProperty("message");
        });
    });

    /* ---- Explore: Objects ---- */

    describe("GET /v1/objects", () => {
        it("returns all objects with correct shape", async () => {
            const { app } = createE2eApp();
            const res = await request(app).get("/v1/objects");

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            const objects = res.body.result;
            expect(objects).toHaveLength(3);

            for (const o of objects) {
                expect(o).toHaveProperty("elementId");
                expect(o).toHaveProperty("displayName");
                expect(o).toHaveProperty("typeElementId");
                expect(o).toHaveProperty("parentId");
                expect(o).toHaveProperty("isComposition");
                expect(o).toHaveProperty("isExtended");
                expect(typeof o.elementId).toBe("string");
                expect(typeof o.isComposition).toBe("boolean");
                expect(typeof o.isExtended).toBe("boolean");
            }
        });

        it("filters to root objects only", async () => {
            const { app } = createE2eApp();
            const res = await request(app)
                .get("/v1/objects")
                .query({ root: "true" });

            expect(res.status).toBe(200);
            const objects = res.body.result;
            expect(objects).toHaveLength(2);
            for (const o of objects) {
                expect(o.parentId).toBeNull();
            }
        });

        it("filters by typeElementId", async () => {
            const { app } = createE2eApp();
            const res = await request(app)
                .get("/v1/objects")
                .query({ typeElementId: "type-robot" });

            expect(res.status).toBe(200);
            const objects = res.body.result;
            expect(objects).toHaveLength(1);
            expect(objects[0].typeElementId).toBe("type-robot");
        });
    });

    describe("GET /v1/objects/:elementId", () => {
        it("returns single object with all fields", async () => {
            const { app } = createE2eApp();
            const res = await request(app).get("/v1/objects/obj-cnc-1");

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.result).toEqual(objCnc1);
        });

        it("returns 404 for nonexistent object", async () => {
            const { app } = createE2eApp();
            const res = await request(app).get("/v1/objects/nonexistent");

            expect(res.status).toBe(404);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toHaveProperty("message");
        });
    });

    describe("POST /v1/objects/list", () => {
        it("returns bulk response preserving order", async () => {
            const { app } = createE2eApp();
            const ids = ["obj-robot-1", "obj-cnc-2", "missing"];

            const res = await request(app)
                .post("/v1/objects/list")
                .send({ elementIds: ids });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            const results = res.body.result.results;
            expect(results).toHaveLength(ids.length);
            expect(results[0].elementId).toBe("obj-robot-1");
            expect(results[0].success).toBe(true);
            expect(results[0].result).toEqual(objRobot);
            expect(results[1].elementId).toBe("obj-cnc-2");
            expect(results[1].success).toBe(true);
            expect(results[2].elementId).toBe("missing");
            expect(results[2].success).toBe(false);
        });
    });

    /* ---- Explore: Relationship Types ---- */

    describe("GET /v1/relationshiptypes", () => {
        it("returns all 4 relationship types", async () => {
            const { app } = createE2eApp();
            const res = await request(app).get("/v1/relationshiptypes");

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.result).toHaveLength(4);

            for (const rt of res.body.result) {
                expect(rt).toHaveProperty("elementId");
                expect(rt).toHaveProperty("displayName");
                expect(rt).toHaveProperty("namespaceUri");
                expect(rt).toHaveProperty("relationshipId");
                expect(rt).toHaveProperty("reverseOf");
            }
        });
    });

    describe("GET /v1/relationshiptypes/:elementId", () => {
        it("returns single relationship type", async () => {
            const { app } = createE2eApp();
            const res = await request(app).get("/v1/relationshiptypes/rel-has-parent");

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.result).toEqual(relHasParent);
        });

        it("returns 404 for nonexistent", async () => {
            const { app } = createE2eApp();
            const res = await request(app).get("/v1/relationshiptypes/nonexistent");

            expect(res.status).toBe(404);
            expect(res.body.success).toBe(false);
        });
    });

    describe("POST /v1/relationshiptypes/query", () => {
        it("returns bulk response matching input size", async () => {
            const { app } = createE2eApp();
            const ids = ["rel-has-children", "nonexistent"];

            const res = await request(app)
                .post("/v1/relationshiptypes/query")
                .send({ elementIds: ids });

            expect(res.status).toBe(200);

            const results = res.body.result.results;
            expect(results).toHaveLength(ids.length);
            expect(results[0].elementId).toBe("rel-has-children");
            expect(results[0].success).toBe(true);
            expect(results[1].success).toBe(false);
        });
    });

    /* ---- Explore: Related Objects ---- */

    describe("GET /v1/objects/:elementId/related", () => {
        it("returns related objects", async () => {
            const { app } = createE2eApp();
            const res = await request(app).get("/v1/objects/obj-cnc-1/related");

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.result)).toBe(true);
            expect(res.body.result).toHaveLength(1);
            expect(res.body.result[0].elementId).toBe("obj-robot-1");
        });

        it("filters by relationshiptype query param", async () => {
            const { app } = createE2eApp();
            const res = await request(app)
                .get("/v1/objects/obj-cnc-1/related")
                .query({ relationshiptype: RelType.HasChildren });

            expect(res.status).toBe(200);
            expect(res.body.result).toHaveLength(1);
            expect(res.body.result[0].elementId).toBe("obj-robot-1");
        });

        it("returns 404 for nonexistent object", async () => {
            const { app } = createE2eApp();
            const res = await request(app).get("/v1/objects/nonexistent/related");

            expect(res.status).toBe(404);
            expect(res.body.success).toBe(false);
        });
    });

    describe("POST /v1/objects/related", () => {
        it("returns bulk related objects", async () => {
            const { app } = createE2eApp();
            const res = await request(app)
                .post("/v1/objects/related")
                .send({
                    elementIds: ["obj-cnc-1", "nonexistent"],
                    relationshiptype: RelType.HasChildren,
                });

            expect(res.status).toBe(200);

            const results = res.body.result.results;
            expect(results).toHaveLength(2);
            expect(results[0].elementId).toBe("obj-cnc-1");
            expect(results[0].success).toBe(true);
            expect(Array.isArray(results[0].result)).toBe(true);
            expect(results[1].elementId).toBe("nonexistent");
            expect(results[1].success).toBe(false);
        });
    });

    /* ---- Query: Current Values ---- */

    describe("GET /v1/objects/:elementId/value", () => {
        it("returns VQT in envelope with all required fields", async () => {
            const { app } = createE2eApp();
            const res = await request(app).get("/v1/objects/obj-cnc-1/value");

            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.body.success).toBe(true);

            const vqt = res.body.result;
            expect(vqt).toHaveProperty("elementId", "obj-cnc-1");
            expect(vqt).toHaveProperty("isComposition");
            expect(vqt).toHaveProperty("value");
            expect(vqt).toHaveProperty("quality");
            expect(vqt).toHaveProperty("timestamp");
            expect(typeof vqt.isComposition).toBe("boolean");
            expect(typeof vqt.quality).toBe("string");
            expect(typeof vqt.timestamp).toBe("string");
        });

        it("returns 404 for object with no value", async () => {
            const { app } = createE2eApp();
            const res = await request(app).get("/v1/objects/obj-cnc-2/value");

            expect(res.status).toBe(404);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toHaveProperty("message");
        });

        it("returns 404 for nonexistent object", async () => {
            const { app } = createE2eApp();
            const res = await request(app).get("/v1/objects/nonexistent/value");

            expect(res.status).toBe(404);
        });
    });

    describe("POST /v1/objects/value", () => {
        it("returns bulk VQT response", async () => {
            const { app } = createE2eApp();
            const res = await request(app)
                .post("/v1/objects/value")
                .send({ elementIds: ["obj-cnc-1", "obj-robot-1", "missing"], maxDepth: 1 });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            const results = res.body.result.results;
            expect(results).toHaveLength(3);

            /* First: has value */
            expect(results[0].elementId).toBe("obj-cnc-1");
            expect(results[0].success).toBe(true);
            expect(results[0].result).toHaveProperty("value");
            expect(results[0].result).toHaveProperty("quality");
            expect(results[0].result).toHaveProperty("timestamp");

            /* Second: has value */
            expect(results[1].elementId).toBe("obj-robot-1");
            expect(results[1].success).toBe(true);

            /* Third: no value */
            expect(results[2].elementId).toBe("missing");
            expect(results[2].success).toBe(false);
        });
    });

    /* ---- Query: History ---- */

    describe("GET /v1/objects/:elementId/history", () => {
        it("returns history array in envelope", async () => {
            const { app } = createE2eApp();
            const res = await request(app)
                .get("/v1/objects/obj-cnc-1/history")
                .query({
                    startTime: "2026-01-01T00:00:00Z",
                    endTime: "2026-01-02T00:00:00Z",
                });

            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toMatch(/application\/json/);
            expect(res.body.success).toBe(true);

            const result = res.body.result;
            expect(result).toHaveProperty("elementId", "obj-cnc-1");
            expect(Array.isArray(result.values)).toBe(true);
            expect(result.values).toHaveLength(3);

            for (const vqt of result.values) {
                expect(vqt).toHaveProperty("value");
                expect(vqt).toHaveProperty("quality");
                expect(vqt).toHaveProperty("timestamp");
            }
        });

        it("returns 400 when startTime and endTime are missing", async () => {
            const { app } = createE2eApp();
            const res = await request(app).get("/v1/objects/obj-cnc-1/history");

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toHaveProperty("message");
        });

        it("returns 400 when only startTime is provided", async () => {
            const { app } = createE2eApp();
            const res = await request(app)
                .get("/v1/objects/obj-cnc-1/history")
                .query({ startTime: "2026-01-01T00:00:00Z" });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });

        it("returns 400 when only endTime is provided", async () => {
            const { app } = createE2eApp();
            const res = await request(app)
                .get("/v1/objects/obj-cnc-1/history")
                .query({ endTime: "2026-01-02T00:00:00Z" });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });
    });

    describe("POST /v1/objects/history", () => {
        it("returns bulk history response", async () => {
            const { app } = createE2eApp();
            const res = await request(app)
                .post("/v1/objects/history")
                .send({
                    elementIds: ["obj-cnc-1", "obj-cnc-2"],
                    startTime: "2026-01-01T00:00:00Z",
                    endTime: "2026-01-02T00:00:00Z",
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            const results = res.body.result.results;
            expect(results).toHaveLength(2);

            expect(results[0].elementId).toBe("obj-cnc-1");
            expect(results[0].success).toBe(true);
            expect(results[0].result.values).toHaveLength(3);

            expect(results[1].elementId).toBe("obj-cnc-2");
            expect(results[1].success).toBe(true);
            expect(results[1].result.values).toHaveLength(0);
        });

        it("returns 400 when time params are missing", async () => {
            const { app } = createE2eApp();
            const res = await request(app)
                .post("/v1/objects/history")
                .send({ elementIds: ["obj-cnc-1"] });

            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });
    });

    /* ---- Subscribe ---- */

    describe("POST /v1/subscriptions", () => {
        it("creates subscription with correct shape", async () => {
            const { app } = createE2eApp();
            const res = await request(app)
                .post("/v1/subscriptions")
                .send({ clientId: "test-client", displayName: "My Sub" });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            const sub = res.body.result;
            expect(sub).toHaveProperty("clientId", "test-client");
            expect(sub).toHaveProperty("subscriptionId");
            expect(sub).toHaveProperty("displayName");
            expect(typeof sub.subscriptionId).toBe("string");
        });
    });

    describe("POST /v1/subscriptions/register", () => {
        it("returns 200 with registration confirmation", async () => {
            const { app } = createE2eApp();
            const res = await request(app)
                .post("/v1/subscriptions/register")
                .send({
                    clientId: "test-client",
                    subscriptionId: "sub-1",
                    elementIds: ["obj-cnc-1", "obj-robot-1"],
                    maxDepth: 1,
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.result).toHaveProperty("registered");
        });
    });

    describe("POST /v1/subscriptions/sync", () => {
        it("returns items array in envelope", async () => {
            const { app } = createE2eApp();
            const res = await request(app)
                .post("/v1/subscriptions/sync")
                .send({
                    clientId: "test-client",
                    subscriptionId: "sub-1",
                    lastSequenceNumber: 0,
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);

            const items = res.body.result;
            expect(Array.isArray(items)).toBe(true);
            expect(items).toHaveLength(2);

            for (const item of items) {
                expect(item).toHaveProperty("sequenceNumber");
                expect(item).toHaveProperty("elementId");
                expect(item).toHaveProperty("value");
                expect(item).toHaveProperty("quality");
                expect(item).toHaveProperty("timestamp");
                expect(typeof item.sequenceNumber).toBe("number");
            }
        });
    });

    describe("POST /v1/subscriptions/list", () => {
        it("returns subscription details", async () => {
            const { app } = createE2eApp();
            const res = await request(app)
                .post("/v1/subscriptions/list")
                .send({ clientId: "test-client", subscriptionIds: ["sub-1"] });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.result)).toBe(true);
        });
    });

    describe("POST /v1/subscriptions/delete", () => {
        it("returns 200 with deleted confirmation", async () => {
            const { app } = createE2eApp();
            const res = await request(app)
                .post("/v1/subscriptions/delete")
                .send({ clientId: "test-client", subscriptionIds: ["sub-1"] });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.result).toHaveProperty("deleted");
        });
    });

    /* ---- Response Envelope Validation ---- */

    describe("Response envelope compliance", () => {
        it("every success response has { success: true, result: ... }", async () => {
            const { app } = createE2eApp();

            const responses = await Promise.all([
                request(app).get("/v1/info"),
                request(app).get("/v1/namespaces"),
                request(app).get("/v1/objecttypes"),
                request(app).get("/v1/objecttypes/type-cnc"),
                request(app).get("/v1/objects"),
                request(app).get("/v1/objects/obj-cnc-1"),
                request(app).get("/v1/relationshiptypes"),
                request(app).get("/v1/relationshiptypes/rel-has-parent"),
                request(app).get("/v1/objects/obj-cnc-1/value"),
                request(app).get("/v1/objects/obj-cnc-1/related"),
                request(app).get("/v1/objects/obj-cnc-1/history")
                    .query({ startTime: "2026-01-01T00:00:00Z", endTime: "2026-01-02T00:00:00Z" }),
            ]);

            for (const res of responses) {
                expect(res.body).toHaveProperty("success", true);
                expect(res.body).toHaveProperty("result");
            }
        });

        it("every error response has { success: false, error: { message } }", async () => {
            const { app } = createE2eApp();

            const responses = await Promise.all([
                request(app).get("/v1/objecttypes/nonexistent"),
                request(app).get("/v1/objects/nonexistent"),
                request(app).get("/v1/relationshiptypes/nonexistent"),
                request(app).get("/v1/objects/nonexistent/value"),
                request(app).get("/v1/objects/nonexistent/related"),
                request(app).get("/v1/objects/obj-cnc-1/history"),
            ]);

            for (const res of responses) {
                expect(res.body).toHaveProperty("success", false);
                expect(res.body).toHaveProperty("error");
                expect(res.body.error).toHaveProperty("message");
                expect(typeof res.body.error.message).toBe("string");
            }
        });

        it("bulk responses have results array matching input size", async () => {
            const { app } = createE2eApp();
            const ids = ["obj-cnc-1", "nonexistent", "obj-robot-1"];

            const responses = await Promise.all([
                request(app).post("/v1/objecttypes/query")
                    .send({ elementIds: ["type-cnc", "missing", "type-robot"] }),
                request(app).post("/v1/objects/list")
                    .send({ elementIds: ids }),
                request(app).post("/v1/relationshiptypes/query")
                    .send({ elementIds: ["rel-has-parent", "missing", "rel-has-children"] }),
                request(app).post("/v1/objects/value")
                    .send({ elementIds: ids }),
                request(app).post("/v1/objects/history")
                    .send({ elementIds: ids, startTime: "2026-01-01T00:00:00Z", endTime: "2026-01-02T00:00:00Z" }),
                request(app).post("/v1/objects/related")
                    .send({ elementIds: ids }),
            ]);

            for (const res of responses) {
                expect(res.status).toBe(200);
                expect(res.body.success).toBe(true);
                const results = res.body.result.results;
                expect(Array.isArray(results)).toBe(true);
                expect(results).toHaveLength(3);

                /* Each item must have elementId */
                for (const item of results) {
                    expect(item).toHaveProperty("elementId");
                    expect(item).toHaveProperty("success");
                }
            }
        });
    });

    /* ---- Readiness ---- */

    describe("Readiness gate", () => {
        it("returns 503 for all main endpoints when not ready", async () => {
            const { app, objectTree } = createE2eApp();
            objectTree.isReady.mockReturnValue(false);

            const responses = await Promise.all([
                request(app).get("/v1/namespaces"),
                request(app).get("/v1/objecttypes"),
                request(app).get("/v1/objecttypes/type-cnc"),
                request(app).get("/v1/objects"),
                request(app).get("/v1/objects/obj-cnc-1"),
                request(app).get("/v1/objects/obj-cnc-1/value"),
                request(app).get("/v1/objects/obj-cnc-1/related"),
                request(app).get("/v1/objects/obj-cnc-1/history")
                    .query({ startTime: "2026-01-01T00:00:00Z", endTime: "2026-01-02T00:00:00Z" }),
                request(app).get("/v1/relationshiptypes"),
                request(app).post("/v1/subscriptions").send({ clientId: "c1" }),
                request(app).post("/v1/objects/list").send({ elementIds: [] }),
            ]);

            for (const res of responses) {
                expect(res.status).toBe(503);
                expect(res.body.success).toBe(false);
                expect(res.body.error).toHaveProperty("message");
            }
        });

        it("allows /v1/info even when not ready", async () => {
            const { app, objectTree } = createE2eApp();
            objectTree.isReady.mockReturnValue(false);

            const res = await request(app).get("/v1/info");
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });

    /* ---- Content-Type ---- */

    describe("Content-Type headers", () => {
        it("all JSON responses have application/json content type", async () => {
            const { app } = createE2eApp();

            const responses = await Promise.all([
                request(app).get("/v1/info"),
                request(app).get("/v1/namespaces"),
                request(app).get("/v1/objecttypes"),
                request(app).get("/v1/objects"),
                request(app).get("/v1/objects/obj-cnc-1"),
                request(app).get("/v1/objects/obj-cnc-1/value"),
                request(app).get("/v1/objects/obj-cnc-1/history")
                    .query({ startTime: "2026-01-01T00:00:00Z", endTime: "2026-01-02T00:00:00Z" }),
                request(app).get("/v1/relationshiptypes"),
                request(app).post("/v1/objecttypes/query")
                    .send({ elementIds: ["type-cnc"] }),
                request(app).post("/v1/objects/list")
                    .send({ elementIds: ["obj-cnc-1"] }),
                request(app).post("/v1/objects/value")
                    .send({ elementIds: ["obj-cnc-1"] }),
                request(app).post("/v1/subscriptions")
                    .send({ clientId: "c1" }),
            ]);

            for (const res of responses) {
                expect(res.headers["content-type"]).toMatch(/application\/json/);
            }
        });

        it("error responses also have application/json content type", async () => {
            const { app } = createE2eApp();

            const responses = await Promise.all([
                request(app).get("/v1/objecttypes/nonexistent"),
                request(app).get("/v1/objects/nonexistent"),
                request(app).get("/v1/objects/obj-cnc-1/history"),
            ]);

            for (const res of responses) {
                expect(res.headers["content-type"]).toMatch(/application\/json/);
            }
        });
    });

    /* ---- Cross-endpoint consistency ---- */

    describe("Cross-endpoint consistency", () => {
        it("object from /objects/:id matches same object in /objects list", async () => {
            const { app } = createE2eApp();

            const singleRes = await request(app).get("/v1/objects/obj-cnc-1");
            const listRes = await request(app).get("/v1/objects");

            const fromList = listRes.body.result.find(
                (o: any) => o.elementId === "obj-cnc-1",
            );
            expect(singleRes.body.result).toEqual(fromList);
        });

        it("object type from /objecttypes/:id matches same in /objecttypes list", async () => {
            const { app } = createE2eApp();

            const singleRes = await request(app).get("/v1/objecttypes/type-cnc");
            const listRes = await request(app).get("/v1/objecttypes");

            const fromList = listRes.body.result.find(
                (t: any) => t.elementId === "type-cnc",
            );
            expect(singleRes.body.result).toEqual(fromList);
        });

        it("bulk object list returns same data as individual gets", async () => {
            const { app } = createE2eApp();

            const bulkRes = await request(app)
                .post("/v1/objects/list")
                .send({ elementIds: ["obj-cnc-1", "obj-robot-1"] });

            const single1 = await request(app).get("/v1/objects/obj-cnc-1");
            const single2 = await request(app).get("/v1/objects/obj-robot-1");

            const bulkResults = bulkRes.body.result.results;
            expect(bulkResults[0].result).toEqual(single1.body.result);
            expect(bulkResults[1].result).toEqual(single2.body.result);
        });

        it("value from /objects/:id/value matches bulk value response", async () => {
            const { app } = createE2eApp();

            const singleRes = await request(app).get("/v1/objects/obj-cnc-1/value");
            const bulkRes = await request(app)
                .post("/v1/objects/value")
                .send({ elementIds: ["obj-cnc-1"] });

            const bulkItem = bulkRes.body.result.results[0];
            expect(bulkItem.result).toEqual(singleRes.body.result);
        });
    });
});

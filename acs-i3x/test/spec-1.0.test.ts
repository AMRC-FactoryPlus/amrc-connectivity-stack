/*
 * ACS i3X
 * The i3X 1.0 rules that hold across the address space, checked on a
 * real ObjectTree, SubscriptionManager and APIv1 with a fleet in them.
 * These are the checks the i3X conformance suite makes of a server.
 * Copyright 2026 University of Sheffield
 */

import { describe, it, expect, afterAll } from "@jest/globals";
import express from "express";
import request from "supertest";

import { APIv1 } from "../lib/api-v1.js";
import { ObjType, RelType } from "../lib/constants.js";
import { ObjectTree } from "../lib/object-tree.js";
import { SubscriptionManager } from "../lib/subscriptions.js";
import { ValueCache } from "../lib/value-cache.js";
import { TestObjectTree } from "./helpers/isa95.js";
import { allowAll } from "./helpers/allow-all.js";
// @ts-ignore - plain ESM benchmark fixture
import { pipelineSnapshot } from "../bench/dataset.mjs";

const NS_URI = "urn:ns";

function stack() {
    const objectTree: ObjectTree = new TestObjectTree({ namespaceName: "NS", namespaceUri: NS_URI });
    objectTree.refreshFromSnapshot(pipelineSnapshot(6));
    objectTree.setReady();
    const valueCache = new ValueCache({ objectTree, staleThreshold: 60_000 });
    const subscriptions = new SubscriptionManager({ valueCache, viewers: allowAll, ttl: 60_000 });
    const api = new APIv1({
        access: allowAll, objectTree, valueCache, subscriptions,
        /* No historian: nothing has a value or a history. */
        history: {
            getValues: async () => new Map(),
            getCompositionValue: async () => null,
            getCurrentValue: async () => null,
            streamHistory: async function* () {},
        } as any,
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as any).auth = "p@R"; next(); });
    app.use("/v1", api.infoRoute);
    app.use("/v1", api.routes);
    return { app, objectTree, subscriptions };
}

const s = stack();
afterAll(() => s.subscriptions.destroy());

const get = async (path: string) => (await request(s.app).get(`/v1${path}`)).body.result;
const post = async (path: string, body: object) => (await request(s.app).post(`/v1${path}`).send(body)).body;

describe("i3X 1.0: server info", () => {
    it("reports specification version 1.0 and the whole capabilities matrix", async () => {
        const info = await get("/info");
        expect(info.specVersion).toBe("1.0");
        expect(info.capabilities).toMatchObject({
            query: { history: true },
            update: { current: false, history: false },
            subscribe: { stream: true },
        });
    });
});

describe("i3X 1.0: address space", () => {
    it("lists a type for every typeElementId an object has", async () => {
        const types = new Map((await get("/objecttypes")).map((t: any) => [t.elementId, t]));
        const objects = await get("/objects");
        expect(objects.length).toBeGreaterThan(100);
        for (const o of objects) expect(types.has(o.typeElementId)).toBe(true);
        for (const t of types.values() as Iterable<any>) {
            expect(t.namespaceUri).toBe(NS_URI);
            expect(typeof t.schema).toBe("object");
        }
    });

    it("gives leaf metrics a scalar type, and levels and unknowns an object type", async () => {
        const types = new Map<string, any>((await get("/objecttypes")).map((t: any) => [t.elementId, t]));
        expect(types.get(ObjType.Isa95Level).schema).toEqual({ type: "object" });
        expect(types.get(ObjType.Unknown).schema).toEqual({ type: "object" });
        expect(types.get(ObjType.NumberMetric).schema).toEqual({ type: "number" });
        expect(types.get(ObjType.BooleanMetric).schema).toEqual({ type: "boolean" });
        expect(types.get(ObjType.StringMetric).schema).toEqual({ type: "string" });

        const objects = await get("/objects");
        const leaves = objects.filter((o: any) => !o.isComposition && o.typeElementId !== "isa95-level");
        const used = new Set(leaves.map((o: any) => o.typeElementId));
        expect(used.has(ObjType.Unknown)).toBe(false);
        expect(used.has(ObjType.NumberMetric)).toBe(true);
        expect(used.has(ObjType.StringMetric)).toBe(true);

        /* Every leaf is a data point with a scalar (or open) type, never
         * a ConfigDB schema: its value must conform to its type. */
        const scalar = new Set<string>([ObjType.NumberMetric, ObjType.BooleanMetric, ObjType.StringMetric, ObjType.Metric]);
        for (const o of leaves) expect(scalar.has(o.typeElementId)).toBe(true);

        /* The synthetic types answer the bulk lookup and the filter. */
        const q = await post("/objecttypes/query", { elementIds: [ObjType.NumberMetric, "no-such-type"] });
        expect(q.results.map((r: any) => r.success)).toEqual([true, false]);
        const numbers = await get(`/objects?typeElementId=${ObjType.NumberMetric}`);
        expect(numbers.length).toBeGreaterThan(0);
        expect(numbers.every((o: any) => o.typeElementId === ObjType.NumberMetric)).toBe(true);
    });

    it("registers every relationship type with a reverse that points back", async () => {
        const rels = new Map<string, any>((await get("/relationshiptypes")).map((r: any) => [r.elementId, r]));
        expect([...rels.keys()].sort())
            .toEqual(["ComponentOf", "HasChildren", "HasComponent", "HasParent"]);
        for (const r of rels.values()) expect(rels.get(r.reverseOf).reverseOf).toBe(r.elementId);
    });

    it("has roots with no parent", async () => {
        const roots = await get("/objects?root=true");
        expect(roots.length).toBeGreaterThan(0);
        for (const o of roots) expect(o.parentId).toBeNull();
    });

    it("returns every edge with its reverse, and an edge to every parent", async () => {
        const objects: any[] = await get("/objects");
        const byId = new Map(objects.map(o => [o.elementId, o]));
        const rels = new Map<string, any>((await get("/relationshiptypes")).map((r: any) => [r.elementId, r]));
        const ids = objects.map(o => o.elementId);
        const related = await post("/objects/related", { elementIds: ids });
        expect(related.success).toBe(true);

        const edges = new Set<string>();
        related.results.forEach((item: any) => {
            for (const e of item.result) {
                expect(rels.has(e.sourceRelationship)).toBe(true);
                expect(e.object).toEqual(byId.get(e.object.elementId));
                edges.add(`${item.elementId} ${e.sourceRelationship} ${e.object.elementId}`);
            }
        });
        for (const edge of edges) {
            const [from, rel, to] = edge.split(" ");
            expect(edges.has(`${to} ${rels.get(rel).reverseOf} ${from}`)).toBe(true);
        }
        for (const o of objects) {
            if (o.parentId === null) continue;
            const up = byId.get(o.parentId).typeElementId === ObjType.Isa95Level
                ? RelType.HasParent : RelType.ComponentOf;
            expect(edges.has(`${o.elementId} ${up} ${o.parentId}`)).toBe(true);
        }
        /* Levels organise; devices are made of their metrics. */
        expect([...edges].some(e => e.includes(` ${RelType.HasChildren} `))).toBe(true);
        expect([...edges].some(e => e.includes(` ${RelType.HasComponent} `))).toBe(true);
    });

    it("honours the relationshipType filter", async () => {
        const root = (await get("/objects?root=true"))[0].elementId;
        const all = await post("/objects/related", { elementIds: [root] });
        const down = await post("/objects/related", { elementIds: [root], relationshipType: RelType.HasChildren });
        const none = await post("/objects/related", { elementIds: [root], relationshipType: RelType.HasComponent });
        expect(down.results[0].result.length).toBeGreaterThan(0);
        expect(down.results[0].result).toEqual(all.results[0].result);
        expect(none.results[0].result).toEqual([]);
    });

    it("returns metadata that agrees with the edges", async () => {
        const objects: any[] = await get("/objects?includeMetadata=true");
        const device = objects.find(o => o.isComposition && o.typeElementId !== ObjType.Isa95Level
            && objects.find(p => p.elementId === o.parentId)?.typeElementId === ObjType.Isa95Level);
        expect(device.metadata.typeNamespaceUri).toBe(NS_URI);
        expect(device.metadata.sourceTypeId).toBe(device.typeElementId);
        expect(device.metadata.relationships.HasParent).toBe(device.parentId);
        expect(device.metadata.relationships.HasComponent.length).toBeGreaterThan(0);

        const edges = (await post("/objects/related", { elementIds: [device.elementId] })).results[0].result;
        expect(edges.filter((e: any) => e.sourceRelationship === "HasComponent").map((e: any) => e.object.elementId))
            .toEqual(device.metadata.relationships.HasComponent);

        const listed = await post("/objects/list", { elementIds: [device.elementId], includeMetadata: true });
        expect(listed.results[0].result).toEqual(device);
        const plain = await post("/objects/list", { elementIds: [device.elementId] });
        expect(plain.results[0].result).not.toHaveProperty("metadata");
    });
});

describe("i3X 1.0: values", () => {
    it("answers an object with no data with a null GoodNoData value, and an unknown id with 404", async () => {
        const objects: any[] = await get("/objects");
        const leaf = objects.find(o => !o.isComposition && o.typeElementId !== "isa95-level");
        const res = await post("/objects/value", { elementIds: [leaf.elementId, "no-such-id"] });
        expect(res.success).toBe(false);
        expect(res.results[0]).toMatchObject({ success: true, elementId: leaf.elementId,
            result: { isComposition: false, value: null, quality: "GoodNoData" } });
        expect(res.results[0].result.timestamp).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/);
        expect(res.results[1]).toEqual({ success: false, elementId: "no-such-id",
            responseDetail: { title: "Not Found", status: 404, detail: "Element not found: no-such-id" } });
    });

    it("answers history with the result shape of 1.0", async () => {
        const objects: any[] = await get("/objects");
        const leaf = objects.find(o => !o.isComposition && o.typeElementId !== "isa95-level");
        const res = await post("/objects/history", {
            elementIds: [leaf.elementId, "no-such-id"],
            startTime: "2026-11-01T00:00:00Z", endTime: "2026-11-02T00:00:00Z",
        });
        expect(res.results[0]).toEqual({ success: true, elementId: leaf.elementId,
            result: { isComposition: false, values: [] } });
        expect(res.results[1].responseDetail.status).toBe(404);
    });
});

describe("i3X 1.0: subscriptions", () => {
    const push = (id: string, value: number) => (s.subscriptions as any).onValueChange(id,
        { value, quality: "Good", timestamp: "2026-11-03T00:00:00Z" });

    it("scopes a subscription to its clientId and syncs in batches", async () => {
        const leaf = (await get("/objects")).find((o: any) => !o.isComposition && o.typeElementId !== "isa95-level").elementId;
        const made = await post("/subscriptions", { clientId: "c-1", displayName: "mine" });
        expect(made.result).toEqual({ clientId: "c-1", subscriptionId: expect.any(String), displayName: "mine" });
        const subscriptionId = made.result.subscriptionId;
        const mine = { clientId: "c-1", subscriptionId };

        const reg = await post("/subscriptions/register", { ...mine, elementIds: [leaf, leaf, "no-such-id"] });
        expect(reg.results.map((r: any) => r.success)).toEqual([true, true, false]);

        /* Another clientId sees nothing of it. */
        const other = await request(s.app).post("/v1/subscriptions/sync").send({ clientId: "c-2", subscriptionId });
        expect(other.status).toBe(404);
        const otherList = await post("/subscriptions/list", { clientId: "c-2", subscriptionIds: [subscriptionId] });
        expect(otherList.results[0].success).toBe(false);
        const none = await request(s.app).post("/v1/subscriptions/sync").send({ subscriptionId });
        expect(none.status).toBe(400);

        expect((await post("/subscriptions/sync", mine)).result).toEqual([]);
        push(leaf, 1);
        push(leaf, 2);
        const first = (await post("/subscriptions/sync", mine)).result;
        expect(first).toEqual([{ sequenceNumber: 1, updates: [
            { elementId: leaf, value: 1, quality: "Good", timestamp: "2026-11-03T00:00:00Z" },
            { elementId: leaf, value: 2, quality: "Good", timestamp: "2026-11-03T00:00:00Z" },
        ] }]);
        push(leaf, 3);
        const second = (await post("/subscriptions/sync", { ...mine, lastSequenceNumber: 1 })).result;
        expect(second.map((b: any) => [b.sequenceNumber, b.updates.length])).toEqual([[2, 1]]);
        expect((await post("/subscriptions/sync", { ...mine, lastSequenceNumber: -1 })).result).toEqual([]);

        const listed = await post("/subscriptions/list", { clientId: "c-1", subscriptionIds: [subscriptionId] });
        expect(listed.results[0].result.monitoredObjects).toEqual([{ elementId: leaf, maxDepth: 1 }]);

        const gone = await post("/subscriptions/delete", { clientId: "c-1", subscriptionIds: [subscriptionId] });
        expect(gone).toEqual({ success: true, results: [{ success: true, subscriptionId, result: null }] });
        const after = await request(s.app).post("/v1/subscriptions/sync").send(mine);
        expect(after.status).toBe(404);
        expect(after.body.responseDetail).toMatchObject({ title: "Not Found", status: 404 });
    });
});

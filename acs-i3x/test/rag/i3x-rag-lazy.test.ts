/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * Lazy rebuild of I3xRag. The tree marks the RAG dirty on every change
 * (ObjectTree.onChange), and the next query rebuilds it. These tests check
 * that a lazily rebuilt RAG answers every query exactly as a full
 * rebuild from the same tree does (the old behaviour), across config
 * changes and UNS-discovered nodes, and that a failed rebuild keeps
 * the previous index.
 */

import { jest } from "@jest/globals";
import { I3xRag } from "../../lib/rag/i3x-rag.js";
import type { ValueCacheLike } from "../../lib/rag/i3x-rag.js";
import { ObjectTree } from "../../lib/object-tree.js";
import { createMockHistory } from "../helpers/mock-rag.js";
// @ts-ignore - plain ESM benchmark fixture
import { device, deviceUuid, pipelineSnapshot } from "../../bench/dataset.mjs";

const FPLUS = { debug: { bound: () => () => {} } };

function makeTree(n: number): ObjectTree {
    const tree = new ObjectTree({ fplus: FPLUS, namespaceName: "NS", namespaceUri: "urn:ns" });
    tree.refreshFromSnapshot(pipelineSnapshot(n));
    return tree;
}

/* Deterministic values for about half the leaves, with mixed quality
 * and timestamps, so valueFilter and staleValues return something. */
function makeValueCache(): ValueCacheLike {
    const h = (s: string) => {
        let x = 2166136261;
        for (let k = 0; k < s.length; k++) x = Math.imul(x ^ s.charCodeAt(k), 16777619);
        return x >>> 0;
    };
    return {
        getValue: (id: string) => {
            const v = h(id);
            if (v % 2 === 0) return null;
            return {
                elementId: id,
                isComposition: false,
                value: v % 1000,
                quality: v % 3 === 0 ? "Bad" : "Good",
                timestamp: new Date(Date.UTC(2026, 0, 1) + (v % 1000) * 1000).toISOString(),
            };
        },
    };
}

/* Publish one UNS metric under device i, creating UNS-source nodes. */
function addUns(tree: ObjectTree, i: number, path: string[]): string | null {
    const uuid = deviceUuid(i);
    return tree.addCompositionFromUns([uuid], [device(i).originMap.Schema_UUID], path);
}

/* Count search hits for the UNS leaf name (prefix search also finds "Brakes"). */
const pressureHits = (rag: I3xRag) =>
    rag.search("Brake_Pressure").filter(r => r.displayName === "Brake_Pressure").length;

/* Every public query, with representative inputs. */
async function answers(rag: I3xRag, ids: { dev: string; dev2: string; leaf: string; uns: string | null }) {
    const types = rag.relationshipMap().map(e => e.fromType).sort();
    return {
        nodeCount: rag.nodeCount(),
        edgeCount: rag.edgeCount(),
        search: rag.search("Traffic Signal 1"),
        searchFuzzy: rag.search("Temprature", 50),
        searchUns: rag.search("Brake_Pressure"),
        searchByType: rag.searchByType(types[0] ?? "", "Signal", 50),
        searchRelated: rag.searchRelated("Status", 2, 10),
        traverse: rag.traverse(ids.dev, 2),
        neighborhood: rag.neighborhood(ids.leaf),
        neighborhoodUns: ids.uns ? rag.neighborhood(ids.uns, 3) : null,
        findPath: rag.findPath(ids.leaf, ids.dev2),
        findPathUns: ids.uns ? rag.findPath(ids.uns, ids.dev2) : null,
        compositionTree: rag.compositionTree(ids.dev),
        compositionTreeDepth: rag.compositionTree(ids.dev, 1),
        relationshipMap: rag.relationshipMap(),
        typeSchemas: [...new Set(types)].map(t => rag.typeSchema(t)),
        valueFilterMissing: rag.valueFilter({ missing: true }),
        valueFilterGood: rag.valueFilter({ quality: "Good", minValue: 100, maxValue: 800 }),
        staleValues: rag.staleValues(0),
        getValues: await rag.getValues([ids.dev, ids.leaf, ...(ids.uns ? [ids.uns] : [])]),
    };
}

/* What the old code served: a full rebuild from the same tree. */
function reference(tree: ObjectTree, vc: ValueCacheLike): I3xRag {
    const rag = new I3xRag(tree, vc, createMockHistory());
    rag.init();
    return rag;
}

describe("I3xRag lazy rebuild", () => {
    it("answers every query as a full rebuild does, across config and UNS changes", async () => {
        const N = 30;
        const tree = makeTree(N);
        const vc = makeValueCache();
        const rag = new I3xRag(tree, vc, createMockHistory());
        rag.init();

        const leafOf = (i: number) =>
            tree.getChildElementIds(deviceUuid(i))
                .find(id => tree.getObject(id)?.isComposition === false)!;
        const ids = { dev: deviceUuid(2), dev2: deviceUuid(7), leaf: leafOf(4), uns: null as string | null };

        let prev = pipelineSnapshot(N);
        const steps: Array<[string, () => void]> = [
            ["add devices", () => {
                const next = pipelineSnapshot(N + 5);
                tree.refreshFromSnapshot(next); prev = next;
            }],
            ["remove a device", () => {
                const next = pipelineSnapshot(N + 5);
                next.devices.delete(deviceUuid(3));
                tree.refreshFromSnapshot(next); prev = next;
            }],
            ["rename a device", () => {
                const next = pipelineSnapshot(N + 5);
                next.devices.delete(deviceUuid(3));
                next.devices.get(deviceUuid(1)).info = { name: "Renamed Signal" };
                tree.refreshFromSnapshot(next); prev = next;
            }],
            ["UNS-discovered nodes", () => {
                ids.uns = addUns(tree, 2, ["Brakes", "Front", "Brake_Pressure"]);
                addUns(tree, 9, ["Brakes", "Rear", "Brake_Pressure"]);
            }],
            ["replace a device subtree", () => {
                const next = pipelineSnapshot(N + 5);
                next.devices.delete(deviceUuid(3));
                next.devices.get(deviceUuid(1)).info = { name: "Renamed Signal" };
                const d5 = next.devices.get(deviceUuid(5));
                d5.devInfo = { ...d5.devInfo, sparkplugName: "Changed" };
                tree.refreshFromSnapshot(next); prev = next;
            }],
            ["full swap keeps UNS nodes", () => {
                tree.refreshFromSnapshot(prev);
            }],
        ];

        for (const [name, step] of steps) {
            step();
            rag.markDirty();
            const got = await answers(rag, ids);
            const want = await answers(reference(tree, vc), ids);
            expect({ name, got }).toEqual({ name, got: want });
        }
        // Sanity: the UNS nodes made it into the index.
        expect(pressureHits(rag)).toBe(2);
    });

    it("does not rebuild on markDirty, and rebuilds once on the next query", () => {
        const tree = makeTree(10);
        const rag = new I3xRag(tree, makeValueCache(), createMockHistory());
        rag.init();
        const spy = jest.spyOn(tree, "getObjects");

        for (let k = 0; k < 50; k++) rag.markDirty();
        expect(spy).not.toHaveBeenCalled();

        rag.search("Signal");
        rag.traverse(deviceUuid(1));
        rag.relationshipMap();
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it("sees tree changes made after markDirty", () => {
        const tree = makeTree(5);
        const rag = new I3xRag(tree, makeValueCache(), createMockHistory());
        rag.init();
        expect(pressureHits(rag)).toBe(0);

        addUns(tree, 1, ["Brakes", "Brake_Pressure"]);
        rag.markDirty();
        expect(pressureHits(rag)).toBe(1);
    });

    it("keeps serving the previous index when a rebuild throws, and retries", () => {
        const tree = makeTree(5);
        const rag = new I3xRag(tree, makeValueCache(), createMockHistory());
        rag.init();
        const before = rag.search("Traffic Signal 2");
        const nodes = rag.nodeCount();
        expect(before.length).toBeGreaterThan(0);

        addUns(tree, 1, ["Brakes", "Brake_Pressure"]);
        const err = jest.spyOn(console, "error").mockImplementation(() => {});
        const spy = jest.spyOn(tree, "getObjects")
            .mockImplementation(() => { throw new Error("boom"); });
        rag.markDirty();

        expect(rag.search("Traffic Signal 2")).toEqual(before);
        expect(rag.nodeCount()).toBe(nodes);
        expect(rag.compositionTree(deviceUuid(2))).not.toBeNull();
        expect(err).toHaveBeenCalled();

        // The failure leaves the RAG dirty, so once the tree can be read
        // again the next query rebuilds and sees the new nodes.
        spy.mockRestore();
        err.mockRestore();
        expect(pressureHits(rag)).toBe(1);
        expect(rag.nodeCount()).toBe(nodes + 2);
    });

    it("does not rebuild for getHistory", async () => {
        const tree = makeTree(3);
        const rag = new I3xRag(tree, makeValueCache(), createMockHistory());
        rag.init();
        rag.markDirty();
        const spy = jest.spyOn(tree, "getObjects");
        await rag.getHistory(deviceUuid(1), "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z");
        expect(spy).not.toHaveBeenCalled();
    });
});

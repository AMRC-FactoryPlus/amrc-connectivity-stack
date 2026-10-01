/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { ObjectTree } from "../lib/object-tree.js";
import { createMockFplus } from "./helpers/mock-services.js";

/*
 * preserveUnsNodes walks a work queue. It used to drain the queue with
 * queue.shift(), which is O(n) per call, so the walk was quadratic. These
 * tests check the index walk gives exactly the same tree as the shift
 * version, and stays fast on a large tree.
 */

type Snap = {
    objectTypes: Map<string, any>;
    objects: Map<string, any>;
    children: Map<string, Set<string>>;
    metricMeta: Map<string, any>;
    sources: Map<string, "config" | "uns">;
};

function emptySnap(): Snap {
    return {
        objectTypes: new Map(),
        objects: new Map(),
        children: new Map(),
        metricMeta: new Map(),
        sources: new Map(),
    };
}

function makeTree(): any {
    return new ObjectTree({
        fplus: createMockFplus(),
        namespaceName: "Factory+",
        namespaceUri: "urn:factoryplus:ns",
    });
}

/** The previous implementation, kept verbatim as the reference. */
function preserveUnsNodesWithShift(tree: any, old: Snap, next: Snap): void {
    const queue: string[] = [...next.objects.keys()];
    while (queue.length > 0) {
        const parentId = queue.shift()!;
        const oldChildren = old.children.get(parentId);
        if (!oldChildren) continue;
        for (const childId of oldChildren) {
            if (next.objects.has(childId)) continue;
            if (old.sources.get(childId) !== "uns") continue;
            tree.copyUnsSubtree(childId, old, next);
            queue.push(childId);
        }
    }
}

/** Small deterministic PRNG so failures reproduce. */
function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function addNode(snap: Snap, id: string, parentId: string | null, source: "config" | "uns") {
    snap.objects.set(id, { elementId: id, displayName: id, parentId });
    snap.sources.set(id, source);
    if (parentId !== null) {
        if (!snap.children.has(parentId)) snap.children.set(parentId, new Set());
        snap.children.get(parentId)!.add(id);
    }
}

/**
 * Build an old snapshot with `configCount` config nodes and `unsCount` UNS
 * nodes hung at random depths, then a next snapshot that keeps most config
 * nodes, drops some (orphaning their UNS children) and promotes some UNS
 * nodes to config (config wins).
 */
function buildPair(seed: number, configCount: number, unsCount: number, chain = false) {
    const rand = rng(seed);
    const old = emptySnap();
    const ids: string[] = [];
    for (let i = 0; i < configCount; i++) {
        const id = `c${i}`;
        const parent = i === 0 || rand() < 0.1 ? null : ids[Math.floor(rand() * ids.length)];
        addNode(old, id, parent, "config");
        ids.push(id);
    }
    const unsIds: string[] = [];
    for (let i = 0; i < unsCount; i++) {
        const id = `u${i}`;
        let parent: string;
        if (chain && i > 0 && rand() < 0.7) parent = unsIds[unsIds.length - 1];
        else parent = ids[Math.floor(rand() * ids.length)];
        addNode(old, id, parent, "uns");
        ids.push(id);
        unsIds.push(id);
    }

    const next = emptySnap();
    for (const [id, obj] of old.objects) {
        if (old.sources.get(id) === "config") {
            if (rand() < 0.15) continue;
            addNode(next, id, obj.parentId, "config");
        } else if (rand() < 0.05) {
            addNode(next, id, obj.parentId, "config");
        }
    }
    for (const id of unsIds) {
        if (rand() < 0.3) old.metricMeta.set(id, { name: id });
    }
    return { old, next };
}

function clone(s: Snap): Snap {
    const c = emptySnap();
    c.objectTypes = new Map(s.objectTypes);
    c.objects = new Map(s.objects);
    c.children = new Map([...s.children].map(([k, v]) => [k, new Set(v)]));
    c.metricMeta = new Map(s.metricMeta);
    c.sources = new Map(s.sources);
    return c;
}

/** Entries as arrays, so Map and Set insertion order is compared too. */
function dump(s: Snap) {
    return {
        objects: [...s.objects],
        children: [...s.children].map(([k, v]) => [k, [...v]]),
        metricMeta: [...s.metricMeta],
        sources: [...s.sources],
    };
}

describe("preserveUnsNodes index walk", () => {
    it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])(
        "matches the shift version on a random tree (seed %i)",
        (seed) => {
            const { old, next } = buildPair(seed, 200, 600, seed % 2 === 0);
            const tree = makeTree();
            const expected = clone(next);
            const actual = clone(next);

            preserveUnsNodesWithShift(tree, old, expected);
            tree.preserveUnsNodes(old, actual);

            expect(actual.objects.size).toBeGreaterThan(next.objects.size);
            expect(dump(actual)).toEqual(dump(expected));
        });

    it("keeps nested UNS subtrees at many depths", () => {
        const old = emptySnap();
        addNode(old, "root", null, "config");
        let parent = "root";
        for (let d = 0; d < 50; d++) {
            addNode(old, `u${d}`, parent, "uns");
            parent = `u${d}`;
        }
        const next = emptySnap();
        addNode(next, "root", null, "config");
        makeTree().preserveUnsNodes(old, next);
        expect(next.objects.size).toBe(51);
        expect(next.sources.get("u49")).toBe("uns");
    });

    it("drops UNS nodes whose parent is gone", () => {
        const old = emptySnap();
        addNode(old, "gone", null, "config");
        addNode(old, "orphan", "gone", "uns");
        const next = emptySnap();
        makeTree().preserveUnsNodes(old, next);
        expect(next.objects.size).toBe(0);
    });

    it("walks about 300k nodes quickly", () => {
        const { old, next } = buildPair(42, 100_000, 200_000);
        const tree = makeTree();
        const actual = clone(next);

        const t0 = performance.now();
        tree.preserveUnsNodes(old, actual);
        const indexMs = performance.now() - t0;
        console.log(`index walk, ${old.objects.size} nodes: ${indexMs.toFixed(0)} ms`);

        // The shift version takes several seconds here, so only run it
        // when asked. It also proves the results match at this size.
        if (process.env.COMPARE_SHIFT) {
            const expected = clone(next);
            const t1 = performance.now();
            preserveUnsNodesWithShift(tree, old, expected);
            const shiftMs = performance.now() - t1;
            console.log(`shift walk, ${old.objects.size} nodes: ${shiftMs.toFixed(0)} ms`);
            expect(dump(actual)).toEqual(dump(expected));
        }

        expect(indexMs).toBeLessThan(2000);
    }, 120_000);
});

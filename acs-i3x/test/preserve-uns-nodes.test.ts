/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { ObjectTree } from "../lib/object-tree.js";
import { createMockFplus } from "./helpers/mock-services.js";

/*
 * UNS-discovered nodes must survive a config-driven rebuild of their
 * device while their parent survives. The rule, which the in-memory
 * tree's preserveUnsNodes / captureUnsDescendants implemented:
 *
 *  - walk the old subtree in pre-order;
 *  - a UNS node is kept, under its old parent, if the new config does
 *    not define it and its parent exists in the new tree (from config,
 *    or kept earlier in the walk);
 *  - a UNS node the new config does define becomes config (config wins).
 *
 * These tests build random device trees with UNS nodes at random
 * depths, change the config, and check the SQLite-backed tree against
 * that rule computed independently here.
 */

const HIERARCHY = "84ac3397-f3a2-440a-99e5-5bb9f6a75091";
const DEV = "dev-preserve";
const SCHEMA = "schema-preserve";

function makeTree(): ObjectTree {
    return new ObjectTree({
        fplus: createMockFplus(),
        namespaceName: "Factory+",
        namespaceUri: "urn:factoryplus:ns",
    });
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

/** A config container: has an Instance_UUID and one leaf, `v`. */
interface CNode { id: string; key: string; parent: CNode | null; path: string[]; kids: CNode[] }

function devInfo(roots: CNode[], keep: (n: CNode) => boolean, extra: Map<string, Array<{ key: string; id: string }>>) {
    const build = (n: CNode): any => {
        const out: any = { Schema_UUID: "s", Instance_UUID: n.id, v: { Sparkplug_Type: "Float" } };
        for (const k of n.kids) if (keep(k)) out[k.key] = build(k);
        for (const p of extra.get(n.id) ?? [])
            out[p.key] = { Schema_UUID: "s", Instance_UUID: p.id, v: { Sparkplug_Type: "Float" } };
        return out;
    };
    const originMap: any = {
        Schema_UUID: SCHEMA,
        Instance_UUID: DEV,
        Device_Information: {
            Schema_UUID: "2dd093e9-1450-44c5-be8c-c0d78e48219b",
            ISA95_Hierarchy: { Schema_UUID: HIERARCHY, Enterprise: { Value: "AMRC" } },
        },
    };
    for (const r of roots) if (keep(r)) originMap[r.key] = build(r);
    for (const p of extra.get(DEV) ?? [])
        originMap[p.key] = { Schema_UUID: "s", Instance_UUID: p.id, v: { Sparkplug_Type: "Float" } };
    return { schema: SCHEMA, sparkplugName: "Dev", originMap };
}

/** Every node under `root`, pre-order, with source and parent. */
function walk(tree: ObjectTree, root: string) {
    const out: Array<{ id: string; parent: string; source: string | undefined }> = [];
    const visit = (id: string) => {
        for (const c of tree.getChildElementIds(id)) {
            out.push({ id: c, parent: id, source: tree.getNodeSource(c) });
            visit(c);
        }
    };
    visit(root);
    return out;
}

function scenario(seed: number, configCount: number, unsCount: number, chain: boolean) {
    const rand = rng(seed);
    const tree = makeTree();

    const roots: CNode[] = [];
    const all: CNode[] = [];
    for (let i = 0; i < configCount; i++) {
        const parent = all.length === 0 || rand() < 0.1 ? null : all[Math.floor(rand() * all.length)];
        const key = `n${i}`;
        const n: CNode = { id: `c${i}`, key, parent, path: [...(parent?.path ?? []), key], kids: [] };
        (parent ? parent.kids : roots).push(n);
        all.push(n);
    }
    tree.addDevice(DEV, devInfo(roots, () => true, new Map()), { name: "Dev" });

    /* UNS nodes hang under a config container or, with `chain`, under
     * the previous UNS node. Each message names the whole path from the
     * device, as the UNS topic does. */
    const unsPaths: string[][] = [];
    for (let j = 0; j < unsCount; j++) {
        const under = chain && j > 0 && rand() < 0.7
            ? unsPaths[unsPaths.length - 1]
            : all[Math.floor(rand() * all.length)].path;
        const path = [...under, `u${j}`];
        tree.addCompositionFromUns([DEV], [SCHEMA], path);
        unsPaths.push(path);
    }

    const before = walk(tree, DEV);
    const unsBefore = before.filter(n => n.source === "uns");
    expect(unsBefore.length).toBe(unsCount);

    /* New config: drop some containers (with their subtrees) and
     * declare some UNS nodes that sit directly under a surviving
     * container. */
    const dropped = new Set(all.filter(() => rand() < 0.15).map(n => n.id));
    const isDropped = (n: CNode): boolean =>
        dropped.has(n.id) || (n.parent ? isDropped(n.parent) : false);
    const keep = (n: CNode) => !isDropped(n);
    const configIds = new Set(all.filter(keep).map(n => n.id));
    const promoted = new Map<string, Array<{ key: string; id: string }>>();
    const promotedIds = new Set<string>();
    for (const u of unsBefore) {
        if (!configIds.has(u.parent) || rand() >= 0.05) continue;
        const name = tree.getObject(u.id)!.displayName;
        if (!promoted.has(u.parent)) promoted.set(u.parent, []);
        promoted.get(u.parent)!.push({ key: name, id: u.id });
        promotedIds.add(u.id);
    }

    /* The rule, computed from the old tree alone. */
    const present = new Set<string>([DEV, ...configIds, ...promotedIds]);
    const kept = new Map<string, string>();
    for (const u of unsBefore) {
        if (present.has(u.id)) continue;
        if (!present.has(u.parent)) continue;
        present.add(u.id);
        kept.set(u.id, u.parent);
    }

    tree.replaceDeviceSubtree(DEV, devInfo(roots, keep, promoted), { name: "Dev" });

    const after = walk(tree, DEV);
    const unsAfter = new Map(after.filter(n => n.source === "uns").map(n => [n.id, n.parent]));
    expect(unsAfter).toEqual(kept);
    for (const id of promotedIds) expect(tree.getNodeSource(id)).toBe("config");
    for (const id of dropped) expect(tree.getObject(id)).toBeUndefined();

    /* Nothing outside the device and its ISA-95 chain is left over. */
    const isa = tree.getObjects().filter(o => o.typeElementId === "isa95-level");
    expect(tree.objectCount()).toBe(after.length + 1 + isa.length);
    return { kept: kept.size, dropped: unsCount - kept.size };
}

describe("UNS nodes across a device rebuild", () => {
    it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])(
        "keeps exactly the UNS nodes whose parent survives (seed %i)",
        (seed) => {
            const { kept, dropped } = scenario(seed, 120, 300, seed % 2 === 0);
            // Both outcomes happen, so the test checks something.
            expect(kept).toBeGreaterThan(0);
            expect(dropped).toBeGreaterThan(0);
        });

    it("keeps nested UNS subtrees at many depths", () => {
        const tree = makeTree();
        const info = devInfo([], () => true, new Map());
        tree.addDevice(DEV, info, { name: "Dev" });
        const path = Array.from({ length: 50 }, (_, d) => `u${d}`);
        const leaf = tree.addCompositionFromUns([DEV], [SCHEMA], path)!;

        tree.replaceDeviceSubtree(DEV, info, { name: "Dev" });
        expect(walk(tree, DEV).filter(n => n.source === "uns")).toHaveLength(50);
        expect(tree.getNodeSource(leaf)).toBe("uns");
    });

    it("drops UNS nodes whose parent is gone", () => {
        const tree = makeTree();
        const gone: CNode = { id: "gone", key: "Gone", parent: null, path: ["Gone"], kids: [] };
        tree.addDevice(DEV, devInfo([gone], () => true, new Map()), { name: "Dev" });
        const orphan = tree.addCompositionFromUns([DEV], [SCHEMA], ["Gone", "Orphan"])!;
        expect(tree.getObject(orphan)!.parentId).toBe("gone");

        tree.replaceDeviceSubtree(DEV, devInfo([gone], () => false, new Map()), { name: "Dev" });
        expect(tree.getObject("gone")).toBeUndefined();
        expect(tree.getObject(orphan)).toBeUndefined();
    });

    it("drops a device's UNS nodes with the device", () => {
        const tree = makeTree();
        tree.addDevice(DEV, devInfo([], () => true, new Map()), { name: "Dev" });
        const leaf = tree.addCompositionFromUns([DEV], [SCHEMA], ["A", "B"])!;
        tree.refreshFromSnapshot({ devices: new Map(), schemas: new Map() });
        expect(tree.getObject(leaf)).toBeUndefined();
        expect(tree.objectCount()).toBe(0);
    });

    it("rebuilds a large device quickly", () => {
        const t0 = performance.now();
        scenario(42, 2_000, 6_000, true);
        const ms = performance.now() - t0;
        console.log(`2,000 config + 6,000 UNS nodes, build and rebuild: ${ms.toFixed(0)} ms`);
        // A wall-clock bound flakes on a busy machine, so only assert
        // it when asked.
        if (process.env.CHECK_TIMING)
            expect(ms).toBeLessThan(10_000);
    }, 120_000);
});

import { I3xRag, ObjectTreeLike, ValueCacheLike, HistoryLike, SearchResult, SearchRelatedResult, TraversalNode, CompositionTreeNode } from "../../src/rag/i3x-rag.js";
import type { I3xObject, I3xVqt } from "../../src/types/i3x.js";

/*
 * Mock object tree:
 *
 * Enterprise (root, composition, type: isa95-level)
 *   └── Site (composition, type: isa95-level)
 *         ├── Device_A (composition, type: schema-cnc)
 *         │     ├── Axes (composition, type: schema-axes)
 *         │     │     ├── X (composition, type: schema-axis)
 *         │     │     │     └── Position (leaf, type: metric)
 *         │     │     └── Y (composition, type: schema-axis)
 *         │     │           └── Position (leaf, type: metric)
 *         │     └── Spindle (composition, type: schema-spindle)
 *         │           └── Speed (leaf, type: metric)
 *         └── Device_B (composition, type: schema-robot)
 *               └── Joint1 (composition, type: schema-joint)
 *                     └── Angle (leaf, type: metric)
 *
 * 13 objects, 12 parent-child edges.
 */

const objects: I3xObject[] = [
    { elementId: "enterprise",  displayName: "Enterprise",  typeElementId: "isa95-level",    parentId: null,         isComposition: true,  isExtended: false },
    { elementId: "site",        displayName: "Site",        typeElementId: "isa95-level",    parentId: "enterprise", isComposition: true,  isExtended: false },
    { elementId: "device-a",    displayName: "Device_A",    typeElementId: "schema-cnc",     parentId: "site",       isComposition: true,  isExtended: false },
    { elementId: "device-b",    displayName: "Device_B",    typeElementId: "schema-robot",   parentId: "site",       isComposition: true,  isExtended: false },
    { elementId: "axes",        displayName: "Axes",        typeElementId: "schema-axes",    parentId: "device-a",   isComposition: true,  isExtended: false },
    { elementId: "spindle",     displayName: "Spindle",     typeElementId: "schema-spindle", parentId: "device-a",   isComposition: true,  isExtended: false },
    { elementId: "x-axis",      displayName: "X",           typeElementId: "schema-axis",    parentId: "axes",       isComposition: true,  isExtended: false },
    { elementId: "y-axis",      displayName: "Y",           typeElementId: "schema-axis",    parentId: "axes",       isComposition: true,  isExtended: false },
    { elementId: "x-pos",       displayName: "Position",    typeElementId: "metric",         parentId: "x-axis",     isComposition: false, isExtended: false },
    { elementId: "y-pos",       displayName: "Position",    typeElementId: "metric",         parentId: "y-axis",     isComposition: false, isExtended: false },
    { elementId: "spindle-spd", displayName: "Speed",       typeElementId: "metric",         parentId: "spindle",    isComposition: false, isExtended: false },
    { elementId: "joint1",      displayName: "Joint1",      typeElementId: "schema-joint",   parentId: "device-b",   isComposition: true,  isExtended: false },
    { elementId: "joint1-angle",displayName: "Angle",       typeElementId: "metric",         parentId: "joint1",     isComposition: false, isExtended: false },
];

/* Build a children map from the objects for the mock. */
const childrenMap = new Map<string, string[]>();
for (const obj of objects) {
    if (obj.parentId && obj.parentId !== "/") {
        const siblings = childrenMap.get(obj.parentId) ?? [];
        siblings.push(obj.elementId);
        childrenMap.set(obj.parentId, siblings);
    }
}

const objectMap = new Map(objects.map(o => [o.elementId, o]));

function createMockObjectTree(): ObjectTreeLike {
    return {
        getObjects: (_opts?: any) => objects,
        getObject: (id: string) => objectMap.get(id),
        getObjectTypes: () => {
            const seen = new Set<string>();
            return objects
                .filter(o => { if (seen.has(o.typeElementId)) return false; seen.add(o.typeElementId); return true; })
                .map(o => ({ elementId: o.typeElementId, displayName: o.typeElementId }));
        },
        getChildElementIds: (id: string) => childrenMap.get(id) ?? [],
        getDescendantLeafIds: (id: string, _maxDepth?: number) => {
            const result: string[] = [];
            const visit = (eid: string) => {
                const children = childrenMap.get(eid);
                if (!children || children.length === 0) {
                    result.push(eid);
                } else {
                    children.forEach(visit);
                }
            };
            visit(id);
            return result;
        },
        getRelated: (id: string) => {
            const obj = objectMap.get(id);
            if (!obj) return [];
            const related: I3xObject[] = [];
            if (obj.parentId && obj.parentId !== "/") {
                const parent = objectMap.get(obj.parentId);
                if (parent) related.push(parent);
            }
            const children = childrenMap.get(id);
            if (children) {
                for (const cid of children) {
                    const child = objectMap.get(cid);
                    if (child) related.push(child);
                }
            }
            return related;
        },
    };
}

function createMockValueCache(): ValueCacheLike {
    return {
        getValue: (_id: string) => null,
    };
}

function createMockHistory(): HistoryLike {
    return {
        queryHistory: async (_id: string, _start: string, _end: string): Promise<I3xVqt[]> => [],
    };
}

describe("I3xRag", () => {
    describe("init", () => {
        it("nodeCount() returns 13 after init", () => {
            const rag = new I3xRag(createMockObjectTree(), createMockValueCache(), createMockHistory());
            rag.init();
            expect(rag.nodeCount()).toBe(13);
        });

        it("edgeCount() returns 12 after init", () => {
            const rag = new I3xRag(createMockObjectTree(), createMockValueCache(), createMockHistory());
            rag.init();
            expect(rag.edgeCount()).toBe(12);
        });
    });

    describe("rebuild", () => {
        it("clears and re-populates both graph and index (same counts)", () => {
            const rag = new I3xRag(createMockObjectTree(), createMockValueCache(), createMockHistory());
            rag.init();
            expect(rag.nodeCount()).toBe(13);
            expect(rag.edgeCount()).toBe(12);

            rag.rebuild();
            expect(rag.nodeCount()).toBe(13);
            expect(rag.edgeCount()).toBe(12);
        });
    });

    describe("search", () => {
        let rag: I3xRag;

        beforeEach(() => {
            rag = new I3xRag(createMockObjectTree(), createMockValueCache(), createMockHistory());
            rag.init();
        });

        it("finds objects by displayName", () => {
            const results: SearchResult[] = rag.search("Device_A");
            expect(results.length).toBeGreaterThanOrEqual(1);
            expect(results[0].elementId).toBe("device-a");
            expect(results[0].displayName).toBe("Device_A");
        });

        it("finds by partial name (Position → 2 results: x-pos, y-pos)", () => {
            const results = rag.search("Position");
            expect(results.length).toBe(2);
            const ids = results.map(r => r.elementId).sort();
            expect(ids).toEqual(["x-pos", "y-pos"]);
        });

        it("returns empty array for no match", () => {
            const results = rag.search("NonExistent_XYZ_12345");
            expect(results).toEqual([]);
        });

        it("respects limit parameter", () => {
            // "isa95-level" appears in typeElementId of enterprise & site
            const results = rag.search("isa95-level", 1);
            expect(results.length).toBe(1);
        });

        it("results include score (typeof number)", () => {
            const results = rag.search("Device_A");
            expect(results.length).toBeGreaterThanOrEqual(1);
            expect(typeof results[0].score).toBe("number");
        });
    });

    describe("searchByType", () => {
        let rag: I3xRag;

        beforeEach(() => {
            rag = new I3xRag(createMockObjectTree(), createMockValueCache(), createMockHistory());
            rag.init();
        });

        it("filters to given type (searchByType('schema-axis', 'X') → x-axis only)", () => {
            const results: SearchResult[] = rag.searchByType("schema-axis", "X");
            expect(results.length).toBe(1);
            expect(results[0].elementId).toBe("x-axis");
            expect(results[0].typeElementId).toBe("schema-axis");
        });

        it("returns empty when type has no matches", () => {
            const results = rag.searchByType("nonexistent-type", "X");
            expect(results).toEqual([]);
        });
    });

    describe("searchRelated", () => {
        let rag: I3xRag;

        beforeEach(() => {
            rag = new I3xRag(createMockObjectTree(), createMockValueCache(), createMockHistory());
            rag.init();
        });

        it("returns search results with `related` array", () => {
            const results: SearchRelatedResult[] = rag.searchRelated("Device_A");
            expect(results.length).toBeGreaterThanOrEqual(1);
            expect(results[0].elementId).toBe("device-a");
            expect(Array.isArray(results[0].related)).toBe(true);
        });

        it("related nodes include neighbours within hops", () => {
            const results = rag.searchRelated("Device_A", 1);
            expect(results.length).toBeGreaterThanOrEqual(1);
            const related = results[0].related;
            expect(related.length).toBeGreaterThan(0);
            // Device_A's direct neighbours: site (parent), axes, spindle (children)
            const relatedIds = related.map(r => r.elementId).sort();
            expect(relatedIds).toEqual(expect.arrayContaining(["axes", "site", "spindle"]));
        });
    });

    describe("traverse", () => {
        let rag: I3xRag;

        beforeEach(() => {
            rag = new I3xRag(createMockObjectTree(), createMockValueCache(), createMockHistory());
            rag.init();
        });

        it("1 hop from device-a returns site, axes, spindle (not x-axis)", () => {
            const result: TraversalNode[] = rag.traverse("device-a", 1);
            const ids = result.map(r => r.elementId).sort();
            expect(ids).toEqual(["axes", "site", "spindle"]);
            expect(ids).not.toContain("x-axis");
        });

        it("does not include the source node", () => {
            const result = rag.traverse("device-a", 1);
            const ids = result.map(r => r.elementId);
            expect(ids).not.toContain("device-a");
        });

        it("returns empty for nonexistent node", () => {
            const result = rag.traverse("nonexistent", 1);
            expect(result).toEqual([]);
        });

        it("2 hops reaches grandchildren (x-axis, y-axis)", () => {
            const result = rag.traverse("device-a", 2);
            const ids = result.map(r => r.elementId);
            expect(ids).toContain("x-axis");
            expect(ids).toContain("y-axis");
        });
    });

    describe("findPath", () => {
        let rag: I3xRag;

        beforeEach(() => {
            rag = new I3xRag(createMockObjectTree(), createMockValueCache(), createMockHistory());
            rag.init();
        });

        it("shortest path x-pos -> y-pos has length 5", () => {
            // x-pos -> x-axis -> axes -> y-axis -> y-pos
            const path = rag.findPath("x-pos", "y-pos");
            expect(path).not.toBeNull();
            expect(path!.length).toBe(5);
            expect(path![0]).toBe("x-pos");
            expect(path![path!.length - 1]).toBe("y-pos");
        });

        it("returns null for nonexistent node", () => {
            expect(rag.findPath("nonexistent", "x-pos")).toBeNull();
            expect(rag.findPath("x-pos", "nonexistent")).toBeNull();
        });

        it("adjacent nodes have path length 2", () => {
            // device-a -> axes are adjacent (parent-child edge)
            const path = rag.findPath("device-a", "axes");
            expect(path).not.toBeNull();
            expect(path!.length).toBe(2);
        });

        it("path to self has length 1", () => {
            const path = rag.findPath("device-a", "device-a");
            expect(path).not.toBeNull();
            expect(path!.length).toBe(1);
            expect(path![0]).toBe("device-a");
        });
    });

    describe("neighborhood", () => {
        let rag: I3xRag;

        beforeEach(() => {
            rag = new I3xRag(createMockObjectTree(), createMockValueCache(), createMockHistory());
            rag.init();
        });

        it("returns nodes grouped by depth (1-hop from axes: device-a, x-axis, y-axis)", () => {
            const result = rag.neighborhood("axes", 1);
            const ids = result.map(r => r.elementId).sort();
            expect(ids).toEqual(["device-a", "x-axis", "y-axis"]);
        });

        it("includes depth on each result", () => {
            const result = rag.neighborhood("axes", 2);
            expect(result.length).toBeGreaterThan(0);
            for (const node of result) {
                expect(typeof node.depth).toBe("number");
                expect(node.depth).toBeGreaterThanOrEqual(1);
                expect(node.depth).toBeLessThanOrEqual(2);
            }
        });

        it("returns empty for nonexistent node", () => {
            const result = rag.neighborhood("nonexistent");
            expect(result).toEqual([]);
        });
    });

    describe("compositionTree", () => {
        let rag: I3xRag;

        beforeEach(() => {
            rag = new I3xRag(createMockObjectTree(), createMockValueCache(), createMockHistory());
            rag.init();
        });

        it("returns nested tree for device-a with 2 children (axes, spindle)", () => {
            const tree: CompositionTreeNode | null = rag.compositionTree("device-a");
            expect(tree).not.toBeNull();
            expect(tree!.elementId).toBe("device-a");
            expect(tree!.displayName).toBe("Device_A");
            expect(tree!.children.length).toBe(2);
            const childIds = tree!.children.map(c => c.elementId).sort();
            expect(childIds).toEqual(["axes", "spindle"]);
        });

        it("children are nested recursively (axes has x-axis, y-axis; each has Position leaf)", () => {
            const tree = rag.compositionTree("device-a");
            expect(tree).not.toBeNull();
            const axes = tree!.children.find(c => c.elementId === "axes");
            expect(axes).toBeDefined();
            expect(axes!.children.length).toBe(2);
            const xAxis = axes!.children.find(c => c.elementId === "x-axis");
            expect(xAxis).toBeDefined();
            expect(xAxis!.children.length).toBe(1);
            expect(xAxis!.children[0].elementId).toBe("x-pos");
            expect(xAxis!.children[0].displayName).toBe("Position");
            expect(xAxis!.children[0].children).toEqual([]);
        });

        it("respects maxDepth (maxDepth=1 means children have empty children arrays)", () => {
            const tree = rag.compositionTree("device-a", 1);
            expect(tree).not.toBeNull();
            expect(tree!.children.length).toBe(2);
            for (const child of tree!.children) {
                expect(child.children).toEqual([]);
            }
        });

        it("returns null for nonexistent node", () => {
            const result = rag.compositionTree("nonexistent");
            expect(result).toBeNull();
        });
    });
});

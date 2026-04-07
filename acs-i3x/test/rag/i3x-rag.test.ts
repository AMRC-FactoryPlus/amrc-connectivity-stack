import { jest } from "@jest/globals";
import { I3xRag, HistoryLike, SearchResult, SearchRelatedResult, TraversalNode, CompositionTreeNode, RelationshipMapEntry, TypeSchemaResult, ValueFilterResult } from "../../src/rag/i3x-rag.js";
import type { I3xVqt } from "../../src/types/i3x.js";
import { createMockObjectTree, createMockValueCache, createMockValueCacheWithValues, createMockHistory, createPrePopulatedValues } from "../helpers/mock-rag.js";

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

    /* ---- analysis methods ---- */

    const prePopulatedValues = createPrePopulatedValues();

    describe("relationshipMap", () => {
        let rag: I3xRag;

        beforeEach(() => {
            rag = new I3xRag(createMockObjectTree(), createMockValueCache(), createMockHistory());
            rag.init();
        });

        it("returns type-level adjacency entries", () => {
            const map: RelationshipMapEntry[] = rag.relationshipMap();
            expect(map.length).toBeGreaterThan(0);
            for (const entry of map) {
                expect(typeof entry.fromType).toBe("string");
                expect(typeof entry.toType).toBe("string");
                expect(typeof entry.count).toBe("number");
                expect(entry.count).toBeGreaterThan(0);
            }
        });

        it("has an entry for schema-cnc -> schema-axes with count 1", () => {
            const map = rag.relationshipMap();
            const entry = map.find(
                e => e.fromType === "schema-cnc" && e.toType === "schema-axes",
            );
            expect(entry).toBeDefined();
            expect(entry!.count).toBe(1);
        });
    });

    describe("typeSchema", () => {
        let rag: I3xRag;

        beforeEach(() => {
            rag = new I3xRag(createMockObjectTree(), createMockValueCache(), createMockHistory());
            rag.init();
        });

        it("returns correct child type distribution for schema-axis", () => {
            const result: TypeSchemaResult | null = rag.typeSchema("schema-axis");
            expect(result).not.toBeNull();
            expect(result!.typeElementId).toBe("schema-axis");
            expect(result!.instanceCount).toBe(2);
            expect(result!.childTypeCounts["metric"]).toBe(2);
        });

        it("returns null for nonexistent type", () => {
            const result = rag.typeSchema("nonexistent-type-xyz");
            expect(result).toBeNull();
        });
    });

    describe("valueFilter", () => {
        let rag: I3xRag;

        beforeEach(() => {
            const valueCache = createMockValueCacheWithValues(prePopulatedValues);
            rag = new I3xRag(createMockObjectTree(), valueCache, createMockHistory());
            rag.init();
        });

        it("filters by quality (quality='Bad' -> just joint1-angle)", () => {
            const results: ValueFilterResult[] = rag.valueFilter({ quality: "Bad" });
            expect(results.length).toBe(1);
            expect(results[0].elementId).toBe("joint1-angle");
        });

        it("filters by min/max value (min=100, max=200 -> just x-pos)", () => {
            const results = rag.valueFilter({ minValue: 100, maxValue: 200 });
            expect(results.length).toBe(1);
            expect(results[0].elementId).toBe("x-pos");
            expect(results[0].value).toBe(123.4);
        });

        it("missing=true returns objects with no cached value (all 4 leaves have values -> 0 results)", () => {
            const results = rag.valueFilter({ missing: true });
            expect(results.length).toBe(0);
        });

        it("no filter returns all 4 leaf values", () => {
            const results = rag.valueFilter();
            expect(results.length).toBe(4);
            const ids = results.map(r => r.elementId).sort();
            expect(ids).toEqual(["joint1-angle", "spindle-spd", "x-pos", "y-pos"]);
        });
    });

    describe("staleValues", () => {
        let rag: I3xRag;

        beforeEach(() => {
            const valueCache = createMockValueCacheWithValues(prePopulatedValues);
            rag = new I3xRag(createMockObjectTree(), valueCache, createMockHistory());
            rag.init();
        });

        it("threshold=300s returns joint1-angle (timestamp 600s ago)", () => {
            const results: ValueFilterResult[] = rag.staleValues(300);
            expect(results.length).toBe(1);
            expect(results[0].elementId).toBe("joint1-angle");
        });

        it("threshold=999999 returns empty (nothing that stale)", () => {
            const results = rag.staleValues(999999);
            expect(results).toEqual([]);
        });
    });

    describe("getHistory", () => {
        it("delegates to history.queryHistory and returns result", async () => {
            const historyData: I3xVqt[] = [
                { value: 100, quality: "Good", timestamp: "2026-04-01T00:00:00Z" },
                { value: 200, quality: "Good", timestamp: "2026-04-01T01:00:00Z" },
            ];

            const mockHistory: HistoryLike = {
                queryHistory: jest.fn().mockResolvedValue(historyData),
            };

            const rag = new I3xRag(createMockObjectTree(), createMockValueCache(), mockHistory);
            rag.init();

            const result = await rag.getHistory("x-pos", "2026-04-01T00:00:00Z", "2026-04-01T02:00:00Z");

            expect(result).toEqual(historyData);
            expect(mockHistory.queryHistory).toHaveBeenCalledWith(
                "x-pos",
                "2026-04-01T00:00:00Z",
                "2026-04-01T02:00:00Z",
            );
        });
    });
});

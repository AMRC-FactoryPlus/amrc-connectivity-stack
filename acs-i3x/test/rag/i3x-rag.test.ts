import { jest } from "@jest/globals";
import { I3xRag, ObjectTreeLike, ValueCacheLike, HistoryLike } from "../../src/rag/i3x-rag.js";
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
});

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { I3xRag, ObjectTreeLike, ValueCacheLike, HistoryLike } from "../../src/rag/i3x-rag.js";
import type { I3xObject, I3xVqt } from "../../src/types/i3x.js";
import { registerRagTools } from "../../src/mcp/tools.js";

/* ------------------------------------------------------------------ */
/*  Mock data (same tree as test/rag/i3x-rag.test.ts)                 */
/* ------------------------------------------------------------------ */

const objects: I3xObject[] = [
    { elementId: "enterprise",   displayName: "Enterprise",  typeElementId: "isa95-level",    parentId: null,         isComposition: true,  isExtended: false },
    { elementId: "site",         displayName: "Site",        typeElementId: "isa95-level",    parentId: "enterprise", isComposition: true,  isExtended: false },
    { elementId: "device-a",     displayName: "Device_A",    typeElementId: "schema-cnc",     parentId: "site",       isComposition: true,  isExtended: false },
    { elementId: "device-b",     displayName: "Device_B",    typeElementId: "schema-robot",   parentId: "site",       isComposition: true,  isExtended: false },
    { elementId: "axes",         displayName: "Axes",        typeElementId: "schema-axes",    parentId: "device-a",   isComposition: true,  isExtended: false },
    { elementId: "spindle",      displayName: "Spindle",     typeElementId: "schema-spindle", parentId: "device-a",   isComposition: true,  isExtended: false },
    { elementId: "x-axis",       displayName: "X",           typeElementId: "schema-axis",    parentId: "axes",       isComposition: true,  isExtended: false },
    { elementId: "y-axis",       displayName: "Y",           typeElementId: "schema-axis",    parentId: "axes",       isComposition: true,  isExtended: false },
    { elementId: "x-pos",        displayName: "Position",    typeElementId: "metric",         parentId: "x-axis",     isComposition: false, isExtended: false },
    { elementId: "y-pos",        displayName: "Position",    typeElementId: "metric",         parentId: "y-axis",     isComposition: false, isExtended: false },
    { elementId: "spindle-spd",  displayName: "Speed",       typeElementId: "metric",         parentId: "spindle",    isComposition: false, isExtended: false },
    { elementId: "joint1",       displayName: "Joint1",      typeElementId: "schema-joint",   parentId: "device-b",   isComposition: true,  isExtended: false },
    { elementId: "joint1-angle", displayName: "Angle",       typeElementId: "metric",         parentId: "joint1",     isComposition: false, isExtended: false },
];

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
        getObjects: () => objects,
        getObject: (id: string) => objectMap.get(id),
        getObjectTypes: () => {
            const seen = new Set<string>();
            return objects
                .filter(o => { if (seen.has(o.typeElementId)) return false; seen.add(o.typeElementId); return true; })
                .map(o => ({ elementId: o.typeElementId, displayName: o.typeElementId }));
        },
        getChildElementIds: (id: string) => childrenMap.get(id) ?? [],
        getDescendantLeafIds: (id: string) => {
            const result: string[] = [];
            const visit = (eid: string) => {
                const children = childrenMap.get(eid);
                if (!children || children.length === 0) result.push(eid);
                else children.forEach(visit);
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

const staleTimestamp = new Date(Date.now() - 600_000).toISOString();
const recentTimestamp = new Date(Date.now() - 30_000).toISOString();

const prePopulatedValues = new Map<string, I3xVqt>([
    ["x-pos",        { value: 123.4,  quality: "Good", timestamp: recentTimestamp }],
    ["y-pos",        { value: 567.8,  quality: "Good", timestamp: recentTimestamp }],
    ["spindle-spd",  { value: 12000,  quality: "Good", timestamp: recentTimestamp }],
    ["joint1-angle", { value: 45.0,   quality: "Bad",  timestamp: staleTimestamp }],
]);

function createMockValueCache(): ValueCacheLike {
    return {
        getValue: (id: string) => {
            const vqt = prePopulatedValues.get(id);
            if (!vqt) return null;
            const obj = objectMap.get(id);
            return {
                elementId: id,
                isComposition: obj?.isComposition ?? false,
                value: vqt.value,
                quality: vqt.quality,
                timestamp: vqt.timestamp,
            };
        },
    };
}

function createMockHistory(): HistoryLike {
    return {
        queryHistory: async () => [],
    };
}

/* ------------------------------------------------------------------ */
/*  Helper: set up MCP server + client linked by in-memory transport  */
/* ------------------------------------------------------------------ */

async function createTestHarness(rag: I3xRag) {
    const server = new McpServer({ name: "test-i3x", version: "0.0.1" });
    registerRagTools(server, rag);

    const client = new Client({ name: "test-client", version: "0.0.1" });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    return { server, client };
}

function parseResult(result: any): any {
    const text = result.content[0]?.text;
    if (!text) return undefined;
    try { return JSON.parse(text); } catch { return text; }
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("MCP tool registrations", () => {
    let client: Client;
    let rag: I3xRag;

    beforeAll(async () => {
        rag = new I3xRag(createMockObjectTree(), createMockValueCache(), createMockHistory());
        rag.init();
        const harness = await createTestHarness(rag);
        client = harness.client;
    });

    it("lists all 12 tools", async () => {
        const { tools } = await client.listTools();
        const names = tools.map(t => t.name).sort();
        expect(names).toEqual([
            "composition_tree",
            "find_path",
            "get_history",
            "neighborhood",
            "relationship_map",
            "search",
            "search_by_type",
            "search_related",
            "stale_values",
            "traverse",
            "type_schema",
            "value_filter",
        ]);
    });

    it("search tool returns results for 'Device_A'", async () => {
        const result = await client.callTool({ name: "search", arguments: { query: "Device_A" } });
        const data = parseResult(result);
        expect(Array.isArray(data)).toBe(true);
        expect(data.length).toBeGreaterThanOrEqual(1);
        expect(data[0].elementId).toBe("device-a");
        expect(data[0].displayName).toBe("Device_A");
    });

    it("traverse tool returns neighbours for device-a with hops=1", async () => {
        const result = await client.callTool({ name: "traverse", arguments: { element_id: "device-a", hops: 1 } });
        const data = parseResult(result);
        expect(Array.isArray(data)).toBe(true);
        const ids = data.map((n: any) => n.elementId).sort();
        expect(ids).toEqual(["axes", "site", "spindle"]);
    });

    it("find_path returns path between x-pos and y-pos", async () => {
        const result = await client.callTool({ name: "find_path", arguments: { from_id: "x-pos", to_id: "y-pos" } });
        expect(result.isError).toBeFalsy();
        const path = parseResult(result);
        expect(Array.isArray(path)).toBe(true);
        expect(path[0]).toBe("x-pos");
        expect(path[path.length - 1]).toBe("y-pos");
        expect(path.length).toBe(5);
    });

    it("composition_tree returns nested structure for device-a", async () => {
        const result = await client.callTool({ name: "composition_tree", arguments: { element_id: "device-a" } });
        expect(result.isError).toBeFalsy();
        const tree = parseResult(result);
        expect(tree.elementId).toBe("device-a");
        expect(tree.displayName).toBe("Device_A");
        expect(tree.children.length).toBe(2);
        const childIds = tree.children.map((c: any) => c.elementId).sort();
        expect(childIds).toEqual(["axes", "spindle"]);
    });

    it("stale_values finds stale entries", async () => {
        const result = await client.callTool({ name: "stale_values", arguments: { threshold_seconds: 300 } });
        const data = parseResult(result);
        expect(Array.isArray(data)).toBe(true);
        expect(data.length).toBe(1);
        expect(data[0].elementId).toBe("joint1-angle");
    });

    it("search with missing required query param returns error", async () => {
        const result = await client.callTool({ name: "search", arguments: {} });
        expect(result.isError).toBe(true);
    });
});

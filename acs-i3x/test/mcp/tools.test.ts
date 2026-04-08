/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { I3xRag } from "../../src/rag/i3x-rag.js";
import { registerRagTools } from "../../src/mcp/tools.js";
import { createMockObjectTree, createMockValueCacheWithValues, createMockHistory, createPrePopulatedValues } from "../helpers/mock-rag.js";

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
        rag = new I3xRag(createMockObjectTree(), createMockValueCacheWithValues(createPrePopulatedValues()), createMockHistory());
        rag.init();
        const harness = await createTestHarness(rag);
        client = harness.client;
    });

    it("lists all 13 tools", async () => {
        const { tools } = await client.listTools();
        const names = tools.map(t => t.name).sort();
        expect(names).toEqual([
            "composition_tree",
            "find_path",
            "get_history",
            "get_values",
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

    it("get_values retrieves current values from cache for multiple elements", async () => {
        const result = await client.callTool({ name: "get_values", arguments: { element_ids: ["x-pos", "y-pos", "joint1-angle"] } });
        const data = parseResult(result);
        expect(Array.isArray(data)).toBe(true);
        expect(data.length).toBe(3);
        const xPos = data.find((v: any) => v.elementId === "x-pos");
        expect(xPos).toBeDefined();
        expect(xPos.value).toBe(123.4);
        expect(xPos.quality).toBe("Good");
        expect(xPos.source).toBe("cache");
    });

    it("search with missing required query param returns error", async () => {
        const result = await client.callTool({ name: "search", arguments: {} });
        expect(result.isError).toBe(true);
    });
});

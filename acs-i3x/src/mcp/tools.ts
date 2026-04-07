/*
 * MCP tool registrations for I3xRag.
 *
 * Registers 12 tools (search, graph traversal, analysis) on an McpServer
 * instance, all delegating to the I3xRag class.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { I3xRag } from "../rag/i3x-rag.js";

function jsonResult(data: unknown) {
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string) {
    return { content: [{ type: "text" as const, text: message }], isError: true as const };
}

export function registerRagTools(server: McpServer, rag: I3xRag): void {

    /* ---- Search tools ---- */

    server.tool(
        "search",
        "Full-text search across object displayNames and typeElementIds.",
        { query: z.string(), limit: z.number().optional() },
        async ({ query, limit }) => {
            return jsonResult(rag.search(query, limit));
        },
    );

    server.tool(
        "search_by_type",
        "Search filtered to objects of a specific typeElementId.",
        { type_element_id: z.string(), query: z.string(), limit: z.number().optional() },
        async ({ type_element_id, query, limit }) => {
            return jsonResult(rag.searchByType(type_element_id, query, limit));
        },
    );

    server.tool(
        "search_related",
        "Search with related graph neighbours attached to each result.",
        { query: z.string(), hops: z.number().optional(), limit: z.number().optional() },
        async ({ query, hops, limit }) => {
            return jsonResult(rag.searchRelated(query, hops, limit));
        },
    );

    /* ---- Graph tools ---- */

    server.tool(
        "traverse",
        "BFS traversal from a node, returning visited nodes up to N hops.",
        { element_id: z.string(), hops: z.number().optional() },
        async ({ element_id, hops }) => {
            return jsonResult(rag.traverse(element_id, hops));
        },
    );

    server.tool(
        "find_path",
        "Shortest path between two nodes in the object graph.",
        { from_id: z.string(), to_id: z.string() },
        async ({ from_id, to_id }) => {
            const path = rag.findPath(from_id, to_id);
            if (path === null) return errorResult("No path found");
            return jsonResult(path);
        },
    );

    server.tool(
        "neighborhood",
        "Return all neighbours within N hops of a node.",
        { element_id: z.string(), hops: z.number().optional() },
        async ({ element_id, hops }) => {
            return jsonResult(rag.neighborhood(element_id, hops));
        },
    );

    server.tool(
        "composition_tree",
        "Build a nested composition tree starting from a node.",
        { element_id: z.string(), max_depth: z.number().optional() },
        async ({ element_id, max_depth }) => {
            const tree = rag.compositionTree(element_id, max_depth);
            if (tree === null) return errorResult("Node not found");
            return jsonResult(tree);
        },
    );

    /* ---- Analysis tools ---- */

    server.tool(
        "relationship_map",
        "Type-level adjacency map: counts of edges grouped by fromType/toType.",
        {},
        async () => {
            return jsonResult(rag.relationshipMap());
        },
    );

    server.tool(
        "type_schema",
        "Find all instances of a type and count their children grouped by child type.",
        { type_element_id: z.string() },
        async ({ type_element_id }) => {
            const schema = rag.typeSchema(type_element_id);
            if (schema === null) return errorResult("Type not found");
            return jsonResult(schema);
        },
    );

    server.tool(
        "value_filter",
        "Filter leaf objects by quality, value range, or missing cached value.",
        {
            quality: z.string().optional(),
            min_value: z.number().optional(),
            max_value: z.number().optional(),
            missing: z.boolean().optional(),
        },
        async ({ quality, min_value, max_value, missing }) => {
            return jsonResult(rag.valueFilter({
                quality,
                minValue: min_value,
                maxValue: max_value,
                missing,
            }));
        },
    );

    server.tool(
        "stale_values",
        "Return leaf objects whose cached value timestamp is older than a threshold.",
        { threshold_seconds: z.number().optional() },
        async ({ threshold_seconds }) => {
            return jsonResult(rag.staleValues(threshold_seconds));
        },
    );

    server.tool(
        "get_history",
        "Fetch historical VQT values for an element over a time range.",
        { element_id: z.string(), start_time: z.string(), end_time: z.string() },
        async ({ element_id, start_time, end_time }) => {
            const history = await rag.getHistory(element_id, start_time, end_time);
            return jsonResult(history);
        },
    );
}

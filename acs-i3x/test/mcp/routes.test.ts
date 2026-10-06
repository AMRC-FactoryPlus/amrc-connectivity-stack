/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * MCP is opt-in (I3X_MCP_ENABLED). routes() mounts /mcp only when it
 * is given an McpServer; otherwise /mcp answers 404 and the i3X API is
 * unchanged.
 */

import express from "express";
import request from "supertest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { routes } from "../../lib/routes.js";
import { ObjectTree } from "../../lib/object-tree.js";
import { ValueCache } from "../../lib/value-cache.js";

const MCP_HEADERS = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
};

const initialize = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test-client", version: "0.0.1" },
    },
};

function app(mcpServer?: McpServer) {
    const objectTree = new ObjectTree({ namespaceName: "NS", namespaceUri: "urn:ns" });
    objectTree.setReady();
    const valueCache = new ValueCache({ objectTree, staleThreshold: 60_000 });
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => { (req as any).auth = "p@R"; next(); });
    routes({
        objectTree, valueCache,
        history: {} as any,
        subscriptions: {} as any,
        mcpServer,
    })(a);
    return a;
}

describe("/mcp", () => {
    it("answers 404 for every method when MCP is disabled", async () => {
        const a = app();
        for (const method of ["post", "get", "delete"] as const) {
            const res = await request(a)[method]("/mcp").set(MCP_HEADERS).send(initialize);
            expect(res.status).toBe(404);
        }
        // The i3X API is still there.
        const ns = await request(a).get("/v1/namespaces");
        expect(ns.status).toBe(200);
        expect(ns.body).toEqual({ success: true, result: [{ uri: "urn:ns", displayName: "NS" }] });
    });

    it("is served when an McpServer is given", async () => {
        const mcp = new McpServer({ name: "test", version: "0.1.0" });
        mcp.tool("ping", "Returns pong", {}, async () => ({ content: [{ type: "text", text: "pong" }] }));
        const res = await request(app(mcp)).post("/mcp").set(MCP_HEADERS).send(initialize);
        expect(res.status).toBe(200);
    });
});

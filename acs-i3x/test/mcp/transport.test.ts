import express from "express";
import request from "supertest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mountMcpTransport } from "../../src/mcp/transport.js";

/* ------------------------------------------------------------------ */
/*  Helper: build Express app with a minimal MCP server               */
/* ------------------------------------------------------------------ */

function createApp() {
    const mcpServer = new McpServer(
        { name: "test-server", version: "0.1.0" },
    );
    mcpServer.tool("ping", "Returns pong", {}, async () => ({
        content: [{ type: "text", text: "pong" }],
    }));

    const app = express();
    app.use(express.json());
    mountMcpTransport(app, mcpServer);

    return app;
}

/* Headers the MCP Streamable HTTP transport requires on POST. */
const MCP_HEADERS = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
};

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("MCP Streamable HTTP transport", () => {

    const app = createApp();

    it("POST /mcp with initialize returns protocol version", async () => {
        const res = await request(app)
            .post("/mcp")
            .set(MCP_HEADERS)
            .send({
                jsonrpc: "2.0",
                id: 1,
                method: "initialize",
                params: {
                    protocolVersion: "2025-03-26",
                    capabilities: {},
                    clientInfo: { name: "test-client", version: "0.0.1" },
                },
            });

        expect(res.status).toBe(200);

        /* Response may be a single JSON-RPC object or an array
           (the SDK wraps single responses in an array when using
           enableJsonResponse). Handle both. */
        const body = Array.isArray(res.body) ? res.body[0] : res.body;
        expect(body.jsonrpc).toBe("2.0");
        expect(body.id).toBe(1);
        expect(body.result).toBeDefined();
        expect(body.result.protocolVersion).toBeDefined();
        expect(body.result.serverInfo.name).toBe("test-server");
    });

    it("POST /mcp with tools/list returns the tool catalogue", async () => {
        const res = await request(app)
            .post("/mcp")
            .set(MCP_HEADERS)
            .send({
                jsonrpc: "2.0",
                id: 2,
                method: "tools/list",
                params: {},
            });

        expect(res.status).toBe(200);

        const body = Array.isArray(res.body) ? res.body[0] : res.body;
        expect(body.jsonrpc).toBe("2.0");
        expect(body.id).toBe(2);
        expect(body.result.tools).toBeDefined();

        const names = body.result.tools.map((t: any) => t.name);
        expect(names).toContain("ping");
    });

    it("POST /mcp with tools/call invokes the tool", async () => {
        const res = await request(app)
            .post("/mcp")
            .set(MCP_HEADERS)
            .send({
                jsonrpc: "2.0",
                id: 3,
                method: "tools/call",
                params: { name: "ping", arguments: {} },
            });

        expect(res.status).toBe(200);

        const body = Array.isArray(res.body) ? res.body[0] : res.body;
        expect(body.jsonrpc).toBe("2.0");
        expect(body.id).toBe(3);
        expect(body.result.content).toEqual([
            { type: "text", text: "pong" },
        ]);
    });

    it("GET /mcp returns 405", async () => {
        const res = await request(app).get("/mcp");
        expect(res.status).toBe(405);
        expect(res.body.error).toBeDefined();
    });

    it("DELETE /mcp returns 405", async () => {
        const res = await request(app).delete("/mcp");
        expect(res.status).toBe(405);
        expect(res.body.error).toBeDefined();
    });
});

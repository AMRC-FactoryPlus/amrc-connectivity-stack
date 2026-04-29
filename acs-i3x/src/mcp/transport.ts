/*
 * MCP Streamable HTTP transport mount.
 *
 * Mounts a POST /mcp endpoint on an Express app, wiring each request
 * through the SDK's StreamableHTTPServerTransport in stateless mode
 * with JSON responses (no SSE).
 */

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Express, Request, Response } from "express";

/**
 * Mount a `/mcp` endpoint on the given Express app that proxies
 * JSON-RPC requests to the given McpServer via the MCP Streamable
 * HTTP transport.
 *
 * Each request creates a fresh stateless transport, connects it to
 * the underlying Server (not the McpServer wrapper — to avoid the
 * "already connected" guard), handles the request, then closes the
 * transport so subsequent requests can reuse the same server.
 *
 * A mutex serialises requests to prevent "already connected" errors
 * when concurrent requests arrive.
 */
export function mountMcpTransport(
    app: Express,
    mcpServer: McpServer,
    logger?: { warn?: (...args: any[]) => void },
): void {
    const server = mcpServer.server;

    /* Simple async mutex: serialise connect → handle → close cycles. */
    let lock: Promise<void> = Promise.resolve();

    /* POST /mcp — the only method the stateless transport needs */
    app.post("/mcp", (req: Request, res: Response) => {
        lock = lock.then(async () => {
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined,
                enableJsonResponse: true,
            });
            transport.onerror = (err) => {
                logger?.warn?.({ err }, "MCP transport error");
            };
            try {
                await server.connect(transport);
                await transport.handleRequest(req, res, req.body);
            } catch (err: unknown) {
                logger?.warn?.({ err }, "MCP request handling error");
                if (!res.headersSent) {
                    res.status(500).json({
                        jsonrpc: "2.0",
                        error: { code: -32603, message: "Internal server error" },
                        id: null,
                    });
                }
            } finally {
                /* Release the transport so the next request can connect. */
                await transport.close();
            }
        });
        /* Return the lock promise so Express waits for it (Express 5 supports async). */
        return lock;
    });

    /* GET & DELETE /mcp — not supported in stateless mode */
    app.get("/mcp", (_req: Request, res: Response) => {
        res.status(405).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Method not allowed in stateless mode" },
            id: null,
        });
    });

    app.delete("/mcp", (_req: Request, res: Response) => {
        res.status(405).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Method not allowed in stateless mode" },
            id: null,
        });
    });
}

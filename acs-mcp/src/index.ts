/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ServiceClient } from "@amrc-factoryplus/service-client";

import { registerConfigDBTools } from "./tools/configdb.js";
import { registerDocsTools } from "./tools/docs.js";
import { registerAuthTools } from "./tools/auth.js";
import { registerDirectoryTools } from "./tools/directory.js";

// Load environment variables from .env in development
let dotenv: any = null;
try {
    dotenv = await import("dotenv");
} catch {
    // dotenv not available (production)
}
dotenv?.config();

// Validate required environment variables
const directoryUrl = process.env.DIRECTORY_URL;
if (!directoryUrl) {
    console.error("Error: DIRECTORY_URL environment variable is required");
    process.exit(1);
}

// Initialise the ACS ServiceClient
const serviceClient = new ServiceClient({
    env: process.env,
});

// Create the MCP server
const server = new McpServer({
    name: "acs-configdb",
    version: "1.0.0",
});

// Register tools
registerConfigDBTools(server, serviceClient);
registerDocsTools(server);
registerAuthTools(server, serviceClient);
registerDirectoryTools(server, serviceClient);

// Connect to stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);

#!/usr/bin/env node

/*
 * Factory+ / AMRC Connectivity Stack (ACS) OPC UA Server component
 * Copyright 2025 AMRC
 */

import { ServiceClient, UUIDs } from "@amrc-factoryplus/service-client";

import { OPCUAServer } from "../lib/server.js";

const fplus = await new ServiceClient({ env: process.env }).init();

const server = new OPCUAServer({ fplus });
await server.init();
await server.start();

process.on("SIGINT", async () => {
    console.log("Shutting down OPC UA server...");
    await server.stop();
    process.exit(0);
});

process.on("SIGTERM", async () => {
    console.log("Shutting down OPC UA server...");
    await server.stop();
    process.exit(0);
});

/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * ACS Edge OPC UA Server - Entry Point
 *
 * Reads configuration from a mounted ConfigMap file and credentials
 * from environment variables, initialises the data store, MQTT client
 * (via ServiceClient), and OPC UA server.
 */

import fs from "node:fs";

import { ServiceClient } from "@amrc-factoryplus/service-client";

import { DataStore } from "../lib/data-store.js";
import { MqttClient } from "../lib/mqtt-client.js";
import { Server } from "../lib/server.js";

/* Read configuration from files. */
const configFile = process.env.CONFIG_FILE ?? "/config/config.json";
const dataDir = process.env.DATA_DIR ?? "/data";

const config = JSON.parse(fs.readFileSync(configFile, "utf-8"));

/* Read OPC UA credentials from environment variables. */
const opcuaUsername = process.env.OPCUA_USERNAME;
const opcuaPassword = process.env.OPCUA_PASSWORD;

if (!opcuaUsername || !opcuaPassword) {
    console.error("OPCUA_USERNAME and OPCUA_PASSWORD must be set");
    process.exit(1);
}

/* Build ServiceClient - reads SERVICE_USERNAME, SERVICE_PASSWORD,
 * DIRECTORY_URL, VERBOSE from process.env. */
const fplus = await new ServiceClient({ env: process.env }).init();

/* Initialise components. */
const dataStore = new DataStore({ dataDir });
dataStore.start();

const mqttClient = new MqttClient({
    fplus,
    topics: config.topics,
    dataStore,
});

const server = new Server({
    port: config.opcua.port,
    dataStore,
    username: opcuaUsername,
    password: opcuaPassword,
    allowAnonymous: config.opcua.allowAnonymous ?? false,
});

/* Start everything. */
await mqttClient.start();
await server.start();

console.log(`OPC UA server ready. Subscribed to ${config.topics.length} MQTT topic pattern(s).`);

/* Graceful shutdown. */
const shutdown = async (signal) => {
    console.log(`Received ${signal}, shutting down...`);
    await server.stop();
    await mqttClient.stop();
    dataStore.stop();
    process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

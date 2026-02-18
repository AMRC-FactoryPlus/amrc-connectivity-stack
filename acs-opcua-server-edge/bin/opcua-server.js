/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * ACS Edge OPC UA Server - Entry Point
 *
 * Reads configuration from mounted files (ConfigMap + Secrets),
 * initialises the data store, MQTT client (via ServiceClient), and
 * OPC UA server.
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

/* Read OPC UA credentials from mounted secrets. */
const opcuaUsernameFile = process.env.OPCUA_USERNAME_FILE ?? "/secrets/opcua/username";
const opcuaPasswordFile = process.env.OPCUA_PASSWORD_FILE ?? "/secrets/opcua/password";
const opcuaUsername = fs.readFileSync(opcuaUsernameFile, "utf-8").trim();
const opcuaPassword = fs.readFileSync(opcuaPasswordFile, "utf-8").trim();

/* Ensure PKI directory exists and is writable */
const pkiDir = `${dataDir}/pki`;
if (!fs.existsSync(pkiDir)) {
    fs.mkdirSync(pkiDir, { recursive: true, mode: 0o755 });
}

/* Build ServiceClient - reads SERVICE_USERNAME, SERVICE_PASSWORD,
 * DIRECTORY_URL, MQTT_URL, VERBOSE from process.env. */
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

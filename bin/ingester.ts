/*
 * AMRC InfluxDB Sparkplug Ingester
 * Copyright "2023" AMRC
 */

import {ServiceClient, UUIDs} from "@amrc-factoryplus/utilities";
import pino from "pino";
import pretty from 'pino-pretty';
import MQTTClient from "@lib/mqttclient.js";
let dotenv: any = null;
try {dotenv = await import ('dotenv')} catch (e) {}

const stream = pretty({
    colorize: true
})

dotenv?.config();

const directoryUrl = process.env.DIRECTORY_URL;
if (!directoryUrl) {
    throw new Error("DIRECTORY_URL environment variable is not set");
}

export const logger = pino({
    name: 'InfluxDB Sparkplug Ingester',
    level: process.env.LOG_LEVEL || 'info',
}, stream);


const client = await new ServiceClient({
    directory_url: directoryUrl,
}).init();

// Overwrite MQTT server if specified in environment
if (process.env.MQTT_URL) {
    client.Discovery.set_service_url(UUIDs.Service.MQTT, process.env.MQTT_URL);
}

// Overwrite Command Escalation server if specified in environment
if (process.env.CMD_ESC_URL) {
    client.Discovery.set_service_url(UUIDs.Service.Command_Escalation, process.env.CMD_ESC_URL);
}

logger.info(client.service_urls('feb27ba3-bd2c-4916-9269-79a61ebc4a47'));

const mqtt = await new MQTTClient({
    e: {
        serviceClient: client,
    }
}).init();

mqtt.run();

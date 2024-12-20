/*
 * AMRC ACS UNS Ingester (Sparkplug)
 * Copyright "2023" AMRC
 */

import {ServiceClient, UUIDs} from "@amrc-factoryplus/service-client";
import pino from "pino";
import pretty from 'pino-pretty';
import MQTTClient from "@lib/mqttclient.js";

let dotenv: any = null;
try {
    dotenv = await import ('dotenv')
} catch (e) {
}

const stream = pretty({
    colorize: true
})

dotenv?.config();

const directoryUrl = process.env.DIRECTORY_URL;
if (!directoryUrl) {
    throw new Error("DIRECTORY_URL environment variable is not set");
}

export const logger = pino({
    name: 'ACS UNS Ingester Sparkplug',
    level: process.env.LOG_LEVEL || 'info',
}, stream);


const client = await new ServiceClient({
    env: process.env
}).init();

// Well known UUID for MQTT Component service function (see: https://factoryplus.app.amrc.co.uk/docs/framework-components/core-components/mqtt)
logger.info(client.service_urls('feb27ba3-bd2c-4916-9269-79a61ebc4a47'));

const mqtt = await new MQTTClient({
    e: {
        serviceClient: client,
    }
});

mqtt.run();

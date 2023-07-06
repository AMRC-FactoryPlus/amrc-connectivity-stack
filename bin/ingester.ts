/*
 * AMRC InfluxDB Sparkplug Ingester
 * Copyright "2023" AMRC
 */

import {ServiceClient} from "@amrc-factoryplus/utilities";
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
    name: 'InfluxDB Sparkplug Ingester'
}, stream);


const client = await new ServiceClient({
    directory_url: directoryUrl,
}).init();

logger.info(client.service_urls('feb27ba3-bd2c-4916-9269-79a61ebc4a47'));

const mqtt = await new MQTTClient({
    e: {
        serviceClient: client,
    }
}).init();

mqtt.run();

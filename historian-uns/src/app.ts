/*
 * AMRC InfluxDB UNS Historian
 * Copyright "2023" AMRC
 */
import {ServiceClient} from "@amrc-factoryplus/service-client";
import MQTTClient from "./mqttclient.js";
import {logger} from "./Utils/logger.js";

let dotenv: any = null;
try {
    dotenv = await import ('dotenv')
} catch (e) {
}

dotenv?.config();

const directoryUrl = process.env.DIRECTORY_URL;
if (!directoryUrl) {
    throw new Error("DIRECTORY_URL environment variable is not set");
}

const client = await new ServiceClient({
    env: process.env
}).init();

// Well known UUID for MQTT Component service function (see: https://factoryplus.app.amrc.co.uk/docs/framework-components/core-components/mqtt)
logger.info(client.service_urls('feb27ba3-bd2c-4916-9269-79a61ebc4a47'));

const mqtt = await new MQTTClient({
    e: {
        serviceClient: client,
    }
}).init();

mqtt.run();

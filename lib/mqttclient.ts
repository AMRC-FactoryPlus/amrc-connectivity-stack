/*
 * AMRC InfluxDB Sparkplug Ingester
 * Copyright "2023" AMRC
 */

import {ServiceClient, SpB, Topic, UUIDs} from "@amrc-factoryplus/utilities";
import {Reader} from "protobufjs";
import {logger} from "../bin/ingester.js";
let dotenv: any = null;
try {dotenv = await import ('dotenv')} catch (e) {}
import Long from "long";
import {InfluxDB, Point} from '@influxdata/influxdb-client'

dotenv?.config()

const influxURL: string = process.env.INFLUX_URL;
if (!influxURL) {
    throw new Error("INFLUX_URL environment variable is not set");
}

const influxToken: string = process.env.INFLUX_TOKEN
if (!influxToken) {
    throw new Error("INFLUX_TOKEN environment variable is not set");
}

const influxOrganisation: string = process.env.INFLUX_ORG
if (!influxOrganisation) {
    throw new Error("INFLUX_ORG environment variable is not set");
}

const influxDB = new InfluxDB({
    url: influxURL,
    token: influxToken,
})

interface MQTTClientConstructorParams {
    e: {
        serviceClient: ServiceClient;
    }
}

export default class MQTTClient {
    private serviceClient: ServiceClient;
    private mqtt: any;
    private aliasResolver = {};
    private birthDebounce = {};

    constructor({e}: MQTTClientConstructorParams) {
        this.serviceClient = e.serviceClient;
    }

    async init() {
        return this;
    }

    async run() {

        const mqtt = await this.serviceClient.mqtt_client();
        this.mqtt = mqtt;

        mqtt.on("authenticated", this.on_connect.bind(this));
        mqtt.on("error", this.on_error.bind(this));
        mqtt.on("message", this.on_message.bind(this));
        mqtt.on("close", this.on_close.bind(this));
        mqtt.on("reconnect", this.on_reconnect.bind(this));

        logger.info("Connecting to Factory+ broker...");
    }

    on_connect() {
        logger.info("🔌 Connected to Factory+ broker");
        logger.info("👂 Subscribing to entire Factory+ namespace");
        this.mqtt.subscribe('spBv1.0/#');
    }

    on_close() {
        logger.warn(`❌ Disconnected from Factory+ broker`);
    }

    on_reconnect() {
        logger.warn(`⚠️ Reconnecting to Factory+ broker...`);
    }

    on_error(error: any) {
        logger.error("🚨 MQTT error: %o", error);
    }

    async on_message(topicString: string, message: Uint8Array | Reader) {
        let topic = Topic.parse(topicString);
        let payload;

        try {
            payload = SpB.decodePayload(message);
        } catch {
            logger.error(`🚨 Bad payload on topic ${topicString}`);
            return;
        }

        if (!topic) {
            logger.error(`🚨 Bad topic: ${topicString}`);
            return;
        }

        switch (topic.type) {
            case "BIRTH":

                // Don't handle Node births
                if (!topic.address.device) return;

                let instance = payload.metrics.find((metric) => metric.name === "Instance_UUID").value;
                let schema = payload.metrics.find((metric) => metric.name === "Schema_UUID").value;

                // If we've already seen this birth, update it
                if (this.aliasResolver?.[topic.address.group]?.[topic.address.node]?.[topic.address.device]) {
                    logger.info(`🔄 Received updated birth certificate for ${topic.address.group}/${topic.address.node}/${topic.address.device} with Instance_UUID ${instance}`);
                } else {
                    logger.info(`👶 Received birth certificate for ${topic.address.group}/${topic.address.node}/${topic.address.device} with Instance_UUID ${instance}`);
                }

                // Store the birth certificate mapping in the alias resolver. This uses the alias as the key and a simplified object containing the name and type as the value.
                this.setNestedValue(this.aliasResolver, [topic.address.group, topic.address.node, topic.address.device], payload.metrics.reduce(function (acc, obj) {
                    let alias = Long.isLong(obj.alias) ? obj.alias.toNumber() : obj.alias;
                    acc[alias] = {
                        instance: instance,
                        schema: schema,
                        name: obj.name,
                        type: obj.type,
                        alias: alias
                    };
                    return acc;
                }, {}));

                // Clear the debounce
                delete this.birthDebounce?.[topic.address.group]?.[topic.address.node]?.[topic.address.device];

                // Store the default values in InfluxDB
                this.writeMetrics(payload, topic);

                break;
            case "DEATH":
                logger.info(`💀 Received death certificate for ${topic.address.group}/${topic.address.node}/${topic.address.device}. Removing from known devices.`);
                delete this.birthDebounce?.[topic.address.group]?.[topic.address.node]
                delete this.aliasResolver?.[topic.address.group]?.[topic.address.node]
                break;
            case "DATA":

                // Don't handle Node data
                if (!topic.address.device) return;

                // Check if we have a birth certificate for the device
                if (this.aliasResolver?.[topic.address.group]?.[topic.address.node]?.[topic.address.device]) {

                    // Device is known, resolve aliases and write to InfluxDB
                    this.writeMetrics(payload, topic);

                } else {

                    // Check that we don't already have an active debounce for this device
                    if (this.birthDebounce?.[topic.address.group]?.[topic.address.node]?.[topic.address.device]) {
                        logger.info(`⏳ Device ${topic.address.group}/${topic.address.node}/${topic.address.device} is unknown but has pending birth certificate request. Ignoring.`);
                        return;
                    }

                    logger.info(`✨ Device ${topic.address.group}/${topic.address.node}/${topic.address.device} is unknown, requesting birth certificate`);

                    // Request birth certificate
                    let response = await this.serviceClient.fetch({
                        service: UUIDs.Service.Command_Escalation,
                        url: `/v1/address/${topic.address.group}/${topic.address.node}`,
                        method: "POST",
                        headers: {
                            "content-type": "application/json"
                        },
                        body: JSON.stringify({
                            "name": "Node Control/Rebirth",
                            "value": "true"
                        })
                    })

                    logger.info('📣 Birth certificate request sent for %s. Status: %s', topic.address, response.status);

                    // Create debounce timout for this device
                    this.setNestedValue(this.birthDebounce, [topic.address.group, topic.address.node, topic.address.device], true);
                    setTimeout(() => {
                        delete this.birthDebounce?.[topic.address.group]?.[topic.address.node]?.[topic.address.device];
                    }, Math.floor(Math.random() * (10000 - 5000 + 1) + 5000));

                }
                break;
        }

        return;
    }

    private writeMetrics(payload, topic: Topic) {
        payload.metrics.forEach((metric) => {
            let birth = this.aliasResolver?.[topic.address.group]?.[topic.address.node]?.[topic.address.device]?.[metric.alias];

            if (!birth) {
                logger.error(`Metric ${metric.alias} is unknown for ${topic.address.group}/${topic.address.node}/${topic.address.device}`);
            }

            // Send each metric to InfluxDB
            this.writeToInfluxDB(birth, topic, metric.value)

        });
    }

    writeToInfluxDB(birth, topic: Topic, value) {
        const writeApi = influxDB.getWriteApi(influxOrganisation, 'default');

        writeApi.useDefaultTags({
            instance: birth.instance,
            schema: birth.schema,
            group: topic.address.group,
            node: topic.address.node,
            device: topic.address.device
        });


        switch (birth.type) {
            case "Int8":
            case "Int16":
            case "Int32":
            case "Int64":
                writeApi.writePoint(new Point(birth.name).intField('value', value));
                break;
            case "UInt8":
            case "UInt16":
            case "UInt32":
            case "UInt64":
                writeApi.writePoint(new Point(birth.name).uintField('value', value));
                break;
            case "Float":
            case "Double":
                writeApi.writePoint(new Point(birth.name).floatField('value', value));
                break;
            case "Boolean":
                writeApi.writePoint(new Point(birth.name).booleanField('value', value));
                break;
            default:
                writeApi.writePoint(new Point(birth.name).stringField('value', value));
                break;

        }

        writeApi.close().then(() => {
            logger.debug(`Written to InfluxDB: [${birth.type}] ${birth.name} = ${value}`);
        })
    }

    setNestedValue(obj, path, value) {
        for (var i = 0; i < path.length - 1; i++) {
            obj = obj[path[i]] = obj[path[i]] || {};
        }
        obj[path[path.length - 1]] = value;
        return obj;
    }
}

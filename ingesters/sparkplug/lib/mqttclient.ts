/*
 * AMRC ACS UNS Ingester
 * Copyright "2024" AMRC
 */

import {ServiceClient, SpB, Topic, UUIDs} from "@amrc-factoryplus/service-client";
import {Reader} from "protobufjs";
import {logger} from "../bin/ingester.js";
import Long from "long";

import * as mqttjs from "mqtt";

interface UnsMetric {
    value: string,
    timestamp: Date,
}

interface BatchedUnsMetric extends UnsMetric {
    batch?: UnsMetric[]
}

let dotenv: any = null;
try {
    dotenv = await import ('dotenv')
} catch (e) {
}

dotenv?.config()

const unsMqttUrl: string = process.env.UNS_MQTT_URL;
if (!unsMqttUrl) {
    throw new Error("UNS_MQTT_URL environment variable is not set");
}

interface MQTTClientConstructorParams {
    e: {
        serviceClient: ServiceClient;
    }
}

export default class MQTTClient {
    private serviceClient: ServiceClient;
    private aliasResolver = {};
    private birthDebounce = {};
    private unsBroker: any;
    private sparkplugBroker: any;

    constructor({e}: MQTTClientConstructorParams) {
        this.serviceClient = e.serviceClient;
    }

    async run() {
        this.unsBroker = mqttjs.connect(unsMqttUrl);
        this.unsBroker.on("connect", () => {
            logger.info("✔  Connected to local mqtt broker!");
        });

        this.unsBroker.on("error", (error) => {
            logger.error(`🔥 Error from broker: ${error}`);
        })
        const sparkplugBroker = await this.serviceClient.mqtt_client();
        this.sparkplugBroker = sparkplugBroker;

        sparkplugBroker.on("connect", this.onConnect.bind(this));
        sparkplugBroker.on("error", this.onError.bind(this));
        sparkplugBroker.on("message", this.onMessage.bind(this));
        sparkplugBroker.on("close", this.onClose.bind(this));
        sparkplugBroker.on("reconnect", this.onReconnect.bind(this));

        logger.info("Connecting to Sparkplug channel...");
    }

    onConnect() {
        logger.info("🔌 Connected to Sparkplug channel");
        logger.info("👂 Subscribing to entire Factory+ namespace");
        this.sparkplugBroker.subscribe('spBv1.0/#');
    }

    onClose() {
        logger.warn(`❌ Disconnected from Sparkplug channel`);
    }

    onReconnect() {
        logger.warn(`⚠️ Reconnecting to Sparkplug channel...`);
    }

    onError(error: any) {
        logger.error("🚨 MQTT error: %o", error);
    }

    async onMessage(topicString: string, message: Uint8Array | Reader) {
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
                if (!topic.address.isDevice()) return;

                let topLevelSchema = null;
                let schemaUUIDMapping = {};

                let topLevelInstance = null;
                let instanceUUIDMapping = {};

                // If we have a Factory+ payload then process the Schema UUIDs and Instance UUIDs
                if (payload.uuid === UUIDs.FactoryPlus) {

                    // TODO: Raise alert if the payload doesn't contain the Device_Information-v1/Heirarchy-v1 schema

                    // Schema_UUIDs
                    payload.metrics.forEach((metric) => {
                        // If the name ends in Schema_UUID (e.g. Phases/1/Schema_UUID)
                        if (metric.name.endsWith("Schema_UUID")) {
                            // Then get the entire string before the /Schema_UUID
                            let schemaPath = metric.name.split("/").slice(0, -1).join("/");

                            // If the schemaPath is empty then this is the top level Schema_UUID
                            if (schemaPath === "") {
                                // So set the topLevelSchema to this value
                                topLevelSchema = metric.value;
                            } else {
                                // Add this mapping to the schemaUUIDMapping array. This means
                                // that all metrics that contain this schema path in their name
                                // will have
                                schemaUUIDMapping[schemaPath] = metric.value;
                            }
                        }
                    })

                    // Instance_UUIDs
                    payload.metrics.forEach((metric) => {
                        // If the name ends in Instance_UUID (e.g. Phases/1/Instance_UUID)
                        if (metric.name.endsWith("Instance_UUID")) {
                            // Then get the entire string before the /Instance_UUID
                            let instancePath = metric.name.split("/").slice(0, -1).join("/");

                            // If the instancePath is empty then this is the top level Instance_UUID
                            if (instancePath === "") {
                                // So set the topLevelInstance to this value
                                topLevelInstance = metric.value;
                            } else {
                                // Add this mapping to the instanceUUIDMapping array. This means
                                // that all metrics that contain this instance path in their name
                                // will have
                                instanceUUIDMapping[instancePath] = metric.value;
                            }
                        }
                    })
                }

                if (this.aliasResolver?.[topic.address.group]?.[topic.address.node]?.[topic.address.device]) {
                    logger.info(`🔄 Received updated birth certificate for ${topic.address.group}/${topic.address.node}/${topic.address.device} with Instance_UUID ${topLevelInstance} using Schema_UUID ${topLevelSchema}`);
                } else {
                    logger.info(`👶 Received birth certificate for ${topic.address.group}/${topic.address.node}/${topic.address.device} with Instance_UUID ${topLevelInstance} using Schema_UUID ${topLevelSchema}`);
                }

                // Store the birth certificate mapping in the alias resolver. This uses the alias as the key and a simplified object containing the name and type as the value.
                this.setNestedValue(this.aliasResolver, [topic.address.group, topic.address.node, topic.address.device], payload.metrics.reduce(function (acc, obj) {
                    let alias = Long.isLong(obj.alias) ? obj.alias.toNumber() : obj.alias;

                    // Work out all schemas that are involved in this metric.
                    //
                    // e.g. Assume the current metric is CNC/Axes/1/BaseAxis/Position/Actual
                    //
                    // The schemaUUIDMapping object will contain the following (non-relevant emitted):
                    // - Axes/1: e39007e9-1427-4867-9d72-1c00c663db15
                    // - Axes/1/BaseAxis: 777dd941-f426-4355-8130-e144530b1376
                    // - Axes/1/BaseAxis/Position: 1a2c3594-d311-4f6b-865b-b97db3fa6d42

                    // Schema_UUIDs

                    let schemas = [];
                    // Get all entries in the schemaUUIDMapping object that have keys that fit in the current obj.name
                    Object.entries(schemaUUIDMapping).forEach(([schemaPath, schemaUUID]) => {
                        // If the current obj.name contains the schemaPath then add the schemaUUID to the schemas array
                        if (obj.name.includes(schemaPath)) {
                            schemas.push(schemaUUID);
                        }
                    });

                    // Get the bottom level schema by finding the the entry in the schemaUUIDMapping object that has
                    // the key with the most slashes that fits in the current obj.name
                    let bottomLevelSchema = Object.entries(schemaUUIDMapping).reduce((acc, [schemaPath, schemaUUID]) => {
                        if (obj.name.includes(schemaPath) && schemaPath.split("/").length > acc.split("/").length) {
                            return schemaUUID;
                        } else {
                            return acc;
                        }
                    }, "");

                    // Instance_UUIDs

                    let instances = [];
                    // Get all entries in the instanceUUIDMapping object that have keys that fit in the current obj.name
                    Object.entries(instanceUUIDMapping).forEach(([instancePath, instanceUUID]) => {
                        // If the current obj.name contains the instancePath then add the instanceUUID to the instances array
                        if (obj.name.includes(instancePath)) {
                            instances.push(instanceUUID);
                        }
                    });

                    // Get the bottom level instance by finding the the entry in the instanceUUIDMapping object that has
                    // the key with the most slashes that fits in the current obj.name
                    let bottomLevelInstance = Object.entries(instanceUUIDMapping).reduce((acc, [instancePath, instanceUUID]) => {
                        if (obj.name.includes(instancePath) && instancePath.split("/").length > acc.split("/").length) {
                            return instanceUUID;
                        } else {
                            return acc;
                        }
                    }, "");

                    acc[alias] = {
                        instance: {
                            // The top level instance for this device
                            top: topLevelInstance,

                            // The last instance before this metric
                            bottom: bottomLevelInstance,

                            // All instances between the top and bottom, inclusive
                            full: instances,
                        },
                        schema: {
                            // The top level schema for this device
                            top: topLevelSchema,

                            // The last schema before this metric
                            bottom: bottomLevelSchema,

                            // All schemas between the top and bottom, inclusive
                            full: schemas,
                        },
                        name: obj.name,
                        type: obj.type,
                        alias: alias,
                        unit: obj.properties?.engUnit?.value,
                        transient: obj.isTransient
                    };
                    return acc;
                }, {}));

                // Clear the debounce
                delete this.birthDebounce?.[topic.address.group]?.[topic.address.node]?.[topic.address.device];

                // Publish values to UNS
                this.publishToUNS(payload, topic);

                break;
            case "DEATH":

                // If the death certificate is for a device then remove it from the known devices, otherwise remove the entire node
                if (topic.address.isDevice()) {
                    logger.info(`💀 Received death certificate for ${topic.address.group}/${topic.address.node}/${topic.address.device}. Removing from known devices.`);
                    delete this.birthDebounce?.[topic.address.group]?.[topic.address.node]?.[topic.address.device]
                    delete this.aliasResolver?.[topic.address.group]?.[topic.address.node]?.[topic.address.device]
                    break;
                } else {
                    logger.info(`💀💀💀 Received death certificate for entire node ${topic.address.group}/${topic.address.node}. Removing from known nodes.`);
                    delete this.birthDebounce?.[topic.address.group]?.[topic.address.node]
                    delete this.aliasResolver?.[topic.address.group]?.[topic.address.node]
                    break;
                }
            case "DATA":

                // Don't handle Node data
                if (!topic.address.isDevice()) return;

                // Check if we have a birth certificate for the device
                if (this.aliasResolver?.[topic.address.group]?.[topic.address.node]?.[topic.address.device]) {

                    // Device is known, resolve aliases and publish to UNS
                    //this.writeMetrics(payload, topic);
                    this.publishToUNS(payload, topic)

                } else {

                    // Check that we don't already have an active debounce for this device
                    if (this.birthDebounce?.[topic.address.group]?.[topic.address.node]?.[topic.address.device]) {
                        logger.info(`⏳ Device ${topic.address.group}/${topic.address.node}/${topic.address.device} is unknown but has pending birth certificate request. Ignoring.`);
                        return;
                    }

                    logger.info(`✨ Device ${topic.address.group}/${topic.address.node}/${topic.address.device} is unknown, requesting birth certificate`);

                    // Create debounce timout for this device
                    this.setNestedValue(this.birthDebounce, [topic.address.group, topic.address.node, topic.address.device], true);
                    setTimeout(() => {
                        delete this.birthDebounce?.[topic.address.group]?.[topic.address.node]?.[topic.address.device];
                    }, Math.floor(Math.random() * (10000 - 5000 + 1) + 5000));

                    // Request birth certificate
                    let response = await this.serviceClient.fetch({
                        service: UUIDs.Service.Command_Escalation,
                        url: `/v1/address/${topic.address.group}/${topic.address.node}/${topic.address.device}`,
                        method: "POST",
                        headers: {
                            "content-type": "application/json"
                        },
                        body: JSON.stringify({
                            "name": "Device Control/Rebirth", "value": "true"
                        })
                    })

                    logger.info('📣 Birth certificate request sent for %s. Status: %s', topic.address, response.status);

                }
                break;
        }

        return;
    }

    /**
     * Publishes received values from the Sparkplug namespace to the UNS with a topic structured to values schema path
     * @param payload Received payload.
     * @param topic Topic the payload was received on.
     */
    private publishToUNS(payload, topic) {
        const metricsToPublish: { [metricPath: string]: any[] } = {};

        //resolve metric aliases
        payload.metrics.forEach((metric) => {
            if (metric.value === null) return;
            let birth = this.aliasResolver?.[topic.address.group]?.[topic.address.node]?.[topic.address.device]?.[metric.alias];

            if (!birth) {
                logger.error(`❓ Metric ${metric.alias} is unknown for ${topic.address.group}/${topic.address.node}/${topic.address.device}`);
                return;
            }

            // TODO: Build custom properties object - SFIP2-57

            if (birth.transient) {
                // TODO: Add transient to custom properties if needed
                logger.debug(`Metric ${birth.name} is transient, publishing to UNS`);
            }

            const metricName = birth.name.split('/').pop() as string;
            const path = birth.name.substring(0, birth.name.lastIndexOf("/")) as string;
            if (path.includes("Device Control")) {
                return;
            }

            // TODO: Get enterprise information from the Device_Information-v1/Hierarchy-v1 schema - SFIP2-58

            let unsTopic = `AMRC/F2050/MK1/${topic.address.device}/Edge/${path ? (path + '/') : ''}${metricName}`;

            if (!(unsTopic in metricsToPublish)) {
                metricsToPublish[unsTopic] = [metric]
            } else {
                metricsToPublish[unsTopic].push(metric);
            }

        });

        // format payload to publish to uns.
        Object.entries(metricsToPublish).forEach(([topic, value]) => {

            // TODO: Add custom properties before sending - SFIP2-57

            // if theirs more than one of the same metric from the same sparkplug payload, add the values to the batch array.
            if (value.length > 1) {
                const sortedMetrics = value.sort((a, b) => b.timestamp.toNumber() - a.timestamp.toNumber());
                let payload: BatchedUnsMetric = {
                    timestamp: new Date(sortedMetrics[0].timestamp.toNumber()),
                    value: sortedMetrics[0].value,
                    batch: []
                }
                //remove the first element, that's our newest and will be the value outside the batch array.
                sortedMetrics.shift();
                sortedMetrics.forEach(metric => {
                    payload.batch.push({timestamp: metric.timestamp.toNumber(), value: metric.value});
                });
                this.unsBroker.publish(topic, JSON.stringify(payload));
            } else {
                const payload: UnsMetric = {timestamp: new Date(value[0].timestamp.toNumber()), value: value[0].value};
                this.unsBroker.publish(topic, JSON.stringify(payload));
            }
        })
    }

    /*
    private writeMetrics(payload, topic: Topic) {
        payload.metrics.forEach((metric) => {
            let birth = this.aliasResolver?.[topic.address.group]?.[topic.address.node]?.[topic.address.device]?.[metric.alias];

            if (!birth) {
                logger.error(`Metric ${metric.alias} is unknown for ${topic.address.group}/${topic.address.node}/${topic.address.device}`);
            }

            let metricTimestamp: Date
            if (metric.timestamp) {
                metricTimestamp = new Date(metric.timestamp);
            } else if (payload.timestamp) {
                // Metrics might not have a timestamp so use the packet timestamp if we have it.
                metricTimestamp = new Date(payload.timestamp);
            } else {
                // No timestamp can be found on the metric or the payload, just use the current time instead.
                metricTimestamp = new Date();
            }
            // Send each metric to InfluxDB
            this.writeToInfluxDB(birth, topic, metric.value, metricTimestamp)
        });
    }
    */
    /**
     * Writes metric values to InfluxDB using the metric timestamp.
     * @param birth Birth certificate for device.
     * @param topic Topic the metric was published on.
     * @param value Metric value to write to InfluxDB.
     * @param timestamp Timestamp from the metric to write to influx.
     */

    /*
    writeToInfluxDB(birth, topic: Topic, value, timestamp: Date) {
        if (value === null) return;
        if (birth.transient) {
            logger.debug(`Metric ${birth.name} is transient, not writing to InfluxDB`);
            return;
        }

        // Get the value after the last /
        let metricName = birth.name.split('/').pop();

        // Get the path as everything behind the last /
        let path = birth.name.substring(0, birth.name.lastIndexOf("/"));

        writeApi.useDefaultTags({
            topLevelInstance: birth.instance.top,
            bottomLevelInstance: birth.instance.bottom,
            usesInstances: birth.instance.top + ':' + birth.instance.full.join(':'),
            topLevelSchema: birth.schema.top,
            bottomLevelSchema: birth.schema.bottom,
            usesSchemas: birth.schema.top + ':' + birth.schema.full.join(':'),
            group: topic.address.group,
            node: topic.address.node,
            device: topic.address.device,
            path: path,
            unit: birth.unit
        });

        let numVal = null;

        switch (birth.type) {
            case "Int8":
            case "Int16":
            case "Int32":
            case "Int64":
                // Validate
                numVal = Number(value);
                if (!Number.isInteger(numVal)) {
                    logger.warn(`${topic.address}/${path}/${metricName} should be a ${birth.type} but received ${numVal}. Not recording.`);
                    return;
                }
                writeApi.writePoint(
                    new Point(`${metricName}:i`)
                        .intField('value', numVal)
                        .timestamp(timestamp)
                );
                break;
            case "UInt8":
            case "UInt16":
            case "UInt32":
            case "UInt64":
                // Validate
                numVal = Number(value);
                if (!Number.isInteger(numVal)) {
                    logger.warn(`${topic.address}/${path}/${metricName} should be a ${birth.type} but received ${numVal}. Not recording.`);
                    return;
                }
                writeApi.writePoint(
                    new Point(`${metricName}:u`)
                        .uintField('value', numVal)
                        .timestamp(timestamp)
                );
                break;
            case "Float":
            case "Double":
                // Validate
                numVal = Number(value);
                if (isNaN(parseFloat(numVal))) {
                    logger.warn(`${topic.address}/${path}/${metricName} should be a ${birth.type} but received ${numVal}. Not recording.`);
                    return;
                }
                writeApi.writePoint(
                    new Point(`${metricName}:d`)
                        .floatField('value', numVal)
                        .timestamp(timestamp)
                );
                break;
            case "Boolean":
                if (typeof value != "boolean") {
                    logger.warn(`${topic.address}/${path}/${metricName} should be a ${birth.type} but received ${value}. Not recording.`);
                    return;
                }
                writeApi.writePoint(
                    new Point(`${metricName}:b`)
                        .booleanField('value', value)
                        .timestamp(timestamp));
                break;
            default:
                writeApi.writePoint(
                    new Point(`${metricName}:s`)
                        .stringField('value', value)
                        .timestamp(timestamp));
                break;

        }

        i++;

        logger.debug(`Added to write buffer (${i}/${batchSize}): [${birth.type}] ${topic.address}/${path}/${metricName} = ${value}`);

        if (i >= batchSize) {
            this.flushBuffer(`${batchSize} point BATCH`);
        }
    }*/

    setNestedValue(obj, path, value) {
        for (let k = 0; k < path.length - 1; k++) {
            obj = obj[path[k]] = obj[path[k]] || {};
        }
        obj[path[path.length - 1]] = value;
        return obj;
    }
}

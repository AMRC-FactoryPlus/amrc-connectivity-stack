/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { ServiceClient, SpB, Topic, UUIDs } from "@amrc-factoryplus/service-client";
import { Reader } from "protobufjs";
import { logger } from "../bin/ingester.js";
import Long from "long";

import { randomUUID } from "crypto";
import mqtt from "mqtt";

interface UnsMetric {
    value: string,
    timestamp: Date,
    batch?: UnsMetric[]
}

interface UnsMetricCustomProperties {
    InstanceUUID: string,
    SchemaUUID: string,
    Transient: boolean,
    Unit: string,
    Type: string,
    InstanceUUIDPath: string,
    SchemaUUIDPath: string,
    Enterprise: string,
    Site: string,
    Area: string,
    WorkCenter: string,
    WorkUnit: string,
    Device: string,
    Node: string,
    Group: string,
}

interface MetricContainer {
    metric: any,
    customProperties: UnsMetricCustomProperties
}

let dotenv: any = null;
try {
    dotenv = await import('dotenv')
} catch (e) {
}

dotenv?.config()

interface MQTTClientConstructorParams {
    e: {
        serviceClient: ServiceClient;
    }
}

export default class MQTTClient {
    private serviceClient: ServiceClient;
    private aliasResolver = {};
    private birthDebounce = {};
    private sparkplugBroker: any;
    private metricsBroker: any;

    constructor({ e }: MQTTClientConstructorParams) {
        this.serviceClient = e.serviceClient;
    }

    async run() {

        this.sparkplugBroker = await this.serviceClient.mqtt_client();

        this.sparkplugBroker.on("connect", this.onConnect.bind(this));
        this.sparkplugBroker.on("error", this.onError.bind(this));
        this.sparkplugBroker.on("message", this.onMessage.bind(this));
        this.sparkplugBroker.on("close", this.onClose.bind(this));
        this.sparkplugBroker.on("reconnect", this.onReconnect.bind(this));

        logger.info("Connecting to MQTT Broker...");

        // Optionally connect a secondary broker for publishing uns/metrics
        const metricsUrl = process.env.METRICS_MQTT_URL;
        if (metricsUrl) {
            try {
                const options: mqtt.IClientOptions = {};
                if (process.env.METRICS_MQTT_USERNAME) options.username = process.env.METRICS_MQTT_USERNAME;
                if (process.env.METRICS_MQTT_PASSWORD) options.password = process.env.METRICS_MQTT_PASSWORD;
                if (process.env.METRICS_MQTT_CLIENT_ID) options.clientId = process.env.METRICS_MQTT_CLIENT_ID;
                if (process.env.METRICS_MQTT_REJECT_UNAUTHORIZED != null) {
                    options.rejectUnauthorized = process.env.METRICS_MQTT_REJECT_UNAUTHORIZED !== 'false';
                }
                this.metricsBroker = mqtt.connect(metricsUrl, options);
                this.metricsBroker.on("connect", () => logger.info(`🔌 Connected to metrics MQTT broker (${metricsUrl})`));
                this.metricsBroker.on("reconnect", () => logger.warn("⚠️ Reconnecting to metrics MQTT broker..."));
                this.metricsBroker.on("close", () => logger.warn("❌ Disconnected from metrics MQTT broker"));
                this.metricsBroker.on("error", (err) => logger.error("🚨 Metrics MQTT error: %o", err));
            } catch (e) {
                logger.error(`🔥 Failed to initialise metrics MQTT broker (${metricsUrl}): ${e?.message ?? e}`);
            }
        } else {
            logger.info("Metrics MQTT broker not configured; publishing uns/metrics to Factory+ broker only");
        }
    }

    onConnect() {
        logger.info("🔌 Connected to MQTT Broker");
        logger.info("👂 Subscribing to entire Factory+ namespace");
        this.sparkplugBroker.subscribe('spBv1.0/#');
    }

    onClose() {
        logger.warn(`❌ Disconnected from MQTT Broker`);
    }

    onReconnect() {
        logger.warn(`⚠️ Reconnecting to MQTT Broker...`);
    }

    onError(error: any) {
        logger.error("🚨 MQTT error: %o", error);
    }

    async onMessage(topicString: string, message: Uint8Array | Reader) {
        let topic = Topic.parse(topicString);
        let payload;

        try {
            payload = SpB.decodeToNative(message);
        } catch (e) {
            logger.error(`🚨 Bad payload on topic ${topicString}: ${e}`);
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

                let enterprise = null;
                let site = null;
                let area = null;
                let workCenter = null;
                let workUnit = null;

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

                            // Check if this Schema_UUID is the Hierarchy-v1 schema
                            if (metric.value === "84ac3397-f3a2-440a-99e5-5bb9f6a75091") {

                                // If the Hierarchy-v1 schema is not in Device_Information/ISA95_Hierarchy then ignore
                                // it - we expect it to be here

                                if (!schemaPath.includes("Device_Information/ISA95_Hierarchy")) {
                                    logger.warn(`🔎 Hierarchy-v1 schema not found in expected location for ${topic.address.group}/${topic.address.node}/${topic.address.device}. This device will not be published to UNS.`);
                                    return;
                                }
                                // Use the path to this location to view the actual information
                                // Extract the actual schema initial value information using the location of the Hierarchy-v1 schema
                                enterprise = payload.metrics.find((metric) => metric.name === schemaPath + "/Enterprise")?.value;
                                site = payload.metrics.find((metric) => metric.name === schemaPath + "/Site")?.value;
                                area = payload.metrics.find((metric) => metric.name === schemaPath + "/Area")?.value;
                                workCenter = payload.metrics.find((metric) => metric.name === schemaPath + "/Work Center")?.value;
                                workUnit = payload.metrics.find((metric) => metric.name === schemaPath + "/Work Unit")?.value;
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

                if (!enterprise) {
                    logger.warn(`🚨 No ISA-95 hierarchy information found in birth certificate for ${topic.address.group}/${topic.address.node}/${topic.address.device}. This device will not be published to UNS.`);
                }

                if (this.aliasResolver?.[topic.address.group]?.[topic.address.node]?.[topic.address.device]) {
                    logger.info(`🔄 Received updated birth certificate for ${topic.address.group}/${topic.address.node}/${topic.address.device} with Instance_UUID ${topLevelInstance} using Schema_UUID ${topLevelSchema}`);
                } else {
                    logger.info(`👶 Received birth certificate for ${topic.address.group}/${topic.address.node}/${topic.address.device} with Instance_UUID ${topLevelInstance} using Schema_UUID ${topLevelSchema}`);
                }

                // Store the birth certificate mapping in the alias resolver. This uses the alias as the key and a simplified object containing the name and type as the value.
                this.setNestedValue(this.aliasResolver, [topic.address.group, topic.address.node, topic.address.device], payload.metrics.reduce(function (acc, obj) {
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

                    acc[obj.alias] = {
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
                        isa95: {
                            enterprise: enterprise,
                            site: site,
                            area: area,
                            workCenter: workCenter,
                            workUnit: workUnit,
                        },
                        name: obj.name,
                        type: obj.type,
                        alias: obj.alias,
                        unit: obj.properties?.engUnit?.value,
                        transient: obj.isTransient
                    };
                    return acc;
                }, {}));

                // Capture a human-readable device name from Device_Information if present
                try {
                    const deviceNameMetric =
                        payload.metrics.find((m) => m.name === "Device_Information/Name") ||
                        payload.metrics.find((m) => m.name?.endsWith("Device_Information/Name")) ||
                        payload.metrics.find((m) => m.name?.includes("Device_Information") && m.name?.endsWith("/Name")) ||
                        payload.metrics.find((m) => m.name === "Device_Information/Device_Name") ||
                        payload.metrics.find((m) => m.name?.includes("Device_Information") && m.name?.endsWith("/Device_Name"));
                    const deviceNameVal = deviceNameMetric?.value ?? topic.address.device;
                    this.aliasResolver[topic.address.group][topic.address.node][topic.address.device]._deviceName = deviceNameVal;
                } catch (_) {
                    // ignore; fall back to device address later
                }


                // Clear the debounce
                delete this.birthDebounce?.[topic.address.group]?.[topic.address.node]?.[topic.address.device];

                // Publish values to UNS
                // this.publishToUNS(payload, topic);

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
                    try {
                        await this.serviceClient.CmdEsc.rebirth(topic.address);
                        logger.info(`📣 Birth certificate request sent for ${topic.address}`);
                    } catch (e) {
                        logger.error(`🔥 Birth certificate request failed for ${topic.address}. Error: ${e.message}`);
                    }
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

        const metricsToPublish: { [metricPath: string]: MetricContainer[] } = {};

        //resolve metric aliases
        payload.metrics.forEach((metric) => {
            if (metric.value === null) return;

            let birth = this.aliasResolver?.[topic.address.group]?.[topic.address.node]?.[topic.address.device]?.[metric.alias];

            if (!birth) {
                logger.error(`❓ Metric ${metric.alias} is unknown for ${topic.address.group}/${topic.address.node}/${topic.address.device}`);
                return;
            }

            // Don't handle data for devices that have not published ISA-95 hierarchy information
            if (!birth.isa95.enterprise) {
                return;
            }

            const metricName = birth.name.split('/').pop() as string;
            const path = birth.name.substring(0, birth.name.lastIndexOf("/")) as string;
            if (path.includes("Device Control")) {
                return;
            }

            // We don't want to publish Instance_UUID or Schema_UUID metrics
            if (metricName === "Instance_UUID" || metricName === "Schema_UUID") {
                return;
            }
            // Build custom properties object
            const customProperties: UnsMetricCustomProperties = {
                InstanceUUIDPath: birth.instance.top + ':' + birth.instance.full.join(':'),
                SchemaUUIDPath: birth.schema.top + ':' + birth.schema.full.join(':'),
                Type: birth.type,
                Unit: birth.unit,
                InstanceUUID: birth.instance.top,
                SchemaUUID: birth.schema.top,
                Transient: birth.transient,
                Enterprise: birth.isa95.enterprise,
                Site: birth.isa95.site,
                Area: birth.isa95.area,
                WorkCenter: birth.isa95.workCenter,
                WorkUnit: birth.isa95.workUnit,
                Device: topic.address.device,
                Node: topic.address.node,
                Group: topic.address.group,
            }

            // Here we can access the ISA95 hierarchy information from the birth.isa95 object. This object contains the following keys:

            // - enterprise
            // - site
            // - area
            // - workCenter
            // - workUnit
            //
            // enterprise is mandatory, but the remaining are optional but must form an unbroken chain from the top to
            // the bottom. I.e. you may not have a workCenter without an area, or a workUnit without a workCenter. As
            // soon as we see a break in the chain publish what we have.

            let unsTopic = null;

            // We must have an enterprise or we can't publish. It should never get to this point.
            if (birth.isa95.enterprise == null) {
                return;
            }

            // If we don't have a site then we publish to the enterprise
            if (birth.isa95.site == null) {
                unsTopic = `UNS/v1/${birth.isa95.enterprise}/Edge/${topic.address.device}/${path ? (path + '/') : ''}${metricName}`;
            }

            // If we have a site but no area then we publish to the site
            else if (birth.isa95.area == null) {
                unsTopic = `UNS/v1/${birth.isa95.enterprise}/${birth.isa95.site}/Edge/${topic.address.device}/${path ? (path + '/') : ''}${metricName}`;
            }

            // If we have a site and an area but no workCenter then we publish to the area
            else if (birth.isa95.workCenter == null) {
                unsTopic = `UNS/v1/${birth.isa95.enterprise}/${birth.isa95.site}/${birth.isa95.area}/Edge/${topic.address.device}/${path ? (path + '/') : ''}${metricName}`;
            }

            // If we have a site, an area and a workCenter but no workUnit then we publish to the workCenter
            else if (birth.isa95.workUnit == null) {
                unsTopic = `UNS/v1/${birth.isa95.enterprise}/${birth.isa95.site}/${birth.isa95.area}/${birth.isa95.workCenter}/Edge/${topic.address.device}/${path ? (path + '/') : ''}${metricName}`;
            }

            // If we have a site, an area, a workCenter and a workUnit then we publish to the workUnit
            else {
                unsTopic = `UNS/v1/${birth.isa95.enterprise}/${birth.isa95.site}/${birth.isa95.area}/${birth.isa95.workCenter}/${birth.isa95.workUnit}/Edge/${topic.address.device}/${path ? (path + '/') : ''}${metricName}`;
            }

            if (!(unsTopic in metricsToPublish)) {
                metricsToPublish[unsTopic] = [{
                    metric: metric,
                    customProperties: customProperties
                }]
            } else {
                metricsToPublish[unsTopic].push({
                    metric: metric,
                    customProperties: customProperties
                });
            }

        });

        // format payload to publish to uns.
        Object.entries(metricsToPublish).forEach(([topic, metricContainers]) => {
            let payload: UnsMetric;
            // if theirs more than one of the same metric from the same sparkplug payload, add the values to the batch array.
            if (metricContainers.length > 1) {
                const sortedMetricContainers = metricContainers.sort((a, b) => a.metric.timestamp - b.metric.timestamp);
                payload = {
                    timestamp: new Date(sortedMetricContainers[0].metric.timestamp),
                    value: sortedMetricContainers[0].metric.value,
                    batch: []
                }
                //remove the first element, that's our newest and will be the value outside the batch array.
                sortedMetricContainers.shift();
                sortedMetricContainers.forEach(metricContainer => {
                    payload.batch.push({
                        timestamp: new Date(metricContainer.metric.timestamp),
                        value: metricContainer.metric.value
                    });
                });
            } else {
                payload = {
                    timestamp: new Date(metricContainers[0].metric.timestamp),
                    value: metricContainers[0].metric.value
                };
            }

            if (!metricContainers[0]?.customProperties.InstanceUUID) {
                logger.warn(`${topic} is not broadcasting an Instance_UUID. Not publishing to UNS.`);
                return;
            }

            if (!metricContainers[0]?.customProperties.SchemaUUID) {
                logger.warn(`${topic} is not broadcasting a Schema_UUID. Not publishing to UNS.`);
                return;
            }

            this.sparkplugBroker.publish(topic, JSON.stringify(payload), {
                properties: {
                    //     Assume that all metrics have the same custom properties
                    userProperties: {
                        InstanceUUID: metricContainers[0]?.customProperties.InstanceUUID,
                        SchemaUUID: metricContainers[0].customProperties.SchemaUUID,
                        Transient: metricContainers[0].customProperties.Transient ?? false,
                        Unit: metricContainers[0].customProperties.Unit ?? '',
                        Type: metricContainers[0].customProperties.Type ?? 'undefined',
                        InstanceUUIDPath: metricContainers[0].customProperties.InstanceUUIDPath ?? "",
                        SchemaUUIDPath: metricContainers[0].customProperties.SchemaUUIDPath ?? "",
                    }
                }
            });

            // Publish to uns/metrics
            let unsBroker;
            if (this.metricsBroker) {
                unsBroker = this.metricsBroker;
            } else {
                unsBroker = this.sparkplugBroker;
            }

            // Get the metric name from the topic (last part of the topic)
            const metricName = topic.split('/').pop() as string;

            // Create the uns/metrics message
            const msg = {
                version: "1",
                id: randomUUID(),
                timestamp: new Date().toISOString(),
                metricName: metricName,
                metricId: metricContainers[0]?.customProperties.SchemaUUID,
                value: payload.value,
                unit: metricContainers[0]?.customProperties.Unit ?? '',
                source: {
                    sourceType: "Factory+ Device",
                    id: metricContainers[0]?.customProperties.InstanceUUID,
                    name: metricContainers[0]?.customProperties.Device ?? '',
                    payloadType: metricContainers[0]?.customProperties.SchemaUUID,
                    enterprise: metricContainers[0]?.customProperties.Enterprise ?? '',
                    site: metricContainers[0]?.customProperties.Site ?? '',
                    area: metricContainers[0]?.customProperties.Area ?? '',
                    workCenter: metricContainers[0]?.customProperties.WorkCenter ?? '',
                    workUnit: metricContainers[0]?.customProperties.WorkUnit ?? '',
                    annotations: {
                        customProperties: {
                            ...metricContainers[0]?.customProperties,
                            FullPath: topic
                        }
                    }
                },
                inputs: [],
                transformation: {},
                annotations: {}
            };

            unsBroker.publish('uns/metrics', JSON.stringify(msg));
        })
    }

    setNestedValue(obj, path, value) {
        for (let k = 0; k < path.length - 1; k++) {
            obj = obj[path[k]] = obj[path[k]] || {};
        }
        obj[path[path.length - 1]] = value;
        return obj;
    }
}

/*
 * AMRC InfluxDB Sparkplug Ingester
 * Copyright "2023" AMRC
 */

import {ServiceClient, SpB, Topic, UUIDs} from "@amrc-factoryplus/utilities";
import {Reader} from "protobufjs";
import {logger} from "../bin/ingester.js";
import Long from "long";
import {InfluxDB, Point} from '@influxdata/influxdb-client'
import {Agent} from 'http'

let dotenv: any = null;
try {
    dotenv = await import ('dotenv')
} catch (e) {
}

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

const batchSize: number = Number.parseInt(process.env.BATCH_SIZE);
if (!batchSize) {
    throw new Error("BATCH_SIZE environment variable is not set");
}

const flushInterval: number = Number.parseInt(process.env.FLUSH_INTERVAL);
if (!flushInterval) {
    throw new Error("FLUSH_INTERVAL environment variable is not set");
}

let i = 0;

// Node.js HTTP client OOTB does not reuse established TCP connections, a custom node HTTP agent
// can be used to reuse them and thus reduce the count of newly established networking sockets
const keepAliveAgent = new Agent({
    keepAlive: true, // reuse existing connections
    keepAliveMsecs: 20 * 1000, // 20 seconds keep alive
})

const influxDB = new InfluxDB({
    url: influxURL,
    token: influxToken,
    transportOptions: {
        agent: keepAliveAgent,
    }
})

let interval: any;

/* points/lines are batched in order to minimize networking and increase performance */

const writeApi = influxDB.getWriteApi(influxOrganisation, process.env.INFLUX_BUCKET || 'default', 'ns', {
    /* the maximum points/lines to send in a single batch to InfluxDB server */
    batchSize: batchSize + 1, // don't let automatically flush data
    /* maximum time in millis to keep points in an unflushed batch, 0 means don't periodically flush */
    flushInterval: 0, // Never allow the package to flush: we'll flush manually
    /* maximum size of the retry buffer - it contains items that could not be sent for the first time */
    maxBufferLines: 30_000,
    /* the count of internally-scheduled retries upon write failure, the delays between write attempts follow an exponential backoff strategy if there is no Retry-After HTTP header */
    maxRetries: 0, // do not retry writes
    // ... there are more write options that can be customized, see
    // https://influxdata.github.io/influxdb-client-js/influxdb-client.writeoptions.html and
    // https://influxdata.github.io/influxdb-client-js/influxdb-client.writeretryoptions.html
});

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

        process.on('exit', () => {
            this.flushBuffer('EXIT');
            keepAliveAgent.destroy();
        })

        return this;
    }

    private flushBuffer(source: string) {
        let bufferSize = i;
        i = 0;
        writeApi.flush().then(() => {
            logger.info(`🚀 Flushed ${bufferSize} points to InfluxDB [${source}]`);
            // Reset the interval
            this.resetInterval();
        })
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
        this.resetInterval();
    }

    private resetInterval() {
        clearInterval(interval);
        interval = setInterval(() => {
            this.flushBuffer(`${flushInterval}ms INTERVAL`);
        }, flushInterval);
    }

    on_close() {
        logger.warn(`❌ Disconnected from Factory+ broker`);

        // Flush any remaining data
        this.flushBuffer('CONN_CLOSE');
    }

    on_reconnect() {
        logger.warn(`⚠️ Reconnecting to Factory+ broker...`);
    }

    on_error(error: any) {
        logger.error("🚨 MQTT error: %o", error);
        // Flush any remaining data
        this.flushBuffer('MQTT_ERROR');
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

                let topLevelSchema = null;
                let schemaUUIDMapping = {};

                let topLevelInstance = null;
                let instanceUUIDMapping = {};

                // If we have a Factory+ payload then process the Schema UUIDs and Instance UUIDs
                if (payload.uuid === UUIDs.FactoryPlus) {

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

        if (value === null) return;

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
                writeApi.writePoint(new Point(`${metricName}:i`).intField('value', numVal));
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
                writeApi.writePoint(new Point(`${metricName}:u`).uintField('value', numVal));
                break;
            case "Float":
            case "Double":
                // Validate
                numVal = Number(value);
                if (isNaN(parseFloat(numVal))) {
                    logger.warn(`${topic.address}/${path}/${metricName} should be a ${birth.type} but received ${numVal}. Not recording.`);
                    return;
                }
                writeApi.writePoint(new Point(`${metricName}:d`).floatField('value', numVal));
                break;
            case "Boolean":
                if (typeof value != "boolean") {
                    logger.warn(`${topic.address}/${path}/${metricName} should be a ${birth.type} but received ${value}. Not recording.`);
                    return;
                }
                writeApi.writePoint(new Point(`${metricName}:b`).booleanField('value', value));
                break;
            default:
                writeApi.writePoint(new Point(`${metricName}:s`).stringField('value', value));
                break;

        }

        i++;

        logger.debug(`Added to write buffer (${i}/${batchSize}): [${birth.type}] ${topic.address}/${path}/${metricName} = ${value}`);

        if (i >= batchSize) {
            this.flushBuffer(`${batchSize} point BATCH`);
        }
    }

    setNestedValue(obj, path, value) {
        for (let k = 0; k < path.length - 1; k++) {
            obj = obj[path[k]] = obj[path[k]] || {};
        }
        obj[path[path.length - 1]] = value;
        return obj;
    }
}

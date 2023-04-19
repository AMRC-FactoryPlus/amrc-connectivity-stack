/*
 * AMRC InfluxDB Sparkplug Ingester
 * Copyright "2023" AMRC
 */
import { SpB, Topic, UUIDs } from "@amrc-factoryplus/utilities";
import { logger } from "../bin/ingester.js";
import * as dotenv from 'dotenv';
import Long from "long";
import { InfluxDB, Point } from '@influxdata/influxdb-client';
dotenv.config();
const influxURL = process.env.INFLUX_URL;
if (!influxURL) {
    throw new Error("INFLUX_URL environment variable is not set");
}
const influxToken = process.env.INFLUX_TOKEN;
if (!influxToken) {
    throw new Error("INFLUX_TOKEN environment variable is not set");
}
const influxOrganisation = process.env.INFLUX_ORG;
if (!influxOrganisation) {
    throw new Error("INFLUX_ORG environment variable is not set");
}
const influxDB = new InfluxDB({
    url: influxURL,
    token: influxToken,
});
export default class MQTTClient {
    constructor({ e }) {
        this.aliasResolver = {};
        this.birthDebounce = {};
        this.serviceClient = e.serviceClient;
    }
    async init() {
        return this;
    }
    async run() {
        const mqtt = await this.serviceClient.mqtt_client();
        this.mqtt = mqtt;
        this.serviceClient.set_service_url(UUIDs.Service.Command_Escalation, 'http://cmdesc.amrc-f2050-apr2023.shef.ac.uk');
        mqtt.on("authenticated", this.on_connect.bind(this));
        mqtt.on("error", this.on_error.bind(this));
        mqtt.on("message", this.on_message.bind(this));
        mqtt.on("close", this.on_close.bind(this));
        mqtt.on("reconnect", this.on_reconnect.bind(this));
        logger.info("👂 Subscribing to entire Factory+ namespace");
        // We subscribe to the whole Sparkplug namespace
        mqtt.subscribe('spBv1.0/#');
    }
    on_connect() {
        logger.info("🔌 Connected to Factory+ broker");
    }
    on_close() {
        logger.info(`❌ Disconnected from Factory+ broker`);
    }
    on_reconnect() {
        logger.info(`⚠️ Reconnecting to Factory+ broker...`);
    }
    on_error(error) {
        logger.error("🚨 MQTT error: %o", error);
    }
    async on_message(topicString, message) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
        let topic = Topic.parse(topicString);
        let payload;
        try {
            payload = SpB.decodePayload(message);
        }
        catch (_s) {
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
                if (!topic.address.device)
                    return;
                let instance = payload.metrics.find((metric) => metric.name === "Instance_UUID").value;
                let schema = payload.metrics.find((metric) => metric.name === "Schema_UUID").value;
                // If we've already seen this birth, update it
                if ((_c = (_b = (_a = this.aliasResolver) === null || _a === void 0 ? void 0 : _a[topic.address.group]) === null || _b === void 0 ? void 0 : _b[topic.address.node]) === null || _c === void 0 ? void 0 : _c[topic.address.device]) {
                    logger.info(`🔄 Received updated birth certificate for ${topic.address.group}/${topic.address.node}/${topic.address.device} with Instance_UUID ${instance}`);
                }
                else {
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
                (_f = (_e = (_d = this.birthDebounce) === null || _d === void 0 ? void 0 : _d[topic.address.group]) === null || _e === void 0 ? void 0 : _e[topic.address.node]) === null || _f === void 0 ? true : delete _f[topic.address.device];
                // Store the default values in InfluxDB
                this.writeMetrics(payload, topic);
                break;
            case "DEATH":
                logger.info(`💀 Received death certificate for ${topic.address.group}/${topic.address.node}/${topic.address.device}. Removing from known devices.`);
                (_h = (_g = this.birthDebounce) === null || _g === void 0 ? void 0 : _g[topic.address.group]) === null || _h === void 0 ? true : delete _h[topic.address.node];
                (_k = (_j = this.aliasResolver) === null || _j === void 0 ? void 0 : _j[topic.address.group]) === null || _k === void 0 ? true : delete _k[topic.address.node];
                break;
            case "DATA":
                // Don't handle Node data
                if (!topic.address.device)
                    return;
                // Check if we have a birth certificate for the device
                if ((_o = (_m = (_l = this.aliasResolver) === null || _l === void 0 ? void 0 : _l[topic.address.group]) === null || _m === void 0 ? void 0 : _m[topic.address.node]) === null || _o === void 0 ? void 0 : _o[topic.address.device]) {
                    // Device is known, resolve aliases and write to InfluxDB
                    this.writeMetrics(payload, topic);
                }
                else {
                    // Check that we don't already have an active debounce for this device
                    if ((_r = (_q = (_p = this.birthDebounce) === null || _p === void 0 ? void 0 : _p[topic.address.group]) === null || _q === void 0 ? void 0 : _q[topic.address.node]) === null || _r === void 0 ? void 0 : _r[topic.address.device]) {
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
                    });
                    logger.info('📣 Birth certificate request sent for %s. Status: %s', topic.address, response.status);
                    // Create debounce timout for this device
                    this.setNestedValue(this.birthDebounce, [topic.address.group, topic.address.node, topic.address.device], true);
                    setTimeout(() => {
                        var _a, _b, _c;
                        (_c = (_b = (_a = this.birthDebounce) === null || _a === void 0 ? void 0 : _a[topic.address.group]) === null || _b === void 0 ? void 0 : _b[topic.address.node]) === null || _c === void 0 ? true : delete _c[topic.address.device];
                    }, Math.floor(Math.random() * (10000 - 5000 + 1) + 5000));
                }
                break;
        }
    }
    writeMetrics(payload, topic) {
        payload.metrics.forEach((metric) => {
            var _a, _b, _c, _d;
            let birth = (_d = (_c = (_b = (_a = this.aliasResolver) === null || _a === void 0 ? void 0 : _a[topic.address.group]) === null || _b === void 0 ? void 0 : _b[topic.address.node]) === null || _c === void 0 ? void 0 : _c[topic.address.device]) === null || _d === void 0 ? void 0 : _d[metric.alias];
            if (!birth) {
                logger.error(`Metric ${metric.alias} is unknown for ${topic.address.group}/${topic.address.node}/${topic.address.device}`);
            }
            // Send each metric to InfluxDB
            this.writeToInfluxDB(birth, topic, metric.value);
        });
    }
    writeToInfluxDB(birth, topic, value) {
        const writeApi = influxDB.getWriteApi(influxOrganisation, 'default');
        writeApi.useDefaultTags({
            instance: birth.instance,
            schema: birth.schema,
            group: topic.address.group,
            node: topic.address.node,
            device: topic.address.device
        });
        let fullName = `${topic.address.group}/${topic.address.node}/${topic.address.device}/${birth.name}`;
        switch (birth.type) {
            case "Int8":
            case "Int16":
            case "Int32":
            case "Int64":
                writeApi.writePoint(new Point(fullName).intField(fullName, value));
                break;
            case "UInt8":
            case "UInt16":
            case "UInt32":
            case "UInt64":
                writeApi.writePoint(new Point(fullName).uintField(fullName, value));
                break;
            case "Float":
            case "Double":
                writeApi.writePoint(new Point(fullName).floatField(fullName, value));
                break;
            case "Boolean":
                writeApi.writePoint(new Point(fullName).booleanField(fullName, value));
                break;
            default:
                writeApi.writePoint(new Point(fullName).stringField(fullName, value));
                break;
        }
        writeApi.close().then(() => {
            logger.info(`Written to InfluxDB: [${birth.type}] ${fullName} = ${value}`);
        });
    }
    setNestedValue(obj, path, value) {
        for (var i = 0; i < path.length - 1; i++) {
            obj = obj[path[i]] = obj[path[i]] || {};
        }
        obj[path[path.length - 1]] = value;
        return obj;
    }
}
//# sourceMappingURL=mqttclient.js.map
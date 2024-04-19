/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import { EventEmitter } from "events";
import * as MQTT from "mqtt";
import { v5 as uuidv5 } from "uuid";

import {
    Address, 
    ServiceClient, 
} from "@amrc-factoryplus/utilities";

import { log } from "./helpers/log.js";
import {
    metricIndex,
    Metrics,
    sparkplugConfig,
    sparkplugDataType,
    sparkplugMetric,
    sparkplugPayload,
} from "./helpers/typeHandler.js";
import * as UUIDs from "./uuids.js";

class InstanceBuilder {
    #uuid: string

    constructor (uuid: string) {
        this.#uuid = uuid;
    }

    fp_v5_uuid (...args: string[]) {
        return uuidv5(args.join(":"), UUIDs.Special.FactoryPlus);
    }

    mk_instance (schema: string, prefix: string) {
        const instance = this.fp_v5_uuid(UUIDs.Special.V5Metric, 
            this.#uuid, prefix);
        return [
            { 
                name: `${prefix}/Schema_UUID`,
                type: sparkplugDataType.uuid,
                value: schema,
            },
            {   
                name: `${prefix}/Instance_UUID`,
                type: sparkplugDataType.uuid,
                value: instance,
            },
        ];
    }

    build_alert (typ: string, name: string, value: boolean) {
        const prefix = `Alerts/${name}`;
        
        return [
            ...this.mk_instance(UUIDs.Schema.Alert, prefix),
            {
                name: `${prefix}/Type`,
                type: sparkplugDataType.uuid,
                value: typ,
            },
            {
                name: `${prefix}/Active`,
                type: sparkplugDataType.boolean,
                value: value,
            },
        ];
    }
}

export class SparkplugNode extends (
    EventEmitter
) {
    #fplus: ServiceClient
    #conf: sparkplugConfig
    #client: any
    #metrics: Metrics
    isOnline: boolean
    #metricBuffer: { [index: string]: sparkplugMetric[] }
    #pubIntHandle: ReturnType<typeof setInterval>
    #aliasCounter: number
    #metricNameIndex: metricIndex

    constructor(fplus: ServiceClient, conf: sparkplugConfig) {
        super();
        this.#fplus = fplus;
        this.#conf = conf;

        this.isOnline = false; // Whether client is online or not
    }

    async init () {
         // Generate randomized client ID
        const address = conf.address;
        const clientId = address.group + '-' + address.node + '-' 
            + (Math.random() * 1e17).toString(36);

        // conf.keepalive = 10;
        this.#client = await this.#fplus.MQTT.basic_sparkplug_node({
            address,
            clientId,
            publishDeath:   true,
        });
        this.#client.connect();

        // What to do when the client connects
        this.#client.on("connect", () => this.onConnect());
        // What to do once the client has connected and should publish an NBIRTH certificate
        this.#client.on("birth", () => this.#publishNBirth());


        // What to do when a DCMD message is received
        this.#client.on("dcmd", (deviceId: string, payload: sparkplugPayload) =>
            this.emit("dcmd", deviceId, payload)
        );
        // What to do when an NCMD message is received
        this.#client.on("ncmd", (payload: sparkplugPayload) => {
            this.#handleNCmd(payload);
        });
        // What to do when the client is trying to reconnect
        this.#client.on("reconnect", () => this.onReconnect());
        // What to do when the client goes offline
        this.#client.on("offline", () => this.onOffline());
        // What to do when the client receives an error
        this.#client.on("error", (err: Error) => this.onError(err));
        // What to do when the client connection is closed
        this.#client.on("close", () => this.onClose());
        this.#metricNameIndex = {};
        // Default Edge Node metrics
        const builder = new InstanceBuilder(this.#conf.uuid);
        this.#metrics = new Metrics([
            {
                name: "Schema_UUID",
                type: sparkplugDataType.uuid,
                value: UUIDs.Schema.EdgeAgent,
            },
            {
                name: "Instance_UUID",
                type: sparkplugDataType.uuid,
                value: this.#conf.uuid,
            },
            {
                name: "Config_Revision",
                type: sparkplugDataType.uuid,
                value: this.#conf.configRevision ?? UUIDs.Special.Null,
            },
            {
                name: "Node Properties/Type",
                type: sparkplugDataType.string,
                value: "ACS Edge Agent"
            },
            {
                name: "Node Control/Rebirth", // Rebirth command
                type: sparkplugDataType.boolean,
                value: false,
            },
            {
                // Whether metrics changes should be pushed immediately or buffered and published periodically
                name: "Node Control/Async Publish Mode",
                type: sparkplugDataType.boolean,
                value: this.#conf.nodeControl?.asyncPubMode ?? false,
            },
            {
                // Command to reload the node configuration from the Management App
                name: "Node Control/Reload Edge Agent Config",
                type: sparkplugDataType.boolean,
                value: false
            },
            {
                // If client is to publish periodically then define how often should this be done
                name: "Node Control/Publish Interval",
                type: sparkplugDataType.uInt16,
                value: this.#conf.nodeControl?.pubInterval ?? 0,
            },
            {
                // Whether payload should be compressed or not
                name: "Node Control/Payload Compression",
                type: sparkplugDataType.boolean,
                value: this.#conf.nodeControl?.compressPayload ?? false,
            },
            ...builder.build_alert(
                UUIDs.Alert.ConfigFetchFailed, "Config_Unavailable",
                this.#conf.alerts?.configFetchFailed ?? false),
            ...builder.build_alert(
                UUIDs.Alert.ConfigInvalid, "Config_Invalid",
                this.#conf.alerts?.configInvalid ?? false),
        ]);
        this.#metricBuffer = {}; // Buffer to hold metrics when periodic publishing enabled
        this.#pubIntHandle = setTimeout(() => {
        }, 1); // Handle for publish interval
        this.#aliasCounter = 0; // Counter to keep track of metrics aliases for this Edge Node

        return this;
    }

    /**
     * Rehash metric to be in Sparkplug format. Metric is prepared without name or
     * properties for NDATA/DDATA to save space
     * @param {sparkplugMetric[]} metrics Array of metrics to be published
     * @param {boolean} birth Whether we are preparing a birth certificate or data
     */
    async #preparePayload(metrics: sparkplugMetric[], birth: boolean = false): Promise<sparkplugPayload> {
        const newMetrics: sparkplugMetric[] = [];
        await Promise.all(
            metrics.map((metric) => {
                // Remove any special characters from metric name
                // See https://docs.inductiveautomation.com/display/DOC80/Understanding+Metrics#
                if (typeof metric.name !== "undefined") {
                    metric.name = metric.name.replace(/[^\w_\s\'\-\:\(\)\/]+/g, "");

                    if (metric.type === sparkplugDataType.string) {
                        metric.value = metric.value?.toString() ?? "";
                    }

                    if (metric.value === "") {
                        metric.value = null;
                        metric.isNull = true;
                    }

                    if (metric.timestamp === undefined) metric.timestamp = Date.now();

                    // Create basic metric object
                    const newMetric: sparkplugMetric = {
                        timestamp: metric.timestamp,
                        value: metric.value,
                        alias: metric.alias,
                        type: metric.type,
                        isTransient: metric.isTransient ?? false,
                    };
                    // If this is a birth certificate, we need to define the name, properties and alias
                    // If a data payload, only alias is used to save space.
                    if (birth) {
                        newMetric.name = metric.name;
                        newMetric.properties = metric.properties;
                        // Assign unique alias for this metric if not already defined
                        if (metric.alias === undefined) {
                            metric.alias = this.requestAlias();
                        }
                        newMetric.alias = metric.alias;
                    }
                    newMetrics.push(newMetric);
                }
            })
        );
        const payload: sparkplugPayload = {
            timestamp: Date.now(),
            metrics: newMetrics,
        };
        if (birth) payload.uuid = UUIDs.Special.FactoryPlus;
        return payload;
    }

    requestAlias() {
        return this.#aliasCounter++;
    }

    /**
     * Publish NBIRTH Certificate
     */
    async #publishNBirth() {
        // Publish NBIRTH using this edge node's metrics
        this.#aliasCounter = 0;
        let payload = await this.#preparePayload(this.#metrics.array, true);
        payload.metrics.forEach((metric, index) => {
            this.#metrics.setAlias(index, metric.alias as number);
        });
        this.#client.publishNodeBirth(payload);
        this.emit('dbirth-all');
        log(`✨ NBIRTH published for ${this.#conf.address}`);
    }

    /**
     * Publish a DBIRTH certificate on behalf of a device
     * @param {string} deviceId The ID of the device we are sending this DBIRTH on behalf of.
     * @param {sparkplugMetric[]} metrics Array of metric objects to be included in the DBIRTH certificate
     */
    async publishDBirth(deviceId: string, metrics: sparkplugMetric[]) {
        // If we're offline, discard any DBirths
        if (this.isOnline) {
            // Prepare metrics for payload and Publish DBIRTH certificate, enabling compression if required.
            const payload = await this.#preparePayload(metrics, true);
            try {
                this.#client.publishDeviceBirth(deviceId, payload, {
                    compress: this.#metrics.getByName("Node Control/Payload Compression").value,
                });
                log(`👶 DBIRTH published for ${deviceId}.`);
            } catch (err) {
                console.log(err);
            }
            // If polled publishing is enabled, start the loop...
            if (!this.#metrics.getByName("Node Control/Async Publish Mode").value) {
                this.#startPublishInterval();
            }
        } else {
            log(`Skipping DBIRTH for ${deviceId} until we're connected to the Factory+ UNS.`);
        }
    }

    /**
     * Start periodic publishing
     */
    async #startPublishInterval() {
        // Get required publishing interval
        const pubInt = this.#metrics.getByName("Node Control/Publish Interval").value as number;
        // Start periodic publishing of metrics from buffer
        this.#pubIntHandle = setInterval(() => {
            this.#publishMetricBuffer();
        }, pubInt);
        log(`Started publishing metrics every ${pubInt} ms`);
    }

    /**
     * Stop periodic publishing of metrics from buffer
     */
    async #stopPublishInterval() {
        clearInterval(this.#pubIntHandle);
        this.#publishMetricBuffer(); // Flush any remaining messages
    }

    /**
     * If periodic publishing is enabled, publish any queue metrics from the message buffer
     */
    async #publishMetricBuffer() {
        // For all devices we are publsing on behalf of...
        await Promise.all(
            Object.keys(this.#metricBuffer).map(async (deviceId) => {
                const metricsToPublish = this.#metricBuffer[deviceId].length;
                // If there are metrics waiting to be published and we're online
                if (metricsToPublish && this.isOnline) {
                    // Prepare payload and publish metrics
                    let payload = await this.#preparePayload(
                        this.#metricBuffer[deviceId].splice(0, metricsToPublish)
                    );
                    await this.#client.publishDeviceData(deviceId, payload, {
                        compress: this.#metrics.getByName("Node Control/Payload Compression").value,
                    });
                    log(
                        `${metricsToPublish} metrics published from buffer for device ${deviceId}.`
                    );
                }
            })
        );
    }

    /**
     * Publish DDATA on behalf of connected device
     * @param {string} deviceId The name of the device we are publishing on behalf of
     * @param {sparkplugMetric[]} metrics Array of metric objects to be published
     */
    async publishDData(deviceId: string, metrics: sparkplugMetric[]) {

        // If metrics are to be published immediately...
        if (this.#metrics.getByName("Node Control/Async Publish Mode").value) {
            // Prepare payload and publish metrics now!
            let payload = await this.#preparePayload(metrics);
            try {
                this.#client.publishDeviceData(deviceId, payload, {
                    compress: this.#metrics.getByName("Node Control/Payload Compression").value,
                });
                // console.dir(payload, {depth: null});
                // console.log(Date.now() - (metrics[2].value as number));
                log(`Async DDATA published for ${deviceId}.`);
            } catch (err) {
                console.log(err);
            }
        } else {
            // Otherwise if metrics are being buffered before publishing
            // If this device doesn't have an entry in the metric buffer, add one
            if (!this.#metricBuffer[deviceId]) {
                this.#metricBuffer[deviceId] = [];
            }
            // Then add these metrics to the publish buffer to be published later
            this.#metricBuffer[deviceId] = this.#metricBuffer[deviceId].concat(metrics);
        }
    }

    /**
     * Notify Sparkplug that device has died
     * @param {string} deviceId The name of the device we are publishing on behalf of
     */
    async publishDDeath(deviceId: string) {
        this.#client.publishDeviceDeath(deviceId, {timestamp: Date.now()});
        log(`💀 DDEATH published for ${deviceId}`);
    }

    /**
     * Publish metric as NDATA for this node
     * @param metrics
     */
    async #publishNData(metrics: sparkplugMetric | sparkplugMetric[]) {
        // Create payload
        let payload = {
            timestamp: Date.now(),
            metrics: (Array.isArray(metrics) ? metrics : [metrics])
        };
        // Publish NDATA
        this.#client.publishNodeData(payload);
    }

    /**
     * Respond to a command to this Edge Node
     * @param {sparkplugPayload} payload Sparkplug payload object
     */
    async #handleNCmd(payload: sparkplugPayload) {
        // For each metric in payload
        log('Handling NCMD');
        console.log(payload);
        await Promise.all(
            payload.metrics.map(async (metric: sparkplugMetric) => {
                // If metric only has an alias, find it's name
                if (!metric.name) {
                    metric.alias = (metric.alias as Long).toNumber();
                    metric.name = this.#metrics.getByAlias(metric.alias).name;
                }
                log(`NCMD: ${metric.name} = ${metric.value}`);
                switch (metric.name) {
                    case "Node Control/Rebirth": // New Birth certificate requested
                        await this.#publishNBirth();
                        break;
                    case "Node Control/Reload Edge Agent Config": // Reload configuration by stopping the node
                        log('Config reload requested. Stopping...');

                        this.emit('stop');
                        break;
                    case "Node Control/Reboot": // Reboot Edge Node
                        break;
                    default:
                        log(`Unhandled NCMD: ${metric.name}`);
                        break;
                }
            })
        );
    }

    /**
     * Stop the Sparkplug client
     */
    async stop() {
        this.#client.stop();
        this.isOnline = false;
    }

    /**
     * What to do when the client connects
     */
    onConnect() {
        log("Client connected.");
        // Update client online status
        this.isOnline = true;
    }

    /**
     * What to do when the client is trying to reconnect
     */
    onReconnect() {
        log("Client is trying to reconnect.");
    }

    /**
     * What to do when the client has gone offline
     */
    onOffline() {
        log("Client lost connection.");
        // Update client online status
        this.isOnline = false;
    }

    /**
     * What to do when the client receives an error
     * @param {Error} error Error
     */
    onError(error: Error) {
        log(`Client received error: ${error}`);
    }

    /**
     * What to do when the client has been asked to close
     */
    onClose() {
        log("Client connection closed.");
        // Update client online status
        this.isOnline = false;
    }
}

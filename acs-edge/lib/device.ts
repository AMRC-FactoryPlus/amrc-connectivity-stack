/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { log } from "./helpers/log.js";
import { SparkplugNode } from "./sparkplugNode.js";
import {
    Metrics,
    parseTimeStampFromPayload,
    parseValueFromPayload,
    processJSONBatchedPayload,
    serialisationType,
    sparkplugDataType,
    sparkplugMetric,
    sparkplugPayload,
    sparkplugTemplate
} from "./helpers/typeHandler.js";
import { EventEmitter } from "events";
import Long from "long";
import { ScoutDriverDetails } from "./scout.js";
// import { ScoutDetails } from "./scout.js";
// import { UniqueDictionary } from "./helpers/uniquedictionary.js";

/**
 * Define structure of device options object which is passed to the Device class constructor
 */
export interface deviceOptions {
    deviceId: string,                 // The name/ID of the device
    pollInt: number                   // The polling interval for polled devices, in ms
    pubInterval: number               // Batch publish interval
    templates: sparkplugMetric[],     // An array of Sparkplug templates to be used by this device
    metrics: sparkplugMetric[],       // An array of metrics to be used by this device
    payloadFormat: serialisationType, // The format of the payloads produced by this device. Must be one of
    // serialisationType
    delimiter?: string                // An optional delimiter character if the payload is a delimited string type
}

type Timer = ReturnType<typeof setTimeout> | null | undefined;

/**
 * DeviceConnection is a superclass which is to be extended to provide  metric access
 * to a specific type of device connection. All methods are empty templates and should be overloaded
 * by the child class.
 */
export abstract class DeviceConnection extends EventEmitter {
    _type: string

    #intHandles: {
        [index: string]: ReturnType<typeof setInterval>
    }
    #subHandles: Map<string, any>

    /**
     * Basic class constructor, doesn't do much. Must emit a 'ready' event when complete.
     * @param type The type of connection
     */
    constructor(type: string) {
        // Call constructor of parent class
        super();
        // Assign type to class attribute
        this._type = type;



        // Define object of polling interval handles for each device
        this.#intHandles = {};
        // Collection of subscription handles
        this.#subHandles = new Map();
        // Emit ready event
        /* XXX this has no listeners */
        this.emit('ready');
    }

    /**
     * Open the device connection. Must emit an 'open' event when finished.
     */
    open() {
        this.emit("open");
    }

    /**
     *
     * @param metrics Metrics object
     * @param payloadFormat Optional string denoting the payload format, must be one of serialisationType
     * @param delimiter Optional string specifying the delimiter character if needed
     */
    readMetrics(metrics: Metrics, payloadFormat?: string, delimiter?: string) {
        // This function must emit a data event with an argument containing the changed metrics
        // The format of this object must be {address: value, ...}
    }

    /**
     *
     * @param metrics Metrics object
     * @param writeCallback Function to call when write attempt complete
     * @param payloadFormat Optional string denoting the payload format, must be one of serialisationType
     * @param delimiter Optional string specifying the delimiter character if needed
     */
    writeMetrics(metrics: Metrics, writeCallback: Function, payloadFormat: serialisationType, delimiter?: string) {
        let err = null;
        // Do whatever connection specific stuff you need to in order to write to the device

        // Call the writeCallback when complete, setting the error if necessary
        writeCallback(err);
    }


    /**
     * Request devices to return a list of available addresses (tags, topics, etc.)
     */
    public async scoutAddresses(driverDetails: ScoutDriverDetails): Promise<object> {

        // should be implmented by subclasses for each type of connection depending on the specific protocol (OPC UA, MQTT, etc.)
        throw new Error('Scouting not supported for this device connection type.');
    }

    /**
     * Perform any setup needed to read from certain addresses, e.g. set
     * up MQTT subscriptions. This does not attempt to detect duplicate
     * requests.
     * @param addresses Addresses to start watching
     */
    async subscribe(addresses: string[]): Promise<any> {
        return null;
    }

    /**
     * Undo any setup performed by `subscribe`.
     * @param addresses Addresses to stop watching
     */
    async unsubscribe(handle: any): Promise<void> {
        return;
    }

    /**
     *
     * @param metrics Metrics object to watch
     * @param payloadFormat String denoting the format of the payload
     * @param delimiter String specifying the delimiter character if needed
     * @param interval Time interval between metric reads, in ms
     * @param deviceId The device ID whose metrics are to be watched
     * @param subscriptionStartCallback A function to call once the subscription has been setup
     */
    async startSubscription(metrics: Metrics, payloadFormat: serialisationType, delimiter: string, interval: number, deviceId: string, subscriptionStartCallback: Function) {
        this.#subHandles.set(deviceId,
            await this.subscribe(metrics.addresses));
        this.#intHandles[deviceId] = setInterval(() => {
            this.readMetrics(metrics, payloadFormat, delimiter);

        }, interval);
        subscriptionStartCallback();
    }

    /**
     * Stop a previously registered subscription for  metric changes.
     * @param deviceId The device ID we are cancelling the subscription for
     * @param stopSubCallback A function to call once the subscription has been cancelled
     */
    async stopSubscription(deviceId: string, stopSubCallback: Function) {
        clearInterval(this.#intHandles[deviceId]);
        delete this.#intHandles[deviceId];
        await this.unsubscribe(this.#subHandles.get(deviceId));
        this.#subHandles.delete(deviceId);
        stopSubCallback();
    }


    /**
     * Close the device connection. Must emit a 'close' event.
     */
    close() {
        // ...
        this.emit("close");
    }
}


/**
 * Device class represents both the proprietary connection and Sparkplug connections for a device
 */
export class Device {

    #spClient: SparkplugNode                        // The sparkplug client
    #devConn: DeviceConnection                      // The associated device connection to this device
    _name: string                                   // The name of this device
    _metrics: Metrics                               // The metrics of this device
    _defaultMetrics: sparkplugMetric[]              // The default metrics common to all devices
    #isAlive: boolean                               // Whether this device is alive or not
    _isConnected: boolean                               // Whether this device is ready to publish or not
    #pollInterval: number                           // Poll interval
    #pubInterval: number                            // Batch interval for DATA packets
    #pubTimer: Timer                                // Batch timer
    #pubBuffer: sparkplugMetric[]                   // Batch buffer
    //#deathTimer: ReturnType<typeof setTimeout>      // A "dead mans handle" or "watchdog" timer which triggers a DDEATH
    // if allowed to time out
    _payloadFormat: serialisationType               // The format of the payloads produced by this device
    _delimiter: string                              // String specifying the delimiter character if needed

    constructor(spClient: SparkplugNode, devConn: DeviceConnection, options: deviceOptions) {
        // Get sparkplug and device connections
        this.#spClient = spClient;
        this.#devConn = devConn;
        this._payloadFormat = options.payloadFormat;
        this._delimiter = "delimiter" in options ? options.delimiter || "" : "";
        // Set device name
        this._name = options.deviceId;
        this.#pollInterval = options.pollInt;
        this.#pubInterval = options.pubInterval;
        this.#pubBuffer = [];
        // Define default properties of device
        this._defaultMetrics = [
            {
                name: "Device Control/Polling Interval",
                value: options.pollInt,
                type: sparkplugDataType.uInt16,
                timestamp: Date.now(),
                isTransient: true,
                properties: {
                    method: {
                        value: "", type: sparkplugDataType.string,
                    }, address: {
                        value: "", type: sparkplugDataType.string,
                    }, path: {
                        value: "", type: sparkplugDataType.string,
                    }, friendlyName: {
                        value: "Device Polling Interval", type: sparkplugDataType.string,
                    }, engUnit: {
                        value: "ms", type: sparkplugDataType.string,
                    }, engLow: {
                        value: 0, type: sparkplugDataType.float,
                    }, engHigh: {
                        value: 1, type: sparkplugDataType.float,
                    }, tooltip: {
                        value: "Polling interval for device metrics in ms.", type: sparkplugDataType.string,
                    },
                },
            }, {
                name: "Device Control/Publish Interval",
                value: options.pubInterval,
                type: sparkplugDataType.uInt16,
                timestamp: Date.now(),
                isTransient: true,
                properties: {
                    method: {
                        value: "", type: sparkplugDataType.string,
                    }, address: {
                        value: "", type: sparkplugDataType.string,
                    }, path: {
                        value: "", type: sparkplugDataType.string,
                    }, friendlyName: {
                        value: "Device Publish Interval", type: sparkplugDataType.string,
                    }, engUnit: {
                        value: "ms", type: sparkplugDataType.string,
                    }, engLow: {
                        value: 0, type: sparkplugDataType.float,
                    }, engHigh: {
                        value: 1, type: sparkplugDataType.float,
                    }, tooltip: {
                        value: "Publish interval for device metrics in ms.", type: sparkplugDataType.string,
                    },
                },
            }, {
                name: "Device Control/Reboot",
                value: false,
                type: sparkplugDataType.boolean,
                timestamp: Date.now(),
                isTransient: true,
                properties: {
                    method: {
                        value: "", type: sparkplugDataType.string,
                    }, address: {
                        value: "", type: sparkplugDataType.string,
                    }, path: {
                        value: "", type: sparkplugDataType.string,
                    }, friendlyName: {
                        value: "Reboot Device", type: sparkplugDataType.string,
                    }, tooltip: {
                        value: "Issue a reboot device command.", type: sparkplugDataType.string,
                    },
                },
            }, {
                name: "Device Control/Rebirth",
                value: false,
                type: sparkplugDataType.boolean,
                timestamp: Date.now(),
                isTransient: true,
                properties: {
                    method: {
                        value: "", type: sparkplugDataType.string,
                    }, address: {
                        value: "", type: sparkplugDataType.string,
                    }, path: {
                        value: "", type: sparkplugDataType.string,
                    }, friendlyName: {
                        value: "Rebirth Device", type: sparkplugDataType.string,
                    }, tooltip: {
                        value: "Request a new device birth certificate.", type: sparkplugDataType.string,
                    },
                },
            },
        ];
        // Populate any template definitions in default Metric list
        if (options.templates && options.templates.length) {
            this.#populateTemplates(options.templates);
        }
        // Add default metrics to the device metrics object
        this._metrics = new Metrics(this._defaultMetrics);
        this._metrics.add(options.metrics);
        // Flag to keep track of device online status
        this.#isAlive = false;

        // Flag for device to indicate when it is ready to publish DBIRTH and start DDATA publishing
        this._isConnected = false;

        // Create watchdog timer which, if allowed to elapse, will set the device as offline
        // This watchdog is kicked by several read/write functions below
        //this.#deathTimer = setTimeout(() => {
        //    this.#publishDDeath();
        //}, 10000);

        //What to do when the device is ready
        //We Just need to sub to metric changes
        let readyInterval = setInterval(() => {
            // Keep checking if the device is ready
            // If so...
            if (this._isConnected) {

                this.#subscribeToMetricChanges();
                // Stop checking if device is ready
                clearInterval(readyInterval);
            }
        }, 100);

    }

    _handleData(obj: { [p: string]: any }, parseVals: boolean) {
        // Array to keep track of values that changed
        let changedMetrics: sparkplugMetric[] = [];
        // Iterate through each key in obj
        for (let addr in obj) {
            // Get all payload paths registered for this address
            const paths = this._metrics.getPathsForAddr(addr);
            // Iterate through each path
            paths.forEach((path) => {
                // Get the complete metric according to its address and path
                const metric = this._metrics.getByAddrPath(addr, path);
                // If the metric can be read i.e. GET method
                if (typeof metric.properties !== "undefined" && (metric.properties.method.value as string).search(
                    /^GET/g) > -1) {
                    // If the value is not to be parsed, or if so a path to the value is provided or there is only one
                    // value
                    if (!parseVals || (parseVals && ((typeof metric.properties.path !== "undefined" && metric.properties.path.value) || Object.keys(
                        obj).length == 1))) {
                        // Handle JSON (Batched) format explicitly
                        if (parseVals && this._payloadFormat === serialisationType.JSONBatched) {
                            // Parse the payload as JSON
                            let payload: any;
                            try {
                                if (typeof obj[addr] === "string") {
                                    payload = JSON.parse(obj[addr]);
                                } else if (Buffer.isBuffer(obj[addr])) {
                                    payload = JSON.parse(obj[addr].toString());
                                } else {
                                    payload = obj[addr];
                                }
                            } catch (e) {
                                log(`Failed to parse JSON (Batched) payload: ${e}`);
                                return;
                            }

                            // Process the batched payload
                            const batchResults = processJSONBatchedPayload(payload, metric);

                            // Create a metric for each item in the batch
                            batchResults.forEach(result => {
                                const { value, timestamp } = result;

                                // Test if the value is a bigint and convert it to a Long
                                let processedValue = value;
                                if (typeof processedValue === "bigint") {
                                    processedValue = Long.fromString(processedValue.toString());
                                }

                                // If it has a sensible value and is different from the current value
                                if ((processedValue || processedValue === 0) && (metric.value !== processedValue)) {
                                    // Create a copy of the metric with the new value and timestamp
                                    const updatedMetric = {
                                        ...this._metrics.setValueByAddrPath(addr, path, processedValue, timestamp || Date.now())
                                    };

                                    // Add to the list of changed metrics
                                    changedMetrics.push(updatedMetric);
                                }
                            });
                        } else {
                            // Standard processing for all other payload formats
                            let newVal = parseVals ? parseValueFromPayload(obj[addr],
                                metric,
                                this._payloadFormat,
                                this._delimiter
                            ) : obj[addr];

                            // Test if the value is a bigint and convert it to a Long. This is a hack to ensure that the
                            // Tahu library works - it only accepts Longs, not bigints.
                            if (typeof newVal === "bigint") {
                                newVal = Long.fromString(newVal.toString());
                            }

                            // If it has a sensible value...
                            // + Use the deadband here

                            if (
                                (newVal || newVal == 0)
                                && (metric.value !== newVal)
                            ) {
                                // If timestamp is provided in data package
                                const timestamp = parseTimeStampFromPayload(obj[addr],
                                    metric,
                                    this._payloadFormat,
                                    this._delimiter
                                );

                                // Update the metric value and push it to the array of changed metrics
                                changedMetrics.push({
                                    ...(this._metrics.setValueByAddrPath(addr,
                                        path,
                                        newVal,
                                        timestamp))
                                });
                            }
                        }
                    }
                }
            })
        }
        // If any metrics have changed
        if (changedMetrics.length) {
            // Publish the changes
            this.#bufferOrPublish(changedMetrics);
        }

        // Kick the watchdog timer to prevent the device dying
        this._refreshDeathTimer();
    }

    // Kick the watchdog timer to prevent the device dying
    _refreshDeathTimer() {
        // Reset timeout to it's initial value
        //this.#deathTimer.refresh();
    }

    /**
     * Adds a template definition to the list of default metrics for this device type
     * @param templates List of define templates which the device will utilise
     */
    #populateTemplates(templates: sparkplugMetric[]) {
        templates.forEach((template) => {
            let newTemplate: sparkplugMetric = {
                name: template.name, type: sparkplugDataType.template, value: {
                    isDefinition: true, metrics: []
                },
            };
            if ("properties" in template) {
                newTemplate.properties = template.properties;
            }
            (template.value as sparkplugTemplate).metrics.forEach((metric: sparkplugMetric) => {
                (newTemplate.value as sparkplugTemplate).metrics.push(metric);
            });
            this._defaultMetrics.push(newTemplate);
        });
    }


    /**
     * Defines what to do when the connection is lost to the device
     */
    _deviceDisconnected() {
        log(`❌ ${this._name} disconnected`);
        this.#publishDDeath();
        this._isConnected = false;
    }

    /**
     * Defines what to do when the connection is made to the device
     */
    _deviceConnected() {
        this._isConnected = true;
        log(`✅ ${this._name} connected`);
        this._publishDBirth();
    }

    /**
     *  Read metrics from device connection
     */
    #readMetricsOnce() {
        // Request tag read from device connection
        this.#devConn.readMetrics(this._metrics, this._payloadFormat, this._delimiter);
    }

    /**
     * Start Subscription for tag value changes
     */
    #subscribeToMetricChanges() {

        // Get the polling interval time from config
        /* XXX bmz: The Manager only configures a single polling
         * interval per connection, so we could run a single poll loop
         * over all devices. However instead each device runs its own
         * poll loop. */
        // Request subscription from device connection and save interval handle
        this.#devConn.startSubscription(this._metrics,
            this._payloadFormat,
            this._delimiter,
            this.#pollInterval,
            this._name,
            () => {
                log(`Started subscription to metrics changes for ${this._name} with ${this.#pollInterval} ms interval.`);
            }
        );
        if (this.#pubInterval) {
            this.#pubTimer = setInterval(
                () => this.#publishBuffer(),
                this.#pubInterval);
            log(`Started buffered publish for ${this._name} with ${this.#pubInterval} ms interval.`);
        }
    }

    /**
     * Stop subscription for tag value changes
     */
    _stopMetricSubscription() {
        // Stop subscription for this devices interval handle
        this.#devConn.stopSubscription(this._name, () => {
            log(`Stopped metric change subscription for ${this._name}`);
            if (this.#pubTimer) {
                clearInterval(this.#pubTimer);
                this.#pubTimer = null;
                this.#publishBuffer();
            }
        });
    }

    #bufferOrPublish(metrics: sparkplugMetric[]) {
        if (this.#pubTimer) {
            this.#pubBuffer.push(...metrics);
        }
        else {
            this._publishDData(metrics);
        }
    }

    #publishBuffer() {
        this._publishDData(this.#pubBuffer);
        this.#pubBuffer = [];
    }

    /**
     * Request tag values to be written to device using device connection
     * @param {sparkplugMetric[]} metrics Array of tag objects to write
     */
    #writeMetrics(metrics: Metrics) {
        // Write metrics to physical device
        this.#devConn.writeMetrics(metrics, (err: Error) => {
            if (!err) {
                metrics.array.forEach((metric, i) => {
                    if (typeof metric.name !== "undefined") {
                        // Update metric value
                        this._metrics.setValueByName(metric.name, metric.value);
                        metrics.array[i] = this._metrics.getByName(metric.name);
                    }
                })
                // Publish new metric value
                this._publishDData(metrics.array);
                log(`Metric values written to ${this._name}`);
                // Kick watchdog
                this._refreshDeathTimer();
            } else {
                console.log(err);
            }
        }, this._payloadFormat);

    }

    /**
     * Publish Sparkplug DBIRTH certificate
     */
    _publishDBirth(readRequired = false) {
        if (this._isConnected) {
            if (readRequired) {
                this.#readMetricsOnce();
            }

            this.#spClient.publishDBirth(this._name, this._metrics.array).then(() => {
                this.#isAlive = true;
            });

        } else {
            log('🕣 DBIRTH requested but device not connected');
        }
    }

    /**
     * Publish Sparkplug DDATA for metrics
     * @param {sparkplugMetric[]} metrics Array of tag objects to push
     */
    _publishDData(metrics: sparkplugMetric[]) {
        if (this.#isAlive) {
            // Publish DDATA
            this.#spClient.publishDData(this._name, metrics);

        } else {
            // If device is not alive, publish DBIRTH first
            this._publishDBirth();
        }
    }

    /**
     * Request device death certificate to be published by Sparkplug client
     */
    #publishDDeath() {
        if (this._isConnected) {
            this.#spClient.publishDDeath(this._name);
            this.#isAlive = false;
        }
    }

    /**
     * Stop device
     */
    stop() {

        this._stopMetricSubscription();

        // Stop the watchdog timer so that we can instantly stop
        //clearTimeout(this.#deathTimer);
    }


    /**
     * Reboot device
     */
    #reboot() {
        log("Reboot not yet implemented");
    }

    /**
     * Perform required actions from DCMD request from Sparkplug client
     * @param {sparkplugPayload} payload Incoming DCMD payload from Sparkplug client
     */
    _handleDCmd(payload: sparkplugPayload) {
        // Define list to hold metrics that need to be updated
        let metricsToWrite: sparkplugMetric[] = [];
        // await Promise.all(
        //   payload.metrics.map(async (metric) => {
        for (let i = 0; i < payload.metrics.length; i++) {
            let metric = payload.metrics[i];
            // For each metric in payload...
            // If metric only has alias, find it's name
            if (!metric.name) {
                metric.alias = (metric.alias as Long).toNumber();
                metric.name = this._metrics.getByAlias(metric.alias).name;
            }

            log(`DCMD: ${metric.name} = ${metric.value}`);
            switch (metric.name) {
                case "Device Control/Reboot": // Request to reboot device
                    if (metric.value) {
                        this.#reboot();
                    }
                    break;

                case "Device Control/Rebirth": // New DBIRTH certificate requested
                    if (metric.value) {
                        log(`${this._name} rebirth requested`)
                        this._publishDBirth();
                    }
                    break;

                case "Device Control/Polling Interval":
                case "Device Control/Publish Interval":
                    /* These metrics are now read-only. With central
                     * configs it isn't practical to persist the
                     * changes. */
                    log(`${this._name} Ignoring CMD to read-only metric`);
                    break;

                default:
                    if (typeof metric.name !== "undefined") {
                        // Requests to change tag values
                        let oldMetric = this._metrics.getByName(metric.name);

                        // If metric value arrives as long, turn it into a JS double
                        if (Long.isLong(metric.value)) {
                            metric.value = (metric.value as Long).toNumber();
                        }
                        // Create copy of tag with new value
                        // Don't directly copy the tag as the value is
                        // immediately applied and the RbE breaks!
                        const newMetric = {
                            ...oldMetric, value: metric.value
                        };

                        metricsToWrite.push(newMetric);
                    }
                    break;
            }
        }
        if (metricsToWrite.length) {
            this.#writeMetrics(new Metrics(metricsToWrite));
        }
    }
}

/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import {
    log
} from "./helpers/log.js";
import * as fs from "fs";
import {
    SparkplugNode
} from "./sparkplugNode.js";
import {
    sparkplugDataType,
    sparkplugMetric,
    Metrics,
    sparkplugPayload,
    sparkplugTemplate,
    sparkplugValue,
    parseValueFromPayload,
    serialisationType,
    parseTimeStampFromPayload
} from "./helpers/typeHandler.js";
import {
    EventEmitter
} from "events";
import * as util from "util";
import Long from "long";

/**
 * Define structure of device options object which is passed to the Device class constructor
 */
export interface deviceOptions {
    deviceId: string,                 // The name/ID of the device
    pollInt: number                   // The polling interval for polled devices, in ms
    templates: sparkplugMetric[],     // An array of Sparkplug templates to be used by this device
    metrics: sparkplugMetric[],       // An array of metrics to be used by this device
    payloadFormat: serialisationType, // The format of the payloads produced by this device. Must be one of
                                      // serialisationType
    delimiter?: string                // An optional delimiter character if the payload is a delimited string type
}


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
        // Emit ready event
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
     *
     * @param metrics Metrics object to watch
     * @param payloadFormat String denoting the format of the payload
     * @param delimiter String specifying the delimiter character if needed
     * @param interval Time interval between metric reads, in ms
     * @param deviceId The device ID whose metrics are to be watched
     * @param subscriptionStartCallback A function to call once the subscription has been setup
     */
    startSubscription(metrics: Metrics, payloadFormat: serialisationType, delimiter: string, interval: number, deviceId: string, subscriptionStartCallback: Function) {

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
    stopSubscription(deviceId: string, stopSubCallback: Function) {
        clearInterval(this.#intHandles[deviceId]);
        delete this.#intHandles[deviceId];
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
export abstract class Device {

    #spClient: SparkplugNode                        // The sparkplug client
    #devConn: DeviceConnection                      // The associated device connection to this device
    _name: string                                   // The name of this device
    _metrics: Metrics                               // The metrics of this device
    _defaultMetrics: sparkplugMetric[]              // The default metrics common to all devices
    #isAlive: boolean                               // Whether this device is alive or not
    _isConnected: boolean                               // Whether this device is ready to publish or not
    #deathTimer: ReturnType<typeof setTimeout>      // A "dead mans handle" or "watchdog" timer which triggers a DDEATH
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
        // Define default properties of device
        this._defaultMetrics = [
            {
                name: "Device Control/Polling Interval",
                value: options.pollInt,
                type: sparkplugDataType.uInt16,
                timestamp: Date.now(),
                isTransient: true,
                properties: {
                    recordToDB: {
                        type: sparkplugDataType.boolean, value: false
                    }, method: {
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
                name: "Device Control/Reboot",
                value: false,
                type: sparkplugDataType.boolean,
                timestamp: Date.now(),
                isTransient: true,
                properties: {
                    recordToDB: {
                        type: sparkplugDataType.boolean, value: false
                    }, method: {
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

                    recordToDB: {
                        type: sparkplugDataType.boolean, value: false
                    }, method: {
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
        // To be populated further by child class as custom manipulations need to take place
        this._metrics = new Metrics(this._defaultMetrics);
        // Flag to keep track of device online status
        this.#isAlive = false;

        // Flag for device to indicate when it is ready to publish DBIRTH and start DDATA publishing
        this._isConnected = false;

        // Create watchdog timer which, if allowed to elapse, will set the device as offline
        // This watchdog is kicked by several read/write functions below
        this.#deathTimer = setTimeout(() => {
            this.#publishDDeath();
        }, 10000);

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
                        // Get new value either directly or by parsing
                        const newVal = parseVals ? parseValueFromPayload(obj[addr],
                            metric,
                            this._payloadFormat,
                            this._delimiter
                        ) : obj[addr];
                        // If it has a sensible value...
                        // + Use the deadband here
                        if (
                            (newVal || newVal == 0)
                            && (((typeof metric.value !== "object")
                            && (metric.value !== newVal)
                            ) || !util.isDeepStrictEqual(metric.value, newVal))) {
                            // If timestamp is provided in data package
                            const timestamp = parseTimeStampFromPayload(obj[addr],
                                metric,
                                this._payloadFormat,
                                this._delimiter
                            );

                            // Update the metric value and push it to the array of changed metrics
                            changedMetrics.push(this._metrics.setValueByAddrPath(addr, path, newVal, timestamp));
                        }
                    }
                }
            })
        }
        // If any metrics have changed
        if (changedMetrics.length) {
            // Publish the changes
            this._publishDData(changedMetrics);
        }

        // Kick the watchdog timer to prevent the device dying
        this._refreshDeathTimer();
    }

    // Kick the watchdog timer to prevent the device dying
    _refreshDeathTimer() {
        // Reset timeout to it's initial value
        this.#deathTimer.refresh();
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
        const pollInterval = this._metrics.getByName("Device Control/Polling Interval").value as number;
        // Request subscription from device connection and save interval handle
        this.#devConn.startSubscription(this._metrics,
            this._payloadFormat,
            this._delimiter,
            pollInterval,
            this._name,
            () => {
                log(`Started subscription to metrics changes for ${this._name} with ${pollInterval} ms interval.`);
            }
        );
    }

    /**
     * Stop subscription for tag value changes
     */
    _stopMetricSubscription() {
        // Stop subscription for this devices interval handle
        this.#devConn.stopSubscription(this._name, () => {
            log(`Stopped metric change subscription for ${this._name}`);
        });
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
        clearTimeout(this.#deathTimer);
    }


    /**
     * Reboot device
     */
    #reboot() {
        log("Reboot not yet implemented");
    }

    /**
     * Update config file for this device
     * @param {string} key Key for config value to update
     * @param {sparkplugValue} value Value of config element to be updated
     */
    #updateConfig(key: string, value: sparkplugValue) {
        // Open config file
        fs.readFile("./config/conf.json", (err, data) => {
            if (err) {
                console.error(err);
            }

            // Parse config file to object
            let conf = JSON.parse(data.toString());
            // Find this device in the config file
            for (let i = 0; i < conf.deviceConnections.length; i++) {
                const devConn = conf.deviceConnections[i];
                // Check each connection
                for (let j = 0; j < devConn.devices.length; j++) {
                    const dev = devConn.devices[j];
                    // Check each device on connection
                    if (dev.deviceId == this._name) {
                        // If device found
                        dev[key] = value; // .. updated config value
                        break;
                    }
                }
            }
            // Write new config to file
            fs.writeFile("./config/conf.json", JSON.stringify(conf), (err) => {
                if (err) {
                    console.error(err);
                }
                log(`Updated config with ${key} = ${value}`);
            });
        });
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

                case "Device Control/Polling Interval": // Request to change polling interval
                    // Stop current subscription
                    this._stopMetricSubscription();
                    // Update interval value
                    this._metrics.setValueByName(metric.name, metric.value, metric.timestamp || Date.now());
                    // Report new value to Sparkplug
                    this._publishDData([metric]);
                    // Restart subscription using new interval
                    this.#subscribeToMetricChanges();
                    // Write new interval to config file in order to persist over reboot
                    this.#updateConfig("pollInt", metric.value);
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
                        if (typeof newMetric.properties !== "undefined" && newMetric.properties.method.value !== "GET") {
                            metricsToWrite.push(newMetric);
                        } else {
                            log(`${metric.name} is read only. Cannot write to it.`);
                        }
                    }
                    break;
            }
        }
        if (metricsToWrite.length) {
            this.#writeMetrics(new Metrics(metricsToWrite));
        }
    }
}

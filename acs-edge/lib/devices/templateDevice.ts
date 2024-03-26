/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import { Device, deviceOptions, DeviceConnection } from "../device.js";
import { log } from "../helpers/log.js";
import { SparkplugNode } from "../sparkplugNode.js";
import { Metrics, serialisationType} from "../helpers/typeHandler.js";

/**
 * Define structure of options for device connection
 */
export default interface myConnDetails {
    connDetailKey: string
}

/**
 * Define class for your device connection type
 */
export class MyConnection extends DeviceConnection {
    // Declare any class attributes and types here
    #myPrivateAttribute: string
    constructor(type: string, connDetails: myConnDetails) {
        super(type);
        // Example class attribute assignment
        this.#myPrivateAttribute = connDetails.connDetailKey;
    }

    /**
     * What to do when opening the connection.
     */
    open() {
        // Here you need to initiate the connection
        // and register any callbacks/handlers etc

        // When ready you MUST emit an "open" event
        log(`myConnection connected.`);
        this.emit("open");
    }

    /**
     * 
     * @param metrics Metrics object
     * @param writeCallback Function to call when write attempt complete
     * @param payloadFormat Optional string denoting the payload format, must be one of serialisationType
     * @param delimiter Optional string specifying the delimiter character if needed
     */
    writeMetrics(metrics: Metrics, writeCallback: Function, payloadFormat?: serialisationType, delimiter?: string) {
        let err = null;
        // Do whatever connection specific stuff you need to in order to write to the device

        // Call the writeCallback when complete, setting the error if necessary
        writeCallback(err);
    }

    /**
     * 
     * @param metrics Metrics object
     * @param payloadFormat Optional string denoting the payload format, must be one of serialisationType
     * @param delimiter Optional string specifying the delimiter character if needed
     */
    readMetrics(metrics: Metrics, payloadFormat?: string, delimiter?: string) {
        let obj = {};
        // This function must emit a data event with an argument containing the changed metrics
        // The format of this object must be {address: value, ...}
        this.emit('data', obj);
    }

    /**
     * Close connection and tidy up
     */
    async close() {
        // Do whatever cleanup code you need to here
    }
};


/**
 * Define device for your device type
 */
export class MyDevice extends Device {
    // Declare any class attributes and types here
    #devConn: MyConnection
    constructor(spClient: SparkplugNode, devConn: MyConnection, options: deviceOptions) {
        super(spClient, devConn, options);
        // Assign device connection to class attribute
        this.#devConn = devConn;

        // Add metrics from options argument
        // NOTE: You may need to do some preprocessing here
        this._metrics.add(options.metrics);

        // When ready, you must set this._isConnected to true to indicate to the parent class
        this._isConnected = true;
        log(`${this._name} ready`);
    }
};

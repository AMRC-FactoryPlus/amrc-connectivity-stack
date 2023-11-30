/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import { Device, deviceOptions, DeviceConnection } from "../device.js";
import { log } from "../helpers/log.js";
import { SparkplugNode } from "../sparkplugNode.js";
import { S7Endpoint, S7ItemGroup } from '@st-one-io/nodes7';
import { Metrics, sparkplugMetric } from '../helpers/typeHandler.js';

interface s7ConnDetails {
    hostname: string,
    port: number,
    rack: number,
    slot: number,
    timeout: number
}

interface s7Vars {
    [key: string]: any
}

export class S7Connection extends DeviceConnection {
    #s7Conn: typeof S7Endpoint
    #itemGroup: typeof S7ItemGroup
    #vars: s7Vars
    constructor(type: string, connDetails: s7ConnDetails) {
        super(type);

        // Instantiate S7 endpoint
        this.#s7Conn = new S7Endpoint({
            host: connDetails.hostname,
            port: connDetails.port,
            rack: connDetails.rack,
            slot: connDetails.slot,
            autoReconnect: connDetails.timeout
        });

        // Prepare variables to hold optimized metric list
        this.#itemGroup = null;
        this.#vars = {};

        // Pass on disconnect event to parent
        this.#s7Conn.on('disconnect', () => {
            this.emit('close');
            log(`☠️ Southbound S7 disconnected from ${this.#s7Conn._connOptsTcp.host}:${this.#s7Conn._connOptsTcp.port}`);
        });

        // Notify when connection is ready
        this.#s7Conn.on('connect', () => {
            log(`🔌 Southbound S7 connected to ${this.#s7Conn._connOptsTcp.host}:${this.#s7Conn._connOptsTcp.port}`)
            this.emit("open");
        });

        // Pass on errors to parent
        this.#s7Conn.on('error', (e: Error) => {
            log(`⚠️ Southbound S7 Error for ${this.#s7Conn._connOptsTcp.host}:${this.#s7Conn._connOptsTcp.port}: ` + e);
        })
    }

    /**
     * Builds the S7 item group from the defined metric list
     * @param {object} vars object containing metric names and PLC addresses
     */
    addToItemGroup(vars: s7Vars) {
        // If item group doesn't exist, create a fresh setup
        if (!this.#itemGroup) {
            this.#itemGroup = new S7ItemGroup(this.#s7Conn);
            this.#vars = {}
            this.#itemGroup.setTranslationCB((metric: string) => this.#vars[metric]); //translates a metric name to its address
        }
        // Merge existing vars with new ones
        this.#vars = {...this.#vars, ...vars}
        // Add metrics to read for this connection
        this.#itemGroup.addItems(Object.keys(this.#vars));
    }

    /**
     * Open the connection to the PLC
     */
    async open() {
    }

    /**
     * Read metrics from PLC
     * @param {array} metrics Array of metric objects to read to
     * @returns {array} Old metric values (for RbE checking)
     */
    async readMetrics(metrics: Metrics, payloadFormat?: string,) {
        const changedMetrics: sparkplugMetric[] = [];
        // Tell S7 to update metric values

        try {
            let newVals = await this.#itemGroup.readAllItems();  // name: value
            log("S7 Read: " + JSON.stringify(newVals));
            this.emit('data', newVals, false);
        } catch (error) {
            // When a read fails, the connection is closed and the error is emitted
            // This is a workaround so that the app does not crash
            log(`⚠️ Southbound S7 read error for ${this.#s7Conn._connOptsTcp.host}:${this.#s7Conn._connOptsTcp.port}: ` + error);
        }
    }

    /**
     * Writes metric values to the PLC
     * @param {array} metrics Array of metric objects to write to the PLC
     */
    async writeMetrics(metrics: Metrics) {
        // This doesn't seem to work for Ixxx value writes
        // Untested with other writes at present

        // Go through each metric to write and separate the name and desired value
        const addrs: string[] = [];
        const values: any[] = [];
        metrics.array.forEach((metric) => {
            if (typeof metric.properties !== "undefined" && metric.properties.address.value) {
                addrs.push(metric.properties.address.value as string);
                values.push(metric.value);
            }
        })
        // If there are actuall metrics to be written...
        if (addrs.length) {
            // Notify user
            log(`Writing ${values} to ${addrs}`);
            // Write metric values
            await this.#itemGroup.writeItems(addrs, values);
        }
    }

    /**
     * Close connection and tidy up
     */
    async close() {
        // Clear the variable list
        this.#vars = {};
        // Destroy the metric item group, if it exists
        if (this.#itemGroup) {
            this.#itemGroup.destroy();
        }
        // Close the PLC connection
        await this.#s7Conn.disconnect();
    }
}

// !! IMPORTANT !!
// Ensure metric addresses are as specified here: 
// https://github.com/st-one-io/node-red-contrib-s7#variable-addressing


/**
 * S7 Device class
 */
export class S7Device extends (Device) {
    s7Vars: {
        [index: string]: string // name: address
    }
    #devConn: S7Connection
    constructor(spClient: SparkplugNode, devConn: S7Connection, options: deviceOptions) {
        super(spClient, devConn, options);
        this.#devConn = devConn;
        this._metrics.add(options.metrics);
        // Prepare list of variables for S7 library to use
        this.s7Vars = {};
        // Push metric to S7 variables list
        options.metrics.forEach((metric) => {
            if (typeof metric.properties !== "undefined" && metric.properties.address.value) {
                this.s7Vars[metric.properties.address.value as string] =
                    metric.properties.address.value as string;
            }
        });

        // Set S7 variables as item group (this allows optimization of PLC transactions)
        this.#devConn.addToItemGroup(this.s7Vars);

    }
}
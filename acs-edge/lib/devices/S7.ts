/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import { Device, deviceOptions, DeviceConnection } from "../device.js";
import { log, logf } from "../helpers/log.js";
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
    /* XXX I'm not sure what purpose this serves */
    #vars: Set<string>
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
        this.#itemGroup = new S7ItemGroup(this.#s7Conn);
        this.#vars = new Set();

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

    async subscribe (addresses: string[]) {
        logf("S7 Subscribe: %O", addresses); 
        for (const a of addresses) {
            this.#vars.add(a);
            this.#itemGroup.addItems(a);
        }
        return addresses;
    }

    async unsubscribe (handle: any) {
        const addresses = handle as string[];
        for (const a of addresses) {
            this.#vars.delete(a);
            this.#itemGroup.removeItems(a);
        };
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
        this.#vars = new Set();
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

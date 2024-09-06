/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import { Device, deviceOptions, DeviceConnection } from "../device.js";
import { log } from "../helpers/log.js";
import { SparkplugNode } from "../sparkplugNode.js";
import { Socket, createSocket, RemoteInfo } from 'dgram';
import { Metrics, sparkplugValue } from '../helpers/typeHandler.js';

interface udpConnDetails {
    port: number
}

export class UDPConnection extends DeviceConnection {
    #port: number
    #server: Socket

    constructor(type: string, connDetails: udpConnDetails) {
        super(type);

        this.#port = connDetails.port;

        this.#server = createSocket('udp4');

        this.#server.on('error', (err) => {
            log(`UDP server error:\n${err.stack}`);
            this.#server.close();
        });

        this.#server.on('message', (msg: Buffer, rinfo: RemoteInfo) => {
            // this.emit('asyncData', msg, rinfo);
            this.emit('data', {'': msg});
        });

        this.#server.on('listening', () => {
            const address = this.#server.address();
            log(`UDP server listening on ${address.address}:${address.port}`);
        });

    }

    /**
     * Open the device connection. Must emit an 'open' event when finished.
     */
    open() {
        this.#server.bind(this.#port);
        // Add a short delay before reporting ready to allow parent device
        // class to initialize
        setTimeout(() => this.emit("open"), 10);
    }

    /**
     * Read specified metrics from device connection
     * @param {Array} metrics Array of metric objects to read. Will be modified in place
     * @returns {Array} Previous values of specified metrics.
     */
    readMetrics(metrics: Metrics): sparkplugValue[] {
        // Unused
        return []
    }

    /**
     * Write specified metrics to device connection
     * @param {Array} metrics Array of metric objects to write to device connection
     */
    writeMetrics(metrics: Metrics) {
        // Not yet implemented
    }

    /**
     * Close connection and tidy up
     */
    async close() {
        try {
            this.#server.close();
        } catch (e) {
            console.log(e);
        }
    }
}

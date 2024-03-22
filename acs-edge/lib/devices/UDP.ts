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

export class UDPDevice extends (Device) {
    #devConn: UDPConnection
    constructor(spClient: SparkplugNode, devConn: UDPConnection, options: deviceOptions) {
        super(spClient, devConn, options);
        this.#devConn = devConn;

        // Prepare metric list
        // This is the bare minimum you have to do
        this._metrics.add(options.metrics);

        // this.#devConn.on('asyncData', (msg: Buffer, rinfo: RemoteInfo) => {
        //     let changedMetrics: sparkplugMetric[] = [];
        //     for (let i = 0; i < this._metrics.length; i++) {
        //         const metric = this._metrics.array[i];
        //         const addr = (metric.properties.address.value as string);

        //         // If metric method is GET and a path is set
        //         // If address is set and it matches the metric or address is not set
        //         // If port is set and it matches the metric or port is not set
        //         if (metric.properties.method.value === "GET"
        //             && metric.properties.path.value) {
        //             if ((!addr || addr == rinfo.address)) {
        //                 let newVal = parseValueFromPayload(msg, metric, this._payloadFormat, this._delimiter);
        //                 if (!util.isDeepStrictEqual(this._metrics.array[i].value, newVal)) {
        //                     this._metrics.setValueByIndex(i, newVal);
        //                     changedMetrics.push(metric);
        //                 }
        //             }
        //         }
        //     }
        //     if (changedMetrics.length) {
        //         this.onConnData(changedMetrics);
        //     }
        // })
    }

    subscribeToMetricChanges() {
        // Override with empty method to prevent polling
    }
}
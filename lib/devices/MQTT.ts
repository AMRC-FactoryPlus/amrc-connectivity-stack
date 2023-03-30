/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import {Device, DeviceConnection, deviceOptions} from "../device.js";
import {log} from "../helpers/log.js";
import {SparkplugNode} from "../sparkplugNode.js";
import {Metrics, writeValuesToPayload} from "../helpers/typeHandler.js";
import * as mqtt from "mqtt";
import {v4 as uuidv4} from 'uuid';

export default interface mqttConnDetails {
    clientId: string,
    protocol: string,
    host: string,
    port: number,
    username?: string,
    password?: string,
    clean?: boolean,
    keepalive?: number
    cleanSession: boolean,
    keepAlive: number
}

export class MQTTConnection extends DeviceConnection {
    #connStr: string
    #options: {
        clientId: string,
        username?: string,
        password?: string,
        clean?: boolean,
        keepalive?: number,
        connectTimeout?: number
        reconnectPeriod?: number
    }
    #client: mqtt.Client

    constructor(type: string, connDetails: mqttConnDetails) {
        super(type);
        this.#connStr = `${connDetails.protocol}://${connDetails.host}:${connDetails.port}`;
        let clientId = (process.env.LOCAL ? 'LOCAL-DEV-' + uuidv4() : connDetails.clientId || 'NO-ID-' + uuidv4());
        log('ClientID: ' + clientId);
        this.#options = {

            clientId: clientId
        };
        if (connDetails.username) {
            this.#options.username = connDetails.username;
            this.#options.password = connDetails.password;
        }
        this.#options.clean = connDetails.cleanSession;
        this.#options.keepalive = connDetails.keepAlive;
        this.#options.connectTimeout = 5000;
        this.#options.reconnectPeriod = 10000;

        this.#client = mqtt.connect(this.#connStr, this.#options);
        this.#client.on('connect', () => {
            log(`🔌 Southbound MQTT server connected (${this.#connStr}).`);
            this.emit('open');
        });

        this.#client.on("message", (topic, msg) => {
            // this.emit("asyncData", topic, msg);
            let obj: any = {};
            obj[topic] = msg;
            this.emit('data', obj);
        });

        this.#client.on("disconnect", () => {
            log('☠️ Southbound MQTT server disconnected.')
        });

        this.#client.on("reconnect", () => {
            log(`🔄 Reconnecting to southbound MQTT server, potentially because the server (${this.#connStr}) can not be reached.`);
        });

        this.#client.on('error', (err) => {
            // [AG] Error messages are not sent when the server can't be reached. Instead it endlessly tries to
            // reconnect.
            // https://github.com/mqttjs/MQTT.js/issues/1247
            log(`⚠️ Could not connect to southbound MQTT server: ${err.message}`);
        })
    }

    readMetrics(metrics: Metrics, payloadFormat?: string, delimiter?: string) {

        // This function effectively kicks the keepAlive timer to ensure that a DDEATH is not issued on an
        // inactive broker. It is run at the `Polling Interval (ms)` value of the connection.

        this.emit('data', {});
    }

    async subscribe(topic: string) {
        this.#client.subscribe(topic, (err) => {
            if (err) {
                console.log(err);
            }
        });
    }

    /**
     * Write specified metrics to device connection
     * @param {Array} metrics Array of metric objects to write to device connection
     * @param writeCallback
     * @param payloadFormat
     * @param delimiter
     */
    writeMetrics(metrics: Metrics, writeCallback: Function, payloadFormat?: string, delimiter?: string) {
        let err = null;
        metrics.addresses.forEach((addr) => {
            let payload = writeValuesToPayload(metrics.getByAddress(addr), payloadFormat || "");
            if (payload && payload.length) {
                this.#client.publish(addr, payload);
            } else {
                err = new Error("Value error");
            }

        })
        writeCallback(err);
    }

    /**
     * Close connection and tidy up
     */
    async close() {
        this.#client.end();
    }
}


export class MQTTDevice extends Device {
    #devConn: MQTTConnection

    constructor(spClient: SparkplugNode, devConn: MQTTConnection, options: deviceOptions) {
        super(spClient, devConn, options);
        this.#devConn = devConn;

        this._metrics.add(options.metrics);
        this._metrics.addresses.forEach((topic) => {
            if (topic) this.#devConn.subscribe(topic);
        })

        // Define function for handling data pushed to device asynchronously
        // this.#devConn.on("asyncData", async (topic: string, msg: any) => {
        //   let changedMetrics: sparkplugMetric[] = [];
        //   this._metrics.getPathsForAddr(topic).forEach((path) => {
        //     const targetMetric = this._metrics.getByAddrPath(topic, path);
        //     const newVal = parseValueFromPayload(msg, targetMetric, this._payloadFormat, this._delimiter);
        //     if (!util.isDeepStrictEqual(targetMetric.value, newVal)) {
        //       this._metrics.setValueByAddrPath(topic, path, newVal);
        //       changedMetrics.push(targetMetric);
        //     }
        //   })
        //   if (changedMetrics.length) {
        //     this.onConnData(changedMetrics);
        //   }
        // });
    }

}

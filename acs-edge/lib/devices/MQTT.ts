/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { DeviceConnection } from "../device.js";
import { log } from "../helpers/log.js";
import { Metrics, writeValuesToPayload } from "../helpers/typeHandler.js";
import * as mqtt from "mqtt";
import { v4 as uuidv4 } from 'uuid';
import { mqttScoutDetails } from "../scout.js";


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
    #client: mqtt.MqttClient

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


    public async scoutAddresses(scoutDetails: mqttScoutDetails): Promise<string[]> {
        const { topic, duration } = scoutDetails;

        const discoveredTopics: Set<string> = new Set();
        const clientForScout = mqtt.connect(this.#connStr, this.#options);
        let scoutTimeout: NodeJS.Timeout;

        return new Promise<string[]>((resolve, reject) => {
            clientForScout.on('connect', () => {
                log(`Scout client for MQTTConnection connected to broker ${this.#connStr}.`);

                clientForScout.subscribe(topic, (err) => {
                    if (err) {
                        log(`Scout client for MQTTConnection couldn't subscribe with error: ${err.message}`);
                        clientForScout.end();
                        reject(err);
                        return;
                    }
                    clientForScout.on('message', (topic, message) => {
                        discoveredTopics.add(topic);
                    });
                    scoutTimeout = setTimeout(() => {
                        log(`Scout client for MQTTConnection completed`)
                        clientForScout.end();
                        resolve(Array.from(discoveredTopics));
                    }, duration);
                });
            });

            clientForScout.on('error', (err) => {
                log(`Scout client for MQTTConnection error: ${err.message}`);
                if (scoutTimeout) {
                    clearTimeout(scoutTimeout);
                }
                clientForScout.end();
                reject(err);
            })
        });
    }

    async subscribe(addresses: string[]) {
        const topics = addresses.filter(t => t);
        const granted = await this.#client.subscribeAsync(topics);
        const failed = granted
            .filter(g => g.qos == 128)
            .map(g => g.topic)
            .join(", ");
        if (failed)
            log(`⚠️ Could not subscribe to southbound topics: ${failed}`);
        return granted
            .filter(g => g.qos != 128)
            .map(g => g.topic);
    }

    /* This accepts the return value from `subscribe`. */
    async unsubscribe(handle: any) {
        const topics = handle as string[];
        await this.#client.unsubscribeAsync(topics);
    }

    /**
     * Write specified metrics to device connection
     * @param {Array} metrics Array of metric objects to write to device connection
     * @param writeCallback
     * @param payloadFormat
     * @param delimiter
     */
    writeMetrics(metrics: Metrics, writeCallback: Function, payloadFormat?: string, delimiter?: string) {
        let err: Error | null = null;
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


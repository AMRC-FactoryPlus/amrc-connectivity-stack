/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { DeviceConnection } from "../device.js";
import { log } from "../helpers/log.js";
import { Metrics, writeValuesToPayload } from "../helpers/typeHandler.js";
import * as mqtt from "mqtt";
import { v4 as uuidv4 } from 'uuid';
import { ScoutDriverDetails } from "../scout.js";

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

interface MqttScoutDetails extends ScoutDriverDetails {
    duration: number,
    topic: string
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
            // If the message is a Buffer, try to parse it as JSON or convert to string
            if (Buffer.isBuffer(msg)) {
                try {
                    // Try parsing as JSON first
                    obj[topic] = JSON.parse(msg.toString());
                } catch (e) {
                    // If not JSON, keep as buffer
                    obj[topic] = msg;
                }
            } else if (typeof msg === 'object' && msg !== null) {
                // If it's already an object, keep it
                obj[topic] = msg;
            } else {
                obj[topic] = msg;
            }
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


    public async scoutAddresses(driverDetails: ScoutDriverDetails): Promise<object> {
        const clientForScout = mqtt.connect(this.#connStr, this.#options);
        let scoutTimeout: NodeJS.Timeout | null = null; // Track timeout
    
        try {
            const { topic, duration }: MqttScoutDetails = await this.validateConfigDetails(driverDetails);
            const discoveredAddresses: Map<string, object | null> = new Map<string, object | null>();
    
            return await new Promise<object>((resolve, reject) => {
                clientForScout.on("connect", () => {
                    log(`Scout client connected to broker ${this.#connStr}.`);
    
                    clientForScout.subscribe(topic, (err) => {
                        if (err) {
                            log(`Subscription failed: ${err.message}`);
                            reject(new Error(`Subscription failed: ${err.message}`));
                            return;
                        }
    
                        log(`Subscribed to topic: ${topic}`);
    
                        clientForScout.on("message", (topic, message) => {
                            if (!discoveredAddresses.has(topic)) {
                                discoveredAddresses.set(topic, null);
                            }
                        });
    
                        scoutTimeout = setTimeout(() => {
                            log(`Scout completed.`);
                            resolve(Object.fromEntries(discoveredAddresses));
                        }, duration);
                    });
                });
    
                clientForScout.on("error", (err) => {
                    log(`MQTT client error: ${err.message}`);
                    reject(err);
                });
            });
        } catch (err) {
            log(`Error during MQTT scouting: ${(err as Error).message}`);
            throw err;
        } finally {
            if (scoutTimeout) clearTimeout(scoutTimeout);
            clientForScout.end();
        }
    }
    

    
    private async validateConfigDetails(driverDetails: any): Promise<MqttScoutDetails> {
        if (!driverDetails.duration || !Number.isFinite(driverDetails.duration) || driverDetails.duration <= 0) {
            throw new Error("Error: driverDetails.duration in MQTT Config is invalid.");
        }
    
        if (!driverDetails.topic || typeof driverDetails.topic !== "string" || driverDetails.topic.trim() === "") {
            throw new Error("Error: driverDetails.topic in MQTT Config is invalid.");
        }
    
        return {
            duration: driverDetails.duration,
            topic: driverDetails.topic.trim(),
        };
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


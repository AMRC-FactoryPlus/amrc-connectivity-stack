/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * ACS Edge OPC UA Server - MQTT Client
 *
 * Subscribes to configured UNS topics on the local ACS MQTT broker and
 * updates the data store with incoming values.
 */

import mqtt from "mqtt";

export class MqttClient {
    constructor(opts) {
        this.host = opts.host;
        this.port = opts.port;
        this.username = opts.username;
        this.password = opts.password;
        this.topics = opts.topics;
        this.dataStore = opts.dataStore;

        this.client = null;
    }

    async start() {
        const url = `mqtt://${this.host}:${this.port}`;
        console.log(`Connecting to MQTT broker at ${url} as ${this.username}`);

        this.client = mqtt.connect(url, {
            username: this.username,
            password: this.password,
            clientId: this.username,
            clean: false,
            reconnectPeriod: 5000,
        });

        this.client.on("connect", () => {
            console.log("Connected to MQTT broker");
            this.subscribe();
        });

        this.client.on("reconnect", () => {
            console.log("Reconnecting to MQTT broker...");
        });

        this.client.on("error", (err) => {
            console.error(`MQTT error: ${err.message}`);
        });

        this.client.on("message", (topic, payload) => {
            this.handleMessage(topic, payload);
        });
    }

    subscribe() {
        for (const topic of this.topics) {
            console.log(`Subscribing to ${topic}`);
            this.client.subscribe(topic, { qos: 1 }, (err) => {
                if (err) {
                    console.error(`Failed to subscribe to ${topic}: ${err.message}`);
                }
            });
        }
    }

    handleMessage(topic, payload) {
        try {
            /* Try to parse as JSON first; fall back to string. */
            let value;
            const text = payload.toString();

            try {
                value = JSON.parse(text);
            }
            catch {
                value = text;
            }

            this.dataStore.set(topic, value);
        }
        catch (err) {
            console.error(`Error handling message on ${topic}: ${err.message}`);
        }
    }

    async stop() {
        if (this.client) {
            await new Promise((resolve) => {
                this.client.end(false, {}, resolve);
            });
            console.log("Disconnected from MQTT broker");
        }
    }
}

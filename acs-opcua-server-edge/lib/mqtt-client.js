/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * ACS Edge OPC UA Server - MQTT Client
 *
 * Subscribes to configured UNS topics on the ACS MQTT broker and
 * updates the data store with incoming values.  The MQTT connection
 * is obtained via ServiceClient which handles broker discovery and
 * authentication (GSSAPI or basic).
 */

export class MqttClient {
    constructor(opts) {
        this.fplus = opts.fplus;
        this.topics = opts.topics;
        this.dataStore = opts.dataStore;

        this.mqtt = null;
    }

    async start() {
        const mqtt = await this.fplus.mqtt_client({});
        if (!mqtt) {
            throw new Error("Failed to obtain MQTT client from ServiceClient");
        }
        this.mqtt = mqtt;

        mqtt.on("authenticated", () => {
            console.log("MQTT authenticated, subscribing to topics");
            this.subscribe();
        });

        mqtt.on("error", (err) => {
            console.error(`MQTT error: ${err.message}`);
        });

        mqtt.on("message", (topic, payload) => {
            this.handleMessage(topic, payload);
        });
    }

    subscribe() {
        for (const topic of this.topics) {
            console.log(`Subscribing to ${topic}`);
            this.mqtt.subscribe(topic, { qos: 1 }, (err) => {
                if (err) {
                    console.error(`Failed to subscribe to ${topic}: ${err.message}`);
                }
            });
        }
    }

    handleMessage(topic, payload) {
        try {
            let value;
            let timestamp;
            const text = payload.toString();

            try {
                const parsed = JSON.parse(text);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    if ("value" in parsed) {
                        value = parsed.value;
                    }
                    else {
                        value = parsed;
                    }

                    if ("timestamp" in parsed) {
                        timestamp = parsed.timestamp;
                    }
                }
                else {
                    value = parsed;
                }
            }
            catch {
                value = text;
            }

            this.dataStore.set(topic, value, timestamp);
        }
        catch (err) {
            console.error(`Error handling message on ${topic}: ${err.message}`);
        }
    }

    async stop() {
        if (this.mqtt) {
            await new Promise((resolve) => {
                this.mqtt.end(false, {}, resolve);
            });
            console.log("Disconnected from MQTT broker");
        }
    }
}

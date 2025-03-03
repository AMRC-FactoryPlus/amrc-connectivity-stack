/*
 * Factory+ / AMRC Connectivity Stack (ACS) Config Store component
 * MQTT client connection
 * Copyright 2022 AMRC
 */

import * as timers from "timers/promises";

import { 
    Address, MetricBuilder, SpB, Topic, UUIDs
} from "@amrc-factoryplus/service-client";

import {Device_Info, Schema, Service} from "./constants.js";

const Changed = {
    app: "Application",
    device: "Device",
    schema: "Schema",
};

export default class MQTTCli {
    constructor(opts) {
        this.fplus = opts.fplus;

        this.device_uuid = opts.device_uuid;
        this.url = opts.url;
        this.silent = opts.silent;

        this.log = opts.fplus.debug.bound("mqtt");

        this.address = Address.parse(opts.sparkplug_address);
        this.seq = 0;
    }

    static fromEnv (fplus, env) {
        if (env.MQTT_DISABLE) {
            fplus.debug.log("mqtt", "Disabling MQTT connection.");
            return;
        }
        return new MQTTCli({
            fplus,
            sparkplug_address:  env.SPARKPLUG_ADDRESS,
            device_uuid:        env.DEVICE_UUID,
            url:                env.HTTP_API_URL,
            silent:             !!env.MQTT_MONITOR_ONLY,
        });
    }

    will() {
        if (this.silent) return undefined;

        const ndeath = {
            timestamp: Date.now(),
            metrics: MetricBuilder.death.node([]),
        };
        const will = SpB.encodePayload(ndeath);

        return {
            topic: this.address.topic("DEATH"),
            payload: will,
            qos: 0,
            retain: false,
        };
    }

    async run() {
        if (this.silent)
            this.log("Running in monitor-only mode.");

        for (;;) {
            this.mqtt = await this.fplus.mqtt_client({
                verbose: true,
                will: this.will(),
            });
            if (this.mqtt) break;

            this.log("Cannot connect to MQTT, retrying in 30s");
            await timers.setTimeout(30000);
        }

        const { mqtt } = this;
        mqtt.on("gssconnect", this.on_connect.bind(this));
        mqtt.on("error", this.on_error.bind(this));
        mqtt.on("message", this.on_message.bind(this));
        mqtt.subscribe(this.address.topic("CMD"));
    }

    encode_metrics(metrics, with_uuid) {
        const payload = {
            timestamp: Date.now(),
            metrics: metrics,
            seq: this.seq,
        };
        this.seq = (this.seq < 255) ? (this.seq + 1) : 0;
        if (with_uuid)
            payload.uuid = UUIDs.FactoryPlus;

        return SpB.encodePayload(payload);
    }

    publish(kind, metrics, with_uuid) {
        if (!this.mqtt) {
            this.log("Can't publish without an MQTT connection.");
            return;
        }

        const topic = this.address.topic(kind);
        const payload = this.encode_metrics(metrics, with_uuid);

        this.mqtt.publish(topic, payload);
    }

    on_connect() {
        this.log("Connected to MQTT broker.");
        this.rebirth();
    }

    rebirth() {
        if (this.silent)
            return;

        this.seq = 0;
        const Birth = MetricBuilder.birth;
        const metrics = Birth.node([]);
        //Birth.command_escalation(metrics);
        metrics.push.apply(metrics, [
            {name: "Device_Information/Manufacturer", type: "String", value: Device_Info.Manufacturer},
            {name: "Device_Information/Model", type: "String", value: Device_Info.Model},
            {name: "Device_Information/Serial", type: "String", value: Device_Info.Serial},

            {name: "Schema_UUID", type: "UUID", value: Schema.Service},
            {name: "Instance_UUID", type: "UUID", value: this.device_uuid},
            {name: "Service_UUID", type: "UUID", value: Service.Registry},
            {name: "Service_URL", type: "String", value: this.url},
        ]);
        metrics.push.apply(metrics,
            Object.values(Changed).map(v =>
                ({name: `Last_Changed/${v}`, type: "UUID", value: ""})));

        this.log(`Publishing birth certificate`);
        this.publish("BIRTH", metrics, true);
    }

    publish_changed(changes) {
        const metrics = [];
        for (let [to, uuid] of Object.entries(changes)) {
            if (!(to in Changed))
                continue;
            metrics.push({
                name: `Last_Changed/${Changed[to]}`,
                type: "UUID",
                value: uuid,
            });
        }
        this.publish("DATA", metrics);
    }

    on_error(error) {
        this.log("MQTT error: %o", error);
    }

    async on_message(topicstr, message) {
        let topic = Topic.parse(topicstr);
        let addr = topic.address;

        let payload;
        try {
            payload = SpB.decodePayload(message);
        } catch {
            this.log(`Bad payload on topic ${topicstr}`);
            return;
        }

        switch (topic.type) {
            case "BIRTH":
                //await this.on_birth(addr, payload);
                break;
            case "DEATH":
                //await this.on_death(addr, payload);
                break;
            case "DATA":
                //await this.on_data(addr, payload);
                break;
            case "CMD":
                await this.on_command(addr, payload);
                break;
            default:
                this.log(`Unknown Sparkplug message type ${topic.type}!`);
        }
    }

    async on_command(addr, payload) {
        if (!addr.equals(this.address)) {
            //console.log(`Received CMD for ${addr}`);
            return;
        }

        for (let m of payload.metrics) {
            switch (m.name) {
                case "Node Control/Rebirth":
                    await this.rebirth();
                    break;
                default:
                    this.log(`Received unknown CMD: ${m.name}`);
                /* Ignore for now */
            }
        }
    }
}

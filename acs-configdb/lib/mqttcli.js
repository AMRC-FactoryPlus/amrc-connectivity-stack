/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { Address, Debug, SpB, Topic, UUIDs } from '@amrc-factoryplus/utilities'
import { MetricBuilder } from '@amrc-factoryplus/service-client'

import { Device_Info, Schema, Service } from './constants.js'

const Changed = {
    app: "Application",
    device: "Device",
    schema: "Schema",
};

const debug = new Debug();

export default class MQTTCli {
    constructor(opts) {
        this.fplus = opts.fplus;

        this.device_uuid = opts.device_uuid;
        this.url = opts.url;
        this.silent = opts.silent;

        this.address = Address.parse(opts.sparkplug_address);
        this.seq = 0;
    }

    async init() {
        return this;
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
            debug.log("mqtt", "Running in monitor-only mode.");

        const mqtt = await this.fplus.mqtt_client({
            verbose: true,
            will: this.will(),
        });
        this.mqtt = mqtt;

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
            debug.log("mqtt", "Can't publish without an MQTT connection.");
            return;
        }

        const topic = this.address.topic(kind);
        const payload = this.encode_metrics(metrics, with_uuid);

        this.mqtt.publish(topic, payload);
    }

    on_connect() {
        debug.log("mqtt", "Connected to MQTT broker.");
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

        debug.log("mqtt", `Publishing birth certificate`);
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
        debug.log("mqtt", "MQTT error: %o", error);
    }

    async on_message(topicstr, message) {
        let topic = Topic.parse(topicstr);
        let addr = topic.address;

        let payload;
        try {
            payload = SpB.decodePayload(message);
        } catch {
            debug.log("mqtt", `Bad payload on topic ${topicstr}`);
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
                debug.log("mqtt", `Unknown Sparkplug message type ${topic.type}!`);
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
                    debug.log("mqtt", `Received unknown CMD: ${m.name}`);
                /* Ignore for now */
            }
        }
    }
}

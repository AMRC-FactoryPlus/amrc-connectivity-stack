/*
 * Factory+ / AMRC Connectivity Stack (ACS) Command Escalation component
 * MQTT client
 * Copyright 2022 AMRC
 */

import {Address, MetricBuilder, SpB, Topic, UUIDs} from "@amrc-factoryplus/utilities";

const Valid = {
    Name: /^[A-Za-z0-9_-]+$/,
    Tag: /^[A-Za-z0-9_ \/]+$/,
};

/* Currently we are a Sparkplug Node; this is only so we can advertise
 * ourself to the Directory over MQTT. Should we instead push a service
 * advert to the Directory over HTTP, and then we don't need node
 * credentials? */

export default class MqttCli {
    constructor(opts) {
        this.fplus = opts.fplus;
        this.address = Address.parse(opts.sparkplug_address);
        this.device_uuid = opts.device_uuid;
        this.http_url = opts.http_url;
        this.service = opts.service;

        this.log = this.fplus.debug.log.bind(this.fplus.debug);

        this.seq = 0;
    }

    async init() {
        return this;
    }

    set_cmdesc(c) {
        this.cmdesc = c;
    }

    will() {
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
        const mqtt = await this.fplus.mqtt_client({
            will: this.will(),
        });
        this.mqtt = mqtt;

        mqtt.on("error", this.on_error.bind(this));
        mqtt.on("authenticated", this.on_connect.bind(this));
        mqtt.on("message", this.on_message.bind(this));
    }

    on_connect() {
        this.log("mqtt", "Connected to MQTT.");
        this.mqtt.subscribe(this.address.topic("CMD"));
        this.mqtt.subscribe("spBv1.0/+/NDATA/+");
        this.mqtt.subscribe("spBv1.0/+/DDATA/+/+");
        this.rebirth();
    }

    on_error(error) {
        console.log(`MQTT error: ${error}`);
    }

    on_message(topicstr, message) {
        const topic = Topic.parse(topicstr);
        if (topic === null) {
            this.log("mqtt", `Ignoring bad topic ${topicstr}`);
            return;
        }
        const addr = topic.address;

        let payload;
        try {
            payload = SpB.decodePayload(message);
        } catch {
            this.log("mqtt", `Bad payload on topic ${topic}`);
            return;
        }

        switch (topic.type) {
            case "BIRTH":
                //this.on_birth(addr, payload);
                break;
            case "DEATH":
                //this.on_death(addr, payload);
                break;
            case "DATA":
                this.on_data(addr, payload);
                break;
            case "CMD":
                this.on_command(addr, payload);
                break;
            default:
                this.log("mqtt", `Unknown Sparkplug message type ${topic.type}!`);
        }
    }

    on_command(addr, payload) {
        if (!addr.equals(this.address)) {
            //console.log(`Received CMD for ${addr}`);
            return;
        }

        for (let m of payload.metrics) {
            switch (m.name) {
                case "Node Control/Rebirth":
                    this.rebirth();
                    break;
                default:
                    this.log("mqtt", `Received unknown CMD: ${m.name}`);
                /* Ignore for now */
            }
        }
    }

    async on_data(addr, payload) {
        for (let m of payload.metrics) {
            switch (m.name) {
                case "Execute_Remote_Command":
                    this.handle_command_request(addr, m);
                    break;
            }
        }
    }

    rebirth() {
        this.seq = 0;
        const Birth = MetricBuilder.birth;
        const metrics = Birth.node([]);
        //Birth.command_escalation(metrics);
        metrics.push.apply(metrics, [
            //{ name: "Device_Information/Manufacturer", type: "String", value: Device_Info.Manufacturer },
            //{ name: "Device_Information/Model", type: "String", value: Device_Info.Model },
            //{ name: "Device_Information/Serial", type: "String", value: Device_Info.Serial },

            {name: "Schema_UUID", type: "UUID", value: UUIDs.Schema.Service},
            {name: "Instance_UUID", type: "UUID", value: this.device_uuid},
            {name: "Service_UUID", type: "UUID", value: this.service},
            {name: "Service_URL", type: "String", value: this.http_url},
        ]);
        //metrics.push.apply(metrics, 
        //    Object.values(Changed).map(v =>
        //        ({ name: `Last_Changed/${v}`, type: "UUID", value: "" })));

        this.publish({
            address:    this.address,
            type:       "BIRTH",
            metrics,
        });
    }

    decode_request(metric) {
        if (metric.type != "Template")
            return;

        const cmdesc = Object.fromEntries(
            metric.value.metrics.map(m => [m.name, m.value]));

        const group = cmdesc.Receivers_Group_ID;
        const node = cmdesc.Receivers_Edge_Node_ID;
        const device = cmdesc.Receivers_Device_ID;
        const tag = cmdesc.Tag_Path;
        const value = cmdesc.Tag_Value;

        if (!Valid.Name.test(group))
            return this.log("cmdesc", `Bad group '${group}'`);

        if (!Valid.Name.test(node))
            return this.log("cmdesc", `Bad node '${node}'`);

        if (!(device == "" || Valid.Name.test(device)))
            return this.log("cmdesc", `Bad device '${device}'`);

        if (!Valid.Tag.test(tag))
            return this.log("cmdesc", `Bad tag '${tag}'`);

        const address = new Address(group, node, device);

        return [address, {name: tag, value}];
    }

    encode_metrics (opts) {
        const { type, metrics, from } = opts;

        const payload = {
            timestamp: Date.now(),
            metrics,
        };

        /* CMDs don't increment the seq, because by spec they are only
         * sent by the Primary App. */
        if (type != "CMD") {
            payload.seq = this.seq;
            this.seq = (this.seq < 255) ? (this.seq + 1) : 0;
        }
        if (type == "BIRTH" || type == "CMD")
            payload.uuid = UUIDs.FactoryPlus;
        if (type == "CMD")
            payload.body = from ?? `uuid:${this.device_uuid}`;

        return SpB.encodePayload(payload);
    }

    async publish (opts) {
        const topic = opts.address.topic(opts.type);
        const payload = this.encode_metrics(opts);

        this.log("mqtt", `Publishing to ${topic}`);
        this.mqtt.publish(topic, payload);
    }

    async handle_command_request(from, metric) {
        const req = this.decode_request(metric);

        if (!req) return;
        const [to, cmd] = req;
        const stat = await this.cmdesc.execute_command(from, to, cmd);

        const resp = MetricBuilder.cmd.command_escalation_response(
            to, cmd.name, stat);
        this.publish({
            address:    from,
            type:       "CMD",
            metrics:    resp,
        });
    }
}


import { Address, MetricBuilder, SpB, Topic } from "@amrc-factoryplus/service-client";
export default class MQTTClient {
    serviceClient;
    deviceUUID;
    url;
    address;
    seq;
    mqtt;
    constructor({ e }) {
        this.serviceClient = e.serviceClient;
        this.deviceUUID = e.deviceUUID;
        this.url = e.url;
        this.address = Address.parse(e.sparkplugAddress);
        this.seq = 0;
        this.log = e.serviceClient.debug.bound("mqtt");
    }
    async init() {
        return this;
    }
    will() {
        const nDeath = {
            timestamp: Date.now(),
            metrics: MetricBuilder.death.node([]),
        };
        // @ts-ignore
        const will = SpB.encodePayload(nDeath);
        return {
            topic: this.address.topic("DEATH"),
            payload: will,
            qos: 0,
            retain: false,
        };
    }
    async run() {
        const mqtt = await this.serviceClient.mqtt_client({
            verbose: true,
            // @ts-ignore
            will: this.will(),
        });
        this.mqtt = mqtt;
        mqtt.on("gssconnect", this.on_connect.bind(this));
        mqtt.on("error", this.on_error.bind(this));
        mqtt.on("message", this.on_message.bind(this));
        // We subscribe to the whole Sparkplug namespace
        mqtt.subscribe('spBv1.0/#');
    }
    // encode_metrics(metrics, with_uuid) {
    //     const payload = {
    //         timestamp: Date.now(),
    //         metrics: metrics,
    //         seq: this.seq,
    //     };
    //     this.seq = (this.seq < 255) ? (this.seq + 1) : 0;
    //     if (with_uuid)
    //         payload.uuid = UUIDs.FactoryPlus;
    //
    //     return SpB.encodePayload(payload);
    // }
    // publish(kind, metrics, with_uuid) {
    //     if (!this.mqtt) {
    //         this.log("mqtt", "Can't publish without an MQTT connection.");
    //         return;
    //     }
    //
    //     const topic = this.address.topic(kind);
    //     const payload = this.encode_metrics(metrics, with_uuid);
    //
    //     this.mqtt.publish(topic, payload);
    // }
    on_connect() {
        this.log("Connected to MQTT broker.");
        // this.rebirth();
    }
    // rebirth() {
    //
    //     this.seq = 0;
    //     const Birth = MetricBuilder.birth;
    //     const metrics = Birth.node([]);
    //     //Birth.command_escalation(metrics);
    //     metrics.push.apply(metrics, [
    //         {name: "Device_Information/Manufacturer", type: "String", value: Device_Info.Manufacturer},
    //         {name: "Device_Information/Model", type: "String", value: Device_Info.Model},
    //         {name: "Device_Information/Serial", type: "String", value: Device_Info.Serial},
    //
    //         {name: "Schema_UUID", type: "UUID", value: Schema.Service},
    //         {name: "Instance_UUID", type: "UUID", value: this.device_uuid},
    //         {name: "Service_UUID", type: "UUID", value: Service.Registry},
    //         {name: "Service_URL", type: "String", value: this.url},
    //     ]);
    //     metrics.push.apply(metrics,
    //         Object.values(Changed).map(v =>
    //             ({name: `Last_Changed/${v}`, type: "UUID", value: ""})));
    //
    //     this.log(`Publishing birth certificate`);
    //     this.publish("BIRTH", metrics, true);
    // }
    // publish_changed(changes) {
    //     const metrics = [];
    //     for (let [to, uuid] of Object.entries(changes)) {
    //         if (!(to in Changed))
    //             continue;
    //         metrics.push({
    //             name: `Last_Changed/${Changed[to]}`,
    //             type: "UUID",
    //             value: uuid,
    //         });
    //     }
    //     this.publish("DATA", metrics);
    // }
    on_error(error) {
        this.log("MQTT error: %o", error);
    }
    async on_message(topicString, message) {
        let topic = Topic.parse(topicString);
        if (!topic) {
            this.log(`Bad topic: ${topicString}`);
            return;
        }
        let address = topic.address;
        let payload;
        try {
            // @ts-ignore
            payload = SpB.decodePayload(message);
        }
        catch {
            this.log(`Bad payload on topic ${topicString}`);
            return;
        }
        switch (topic.type) {
            case "BIRTH":
                //await this.on_birth(address, payload);
                break;
            case "DEATH":
                //await this.on_death(address, payload);
                break;
            case "DATA":
                await this.on_data(address, payload);
                break;
            case "CMD":
                await this.on_command(address, payload);
                break;
            default:
                this.log(`Unknown Sparkplug message type ${topic.type}!`);
        }
    }
    async on_data(addr, payload) {
        if (!payload.metrics) {
            this.log(`Received DATA with no metrics!`);
            return;
        }
        // for (let m of payload.metrics) {
        //     switch (m.name) {
        //         // case "Node Control/Rebirth":
        //         //     await this.rebirth();
        //         //     break;
        //         default:
        //             this.log(`Received unknown CMD: ${m.name}`);
        //         /* Ignore for now */
        //     }
        // }
    }
    async on_command(addr, payload) {
        if (!addr.equals(this.address)) {
            //console.log(`Received CMD for ${addr}`);
            return;
        }
        if (!payload.metrics) {
            this.log(`Received CMD with no metrics!`);
            return;
        }
        for (let m of payload.metrics) {
            switch (m.name) {
                // case "Node Control/Rebirth":
                //     await this.rebirth();
                //     break;
                default:
                    this.log(`Received unknown CMD: ${m.name}`);
                /* Ignore for now */
            }
        }
    }
}

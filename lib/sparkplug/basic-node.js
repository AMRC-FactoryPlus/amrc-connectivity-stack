import { EventEmitter } from "node:events";

import { Debug } from "../debug.js";
import { SpB } from "../deps.js";
import { Address, Topic } from "./util.js";

export class BasicSparkplugNode extends EventEmitter {
    constructor (opts) {
        super();

        this.address = opts.address;
        this.publishDeath = opts.publishDeath;
        this.mqttFactory = opts.mqttFactory;
        this.debug = opts.debug ?? new Debug();

        this.log = this.debug.log.bind(this.debug, "sparkplug");

        this.bdSeq = 0;
    }

    will () {
        return {
            topic:      this.address.topic("DEATH"),
            payload:    SpB.encodePayload(this._death()),
            qos:        0,
            retain:     false,
        };
    }

    async connect (mqtt) {
        mqtt ??= await this.mqttFactory(this.will());
        this.mqtt = mqtt;

        /* XXX Tahu exits if we get an error before we have connected...
         * I'm not sure why. */
        for (const ev of ["error", "close", "reconnect", "offline"])
            mqtt.on(ev, this.emit.bind(this, ev));

        mqtt.on("authenticated", this.on_authenticated.bind(this));
        mqtt.on("message", this.on_message.bind(this));
    }

    on_authenticated () {
        const {mqtt, address} = this;

        this.log("MQTT connected");
        this.emit("connect");

        /* Tahu subscribes much too broadly here. This causes problems
         * with the HiveMQ ACLs, which are quite strict about the
         * subscription topics requested. */
        mqtt.subscribe(address.topic("CMD"));
        mqtt.subscribe(address.child_device("+").topic("CMD"));

        this.emit("birth");
    }

    /* XXX We don't handle Tahu compressed payloads. There is no spec;
     * we could potentially write one up and use it. */
    on_message (topicstr, message) {
        const topic = Topic.parse(topicstr);
        if (!topic) {
            this.log(`Message on unknown topic ${topicstr}`);
            return;
        }

        let payload;
        try {
            payload = SpB.decodePayload(message);
        }
        catch {
            this.log(`Invalid payload on ${topic}`);
            return;
        }

        if (topic.type == "CMD") {
            if (topic.address.isDevice())
                this.emit("dcmd", topic.address.device, payload);
            else
                this.emit("ncmd", payload);
        }
        else {
            /* What are you doing listening to other messages? */
            this.emit("message", payload);
        }
    }

    _bdSeqMetric () {
        return {
            name:   "bdSeq",
            type:   "UInt64",
            value:  this.bdSeq,
        };
    }

    _death () {
        return {
            timestamp:  Date.now(),
            metrics:    [this._bdSeqMetric()],
        };
    }

    _publish (kind, device, payload, opts) {
        const addr = device == null 
            ? this.address 
            : this.address.child_device(device);

        payload.seq = this.seq;
        this.seq = (this.seq < 255) ? this.seq + 1 : 0;

        /* XXX compress? */

        const message = SpB.encodePayload(payload);
        this.mqtt.publish(addr.topic(kind), message);
        this.log(`Published ${kind} for ${device ?? "Edge Node"}`);
    }

    /* All these methods may modify the payload parameter, to any depth.
     */

    publishNodeBirth (payload, opts) {
        this.seq = 0;
        payload.metrics ??= [];
        /* This will always sit at 0, and is therefore pointless. But
         * it's in the spec, and this is what Tahu does. If we wanted to
         * require stable storage we could do this properly. */
        payload.metrics.push(this._bdSeqMetric());
        this._publish("BIRTH", null, payload, opts);
    }

    publishDeviceBirth (device, payload, opts) {
        this._publish("BIRTH", device, payload, opts);
    }

    publishNodeData (payload, opts) {
        this._publish("DATA", null, payload, opts);
    }

    publishDeviceData (device, payload, opts) {
        this._publish("DATA", device, payload, opts);
    }

    publishDeviceDeath (device, payload, opts) {
        this._publish("DEATH", device, payload, opts);
    }

    stop () {
        if (this.publishDeath)
            this._publish("DEATH", null, this._death());
        this.mqtt.end();
    }
}

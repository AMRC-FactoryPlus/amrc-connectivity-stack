import { EventEmitter } from "events";

import { Debug } from "../debug.js";
import { SpB } from "../deps.js";
import { Topic } from "./util.js";

/** A class implementing a basic Sparkplug Node.
 * This class was written to replace the Tahu Sparkplug Node
 * implementation in the Edge Agent. It is a little crude as a result.
 */
export class BasicSparkplugNode extends EventEmitter {
    /** Construct a BasicSparkplugNode.
     * Arguments are passed as an object.
     *
     * The MQTT connection factory is called with an object representing
     * the MQTT LWT to publish on disconnection. The return value should
     * be a Promise to an MQTT object.
     *
     * @arg address An Address object representing our Node address.
     * @arg publishDeath Do we publish NDEATH on `stop()`?
     * @arg mqttFactory A function to create an MQTT connection.
     * @arg debug A Debug object to use for logging.
     */
    constructor (opts) {
        super();

        this.address = opts.address;
        this.publishDeath = opts.publishDeath;
        this.mqttFactory = opts.mqttFactory;
        this.debug = opts.debug ?? new Debug();

        this.log = this.debug.log.bind(this.debug, "sparkplug");

        this.bdSeq = 0;
    }

    /* private */
    will () {
        return {
            topic:      this.address.topic("DEATH"),
            payload:    SpB.encodePayload(this._death()),
            qos:        0,
            retain:     false,
        };
    }

    /** Connect to MQTT
     * This will generate a new MQTT connection and set up the
     * appropriate events.
     */
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

    /** Publish a NBIRTH.
     * The payload will be Sparkplug-encoded before transmission.
     * @arg payload The payload. May be modified to any depth.
     * @arg opts Ignored.
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

    /** Publish a DBIRTH.
     * The payload will be Sparkplug-encoded before transmission.
     * @arg device The Device ID to publish to.
     * @arg payload The payload. May be modified to any depth.
     * @arg opts Ignored.
     */
    publishDeviceBirth (device, payload, opts) {
        this._publish("BIRTH", device, payload, opts);
    }

    /** Publish a NDATA.
     * The payload will be Sparkplug-encoded before transmission.
     * @arg payload The payload. May be modified to any depth.
     * @arg opts Ignored.
     */
    publishNodeData (payload, opts) {
        this._publish("DATA", null, payload, opts);
    }

    /** Publish a DDATA.
     * The payload will be Sparkplug-encoded before transmission.
     * @arg device The Device ID to publish to.
     * @arg payload The payload. May be modified to any depth.
     * @arg opts Ignored.
     */
    publishDeviceData (device, payload, opts) {
        this._publish("DATA", device, payload, opts);
    }

    /** Publish a DDEATH.
     * The payload will be Sparkplug-encoded before transmission.
     * @arg device The Device ID to publish to.
     * @arg payload The payload. May be modified to any depth.
     * @arg opts Ignored.
     */
    publishDeviceDeath (device, payload, opts) {
        this._publish("DEATH", device, payload, opts);
    }

    /** Stop the Node.
     * If `publishDeath` was set in the constructor, publish a NDEATH
     * first. Close the MQTT connection.
     */
    stop () {
        if (this.publishDeath)
            this._publish("DEATH", null, this._death());
        this.mqtt.end();
    }
}

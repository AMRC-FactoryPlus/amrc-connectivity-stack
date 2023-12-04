/* ACS Sparkplug App library.
 * Sparkplug App class.
 * Copyright 2023 AMRC.
 */

import rx from "rxjs";

import { SpB, Topic }       from "@amrc-factoryplus/utilities";

import { SparkplugDevice }  from "./sparkplug-device.js";

export class SparkplugApp {
    constructor (opts) {
        this.fplus = opts.fplus;
        this.debug = opts.fplus.debug;
    }

    async init () {
        const fplus = this.fplus;

        const mqtt = this.mqtt = await fplus.MQTT.mqtt_client({});

        this.packets = this._init_packets();
        this.topics = new Map();
        this.failed_subscriptions = new rx.Subject();

        return this;
    }

    /* Sparkplug packets received from the broker */
    _init_packets () {
        return rx.fromEvent(this.mqtt, "message", 
            (t, p) => ({
                topic:      t, 
                payload:    SpB.decodePayload(p),
            }))
        .pipe(rx.share());
    }

    subscribe (topic) {
        this.mqtt.subscribeAsync(topic)
            .then(grs => grs.filter(gr => gr.qos & 0x80)
                .map(gr => gr.topic)
                .forEach(t => this.failed_subscriptions.next(t)));
    }

    unsubscribe (topic) {
        this.mqtt.unsubscribe(topic);
    }

    /* Return a sequence following a particular topic. These sequences
     * are shared and cached so we can track the subscriptions we need. */
    watch_topic (topic) {
        return rx.defer(() => this._watch_topic(topic));
    }

    _watch_topic (topic) {
        const log = this.debug.log.bind(this.debug, "topic");

        if (this.topics.has(topic)) {
            log("Using cached seq for %s", topic);
            return this.topics.get(topic);
        }

        log("Starting new seq for %s", topic);
        const seq = this.packets.pipe(
            rx.filter(p => p.topic == topic),
            /* Teardown when we have no more consumers */
            rx.finalize(() => {
                this.topics.delete(topic);
                this.unsubscribe(topic);
            }),
            /* Delay 5s after we have no subscribers in case we get some
             * more. This avoids churn in our MQTT subscriptions. */
            rx.share({ resetOnRefCountZero: () => rx.timer(5000) }),
        );
        this.subscribe(topic);
        this.topics.set(topic, seq);
        return seq;
    }

    /* Return a sequence of all packets from this address. types is a
     * list of Sparkplug topic types. */
    watch_address (addr, types) {
        types ??= ["BIRTH", "DEATH", "DATA"];

        const topics = types
            .map(typ => addr.topic(typ))
            .map(top => this.watch_topic(top));
        return rx.merge(...topics).pipe(
            rx.map(p => {
                const top = Topic.parse(p.topic);
                return { ...top, ...p.payload };
            }),
        );
    }

    device (opts) {
        return new SparkplugDevice(this, opts);
    }
}

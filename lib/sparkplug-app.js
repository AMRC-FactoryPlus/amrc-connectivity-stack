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

        this.packets = rx.fromEvent(mqtt, "message", (t, m) => [t, m])
            .pipe(
                rx.map(([t, p]) => ({
                    topic:      Topic.parse(t), 
                    payload:    SpB.decodePayload(p),
                })));

        this.watch = new rx.Subject();
        this.watch.pipe(
            rx.flatMap(addr => rx.from(
                ["BIRTH", "DEATH", "DATA"]
                .map(t => addr.topic(t)))),
            rx.tap(v => this.debug.log("watch", "%o", v)))
        .subscribe(topic => mqtt.subscribe(topic));

        return this;
    }

    /* This subscribes to MQTT when the method is called. This is
     * incorrect: our MQTT subscriptions should be driven by the
     * sequence subscriptions. */
    watch_address (addr) {
        this.watch.next(addr);
        return this.packets.pipe(
            rx.filter(m => m.topic.address.equals(addr)),
            rx.map(({topic, payload}) => ({
                type:       topic.type,
                address:    topic.address,
                ...payload,
            })));
    }

    device (opts) {
        return new SparkplugDevice(this, opts);
    }
}

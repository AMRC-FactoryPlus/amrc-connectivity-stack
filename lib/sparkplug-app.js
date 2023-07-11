/* ACS Sparkplug App library.
 * Sparkplug App class.
 * Copyright 2023 AMRC.
 */

import rx from "rxjs";

import { Address, SpB, Topic, UUIDs } from "@amrc-factoryplus/utilities";

import { SPAppError } from "./spapp-error.js";

class SparkplugDevice {
    constructor (app, opts) {
        this.app = app;
        this.log = this.app.debug.log.bind(this.app.debug, "device");

        if (opts.device) {
            this.device = opts.device;
        }
        else if (opts.address) {
            this.address = opts.address;
        }
        else {
            throw new SPAppError("Must supply device or address to constructor");
        }
    }

    async _address () {
        const addr = this.address;
        if (addr instanceof Address) return addr;
        if (addr != null) return Address.parse(addr);

        const resolved = await this.app.fplus.Directory.get_device_address(this.device);
        if (!resolved)
            throw new SPAppError(`Can't resolve device ${this.device}`);
        return resolved;
    }

    _setup_births (addr) {
        const cmdesc = this.app.fplus.CmdEsc;

        /* XXX We map aliases to strings here. It would be better to map
         * to BigInts, or to have the protobuf decoder decode to BigInts
         * in the first place, but the only way to convert Longs to
         * BigInts is via a string. */
        const births = this.packets.pipe(
            rx.filter(p => p.type == "BIRTH"),
            rx.map(birth => ({
                factoryplus:    birth.uuid == UUIDs.FactoryPlus,
                metrics:        new Map(
                    birth.metrics.map(m => [m.name, m])),
                aliases:        new Map(
                    birth.metrics
                        .filter(m => "alias" in m)
                        .map(m => [m.alias.toString(), m.name])),
            })),
            rx.shareReplay(1),
            rx.tap(b => this.log("Birth for %s", addr)));

        /* XXX The initial delay here is crude. We should be reacting to
         * successful subscription instead. */
        rx.timer(20, 2000)
            .pipe(
                rx.takeUntil(births),
                rx.tap(() => this.log("Rebirthing %s", addr)),
                rx.mergeMap(n => rx.from(cmdesc.rebirth(addr))))
            .subscribe();

        return births;
    }

    _setup_metrics () {
        /* XXX This resolves aliases on all metrics. We could probably
         * avoid this by instead keeping track of the current alias of
         * each metric we are interested in. */
        return this.packets.pipe(
            rx.mergeMap(p => rx.from(p.metrics)),
            rx.withLatestFrom(this.births,
                (m, b) => {
                    const rv = {...m};
                    if (m.alias)
                        rv.name = b.aliases.get(m.alias.toString());
                    return rv;
                }),
            rx.share());
    }

    async init () {
        const { fplus, mqtt } = this.app;

        const addr = await this._address();
        this.log("Watching %s", addr);

        this.packets = this.app.watch_address(addr).pipe(rx.share());
        this.births = this._setup_births(addr);
        this.metrics = this._setup_metrics();

        return this;
    }

    metric (tag) {
        return this.metrics.pipe(
            rx.filter(m => m.name == tag),
            rx.map(m => m.value));
    }
}

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

    watch_address (addr) {
        this.watch.next(addr);
        return this.packets.pipe(
            rx.filter(m => m.topic.address.equals(addr)),
            rx.map(({topic, payload}) => ({type: topic.type, ...payload})));
    }

    async device (opts) {
        const dev = new SparkplugDevice(this, opts);
        return await dev.init();
    }
}

/*
 * ACS Monitor
 * Monitor for an F+ Sparkplug Node
 * Copyright 2024 AMRC
 */

import duration     from "parse-duration";
import * as rx      from "rxjs";

import * as rxx     from "@amrc-factoryplus/rx-util";

import { rx_rx }    from "../util.js";

export class NodeMonitor {
    constructor (op, spec) {
        this.operator = op;
        this.spec = spec;

        this.fplus = op.fplus;

        this.log = this.fplus.debug.log.bind(this.fplus.debug, "node");

        this.node = spec.uuid;
        this.interval = duration(spec.interval);

        this._checks = [];
    }

    async init () {
        /* This will watch a SP publisher and resolve aliases */
        this.app = await this.fplus.MQTT.sparkplug_app();

        /* This will track our Node by its ConfigDB address */
        this.device = this.app.device({ node: this.node });

        /* Read all packets from the Node, including Devices */
        this.all_pkts = this._init_all_pkts();

        /* Check for updates to the config file */
        this._checks.push(this._rebirth_if_silent());

        this.offline = this._init_offline();

        return this;
    }

    address () {
        return rx.firstValueFrom(this.device.address);
    }

    checks () {
        const reporter = this.operator.sparkplug;

            /* rx.from on the array gives us a seq-of-seqs */
        return rx.from(this._checks).pipe(
            /* Attach restart logic to each check seq */
            rx.map(ch => ch.pipe(
                rx.tap({ error: e => 
                    this.log("Check error: %s: %o", this.node, e) }),
                rx.retry({ delay: 5000 }),
            )),
            /* Flatten the seq-of-seqs into our output */
            rx.mergeAll(),
            /* Inform the Sparkplug Node */
            rx.tap({
                subscribe:  () => reporter?.add_device(this),
                finalize:   () => reporter?.remove_device(this),
            }),
        );
    }

    /* This is not quite the same as this.device.packets, as this
     * watches for packets from Devices as well. */
    _init_all_pkts () {
        const { device, app } = this;
        return device.address.pipe(
            rx.switchMap(addr => rx.merge(
                app.watch_address(addr),
                app.watch_address(addr.child_device("+")))),
            rx.tap({ error: e => this.log("Can't watch: %s", e) }),
            rx.retry({ delay: 10000 }),
            rx.share(),
        );
    }

    _rebirth_if_silent () {
        /* If we see no packets for our timeout interval, send a
         * rebirth. Delay the rebirth by up to half the interval again
         * to avoid rebirth storms. */

        const each = this.interval;
        const jitter = each / 4;

        return rx_rx(
            this.all_pkts,
            rx.startWith(null),
            rx.switchMap(() => rx_rx(
                rx.of(null),
                rx.repeat({ 
                    delay: () => rx.timer(each + Math.random()*jitter),
                }),
                rx.skip(1),
                rx.tap(() => this.log("No packets for %s", this.node)),
                rx.exhaustMap(() => this.device.rebirth()),
            )),
            rx.tap({ 
                subscribe:  () => this.log(
                    "Liveness checks on %s with interval %s",
                    this.node, each),
                finalize:   () => this.log(
                    "Stop liveness checks on %s", this.node),
            }),
        );
    }

    _init_offline () {
        /* If we see no packets for 3 times our interval, raise an alert */

        const delay = this.interval * 3;

        return this.all_pkts.pipe(
            /* Pretend we saw an initial packet to give the device a
             * chance to speak */
            rx.startWith(null),
            /* Each time we see a packet, restart this sub-seq */
            rx.switchMap(() => rx.merge(
                /* the offline alert goes inactive immediately */
                rx.of(false),
                /* but it goes active again after this delay */
                rx.of(true).pipe(rx.delay(delay)))),
            /* Always make a value available */
            rxx.shareLatest());
    }
}

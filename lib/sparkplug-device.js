/*
 * ACS Sparkplug App library.
 * Class representing an individual Sparkplug device we are watching.
 * Copyright 2023 AMRC
 */

import rx from "rxjs";

import * as rxx             from "@amrc-factoryplus/rx-util";
import { Address, UUIDs }   from "@amrc-factoryplus/utilities";

import { SPAppError }       from "./spapp-error.js";

export class SparkplugDevice {
    constructor (app, opts) {
        this.app = app;
        this.log = this.app.debug.log.bind(this.app.debug, "device");

        this.address = this._setup_address(opts);
        this.packets = this._setup_packets();
        this.births = this._setup_births(opts.rebirth);
        this.metrics = this._setup_metrics();

        return this;
    }

    /* XXX This should be more dynamic. In both cases we should be
     * tracking the relevant source of information. */
    _setup_address (opts) {
        const fp = this.app.fplus;

        const resolver =
            opts.address ? rx.of(Address.parse(opts.address))
            : opts.node ? fp.ConfigDB
                .get_config(UUIDs.App.SparkplugAddress, opts.node)
                .then(add => add && new Address(add.group_id, add.node_id))
            : opts.device ? fp.Directory.get_device_address(opts.device)
            : null;
        if (resolver == null)
            throw new SPAppError("You must provide a device to watch");

        /* Return an endless sequence. This is for future compat when we
         * track the device's address. */
        return rx.concat(resolver, rx.NEVER).pipe(
            /* Ensure new subscribers see the last address. This uses
             * shareReplay for the moment, as we never update the
             * address. When we do it should use rxx.shareLatest. */
            rx.shareReplay(1),
        );
    }

    _setup_packets () {
        return this.address.pipe(
            rx.tap(addr => this.log("Watching %s", addr)),
            rx.switchMap(addr => this.app.watch_address(addr)),
            rx.share({
                resetOnRefCountZero:    () => rx.timer(5000),
            }),
        );
    }

    _setup_births (opts) {
        const timeout = opts?.timeout ?? 5*60*1000;
        const rebirth = opts?.interval ?? 2000;

        /* XXX We map aliases to strings here. It would be better to map
         * to BigInts, or to have the protobuf decoder decode to BigInts
         * in the first place, but the only way to convert Longs to
         * BigInts is via a string. */
        const births = this.packets.pipe(
            rx.filter(p => p.type == "BIRTH"),
            /* If we don't get a birth, rebirth and retry */
            rx.timeout({ first: rebirth }),
            rx.retry({ delay: e => this.rebirth() }),
            /* Timeout for whole process */
            rx.timeout({ first: timeout }),
            rx.map(birth => ({
                address:        birth.address,
                factoryplus:    birth.uuid == UUIDs.FactoryPlus,
                metrics:        new Map(
                    birth.metrics.map(m => [m.name, m])),
                aliases:        new Map(
                    birth.metrics
                        .filter(m => "alias" in m)
                        .map(m => [m.alias.toString(), m.name])),
            })),
            rxx.shareLatest(),
            rx.tap(b => this.log("Birth for %s", b.address)),
        );

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
        return this;
    }

    /* Send a rebirth request. */
    async rebirth () {
        const addr = await rx.firstValueFrom(this.address);
        this.log("Rebirthing %s", addr);
        try {
            await this.app.fplus.CmdEsc.rebirth(addr);
        }
        catch (e) {
            this.log("Error rebirthing %s: %s", addr, e);
        }
    }

    metric (tag) {
        return this.metrics.pipe(
            rx.filter(m => m.name == tag),
            rx.map(m => m.value));
    }
}


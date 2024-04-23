/*
 * ACS Edge Monitor
 * Central monitor-of-monitors class
 * Copyright 2024 AMRC
 */

import imm          from "immutable";
import rx           from "rxjs";
import { Address, UUIDs }   from "@amrc-factoryplus/service-client";
import * as rxx             from "@amrc-factoryplus/rx-util";

import { App }                      from "./uuids.js";
import { NodeMonitor, NodeSpec }    from "./monitor.js";
import { rx_rx }                    from "./util.js";

export class CentralMonitor {
    constructor (opts) {
        this.fplus  = opts.fplus;

        this.log = opts.fplus.debug.bound("central");
    }

    async init () {
        this.clusters = await this._init_clusters();

        return this;
    }

    run () {
        this.clusters.subscribe();
    }

    async _init_clusters () {
        const ClSt  = App.ClusterStatus;
        const SpAdd = UUIDs.App.SparkplugAddress;
        const cdb = this.fplus.ConfigDB;
        const cdbw = await cdb.watcher();

        /* This is a bit round-the-houses: for each cluster, we look up
         * its Sparkplug Group. Then we construct the Monitor address
         * and reverse-lookup the Monitor UUID. */
        const configs = () => rx_rx(
            cdb.list_configs(ClSt),
            rx.mergeAll(),
            rx.mergeMap(cl => cdb.get_config(SpAdd, cl)),
            rx.mergeMap(address => 
                cdb.resolve({
                    app:    SpAdd, 
                    query:  { 
                        group_id:   address.group_id,
                        node_id:    "Monitor", 
                        device_id:  undefined
                    },
                }).then(uuid => NodeSpec.of({
                    uuid,
                    address:    `${address.group_id}/Monitor`,
                    edgeAgent:  false,
                }))),
            rx.toArray(),
            rx.map(l => imm.Set(l)),
        );

        return rx_rx(
            rx.merge(cdbw.application(ClSt), rx.timer(0, 5*60*1000)),
            rx.switchMap(configs),
            rx.tap(cs => this.log("New cluster configs: %o", cs.toJS())),
            rx.distinctUntilChanged(imm.is),
            rxx.mapStartStops(spec => {
                const monitor = NodeMonitor.of(this, spec);
                this.log("Using monitor %s for %s", monitor, spec.uuid);

                /* Run the monitor checks until we get a stop */
                return rx_rx(
                    monitor.init(),
                    rx.mergeMap(m => m.checks()),
                    rx.finalize(() => this.log("STOP: %s", spec.uuid)),
                );
            }),
            rx.mergeAll(),
        );
    }
}

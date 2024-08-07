/*
 * ACS Edge Monitor
 * Central monitor-of-monitors class
 * Copyright 2024 AMRC
 */

import imm          from "immutable";
import rx           from "rxjs";

import { UUIDs }    from "@amrc-factoryplus/service-client";
import * as rxx     from "@amrc-factoryplus/rx-util";

import { App }          from "./uuids.js";
import { NodeSpec }     from "./nodespec.js";
import { rx_rx }        from "./util.js";

export class CentralMonitor {
    constructor (opts) {
        this.fplus      = opts.fplus;
        this.sparkplug  = opts.sparkplug;

        this.log = opts.fplus.debug.bound("central");
    }

    async init () {
        this.clusters = await this._init_clusters();

        return this;
    }

    run () {
        this.clusters.subscribe();
    }

    /* This is a bit round-the-houses: for each cluster, we look up its
     * Sparkplug Group. Then we construct the Monitor address and
     * reverse-lookup the Monitor UUID. We require the UUID of the edge
     * monitor Node; our Sparkplug schema depends on it. One way to
     * avoid the redundant lookups would be to use the Links API to find
     * the edge monitor rather than a well-known address; this would
     * give us a Node UUID directly. */
    fetch_configs () {
        const ClSt  = App.ClusterStatus;
        const SpAdd = UUIDs.App.SparkplugAddress;
        const cdb = this.fplus.ConfigDB;

        return rx_rx(
            cdb.list_configs(ClSt),
            rx.mergeAll(),
            rx.mergeMap(async cluster => {
                const addr = await cdb.get_config(SpAdd, cluster);
                if (!addr || addr.node_id) {
                    this.log("Can't find cluster Group for %s", cluster);
                    return null;
                }
                const monitor = await cdb.resolve({
                    app:    SpAdd, 
                    query:  { 
                        group_id:   addr.group_id,
                        node_id:    "Monitor", 
                        device_id:  undefined
                    },
                });
                if (!monitor)
                    this.log("Can't find Monitor for cluster %s", cluster);
                return monitor;
            }),
            rx.filter(uuid => !!uuid),
            rx.map(uuid => NodeSpec.of({
                uuid,
                edgeAgent:  false,
            })),
            rx.toArray(),
            rx.map(l => imm.Set(l)),
        );
    }

    async _init_clusters () {
        const ClSt  = App.ClusterStatus;
        const cdbw  = await this.fplus.ConfigDB.watcher();

        return rx_rx(
            rx.merge(cdbw.application(ClSt), rx.timer(0, 5*60*1000)),
            rx.switchMap(() => this.fetch_configs()),
            rx.distinctUntilChanged(imm.is),
            rxx.mapStartStops(spec => {
                const monitor = spec.monitor(this);

                /* Run the monitor checks until we get a stop */
                return rx_rx(
                    monitor.init(),
                    rx.mergeMap(m => m.checks()),
                    rx.finalize(() => this.log(
                        "Stopped monitor for %s", spec.uuid)),
                );
            }),
            rx.mergeAll(),
        );
    }
}

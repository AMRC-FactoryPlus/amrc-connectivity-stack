/*
 * ACS Edge Monitor
 * Central monitor-of-monitors class
 * Copyright 2024 AMRC
 */

import imm          from "immutable";
import rx           from "rxjs";

import { UUIDs }            from "@amrc-factoryplus/utilities";
import * as rxx             from "@amrc-factoryplus/rx-util";

import { App }              from "./uuids.js";
import { NodeSpec }         from "./monitor.js";

function rxp (src, ...pipe) {
    return rx.pipe(...pipe)(rx.from(src));
}

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
        this.clusters.subscribe(cs => this.log("CLUSTERS: %o", cs.toJS()));
    }

    async _init_clusters () {
        const ClSt  = App.ClusterStatus;
        const SpAdd = UUIDs.App.SparkplugAddress;
        const cdb = this.fplus.ConfigDB;
        const cdbw = await cdb.watcher();

        /* This is a bit round-the-houses: for each cluster, we look up
         * its Sparkplug Group. Then we construct the Monitor address
         * and reverse-lookup the Monitor UUID. */
        const configs = () => rxp(
            cdb.list_configs(ClSt),
            rx.mergeAll(),
            rx.mergeMap(cl => cdb.get_config(SpAdd, cl)),
            rx.mergeMap(adr => cdb.search(SpAdd, 
                { ...adr, node_id: "Monitor", device_id: undefined }, {})),
            rx.map(uuid => NodeSpec.of({ uuid, edgeAgent: false })),
            rx.toArray(),
            rx.map(l => imm.Set(l)),
        );

        return rxp(
            rx.merge(cdbw.application(ClSt), rx.interval(5*6*1000)),
            rx.switchMap(configs),
        );
    }
}

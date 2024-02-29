/*
 * Factory+ / AMRC Connectivity Stack (ACS) Git server
 * Publish repo status over MQTT
 * Copyright 2024 AMRC
 */

import imm          from "immutable";
import rx           from "rxjs";

import { UUIDs }    from "@amrc-factoryplus/utilities";
import * as rxx     from "@amrc-factoryplus/rx-util";

import { Git }      from "./uuids.js";

const Metric = imm.Record({ name: "", type: "String", value: null });
Metric.of = (name, type, value) => Metric({ name, type, value });
Metric.str = (name, value) => Metric.of(name, "String", value);
Metric.bool = (name, value) => Metric.of(name, "Boolean", value);
Metric.uuid = (name, value) => Metric.of(name, "UUID", value);

export class SparkplugNode {
    constructor (opts) {
        this.fplus  = opts.fplus;
        this.status = opts.status.status;

        this.log = this.fplus.debug.bound("sparkplug");
    }

    async init () {
        this.metrics = this._init_metrics();

        return this;
    }

    async run () {
        const { MQTT, Auth } = this.fplus;

        const ids = this.ids = await rx.firstValueFrom(
            rx.defer(() => Auth.find_principal()).pipe(
                rx.filter(ids => ids && ids.uuid && ids.sparkplug),
                rx.throwIfEmpty(),
                rx.tap({ error: e => this.log("Error finding address: %s", e) }),
                rx.retry({ delay: 5000 }),
            ));

        const cli = this.client = MQTT.basic_sparkplug_node({
            address:        ids.sparkplug,
            clientId:       ids.uuid,
            publishDeath:   true,
        });

        cli.on("connect", () => this.log("MQTT connected"));
        cli.on("error", e => this.log("MQTT error: %s", e));
        cli.on("birth", () => this.nbirth());
        cli.on("ncmd", payload => this.ncmd(payload));
        cli.on("dcmd", (device, payload) => this.dcmd(device, payload));
        
        cli.connect();

        this.metrics.pipe(rx.pairwise()).subscribe(ms => this.ndata(ms));

        return;
    }

    _init_metrics () {
        const build_metrics = status => imm.Seq().concat(
            Metric.bool(`Node Control/Rebirth`, false),
            Metric.uuid(`Schema_UUID`, Git.Schema.GitServer),
            Metric.uuid(`Instance_UUID`, this.ids.uuid),

            status.entrySeq()
                .map(([uuid, brs]) => [uuid, `Repositories/${uuid}`, brs])
                .flatMap(([uuid, prefix, branches]) => imm.Seq().concat(
                    Metric.uuid(`${prefix}/Schema_UUID`, Git.Schema.GitRepo),
                    Metric.uuid(`${prefix}/Instance_UUID`, uuid),

                    branches.entrySeq().map(([branch, sha]) => 
                        Metric.str(`${prefix}/Branches/${branch}`, sha))))
        ).toSet();

        return this.status.pipe(
            rx.map(build_metrics),
            rxx.shareLatest(),
        );
    }

    async nbirth () {
        const metrics = await rx.firstValueFrom(this.metrics);

        this.client.publishNodeBirth({
            metrics:    metrics.toArray(),
            timestamp:  Date.now(),
            uuid:       UUIDs.Special.FactoryPlus,
        });
    }

    ncmd (payload) {
        for (const m of payload.metrics) {
            switch (m.name) {
                case "Node Control/Rebirth":
                    this.nbirth();
                    break;
            }
        }
    }

    ndata ([then, now]) {
        const tnames = then.map(m => m.name);
        const nnames = now.map(m => m.name);
        if (!imm.is(tnames, nnames))
            return this.nbirth();

        const changed = now.subtract(then);
        this.client.publishNodeData({
            metrics:    changed.toArray(),
            timestamp:  Date.now(),
        });
    }
}

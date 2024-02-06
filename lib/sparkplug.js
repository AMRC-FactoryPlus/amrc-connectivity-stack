/*
 * ACS Edge Monitor
 * Monitor class
 * Copyright 2023 AMRC
 */

import rx               from "rxjs";
import * as uuid        from "uuid";

import { UUIDs }        from "@amrc-factoryplus/utilities";

import { Schema, Link, Special }    from "./uuids.js";

function instance_uuid (device, metric) {
    return uuid.v5(
        `${Special.V5Metric}:${device}:${metric}`,
        UUIDs.Special.FactoryPlus);
}

function mk_instance (device, schema, prefix) {
    const instance = instance_uuid(device, prefix);
    return [
        { name: `${prefix}/Schema_UUID`, type: "UUID", value: schema },
        { name: `${prefix}/Instance_UUID`, type: "UUID", value: instance },
    ];
}

export class SparkplugNode {
    constructor (opts) {
        this.fplus  = opts.fplus;
        this.cluster = opts.cluster;
    }

    async init () {
        const { fplus } = this;

        const ids = await this._find_ids();
        this.uuid = ids.uuid;

        const node = this.node = await this.fplus.MQTT.basic_sparkplug_node({
            address:        ids.sparkplug,
            publishDeath:   true,
        });

        node.on("birth", this.rebirth.bind(this));
        node.on("ncmd", this._ncmd.bind(this));
        node.on("dcmd", this._dcmd.bind(this));

        return this;
    }

    async run () {
        this.node.connect();
    }

    async rebirth () {
        const metrics = [
            { name: "Schema_UUID", type: "UUID", value: Schema.EdgeMonitor },
            { name: "Instance_UUID", type: "UUID", value: this.uuid },
            ...mk_instance(this.uuid, Schema.Link, "Links/Cluster"),
            { name: "Links/Cluster/Target", type: "UUID", value: this.cluster },
            { name: "Links/Cluster/Relation", type: "UUID", 
                value: Link.MonForCluster },
        ];
    
        this.node.publishNodeBirth({
            metrics,
            timestamp:  Date.now(),
            uuid:       UUIDs.Special.FactoryPlus,
        });
    }

    publish (name, type, value) {
        const timestamp = Date.now();
        this.node.publishNodeData({
            metrics: [ { name, type, value, timestamp } ],
        });
    }
        
    _find_ids () {
        const auth = this.fplus.Auth;
        const ids = rx.defer(() => auth.find_principal()).pipe(
            rx.filter(ids => ids.sparkplug && ids.uuid),
            rx.throwIfEmpty(),
            rx.tap({ error: e => 
                this.log("Can't fetch my identity, retrying in 5s: %s", e) }),
            rx.retry({ delay: 5000 }));
        return rx.firstValueFrom(ids);
    }

    _ncmd (payload) {
        for (const m of payload.metrics) {
            switch (m.name) {
            case "Node Control/Rebirth":
                if (!m.value) break;
                this.publish(m.name, "Boolean", true);
                this.rebirth();
                break;
            default:
                this.log("Unknown NCMD %s", m.name);
            }
        }
    }

    _dcmd (device, payload) {
        for (const m of payload.metrics) {
            this.log("Unknown DCMD: %s: %s", device, m.name);
        }
    }
}


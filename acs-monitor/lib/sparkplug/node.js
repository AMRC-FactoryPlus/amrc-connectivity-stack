/*
 * ACS Edge Monitor
 * Monitor class
 * Copyright 2023 AMRC
 */

import rx               from "rxjs";

import { UUIDs }        from "@amrc-factoryplus/service-client";

import { Schema, Link }             from "../uuids.js";
import { SparkplugDevice }          from "./device.js";
import { mk_instance }              from "./util.js";

export class SparkplugNode {
    constructor (opts) {
        this.fplus  = opts.fplus;
        this.cluster = opts.cluster;

        this.log = opts.fplus.debug.bound("spnode");

        this.devices = new Map();
        this.dev_subs = new Map();
    }

    async init () {
        const ids = await this._find_ids();
        this.uuid = ids.uuid;

        const splug = this.splug = await this.fplus.MQTT.basic_sparkplug_node({
            address:        ids.sparkplug,
            publishDeath:   true,
            /* XXX workaround for js-service-client bug */
            debug:          this.fplus.debug,
        });

        splug.on("birth", this.rebirth.bind(this));
        splug.on("ncmd", this._ncmd.bind(this));
        splug.on("dcmd", this._dcmd.bind(this));

        return this;
    }

    async run () {
        await this.splug.connect();
    }

    async rebirth () {
        const metrics = [
            { name: "Node Control/Rebirth", type: "Boolean", value: false },
            { name: "Schema_UUID", type: "UUID", value: Schema.EdgeMonitor },
            { name: "Instance_UUID", type: "UUID", value: this.uuid },
        ];

        if (this.cluster)
            metrics.push(
                ...mk_instance(this.uuid, Schema.Link, "Links/Cluster"),
                { name: "Links/Cluster/Target", type: "UUID",
                    value: this.cluster },
                { name: "Links/Cluster/Relation", type: "UUID", 
                    value: Link.ClusterMonitor },
            );
    
        this.splug.publishNodeBirth({
            metrics,
            timestamp:  Date.now(),
            uuid:       UUIDs.Special.FactoryPlus,
        });

        for (const dev of this.devices.values()) {
            dev.birth();
        }
    }


    publish (name, type, value) {
        const timestamp = Date.now();
        this.splug.publishNodeData({
            metrics: [ { name, type, value, timestamp } ],
        });
    }

    add_device (monitor) {
        const uuid = monitor.node;
        this.log("Adding Device %s", uuid);
        const device = new SparkplugDevice({
            fplus:      this.fplus,
            splug:      this.splug,
            uuid:       uuid,
            monitor:    monitor,
            find_name:  this.cluster ? a => a.node : a => a.group,
        });
        this.devices.set(uuid, device);
        device.start();

    }

    remove_device (monitor) {
        const uuid = monitor.node;
        this.log("Removing Device %s", uuid);
        this.devices.get(uuid)?.stop();
        this.devices.delete(uuid);
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
        const dev = [...this.devices.values()]
            .find(d => d.name == device);
        if (dev)
            dev.dcmd(payload);
        else
            this.log("DCMD for unknown device %s", device);
    }
}


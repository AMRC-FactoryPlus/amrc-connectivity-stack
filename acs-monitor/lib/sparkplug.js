/*
 * ACS Edge Monitor
 * Monitor class
 * Copyright 2023 AMRC
 */

import rx               from "rxjs";
import * as uuid        from "uuid";

import { UUIDs }        from "@amrc-factoryplus/service-client";

import { Alert, Schema, Link, Special }
                        from "./uuids.js";

function fp_v5_uuid (...args) {
    return uuid.v5(args.join(":"), UUIDs.Special.FactoryPlus);
}

function mk_instance (device, schema, prefix) {
    const instance = fp_v5_uuid(Special.V5Metric, device, prefix);
    return [
        { name: `${prefix}/Schema_UUID`, type: "UUID", value: schema },
        { name: `${prefix}/Instance_UUID`, type: "UUID", value: instance },
    ];
}

class SparkplugDevice {
    constructor (opts) {
        this.fplus      = opts.fplus;
        this.node       = opts.node;
        this.uuid       = opts.uuid;
        this.monitor    = opts.monitor;

        this.log        = this.fplus.debug.bound("spdev");
        this.sub        = new rx.Subscription();
        this.name       = null;
    }

    start () {
        const { monitor, sub } = this;

        sub.add(monitor.device.address
            .pipe(rx.distinctUntilChanged())
            .subscribe(async a => {
                if (this.name)
                    await this.death();
                this.name = a.node;
                await this.birth();
            }));
        sub.add(monitor.offline
            .pipe(rx.distinctUntilChanged())
            .subscribe(b => this.publish_offline(b)));
    }

    stop () {
        this.sub.unsubscribe();
        this.death();
    }

    check_name (typ) {
        if (!this.name) {
            this.log("Unable to publish %s for %s, I have no name", 
                typ, this.uuid);
            return false;
        }
        return true;
    }

    async birth () {
        if (!this.check_name("BIRTH")) return;

        const { monitor, uuid } = this;

        const device = fp_v5_uuid(Special.V5Monitor, uuid);
        const offline = await rx.firstValueFrom(monitor.offline);

        const mk_link = (name, relation, target) => [
            ...mk_instance(device, Schema.Link, name),
            { name: `${name}/Target`, type: "UUID", value: target },
            { name: `${name}/Relation`, type: "UUID", value: relation },
        ];
        const mk_alert = (name, type, value) => {
            return [
                ...mk_instance(device, Schema.Alert, name),
                { name: `${name}/Type`, type: "UUID", value: type },
                { name: `${name}/Active`, type: "Boolean", value: value },
                ...mk_link(`${name}/Links/Node`, Link.DeviceMonitor, uuid),
            ];
        };

        const metrics = [
            { name: "Schema_UUID", type: "UUID",
                value: Schema.EdgeMonitorDevice },
            { name: "Instance_UUID", type: "UUID", value: device },
            ...mk_link("Links/Node", Link.DeviceMonitor, uuid),
            ...mk_alert("Alerts/Offline", Alert.Offline, offline),
        ];

        this.node.publishDeviceBirth(this.name, {
            metrics,
            timestamp:  Date.now(),
            uuid:       UUIDs.Special.FactoryPlus,
        });
    }

    async publish_offline (offline) {
        if (!this.check_name("DATA")) return;

        const timestamp = Date.now();

        this.node.publishDeviceData(this.name, {
            metrics: [
                { name: "Alerts/Offline/Active", type: "Boolean", 
                    value: offline },
            ],
            timestamp,
        });
    }

    death () {
        if (!this.check_name("DEATH")) return;

        this.node.publishDeviceDeath(this.name, { timestamp: Date.now() });
    }
}

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
                value: Link.ClusterMonitor },
        ];
    
        this.node.publishNodeBirth({
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
        this.node.publishNodeData({
            metrics: [ { name, type, value, timestamp } ],
        });
    }

    add_device (monitor) {
        const uuid = monitor.node;
        this.log("Adding Device %s", uuid);
        const device = new SparkplugDevice({
            fplus:      this.fplus,
            node:       this.node,
            uuid:       uuid,
            monitor:    monitor,
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
        for (const m of payload.metrics) {
            this.log("Unknown DCMD: %s: %s", device, m.name);
        }
    }
}


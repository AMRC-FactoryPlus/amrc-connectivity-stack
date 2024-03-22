/*
 * ACS Edge Monitor
 * Monitor class
 * Copyright 2023 AMRC
 */

import rx               from "rxjs";
import * as uuid        from "uuid";

import { UUIDs }        from "@amrc-factoryplus/utilities";

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

export class SparkplugNode {
    constructor (opts) {
        this.fplus  = opts.fplus;
        this.cluster = opts.cluster;

        this.log = opts.fplus.debug.bound("spnode");

        this.devices = new Map();
        this.alert_subs = new Map();
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

        for (const uuid of this.devices.keys()) {
            this.rebirth_device(uuid);
        }
    }

    async rebirth_device (uuid) {
        const device = fp_v5_uuid(Special.V5Monitor, uuid);
        const monitor = this.devices.get(uuid);

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
                ...mk_link(`${name}/Links/Node`, type, uuid),
            ];
        };

        const metrics = [
            { name: "Schema_UUID", type: "UUID",
                value: Schema.EdgeMonitorDevice },
            { name: "Instance_UUID", type: "UUID", value: device },
            ...mk_link("Links/Node", Link.DeviceMonitor, uuid),
            ...mk_alert("Alerts/Offline", Alert.Offline, offline),
        ];

        this.node.publishDeviceBirth(uuid, {
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

    publish_device_alert (device, offline) {
        const timestamp = Date.now();
        this.node.publishDeviceData(device, {
            metrics: [
                { name: "Alerts/Offline/Active", type: "Boolean", 
                    value: offline },
            ],
            timestamp,
        });
    }

    add_device (monitor) {
        const uuid = monitor.node;
        this.log("Adding Device %s", uuid);
        this.devices.set(uuid, monitor);
        this.rebirth_device(uuid);

        this.alert_subs.set(uuid,
            monitor.offline.pipe(rx.distinctUntilChanged())
                .subscribe(b => this.publish_device_alert(uuid, b)));
    }

    remove_device (monitor) {
        const uuid = monitor.node;
        this.log("Removing Device %s", uuid);
        this.alert_subs.get(uuid)?.unsubscribe();
        this.alert_subs.delete(uuid);
        this.node.publishDeviceDeath(uuid, { timestamp: Date.now() });
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


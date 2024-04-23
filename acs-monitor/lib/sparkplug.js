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
        this.splug      = opts.splug;
        this.uuid       = opts.uuid;
        this.monitor    = opts.monitor;
        this.find_name  = opts.find_name;

        this.log        = this.fplus.debug.bound("spdev");
        this.sub        = new rx.Subscription();
        this.name       = null;
    }

    start () {
        const { monitor, sub } = this;

        sub.add(monitor.device.address
            .pipe(rx.distinctUntilChanged())
            .subscribe(async a => {
                await this.death();
                await this.birth(this.find_name(a));
            }));
        sub.add(monitor.offline
            .pipe(rx.distinctUntilChanged())
            .subscribe(b => this.publish_offline(b)));
    }

    stop () {
        this.sub.unsubscribe();
        this.death();
    }

    async dcmd (payload) {
        for (const m of payload.metrics) {
            switch (m.name) {
            case "Device Control/Rebirth":
                if (!m.value) break;
                await this.publish(m.name, "Boolean", true);
                this.birth();
                break;
            default:
                this.log("Unknown DCMD %s for %s", m.name, this.name);
            }
        }
    }

    async birth (name) {
        name ??= this.name;
        if (!name) return;

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
            { name: "Device Control/Rebirth", type: "Boolean", value: false },
            { name: "Schema_UUID", type: "UUID",
                value: Schema.EdgeMonitorDevice },
            { name: "Instance_UUID", type: "UUID", value: device },
            ...mk_link("Links/Node", Link.DeviceMonitor, uuid),
            ...mk_alert("Alerts/Offline", Alert.Offline, offline),
        ];

        this.splug.publishDeviceBirth(name, {
            metrics,
            timestamp:  Date.now(),
            uuid:       UUIDs.Special.FactoryPlus,
        });
        this.name = name;
    }

    async publish (name, type, value) {
        if (!this.name) return;

        const timestamp = Date.now();

        this.splug.publishDeviceData(this.name, {
            metrics:    [ { name, type, value } ],
            timestamp,
        });
    }

    publish_offline (offline) {
        return this.publish("Alerts/Offline/Active", "Boolean", offline);
    }

    death () {
        if (!this.name) return;

        const name = this.name;
        this.name = null;
        this.splug.publishDeviceDeath(name, { timestamp: Date.now() });
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
        this.splug.connect();
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


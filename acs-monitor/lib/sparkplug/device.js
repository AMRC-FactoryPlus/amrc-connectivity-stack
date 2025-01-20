/*
 * ACS Monitor
 * Sparkplug Device class
 * Copyright 2024 AMRC
 */

import * as rx      from "rxjs";

import { UUIDs }        from "@amrc-factoryplus/service-client";

import { Alert, Schema, Link, Special }     from "../uuids.js";
import { fp_v5_uuid, mk_instance }          from "./util.js";

export class SparkplugDevice {
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

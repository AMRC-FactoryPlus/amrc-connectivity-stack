/*
 * ACS Briefcase exporter
 * Publish the release state of every dataset to the UNS
 * Copyright 2026 University of Sheffield
 */

import * as rx          from "rxjs";

import { UUIDs }        from "@amrc-factoryplus/rx-client";

import { App, Class, Schema } from "./constants.js";
import { defined, watch_members } from "./util.js";

/** How far back a device list request to Data Access looks. Data
 * Access lists every device in the dataset whatever the window, but
 * it needs one. */
const DEVICE_WINDOW = 60 * 60 * 1000;

/** The release state of a dataset, from its Briefcase release entry.
 *
 * `state` comes from the newest briefcase: `released` while it is
 * live, `withdrawn` once it has been withdrawn, and `unreleased` if
 * there is none. `at` is when that state began and `built` when the
 * newest briefcase was built. An unreleased dataset has neither, as
 * nothing records when it was made.
 */
export function release_state (entry) {
    const last = entry?.briefcases?.at(-1);
    if (!last) return { state: "unreleased" };
    return defined({
        state:      last.withdrawn ? "withdrawn" : "released",
        at:         last.withdrawn ?? last.built,
        briefcase:  last.uuid,
        built:      last.built,
        tier:       last.tier,
    });
}

/** The ISA-95 enterprise in a device's Device Information config, as
 * the UNS ingester puts it in the device's topics. Null if there is
 * none, or if it can't be a single MQTT topic level. */
export function enterprise_of (info) {
    const name = info?.originMap?.Device_Information
        ?.ISA95_Hierarchy?.Enterprise?.Value;
    return typeof name == "string" && name != "" && !/[/+#\0]/.test(name)
        ? name : null;
}

/** The UNS messages that publish a dataset's release state under one
 * enterprise. The user properties match the UNS ingester's for a
 * metric at the top of its object.
 *
 * @param opts.enterprise The ISA-95 enterprise to publish under.
 * @param opts.dataset The dataset UUID.
 * @param opts.state The dataset's state, from `release_state`, or
 * `{ state: "deleted" }`.
 * @param opts.now The time to give a state with no recorded time, as
 * an ISO 8601 string.
 * @returns A list of `{ topic, payload, properties }`.
 */
export function release_messages ({ enterprise, dataset, state, now }) {
    const prefix = `UNS/v1/${enterprise}/Datasets/${dataset}/Release`;
    const properties = {
        InstanceUUID:       dataset,
        SchemaUUID:         Schema.DatasetRelease,
        Type:               "String",
        Unit:               "",
        Transient:          "false",
        InstanceUUIDPath:   `${dataset}:${dataset}`,
        SchemaUUIDPath:     `${Schema.DatasetRelease}:${Schema.DatasetRelease}`,
    };
    const message = (name, value, timestamp) => ({
        topic:      `${prefix}/${name}`,
        payload:    JSON.stringify({ timestamp, value }),
        properties,
    });

    return [
        message("State", state.state, state.at ?? now),
        state.briefcase && message("Briefcase", state.briefcase, state.built),
        state.tier && message("Tier", state.tier, state.built),
    ].filter(m => m);
}

export class UNSPublisher {
    constructor (opts) {
        this.fplus = opts.fplus;
        this.cdb = opts.fplus.ConfigDB;
        this.da = opts.fplus.DataAccess;
        this.log = opts.fplus.debug.bound("uns");

        /* The enterprise for a dataset none of whose devices has one. */
        this.fallback = opts.enterprise;
        this.retry = opts.retry ?? 5 * 60 * 1000;
        this.now = opts.now ?? Date.now;
        this.schedule = opts.schedule ?? setTimeout;
        this.mqtt = opts.mqtt;

        /* The current state of every dataset. */
        this.states = null;
        /* What each dataset was last published as: its state as JSON,
         * and the enterprises it went under. A dataset that leaves the
         * Dataset class is published as deleted under the same ones. */
        this.published = new Map();

        this.running = false;
        this.again = false;
    }

    /** A sequence of Maps from each dataset's UUID to its release
     * state, emitted each time a state changes. Nothing is emitted
     * until both the Dataset class and the Briefcase release entries
     * can be read. */
    watch_states () {
        return rx.combineLatest([
            watch_members({
                cdb: this.cdb, klass: Class.Dataset,
                log: this.log, delay: this.retry,
            }),
            this.cdb.search_app(App.BriefcaseRelease),
        ]).pipe(
            rx.map(([datasets, releases]) => new Map(
                datasets.toArray().map(ds =>
                    [ds, release_state(releases.get(ds))]))),
            rx.distinctUntilChanged((a, b) =>
                JSON.stringify([...a]) == JSON.stringify([...b])));
    }

    update (states) {
        this.states = states;
    }

    async client () {
        this.mqtt ??= await this.fplus.MQTT.mqtt_client({});
        if (!this.mqtt)
            throw new Error("Can't find the MQTT broker");
        return this.mqtt;
    }

    /** The UUIDs of a dataset's devices, from Data Access. A dataset
     * Data Access can't resolve, such as an invalid one, or one with
     * more devices than it will list, has none. */
    async devices (dataset) {
        const to = this.now();
        try {
            const res = await this.da.series({
                dataset,
                from:   new Date(to - DEVICE_WINDOW).toISOString(),
                to:     new Date(to).toISOString(),
            });
            return Object.keys(res.devices ?? {});
        }
        catch (e) {
            if (e.status != 404 && e.status != 413) throw e;
            this.log("Can't list the devices of %s: %s", dataset, e.message);
            return [];
        }
    }

    /** The ISA-95 enterprises of a dataset's devices, sorted, or the
     * fallback enterprise if none of them has one.
     * @param infos A Map caching Device Information configs. */
    async enterprises (dataset, infos) {
        const names = new Set();
        for (const device of await this.devices(dataset)) {
            if (!infos.has(device))
                infos.set(device, await this.cdb.get_config(
                    UUIDs.App.DeviceInformation, device));
            const name = enterprise_of(infos.get(device));
            if (name) names.add(name);
        }
        return names.size ? [...names].sort() : [this.fallback];
    }

    async publish (dataset, state, enterprises, now) {
        const mqtt = await this.client();
        for (const enterprise of enterprises)
            for (const m of release_messages({ enterprise, dataset, state, now }))
                await mqtt.publishAsync(m.topic, m.payload, {
                    qos:        1,
                    retain:     false,
                    properties: { userProperties: m.properties },
                });
        this.log("Published %s as %s under %s",
            dataset, state.state, enterprises.join(", "));
    }

    /** Publish every dataset whose state has changed since it was last
     * published, and every dataset that has been deleted. Failures are
     * logged and retried later. */
    async pass () {
        const states = this.states;
        if (!states) return;

        const now = new Date(this.now()).toISOString();
        const infos = new Map();
        let failed = false;

        for (const [dataset, state] of states) {
            const json = JSON.stringify(state);
            if (this.published.get(dataset)?.json == json) continue;
            try {
                const enterprises = await this.enterprises(dataset, infos);
                await this.publish(dataset, state, enterprises, now);
                this.published.set(dataset, { json, enterprises });
            }
            catch (e) {
                failed = true;
                this.log("Can't publish %s: %s", dataset, e.message ?? e);
            }
        }

        for (const [dataset, { enterprises }] of this.published) {
            if (states.has(dataset)) continue;
            try {
                await this.publish(dataset, { state: "deleted" }, enterprises, now);
                this.published.delete(dataset);
            }
            catch (e) {
                failed = true;
                this.log("Can't publish %s as deleted: %s", dataset, e.message ?? e);
            }
        }

        if (failed) {
            this.log("Retrying in %ds", this.retry / 1000);
            this.schedule(() => this.poke(), this.retry);
        }
    }

    /** Start a pass, or another one after the pass already running. */
    poke () {
        if (this.running) {
            this.again = true;
            return;
        }
        this.running = true;
        this.pass()
            .catch(e => this.log("Pass failed: %s", e))
            .finally(() => {
                this.running = false;
                if (this.again) {
                    this.again = false;
                    this.poke();
                }
            });
    }

    run () {
        this.log("Publishing dataset states to the UNS, falling back to %s",
            this.fallback);
        this.watch_states().subscribe(s => {
            this.update(s);
            this.poke();
        });
    }
}

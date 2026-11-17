/*
 * ACS service setup
 * Move connections between internal drivers and their split drivers
 * Copyright 2026 University of Sheffield AMRC
 *
 * The REST, MQTT and OPC UA drivers are moving out of the Edge Agent
 * into split drivers, which run as sidecars. Each split driver has
 * its own DriverDef, so a site moves one protocol at a time, and can
 * move it back, by setting `serviceSetup.config.splitDrivers` in the
 * chart values:
 *
 *   splitDrivers:
 *     REST:   true     # move REST connections to the split driver
 *     OPCUA:  false    # move OPC UA connections back to the Edge Agent
 *     dryRun: true     # log what would change and write nothing
 *
 * A protocol that is not named is left alone, so by default nothing
 * moves. For each connection of a named protocol this rewrites:
 *
 *  - its Edge Agent config entry: `connType`, the details key and,
 *    where the protocol needs it, the payload format;
 *  - `values.drivers.<name>` in its Edge Agent Deployment, so the
 *    sidecar and its password are rendered, or removed on the way
 *    back;
 *  - its ConnectionConfiguration: `driver` and the payload format.
 *
 * The ConnectionConfiguration is written last. A connection still on
 * the old driver is moved again on the next run, and every rewrite
 * gives the same result twice, so a run that fails half way is
 * finished by the next. A second run finds nothing to do.
 *
 * The entry and the deployment values are built with the same
 * functions the admin UI uses when a connection is saved, so a later
 * save gives the same config.
 */

import {
    ServiceError, UUIDs,
    driver_values, move_connection, move_entry, move_payload_format,
} from "@amrc-factoryplus/service-client";

import { ACS, Edge } from "./uuids.js";

const { App } = UUIDs;
const { Driver } = ACS;

/* What each protocol moves between, and how the payload format
 * changes. Built-in OPC UA hands the Edge Agent decoded values, which
 * only "Defined by Protocol" reads; the split driver sends
 * `{"value", "timestamp"}` JSON per address, as edge-sim does. MQTT
 * and REST pass the device's bytes through unchanged. */
export const SplitDrivers = {
    REST:   {
        internal:       Driver.REST,
        split:          Driver.RESTSplit,
        payloadFormat:  {},
    },
    MQTT:   {
        internal:       Driver.MQTT,
        split:          Driver.MQTTSplit,
        payloadFormat:  {},
    },
    OPCUA:  {
        internal:       Driver.OPCUA,
        split:          Driver.OPCUASplit,
        payloadFormat:  { "Defined by Protocol": "JSON" },
    },
};

/* How many times to rebuild a config someone else saved first. */
const ATTEMPTS = 3;

/** Compare two JSON values. */
function same (a, b) {
    return JSON.stringify(a) == JSON.stringify(b);
}

export class MigrateSplitDrivers {
    constructor (opts) {
        this.cdb = opts.fplus.ConfigDB;
        this.log = opts.log ?? opts.fplus.debug.bound("split-drivers");

        const settings = opts.settings ?? {};
        this.dry_run = !!settings.dryRun;
        this.wanted = Object.keys(SplitDrivers)
            .filter(p => typeof settings[p] == "boolean")
            .map(p => [p, settings[p]]);
    }

    async run () {
        const count = { moved: 0, repaired: 0, unchanged: 0, failed: 0 };

        if (!this.wanted.length) {
            this.log("No split driver moves requested");
            return count;
        }
        if (this.dry_run)
            this.log("Dry run: logging what would change, writing nothing");

        const { cdb } = this;
        this.cconfs = await cdb.get_all_configs(App.ConnectionConfiguration);
        this.drivers = await cdb.get_all_configs(App.DriverDefinition);

        for (const [name, to_split] of this.wanted) {
            const proto = SplitDrivers[name];
            const [from, to] = to_split
                ? [proto.internal, proto.split]
                : [proto.split, proto.internal];

            const from_def = this.drivers.get(from);
            const to_def = this.drivers.get(to);
            if (!from_def || !to_def) {
                this.log("%s: DriverDef %s missing; not moving", name,
                    from_def ? to : from);
                continue;
            }
            if (to_split && !to_def.image) {
                this.log("%s: split DriverDef %s has no image; not moving", name, to);
                continue;
            }

            this.log("%s: moving connections to the %s driver", name,
                to_split ? "split" : "internal");

            for (const [conn, cconf] of this.cconfs) {
                if (cconf.driver != from && cconf.driver != to)
                    continue;
                try {
                    const how = await this.move(conn, cconf, proto, to_split, to_def);
                    count[how]++;
                }
                catch (e) {
                    this.log("%s: can't move connection %s: %s", name, conn, e);
                    count.failed++;
                }
            }
        }

        this.log("Split drivers: %d connections %s, %d repaired, %d already right, %d failed",
            count.moved, this.dry_run ? "would move" : "moved",
            count.repaired, count.unchanged, count.failed);
        return count;
    }

    /* Move one connection. A connection already on the new driver is
     * still checked, which finishes a move a failed run left half
     * done. Its payload format is left as it is. */
    async move (conn, cconf, proto, to_split, to_def) {
        const moving = cconf.driver != (to_split ? proto.split : proto.internal);
        const next = moving ? move_connection(cconf, proto, to_split) : cconf;
        const original = cconf.splitMigration?.payloadFormat;
        const format = moving
            ? f => move_payload_format(f, proto.payloadFormat, to_split, original)
            : f => f;

        const agent = cconf.edgeAgent;
        let changed = false;
        if (agent) {
            const entry = await this.update_config(conn, agent, to_def, format, cconf.config);
            /* A connection with no entry has no devices. The admin UI
             * gives it no driver values either. */
            if (entry) {
                const dep = await this.update_deployment(agent, entry.name,
                    driver_values(next, to_def));
                changed = entry.changed || dep;
            }
        }

        if (moving) {
            this.log("Connection %s: driver %s to %s, payload format %o to %o",
                conn, cconf.driver, next.driver,
                cconf.source?.payloadFormat, next.source?.payloadFormat);
            if (!this.dry_run)
                await this.cdb.put_config(App.ConnectionConfiguration, conn, next);
            return "moved";
        }
        return changed ? "repaired" : "unchanged";
    }

    /* Read, change and write a config with If-Match, rebuilding if
     * someone else saved it first. `change` returns the new config,
     * or undefined to leave it. */
    async rewrite (app, obj, change) {
        for (let i = 1; ; i++) {
            const [config, etag] = await this.cdb.get_config_with_etag(app, obj);
            const next = change(config);
            if (next === undefined) return false;
            if (this.dry_run) return true;
            try {
                await this.cdb.put_config(app, obj, next, etag ? { etag } : undefined);
                return true;
            }
            catch (e) {
                const stale = e instanceof ServiceError && e.status == 412;
                if (!stale || i >= ATTEMPTS) throw e;
                this.log("Config %s of %s changed under us; rebuilding", app, obj);
            }
        }
    }

    /* Rewrite the connection's Edge Agent config entry. Returns
     * `{ name, changed }`, or undefined if the agent has no entry for
     * the connection. */
    async update_config (conn, agent, to_def, format, fallback) {
        let name;
        const changed = await this.rewrite(App.EdgeAgentConfig, agent, config => {
            const conns = config?.deviceConnections ?? [];
            const i = conns.findIndex(c => c.uuid == conn);
            name = conns[i]?.name;
            if (i < 0) return;

            const next = move_entry(conns[i], to_def, format, fallback);
            if (same(next, conns[i])) return;

            this.log("Agent %s, connection %s: connType %s to %s, payload formats %o to %o",
                agent, name, conns[i].connType, next.connType,
                formats(conns[i]), formats(next));
            const out = structuredClone(config);
            out.deviceConnections[i] = next;
            return out;
        });
        if (name === undefined) return;
        return { name, changed };
    }

    /* Set or remove the connection's sidecar in the deployment. */
    async update_deployment (agent, name, values) {
        return await this.rewrite(Edge.App.Deployment, agent, deployment => {
            /* Never create a Deployment: the Manager does that when
             * someone asks it to. */
            if (!deployment) return;

            const current = deployment.values?.drivers?.[name];
            if (same(current, values)) return;

            this.log("Agent %s: values.drivers.%s %s", agent, name,
                values ? `set to image ${values.image?.repository}` : "removed");

            const out = structuredClone(deployment);
            const drivers = (out.values ??= {}).drivers ??= {};
            if (values) drivers[name] = values;
            else delete drivers[name];
            return out;
        });
    }
}

/* The distinct payload formats of a connection entry, for logging. */
function formats (entry) {
    return [...new Set([entry.payloadFormat,
        ...(entry.devices ?? []).map(d => d.payloadFormat)])];
}

export function migrate_split_drivers (ss) {
    return new MigrateSplitDrivers({
        fplus:      ss.fplus,
        settings:   ss.config?.splitDrivers,
    }).run();
}

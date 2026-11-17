/*
 * ACS service setup
 * Move connections between internal drivers and their split drivers
 * Copyright 2026 University of Sheffield AMRC
 *
 * The REST, MQTT, OPC UA and UDP drivers are moving out of the Edge Agent
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
 * A protocol that is not named, or is null, is left alone. The chart
 * sets `REST: true`, `OPCUA: true` and `UDP: true`, so those
 * connections move on upgrade unless a site sets them to `false` or
 * `null`; MQTT doesn't move unless a site asks. For each connection of
 * a named protocol this rewrites:
 *
 *  - its Edge Agent config entry: `connType`, the details key and,
 *    where the protocol needs it, the payload format, and its metric
 *    paths where the split DriverDef has `metricPaths: false` (OPC
 *    UA's built-in connection never read them; the driver's data
 *    would be read through them);
 *  - `values.drivers.<id>` in its Edge Agent Deployment, so the
 *    sidecar and its password are rendered, or removed on the way
 *    back. The id is the connection's driver id, which is its name
 *    unless that can't be an id (see `driver_ids`);
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
 *
 * A split driver can open a port on the host its Edge Agent runs on
 * (`hostPorts` in its DriverDef: UDP does), and a host can open each
 * port once. A connection is not moved to such a driver when a
 * connection that can run on the same host already has its port, by
 * the same rule the admin UI checks on save (`port_clashes`); it stays
 * on the internal driver and the log names the other connection. The
 * built-in UDP connection only allowed port 50205, so this matters.
 *
 * Before any move, and whether or not a move is asked for, every split
 * driver connection whose name can't be its driver id is given a
 * `driverId` in its Edge Agent config, and its `values.drivers` entry
 * is moved from its name to that id. A name with a dot never worked as
 * a split driver, and one with an underscore or a space never
 * deployed, so this changes nothing that was running. An agent whose
 * names all work as ids is not written.
 */

import {
    ServiceError, UUIDs,
    driver_id, driver_ports, driver_values, move_connection, move_entry,
    move_payload_format, port_clashes, set_driver_ids,
} from "@amrc-factoryplus/service-client";

import { ACS, Edge } from "./uuids.js";

const { App } = UUIDs;
const { Driver } = ACS;

/* What each protocol moves between, and how the payload format
 * changes. Built-in OPC UA hands the Edge Agent decoded values, which
 * only "Defined by Protocol" reads; the split driver sends
 * `{"value", "timestamp"}` JSON per address, as edge-sim does. MQTT,
 * REST and UDP pass the device's bytes through unchanged. */
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
    UDP:    {
        internal:       Driver.UDP,
        split:          Driver.UDPSplit,
        payloadFormat:  {},
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
        const count = { moved: 0, repaired: 0, unchanged: 0, failed: 0, held: 0 };

        if (this.dry_run)
            this.log("Dry run: logging what would change, writing nothing");

        count.ids = await this.repair_driver_ids();

        if (!this.wanted.length) {
            this.log("No split driver moves requested");
            return count;
        }

        const { cdb } = this;
        this.cconfs = await cdb.get_all_configs(App.ConnectionConfiguration);
        this.drivers = await cdb.get_all_configs(App.DriverDefinition);
        this.deployments = await cdb.get_all_configs(Edge.App.Deployment);
        this.host_ports = this.open_ports();

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

        this.log("Split drivers: %d connections %s, %d repaired, %d already right, %d held back, %d failed",
            count.moved, this.dry_run ? "would move" : "moved",
            count.repaired, count.unchanged, count.held, count.failed);
        return count;
    }

    /* The host ports each connection opens now, as `port_clashes`
     * takes them, keyed by connection. */
    open_ports () {
        const open = new Map();
        for (const [conn, cconf] of this.cconfs) {
            const ports = driver_ports(cconf, this.drivers.get(cconf.driver));
            if (ports.length) open.set(conn, this.placed(conn, cconf, ports));
        }
        return open;
    }

    /* A connection's host ports as `port_clashes` takes them, with
     * where it runs: its Edge Agent's cluster and the host the agent is
     * pinned to, from the agent's Deployment, as the Manager reads them
     * (acs-admin/src/utils/hostPorts.js). A connection's own `topology`
     * copy was written empty for a long time, so it is used only for an
     * agent with no Deployment. */
    placed (conn, cconf, ports) {
        const deployment = this.deployments.get(cconf.edgeAgent);
        const where = deployment ?? cconf.topology ?? {};
        const host = where.hostname;
        return {
            name:       conn,
            cluster:    where.cluster,
            hostname:   host && host != "Floating" ? host : undefined,
            ports,
        };
    }

    /* A connection whose host ports another connection that can run on
     * the same host has open, as `{ protocol, port, names }`, or
     * undefined. */
    port_clash (conn, cconf, ports) {
        const me = this.placed(conn, cconf, ports);
        for (const [other, theirs] of this.host_ports) {
            if (other == conn) continue;
            const [clash] = port_clashes([me, theirs]);
            if (clash) return clash;
        }
    }

    /* Give the split driver connections of every agent their driver
     * ids, and key their deployment values by them. Returns how many
     * agents changed. */
    async repair_driver_ids () {
        const agents = await this.cdb.get_all_configs(App.EdgeAgentConfig);
        let fixed = 0;

        for (const agent of agents.keys()) {
            try {
                if (await this.repair_agent(agent)) fixed++;
            }
            catch (e) {
                this.log("Agent %s: can't set driver ids: %s", agent, e);
            }
        }
        if (fixed)
            this.log("Driver ids: %d agents %s", fixed,
                this.dry_run ? "would change" : "changed");
        return fixed;
    }

    async repair_agent (agent) {
        /* [name, id] of each split driver whose id is not its name. */
        let renames = [];
        let ids = new Set();

        const config = await this.rewrite(App.EdgeAgentConfig, agent, config => {
            const conns = config?.deviceConnections;
            if (!Array.isArray(conns)) return;

            const out = structuredClone(config);
            set_driver_ids(out.deviceConnections);
            const split = out.deviceConnections.filter(e => e.connType == "Driver");
            ids = new Set(split.map(driver_id));
            renames = split
                .filter(e => driver_id(e) != e.name)
                .map(e => [e.name, driver_id(e)]);
            if (same(out, config)) return;

            for (const [name, id] of renames)
                this.log("Agent %s, connection %s: driver id %s", agent, name, id);
            return out;
        });
        if (!renames.length) return config;

        const deployment = await this.rewrite(Edge.App.Deployment, agent, deployment => {
            const drivers = deployment?.values?.drivers;
            if (!drivers) return;
            const moves = renames.filter(([name]) => name in drivers && !ids.has(name));
            if (!moves.length) return;

            const out = structuredClone(deployment);
            const next = out.values.drivers;
            for (const [name, id] of moves) {
                this.log("Agent %s: values.drivers.%s moved to %s", agent, name, id);
                next[id] ??= next[name];
                delete next[name];
            }
            return out;
        });
        return config || deployment;
    }

    /* Move one connection. A connection already on the new driver is
     * still checked, which finishes a move a failed run left half
     * done. Its payload format is left as it is. */
    async move (conn, cconf, proto, to_split, to_def) {
        const moving = cconf.driver != (to_split ? proto.split : proto.internal);
        const next = moving ? move_connection(cconf, proto, to_split) : cconf;

        /* A port another connection has open on the host would stop
         * this Edge Agent, or that one, from starting. */
        const ports = driver_ports(next, to_def);
        if (moving && ports.length) {
            const clash = this.port_clash(conn, next, ports);
            if (clash) {
                this.log("Connection %s: not moving to the split driver, because "
                    + "connection %s, which can run on the same host, already opens "
                    + "%s port %s there. Give one of them another port; the next "
                    + "service-setup run then moves it.",
                    conn, clash.names[1], clash.protocol, clash.port);
                return "held";
            }
        }
        if (moving) {
            if (ports.length)
                this.host_ports.set(conn, this.placed(conn, next, ports));
            else
                this.host_ports.delete(conn);
        }
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
                const dep = await this.update_deployment(agent, entry,
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

    /* Rewrite the connection's Edge Agent config entry, and give it a
     * driver id if it is now a split driver. Returns `{ name, id,
     * changed }`, where `id` is the connection's driver id as a split
     * driver, whichever way it moved, or undefined if the agent has no
     * entry for the connection. */
    async update_config (conn, agent, to_def, format, fallback) {
        let result;
        const changed = await this.rewrite(App.EdgeAgentConfig, agent, config => {
            result = undefined;
            const conns = config?.deviceConnections ?? [];
            const i = conns.findIndex(c => c.uuid == conn);
            if (i < 0) return;

            const out = structuredClone(config);
            const entry = out.deviceConnections[i] =
                move_entry(conns[i], to_def, format, fallback);

            /* The id it has as a split driver, which keys its sidecar
             * in the deployment, even when it is moving back. */
            const probe = structuredClone(out.deviceConnections);
            probe[i].connType = "Driver";
            set_driver_ids(probe);
            result = { name: entry.name, id: driver_id(probe[i]) };

            set_driver_ids(out.deviceConnections);
            if (same(out, config)) return;

            this.log("Agent %s, connection %s: connType %s to %s, payload formats %o to %o, driver id %s",
                agent, entry.name, conns[i].connType, entry.connType,
                formats(conns[i]), formats(entry), result.id);
            return out;
        });
        if (result === undefined) return;
        return { ...result, changed };
    }

    /* Set or remove the connection's sidecar in the deployment, under
     * its driver id. An entry under its name, from before it had a
     * driver id, is removed. */
    async update_deployment (agent, entry, values) {
        const { name, id } = entry;
        return await this.rewrite(Edge.App.Deployment, agent, deployment => {
            /* Never create a Deployment: the Manager does that when
             * someone asks it to. */
            if (!deployment) return;

            const drivers = deployment.values?.drivers ?? {};
            const stale = name != id && name in drivers;
            if (same(drivers[id], values) && !stale) return;

            this.log("Agent %s: values.drivers.%s %s", agent, id,
                values ? `set to image ${values.image?.repository}` : "removed");
            if (stale)
                this.log("Agent %s: values.drivers.%s removed: the driver id is %s",
                    agent, name, id);

            const out = structuredClone(deployment);
            const next = (out.values ??= {}).drivers ??= {};
            if (stale) delete next[name];
            if (values) next[id] = values;
            else delete next[id];
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

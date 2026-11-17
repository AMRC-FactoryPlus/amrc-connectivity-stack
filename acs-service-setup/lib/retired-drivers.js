/*
 * ACS service setup
 * Warn about and tidy up drivers removed from the Edge Agent
 * Copyright 2026 University of Sheffield AMRC
 *
 * The Edge Agent no longer runs the MTConnect, S7, UDP, EtherNet/IP
 * and Websocket connection types itself. An Edge Agent given a
 * connection of one of these types logs an error and runs its other
 * connections, so the devices on it publish nothing.
 *
 * This step makes that visible from the central cluster and stops new
 * connections being made with these drivers:
 *
 *  - every connection still using a removed driver, found from its
 *    ConnectionConfiguration or from an Edge Agent config entry, is
 *    logged as a warning on every run;
 *  - a removed driver that no ConnectionConfiguration uses has its
 *    DriverDef deleted and is taken out of the Edge Agent driver
 *    class, so the admin UI stops offering it. One still in use is
 *    left alone, so its connections can still be opened and moved.
 *
 * Nothing is moved or deleted from a connection. A site keeps its
 * config, and can move it to a split driver when one exists.
 */

import { ServiceError, UUIDs } from "@amrc-factoryplus/service-client";

import { ACS } from "./uuids.js";

const { App } = UUIDs;
const { Driver } = ACS;

/* The removed drivers, by Edge Agent `connType`. EtherNet/IP and
 * Websocket never had a DriverDef, but a hand-written agent config
 * could still name them. */
export const RetiredDrivers = {
    "MTConnect":    Driver.MTConnect,
    "S7":           Driver.S7,
    "UDP":          Driver.UDP,
    "EtherNet/IP":  Driver.EtherNetIP,
    "Websocket":    Driver.Websocket,
};

export class RetiredDriverCheck {
    constructor (opts) {
        this.cdb = opts.fplus.ConfigDB;
        this.log = opts.log ?? opts.fplus.debug.bound("retired");
    }

    async run () {
        const { cdb } = this;

        const names = new Map(Object.entries(RetiredDrivers)
            .map(([t, d]) => [d, t]));

        /* Connections the admin UI knows about, by driver. */
        const cconfs = await cdb.get_all_configs(App.ConnectionConfiguration);
        const in_use = new Set();
        const warned = new Set();
        for (const [conn, cconf] of cconfs) {
            const type = names.get(cconf?.driver);
            if (!type) continue;
            in_use.add(cconf.driver);
            warned.add(conn);
            this.warn(type, conn, cconf.name, cconf.edgeAgent);
        }

        /* Connections in Edge Agent configs. This catches those
         * written by hand, with no ConnectionConfiguration. */
        const agents = await cdb.get_all_configs(App.EdgeAgentConfig);
        for (const [agent, config] of agents) {
            for (const entry of config?.deviceConnections ?? []) {
                if (!(entry?.connType in RetiredDrivers)) continue;
                if (warned.has(entry.uuid)) continue;
                warned.add(entry.uuid);
                this.warn(entry.connType, entry.uuid, entry.name, agent);
            }
        }

        const removed = [];
        for (const [type, driver] of Object.entries(RetiredDrivers)) {
            if (in_use.has(driver)) {
                this.log("Keeping the %s DriverDef while connections use it", type);
                continue;
            }
            if (await this.remove_driver(driver))
                removed.push(type);
        }

        if (warned.size)
            this.log("WARNING: %d connections use removed drivers and publish no data",
                warned.size);
        return { warned: [...warned], removed };
    }

    warn (type, conn, name, agent) {
        this.log("WARNING: connection %s (%s) on Edge Agent %s uses the %s driver, "
            + "which the Edge Agent no longer has. Its devices publish no data "
            + "until it is moved to a split driver.",
            name ?? "(unnamed)", conn, agent ?? "(none)", type);
    }

    /* Delete the DriverDef and the class membership. Returns true if
     * either was there. */
    async remove_driver (driver) {
        const { cdb } = this;
        let done = false;

        const def = await cdb.get_config(App.DriverDefinition, driver);
        if (def !== undefined) {
            this.log("Deleting DriverDef for removed driver %s", driver);
            await cdb.delete_config(App.DriverDefinition, driver)
                .catch(ServiceError.check(404));
            done = true;
        }

        const klass = UUIDs.Class.EdgeAgentDriver;
        if (await cdb.class_has_direct_member(klass, driver)) {
            this.log("Removing %s from the Edge Agent driver class", driver);
            await cdb.class_remove_member(klass, driver);
            done = true;
        }
        return done;
    }
}

export function check_retired_drivers (ss) {
    return new RetiredDriverCheck({ fplus: ss.fplus }).run();
}

/*
 * ACS service setup
 * Warn about and tidy up drivers removed from the Edge Agent
 * Copyright 2026 University of Sheffield AMRC
 *
 * The Edge Agent no longer runs the MTConnect, S7, EtherNet/IP and
 * Websocket connection types itself. (UDP was removed too, then put
 * back because it is needed: it is not retired.) An Edge Agent given a
 * connection of one of these types logs an error and runs its other
 * connections, so the devices on it publish nothing.
 *
 * This step makes that visible from the central cluster and stops new
 * connections being made with these drivers:
 *
 *  - every connection still using a removed driver, found from its
 *    ConnectionConfiguration or from an Edge Agent config entry, is
 *    logged as a warning on every run;
 *  - every removed driver's DriverDef is marked `hidden`, so the admin
 *    UI stops offering it for new connections. A connection that still
 *    uses one still shows it, so it can be opened and moved.
 *
 * A removed driver is hidden, not deleted. Its object was created by a
 * dump with the Edge Agent driver class as its primary class, and the
 * ConfigDB refuses to take an object out of its primary class (409).
 * Deleting the object would work, but object UUIDs are meant to stay
 * registered, and a class member with no DriverDef would be offered in
 * the admin UI as a driver with no form. So the DriverDef stays, with
 * `hidden: true`, and one that an earlier version of this step deleted
 * comes back as `{ hidden: true }`. Every run gives the same result.
 *
 * Nothing is moved or deleted from a connection. A site keeps its
 * config, and can move it to a split driver when one exists.
 *
 * Since ACS 7 the Edge Agent has no built-in REST, MQTT, OPC UA or UDP
 * connection either, and split-drivers.js moves those connections to
 * their split drivers. Their built-in DriverDefs are no longer loaded,
 * and are hidden here the same way. A connection that still uses one
 * (an Edge Agent that pins its own version 6 image keeps its built-in
 * connections) still shows it in the Manager.
 *
 * Nothing here may stop service-setup: a failure is logged as an ERROR
 * and the step goes on to the next driver.
 */

import { UUIDs } from "@amrc-factoryplus/service-client";

import { ACS } from "./uuids.js";

const { App } = UUIDs;
const { Driver } = ACS;

/* The removed drivers, by Edge Agent `connType`. EtherNet/IP and
 * Websocket never had a DriverDef, but a hand-written agent config
 * could still name them. */
export const RetiredDrivers = {
    "MTConnect":    Driver.MTConnect,
    "S7":           Driver.S7,
    "EtherNet/IP":  Driver.EtherNetIP,
    "Websocket":    Driver.Websocket,
};

/* The built-in drivers ACS 7 replaced with split drivers, by Edge Agent
 * `connType`. Their connections are moved, not warned about here. */
export const MovedDrivers = {
    "REST":         Driver.REST,
    "MQTT":         Driver.MQTT,
    "OPC UA":       Driver.OPCUA,
    "UDP":          Driver.UDP,
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
        const warned = new Set();
        for (const [conn, cconf] of cconfs) {
            const type = names.get(cconf?.driver);
            if (!type) continue;
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

        const hidden = [];
        const failed = [];
        const all = { ...RetiredDrivers, ...MovedDrivers };
        for (const [type, driver] of Object.entries(all)) {
            try {
                if (await this.hide_driver(type, driver))
                    hidden.push(type);
            }
            catch (e) {
                this.log("ERROR: can't hide the %s DriverDef %s: %s", type, driver, e);
                failed.push(type);
            }
        }

        if (warned.size)
            this.log("WARNING: %d connections use removed drivers and publish no data",
                warned.size);
        return { warned: [...warned], hidden, failed };
    }

    warn (type, conn, name, agent) {
        this.log("WARNING: connection %s (%s) on Edge Agent %s uses the %s driver, "
            + "which the Edge Agent no longer has. Its devices publish no data "
            + "until it is moved to a split driver.",
            name ?? "(unnamed)", conn, agent ?? "(none)", type);
    }

    /* Mark a removed driver's DriverDef hidden, writing a bare one if
     * it has none. A driver that is not in the Edge Agent driver class
     * has no object to hide (EtherNet/IP and Websocket never had one).
     * Returns true if it wrote anything. */
    async hide_driver (type, driver) {
        const { cdb } = this;

        const klass = UUIDs.Class.EdgeAgentDriver;
        if (!await cdb.class_has_direct_member(klass, driver))
            return false;

        const def = await cdb.get_config(App.DriverDefinition, driver);
        if (def?.hidden === true) return false;

        this.log("Hiding the DriverDef of removed driver %s (%s)%s", type, driver,
            def === undefined ? ", which had none" : "");
        await cdb.put_config(App.DriverDefinition, driver,
            { ...(def ?? {}), hidden: true });
        return true;
    }
}

/* Never throws: this is clean-up, and must not stop service-setup. */
export async function check_retired_drivers (ss) {
    const log = ss.fplus.debug.bound("retired");
    try {
        return await new RetiredDriverCheck({ fplus: ss.fplus, log }).run();
    }
    catch (e) {
        log("ERROR: the removed-driver check failed, carrying on: %s", e);
    }
}

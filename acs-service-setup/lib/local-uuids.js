/* ACS service setup
 * Local UUID creation
 * Copyright 2025 University of Sheffield AMRC
 */

import { UUIDs }        from "@amrc-factoryplus/service-client";

import { Clusters }     from "./uuids.js";

const { ServiceConfig } = UUIDs.App;

class LocalUUIDs {
    constructor (ss) {
        const { fplus } = ss;

        this.cdb = fplus.ConfigDB;
        this.log = fplus.debug.bound("local");
    }

    async get_conf (srv) {
        const conf = this.cdb.get_config(ServiceConfig, srv);
        this.log("Fetched existing config for %s: %o", srv, conf);
        return conf;
    }

    async put_conf (srv, conf) {
        await this.cdb.put_config(ServiceConfig, srv, conf);
        this.log("Installed new config for %s: %o", srv, conf);
    }

    async create_by_name (name, klass, ...keys) {
        const config = this.local[name] ??= {};

        for (const key of ...keys) {
            if (key in config) {
                this.log("Using existing %s %s: %s", name, key, config[key]);
                continue;
            }

            this.log("Creating %s %s", name, key);
            const uuid = await this.cdb.create_object(klass);
            this.log("Created %s %s: %s", name, key, uuid);
            config[key] = uuid;
        }
    }

    async create_objects (...specs) {
        for (const s of specs)
            await this.create_by_name(...s);
    }

    async setup_uuids () {
        /* The master list of local UUIDs lives in the app config. */
        this.local = await this.get_conf(ServiceConfig);

        await this.create_objects(
            ["Role", Auth.Class.EdgeRole,
                "EdgeAgent", "EdgeSync", "EdgeMonitor"],
            ["Chart", Clusters.Class.HelmChart,
                "EdgeAgent", "Cluster", "ModbusRest", "MQTT"],
        );

        await this.put_conf(ServiceConfig, this.local);

        /* Generate the other ServiceConfig entries from this. Probably
         * the services should just all use the master list. */
        const { local } = this;
        await this.put_conf(ACS.Service.Manager, {
            helm: {
                agent:      local.Chart.EdgeAgent,
                cluster:    local.Chart.Cluster,
            }
        });

        /* Remove redundant ServiceConfig entry. */
        await this.cdb.delete_config(ServiceConfig, Clusters.App.HelmTemplate);

        return local;
    }
}

export function setup_local_uuids (ss) {
    return new LocalUUIDs(ss).setup_uuids();
}
    

/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { ServiceError, UUIDs }         from "@amrc-factoryplus/service-client";

import { ACS, Auth, Clusters, Git }    from "./uuids.js";

const { ServiceConfig } = UUIDs.App;

class LocalUUIDs {
    constructor (ss) {
        const { fplus } = ss;

        this.cdb = fplus.ConfigDB;
        this.log = fplus.debug.bound("local");
    }

    async get_conf (srv) {
        const conf = await this.cdb.get_config(ServiceConfig, srv);
        this.log("Fetched existing config for %s: %o", srv, conf);
        return conf;
    }

    async put_conf (srv, conf) {
        await this.cdb.put_config(ServiceConfig, srv, conf);
        this.log("Installed new config for %s: %o", srv, conf);
    }

    /* XXX This method is not atomic, and it should be. If service-setup
     * fails between creating the object and recoding the new local
     * UUIDs list then we will leave behind orphaned objects. */
    async create_by_name (name, klass, ...keys) {
        const config = this.local[name] ??= {};

        for (const key of keys) {
            if (config[key]) {
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

    /* We have to check the legacy configs for migration. If we have a
     * new-style entry it overrides the old entries. */
    async fetch_local_uuids () {
        const local = await this.get_conf(ServiceConfig);
        if (local) return local;

        this.log("Fetching legacy configs for migration");
        const clusters = await this.get_conf(UUIDs.Service.Clusters);
        const helm = await this.get_conf(Clusters.App.HelmTemplate);

        return {
            Chart: {
                EdgeAgent:      helm?.helm?.agent,
                Cluster:        helm?.helm?.cluster,
                ModbusRest:     helm?.helm?.modbus,
                MQTT:           helm?.helm?.mqtt,
            },
            Repo: {
                HelmCharts:     clusters?.repo?.helm?.uuid,
            },
            RepoGroup: {
                Cluster:        clusters?.group?.cluster?.uuid,
                Shared:         clusters?.group?.shared?.uuid,
            },
            Role: {
                EdgeAgent:      helm?.group?.agent?.uuid,
                EdgeFlux:       clusters?.group?.flux?.uuid,
                EdgeKrbkeys:    clusters?.group?.krbkeys?.uuid,
                EdgeMonitor:    helm?.group?.monitor?.uuid,
                EdgeSync:       helm?.group?.sync?.uuid,
            },
        };
    }

    async put_service_configs () {
        /* Generate the other ServiceConfig entries from this. Probably
         * the services should just all use the master list. */
        const { local } = this;
        await this.put_conf(UUIDs.Service.Clusters, {
            group: {
                cluster: {
                    path: "cluster",
                    uuid: local.RepoGroup.Cluster,
                },
                flux:       { uuid: local.Role.EdgeFlux },
                krbkeys:    { uuid: local.Role.EdgeKrbkeys },
                shared:     { uuid: local.RepoGroup.Shared },
            },
            helm: { cluster: local.Chart.Cluster },
            repo: { helm: { uuid: local.Repo.HelmCharts } },
        });
        await this.put_conf(ACS.Service.Manager, {
            helm: {
                agent:      local.Chart.EdgeAgent,
                cluster:    local.Chart.Cluster,
            }
        });

        /* Remove redundant ServiceConfig entry. */
        await this.cdb.delete_config(ServiceConfig, Clusters.App.HelmTemplate)
            .catch(ServiceError.check(404));
    }

    async setup_uuids () {
        /* The master list of local UUIDs lives in the app config. */
        this.local = await this.fetch_local_uuids();

        await this.create_objects(
            ["Chart", Clusters.Class.HelmChart,
                "EdgeAgent", "Cluster", "ModbusRest", "MQTT", "UNSBridge"],
            ["Repo", Git.Class.Repo, "HelmCharts"],
            ["RepoGroup", Git.Class.Group,
                "Cluster", "Shared"],
            ["Role", Auth.Class.EdgeRole,
                "EdgeAgent", "EdgeFlux", "EdgeKrbkeys", "EdgeMonitor", "EdgeSync", "UNSBridge"],
        );

        await this.put_conf(ServiceConfig, this.local);
        await this.put_service_configs();

        return this.local;
    }
}

export function setup_local_uuids (ss) {
    return new LocalUUIDs(ss).setup_uuids();
}


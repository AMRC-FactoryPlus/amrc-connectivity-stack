/*
 * ACS Gateway Depot
 * Edge clusters: listing, creating and enrolling.
 * Copyright 2026 University of Sheffield AMRC
 */

import timers from "timers/promises";

import { sparkplug_safe_string }
    from "@amrc-factoryplus/service-client/lib/sparkplug/util.js";

import { App, Class, Service, EDGE_NAMESPACE }  from "./constants.js";
import { DepotError }                           from "./errors.js";

export class Clusters {
    constructor (opts) {
        this.fplus = opts.fplus;
        this.cdb = opts.fplus.ConfigDB;
        this.log = opts.fplus.debug.bound("clusters");
    }

    /* Call the Cluster Manager. Resolves to [status, json]. */
    async manager (method, url) {
        const res = await this.fplus.Fetch.fetch({
            service:    Service.Clusters,
            url, method,
        });
        const json = await res.json().catch(() => undefined);
        return [res.status, json];
    }

    /* The edge clusters that exist, with whether each has reported in. */
    async list () {
        const { cdb } = this;

        const uuids = await cdb.list_configs(App.ClusterConfig);
        return Promise.all(uuids.map(async uuid => {
            const config = await cdb.get_config(App.ClusterConfig, uuid);
            const status = await cdb.get_config(App.ClusterStatus, uuid);
            return {
                uuid,
                name:       config?.name,
                reported:   !!status,
                hosts:      status?.hosts?.map(h => h.hostname) ?? [],
            };
        }));
    }

    /* Create an edge cluster the way the Admin UI does. The Cluster
     * Manager sees the entry and prepares the cluster's repo and
     * accounts. */
    async create (name) {
        const { cdb } = this;

        const sparkplug = sparkplug_safe_string(name);
        if (!sparkplug)
            throw new DepotError(400, "The cluster name has no usable characters.");

        /* A cluster of this name that has never reported in is one that
         * was created but never bootstrapped, most likely by an earlier
         * attempt at this gateway. Use it instead of refusing. */
        const existing = (await this.list()).find(c => c.name == sparkplug);
        if (existing?.reported)
            throw new DepotError(409,
                `An edge cluster called ${sparkplug} already exists and is in use.`);
        if (existing) {
            this.log("Reusing edge cluster %s (%s)", sparkplug, existing.uuid);
            return { uuid: existing.uuid, name: sparkplug };
        }

        const manager = await cdb.get_config(App.ServiceConfig, Service.Manager);
        const chart = manager?.helm?.cluster;
        if (!chart)
            throw new DepotError(502, "ACS has no default edge cluster chart configured.");

        const uuid = await cdb.create_object(Class.EdgeCluster);
        await cdb.put_config(App.Info, uuid, { name });
        await cdb.put_config(App.ClusterConfig, uuid,
            { chart, name: sparkplug, namespace: EDGE_NAMESPACE });
        this.log("Created edge cluster %s (%s)", sparkplug, uuid);
        return { uuid, name: sparkplug };
    }

    /* Wait for the Cluster Manager to finish preparing a cluster, then
     * ask it for an enrolment token. Resolves to { token, bootstrap }. */
    async enrol (uuid, timeout = 180000) {
        const end = Date.now() + timeout;
        for (;;) {
            const [st, json] = await this.manager("POST", `v1/cluster/${uuid}/enrol`);
            if (st == 200) return json;
            if (st == 403)
                throw new DepotError(502,
                    "The Gateway Depot is not allowed to enrol edge clusters.");
            /* 404 means the cluster is not ready yet. */
            if (st != 404 || Date.now() > end)
                throw new DepotError(504,
                    "Cluster Manager did not finish preparing the cluster in time.");
            await timers.setTimeout(3000);
        }
    }

    /* Throw away a cluster's enrolment token once it has been used. It
     * expires by itself if this fails. */
    async unenrol (uuid) {
        const [st] = await this.manager("DELETE", `v1/cluster/${uuid}/enrol`)
            .catch(() => [0]);
        if (st != 204)
            this.log("Cannot revoke enrolment token for %s: %s", uuid, st);
    }
}

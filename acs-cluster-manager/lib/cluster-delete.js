/*
 * ACS Cluster Manager
 * Delete an edge cluster and everything that belongs to it.
 * Copyright 2026 University of Sheffield AMRC
 */

import timers from "node:timers/promises";

import { UUIDs, ServiceError } from "@amrc-factoryplus/service-client";

import { NodeDelete }   from "./node-delete.js";
import { Edge, Git }    from "./uuids.js";

const { App, Class } = UUIDs;

function svc_catch (...codes) {
    return err => {
        if (err instanceof ServiceError && codes.includes(err.status))
            return;
        throw err;
    };
}

/* The Kerberos accounts an edge cluster runs as. We make flux and
 * krbkeys when the cluster is set up, and record them in its status.
 * The edge krbkeys makes sync and monitor from the edge-cluster chart,
 * and we find those by their principal. */
const OWN_ACCOUNTS = ["flux", "krbkeys"];
const EDGE_ACCOUNTS = ["sync", "monitor"];

/* An edge cluster is spread across several services:
 *
 * - The Admin UI or the Gateway Depot creates the ConfigDB object, its
 *   Info and its EdgeClusterConfig.
 * - The cluster operator in this service (clusters.js, actions.js)
 *   sets it up from the config: the op1flux and op1krbkeys accounts,
 *   their grants and Kerberos identities, the Git repo config, the
 *   Sparkplug group, and the setup status. Deleting the config makes
 *   it remove these again.
 * - Enrolment makes op1enrol/<name> and the KDC principals of the two
 *   accounts.
 * - On the edge, krbkeys makes the op1sync and op1monitor accounts and
 *   principals, edge-sync reports the hosts in EdgeClusterStatus, and
 *   the cluster's nodes and other deployments live here too.
 * - The Git service keeps the repo, with its sealed secrets, on disk.
 *
 * We only delete a cluster which is offline. A running cluster would
 * go on trying to use accounts we had removed, and its krbkeys would
 * try to put back what we had deleted. So the edge does none of the
 * work and we do all of it here. Every step tolerates having been done
 * already, so a delete that stopped part way can be run again. */
export class ClusterDelete {
    constructor (opts) {
        this.fplus      = opts.fplus;
        this.clusters   = opts.clusters;
        this.enrolment  = opts.enrolment;
        this.realm      = opts.realm;
        /* How long to wait for the cluster operator to take the
         * cluster apart once its config has gone. */
        this.wait       = opts.wait ?? 2 * 60 * 1000;
        this.poll       = opts.poll ?? 2000;

        /* The cluster is offline, so its krbkeys will not remove a
         * node's account; do it at once. The cluster's repo goes as a
         * whole, so leave the nodes' secrets in it. */
        this.node_delete = opts.node_delete ?? new NodeDelete({
            ...opts, wait: 0, secrets: false,
        });

        this.log = this.fplus.debug.bound("cluster-delete");
        this.running = new Set();
    }

    /* What deleting a cluster would remove. Returns null if the object
     * is not an edge cluster.
     *
     * Read the ConfigDB without its cache, as the delete works from
     * this plan. */
    async plan (cluster) {
        const cdb = this.fplus.ConfigDB;
        const fresh = { cache: "no-cache" };
        const get = (app, obj) => cdb.get_config(app, obj, fresh);
        const search = (app, query) => cdb.search({ app, query, ...fresh });

        const reg = await get(App.Registration, cluster);
        if (reg?.class != Edge.Class.Cluster) return null;

        const config = await get(Edge.App.Cluster, cluster);
        const status = await this.clusters.cluster_status(cluster);
        const info = await get(App.Info, cluster);
        /* The principals are named from the config name, which can
         * differ from Info. A delete that stopped after removing the
         * config has already done everything that needs the name. */
        const name = status?.spec?.name ?? config?.name;

        const in_cluster = await search(App.EdgeAgentDeployment, { cluster });
        const deployed = await Promise.all(in_cluster.map(async uuid => ({
            uuid,
            name:   (await get(App.Info, uuid))?.name ?? uuid,
            node:   (await get(App.Registration, uuid))?.class == Class.EdgeAgent,
        })));
        const nodes = deployed.filter(d => d.node)
            .map(({ uuid, name }) => ({ uuid, name }));
        const deployments = deployed.filter(d => !d.node)
            .map(({ uuid, name }) => ({ uuid, name }));

        const accounts = {};
        for (const acc of OWN_ACCOUNTS)
            accounts[acc] = status?.[acc]?.uuid ?? null;
        for (const acc of EDGE_ACCOUNTS)
            accounts[acc] = name
                ? await this.find_account(this.principal(acc, name))
                : null;

        const online = await this.online_devices(
            [accounts.monitor, ...nodes.map(n => n.uuid)]);

        return {
            cluster,
            name:       info?.name ?? name ?? cluster,
            principal_name: name ?? null,
            configured: !!config,
            set_up:     !!status?.spec,
            online,
            nodes, deployments, accounts,
        };
    }

    principal (account, name) {
        return `op1${account}/${name}@${this.realm}`;
    }

    async find_account (principal) {
        return await this.fplus.Auth.resolve_identity("kerberos", principal)
            .catch(e => { svc_catch(403, 404)(e); return null; })
            ?? null;
    }

    /* Which of these Sparkplug nodes the Directory says are online.
     * The cluster's monitor publishes as long as the cluster runs, and
     * so do its edge agents. */
    async online_devices (uuids) {
        const dir = this.fplus.Directory;
        const online = [];
        for (const uuid of uuids) {
            if (!uuid) continue;
            const info = await dir.get_device_info(uuid)
                .catch(e => { svc_catch(403, 404)(e); return null; });
            if (info?.online) online.push(uuid);
        }
        return online;
    }

    /* Start deleting a cluster. Returns at once; the work goes on in
     * the background and is logged. */
    start (plan, who) {
        if (this.running.has(plan.cluster)) return;
        this.running.add(plan.cluster);
        this.log("%s asked to delete cluster %s (%s)",
            who, plan.name, plan.cluster);
        this.run(plan)
            .then(() => this.log("Deleted cluster %s (%s)", plan.name, plan.cluster))
            .catch(e => this.log("Deleting cluster %s failed: %s", plan.cluster, e))
            .finally(() => this.running.delete(plan.cluster));
    }

    async run (plan) {
        const { cluster } = plan;
        const cdb = this.fplus.ConfigDB;
        const name = plan.principal_name;

        /* Stop anyone joining the cluster while we take it apart. */
        if (name) await this.enrolment.revoke(name);

        /* The nodes and deployments go first, while the cluster still
         * says which they are. */
        for (const { uuid } of plan.nodes) {
            const node = await this.node_delete.plan(cluster, uuid);
            if (!node) continue;
            this.log("Removing node %s", uuid);
            await this.node_delete.run(node);
        }
        for (const { uuid } of plan.deployments)
            await this.remove_deployment(uuid);

        /* Everything that needs the cluster's name goes before its
         * config. */
        for (const acc of EDGE_ACCOUNTS)
            await this.remove_account(acc, plan.accounts[acc]);
        if (name) await this.enrolment.delete_cluster_principals(name);

        await this.remove_config(plan);
        for (const acc of OWN_ACCOUNTS)
            await this.remove_account(acc, plan.accounts[acc]);

        this.log("Removing the repo of %s", cluster);
        await this.remove_repo(cluster);

        await this.remove_grants(cluster);

        this.log("Removing cluster object %s", cluster);
        await cdb.delete_object(cluster).catch(svc_catch(404));
    }

    /* A deployment which is not a node: a UNS bridge, say. Removing
     * its deployment entry would make edge-sync remove the HelmRelease,
     * but the cluster is offline, so the object goes too. */
    async remove_deployment (uuid) {
        const cdb = this.fplus.ConfigDB;
        this.log("Removing deployment %s", uuid);
        await cdb.delete_config(App.EdgeAgentDeployment, uuid)
            .catch(svc_catch(404));
        await this.remove_grants(uuid);
        await cdb.delete_object(uuid).catch(svc_catch(404));
    }

    /* Deleting the config makes the cluster operator run its Delete
     * action: it removes the flux and krbkeys accounts' grants and
     * identities, the repo config, the Sparkplug group and the setup
     * status. Wait for that, so the operator and we never work on the
     * cluster at once. A cluster that was never set up has no status
     * and the operator has nothing to do. */
    async remove_config (plan) {
        const { cluster } = plan;
        const cdb = this.fplus.ConfigDB;

        this.log("Removing the config of %s", cluster);
        await cdb.delete_config(Edge.App.Cluster, cluster)
            .catch(svc_catch(404));

        const end = Date.now() + this.wait;
        while (Object.keys(await this.clusters.cluster_status(cluster)).length) {
            if (Date.now() >= end)
                throw new Error(`The cluster operator has not removed ${cluster}`);
            await timers.setTimeout(this.poll);
        }

        /* In case the operator was not running when the config went. */
        await cdb.delete_config(UUIDs.App.SparkplugAddress, cluster)
            .catch(svc_catch(404));
        await cdb.delete_config(Git.App.Config, cluster)
            .catch(svc_catch(404));
    }

    /* One of the cluster's Kerberos accounts: its grants, identity,
     * Sparkplug address and object. The cluster operator has done most
     * of this for flux and krbkeys, but only marks their objects
     * deleted. */
    async remove_account (account, uuid) {
        if (!uuid) return;
        const { Auth, ConfigDB } = this.fplus;

        this.log("Removing %s account %s", account, uuid);
        await this.remove_grants(uuid);
        await Auth.delete_identity(uuid, "kerberos")
            .catch(svc_catch(404));
        await ConfigDB.delete_config(App.SparkplugAddress, uuid)
            .catch(svc_catch(404));
        await ConfigDB.delete_object(uuid).catch(svc_catch(404));
    }

    /* The repo's files, sealed secrets with them. The cluster operator
     * removed the repo config, which stops the Git service serving it,
     * but the files stay on disk until we ask. */
    async remove_repo (cluster) {
        const [st] = await this.fplus.Git.fetch({
            method:     "DELETE",
            url:        `v1/storage/${cluster}`,
        });
        if (st != 204 && st != 404)
            throw new Error(`Can't remove the repo of ${cluster}: ${st}`);
    }

    /* Grants for the object, or on it. This service may not be allowed
     * to see or remove some of them, and that must not stop the
     * delete. */
    async remove_grants (uuid) {
        const auth = this.fplus.Auth;
        const find = pattern => auth.find_grants(pattern)
            .catch(e => { svc_catch(403)(e); return []; });
        const grants = [
            ...await find({ principal: uuid }),
            ...await find({ target: uuid }),
        ];
        for (const grant of new Set(grants)) {
            this.log("Removing grant %s", grant);
            await auth.delete_grant(grant).catch(svc_catch(403, 404));
        }
    }
}

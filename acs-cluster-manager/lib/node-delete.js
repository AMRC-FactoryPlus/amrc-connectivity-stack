/*
 * ACS Cluster Manager
 * Delete an edge node and everything that belongs to it.
 * Copyright 2026 University of Sheffield AMRC
 */

import timers from "node:timers/promises";

import { UUIDs, ServiceError } from "@amrc-factoryplus/service-client";

import { Checkout }     from "./checkout.js";
import { Edge }         from "./uuids.js";

const { App, Class } = UUIDs;

function svc_catch (...codes) {
    return err => {
        if (err instanceof ServiceError && codes.includes(err.status))
            return;
        throw err;
    };
}

/* The sealed secret holding a node's connection passwords. The Admin
 * UI names it this way when it saves a connection. */
export const secret_name = node => `edge-agent-sensitive-information-${node}`;

/* An edge node is spread across several services:
 *
 * - The Admin UI creates the ConfigDB object, its Info and its
 *   EdgeAgentDeployment, and later its connections, devices and
 *   EdgeAgentConfig.
 * - edge-sync turns the deployment into a HelmRelease on the cluster.
 *   The chart's KerberosKey makes the edge krbkeys operator create the
 *   node's Kerberos identity, its membership of the edge agent role and
 *   its Sparkplug address. The node UUID is the agent's Auth principal.
 * - Connection passwords live in a sealed secret in the cluster's repo.
 *
 * Deleting the deployment makes edge-sync remove the HelmRelease, and
 * krbkeys then removes what it made. That only happens while the
 * cluster is online, and krbkeys cannot finish if the node object has
 * gone first. So: remove the deployment, wait for krbkeys, do its work
 * ourselves if it has not happened in time, and only then delete the
 * objects. Every step tolerates having been done already, so a delete
 * that stopped part way can be run again. */
export class NodeDelete {
    constructor (opts) {
        this.fplus      = opts.fplus;
        /* How long to wait for the cluster to remove the agent. */
        this.wait       = opts.wait ?? 5 * 60 * 1000;
        this.poll       = opts.poll ?? 5000;
        this.clone      = opts.clone ?? (o => Checkout.clone(o));

        this.log = this.fplus.debug.bound("node-delete");
        this.running = new Set();
    }

    /* What deleting a node would remove. Returns null if the node is not
     * an edge node, or false if it belongs to another cluster. */
    async plan (cluster, node) {
        const cdb = this.fplus.ConfigDB;

        const deployment = await cdb.get_config(App.EdgeAgentDeployment, node);
        if (deployment) {
            if (deployment.cluster != cluster) return false;
        }
        else {
            /* A delete that stopped part way has removed the deployment
             * already. The object still says what it is. */
            const reg = await cdb.get_config(App.Registration, node);
            if (reg?.class != Class.EdgeAgent) return null;
        }

        const connections = await cdb.search({
            app: App.ConnectionConfiguration, query: { edgeAgent: node } });
        const by_node = await cdb.search({
            app: App.DeviceInformation, query: { node } });
        const by_conn = await Promise.all(connections.map(connection =>
            cdb.search({ app: App.DeviceInformation, query: { connection } })));
        const devices = [...new Set([...by_node, ...by_conn.flat()])];

        const named = uuids => Promise.all(uuids.map(async uuid => ({
            uuid,
            name: (await cdb.get_config(App.Info, uuid))?.name ?? uuid,
        })));

        return {
            node,
            name:           (await cdb.get_config(App.Info, node))?.name ?? node,
            cluster,
            deployment:     deployment ?? null,
            connections:    await named(connections),
            devices:        await named(devices),
        };
    }

    /* Start deleting a node. Returns at once; the work goes on in the
     * background and is logged. */
    start (plan, who) {
        if (this.running.has(plan.node)) return;
        this.running.add(plan.node);
        this.log("%s asked to delete node %s (%s) on cluster %s",
            who, plan.name, plan.node, plan.cluster);
        this.run(plan)
            .then(() => this.log("Deleted node %s (%s)", plan.name, plan.node))
            .catch(e => this.log("Deleting node %s failed: %s", plan.node, e))
            .finally(() => this.running.delete(plan.node));
    }

    async run (plan) {
        const { node } = plan;
        const cdb = this.fplus.ConfigDB;

        /* Read these before the deployment goes, for the fallback. */
        const role = await this.agent_role(plan.deployment);

        this.log("Removing the deployment of %s", node);
        await cdb.delete_config(App.EdgeAgentDeployment, node)
            .catch(svc_catch(404));

        if (!await this.wait_for_krbkeys(node)) {
            this.log("The cluster has not removed agent %s; removing its account here",
                node);
            await this.remove_account(node, role);
        }

        for (const { uuid } of plan.devices) {
            this.log("Removing device %s", uuid);
            await cdb.delete_object(uuid).catch(svc_catch(404));
        }
        for (const { uuid } of plan.connections) {
            this.log("Removing connection %s", uuid);
            await cdb.delete_object(uuid).catch(svc_catch(404));
        }

        await this.remove_secret(plan);
        await this.remove_grants(node);

        this.log("Removing node object %s", node);
        await cdb.delete_object(node).catch(svc_catch(404));
    }

    /* The role group the agent's chart puts its account in. */
    async agent_role (deployment) {
        if (!deployment?.chart) return null;
        const chart = await this.fplus.ConfigDB
            .get_config(App.HelmChartTemplate, deployment.chart)
            .catch(svc_catch(403, 404));
        return chart?.values?.authGroup?.edgeAgent ?? null;
    }

    /* The edge krbkeys operator removes the Kerberos identity when the
     * agent's KerberosKey goes. Wait for that. */
    async wait_for_krbkeys (node) {
        const auth = this.fplus.Auth;
        const has_identity = () => auth.get_identity(node, "kerberos")
            .then(() => true, e => {
                if (e instanceof ServiceError && e.status == 404) return false;
                throw e;
            });

        const end = Date.now() + this.wait;
        while (await has_identity()) {
            if (Date.now() >= end) return false;
            await timers.setTimeout(this.poll);
        }
        return true;
    }

    /* What krbkeys does when the cluster is online. */
    async remove_account (node, role) {
        const { Auth, ConfigDB } = this.fplus;
        await Auth.delete_identity(node, "kerberos");
        if (role)
            await ConfigDB.class_remove_member(role, node)
                .catch(svc_catch(404));
        await ConfigDB.delete_config(App.SparkplugAddress, node)
            .catch(svc_catch(404));
    }

    /* The node's connection passwords, sealed in the cluster's repo. */
    async remove_secret (plan) {
        const conf = await this.fplus.ConfigDB
            .get_config(Edge.App.Cluster, plan.cluster);
        if (!conf?.namespace) return;

        const co = await this.clone({ fplus: this.fplus, uuid: plan.cluster });
        const dir = ["edo", "secrets", conf.namespace];
        const file = `${secret_name(plan.node)}.yaml`;
        if (await co.read_file(...dir, file) === undefined) {
            await co.dispose();
            return;
        }
        this.log("Removing sealed secret %s/%s", conf.namespace, file);
        await co.unlink_file(...dir, file);
        await co.push("Remove the secrets of deleted node %s.", plan.name);
    }

    /* Grants for the node, or on it, made by people. This service may
     * not be allowed to see or remove some of them, and that must not
     * stop the delete. */
    async remove_grants (node) {
        const auth = this.fplus.Auth;
        const find = pattern => auth.find_grants(pattern)
            .catch(e => { svc_catch(403)(e); return []; });
        const grants = [
            ...await find({ principal: node }),
            ...await find({ target: node }),
        ];
        for (const grant of new Set(grants)) {
            this.log("Removing grant %s", grant);
            await auth.delete_grant(grant).catch(svc_catch(403, 404));
        }
    }
}

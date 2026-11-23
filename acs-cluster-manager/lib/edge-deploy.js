/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Deployment operator
 * Main entry point
 * Copyright 2023 AMRC
 */

import express from "express";

import { UUIDs } from "@amrc-factoryplus/service-client";

//import { Clusters }         from "./clusters.js";
import { SealedSecrets }    from "./secrets.js";
import { Edge }             from "./uuids.js";

export class EdgeDeploy {
    constructor (opts) {
        this.fplus          = opts.fplus;
        this.http_url       = opts.http_url;
        this.external_url   = opts.external_url;
        this.clusters       = opts.clusters;

        this.log = this.fplus.debug.bound("edge");
        this.routes = express.Router();

        this.secrets = new SealedSecrets(opts);
    }

    wrap (fn) {
        return async (req, res, next) => {
            try {
                return await fn.call(this, req, res, next);
            }
            catch (e) {
                next(e);
            }
        };
    }

    async init () {

        const app = this.routes;
        app.get("/cluster/:cluster/bootstrap", this.wrap(this.bootstrap));
        app.post("/cluster/:cluster/bootstrap-url", 
            this.wrap(this.bootstrap_url));
        app.route("/cluster/:cluster/enrol")
            .post(this.wrap(this.enrol))
            .delete(this.wrap(this.unenrol));
        app.get("/cluster/:cluster/status", this.wrap(this.cluster_status));
        app.get("/cluster/:cluster/secret-access",
            this.wrap(this.secret_access));
        app.route("/cluster/:cluster/secret/:namespace/:name/:key")
            .put(this.wrap(this.seal_secret))
            .delete(this.wrap(this.delete_sealed_secret));

        return this;
    }

    async bootstrap (req, res) {
        const { cluster } = req.params;

        const bs = await this.clusters.bootstrap(cluster);

        if (!bs) return res.status(404).end();
        return res.status(200).type("text/plain").send(bs);
    }

    async bootstrap_url (req, res) {
        const { cluster } = req.params;

        const ok = await this.fplus.Auth.check_acl(
            req.auth, Edge.Perm.Clusters, cluster, true);
        if (!ok) return res.status(403).end();

        const rv = await this.clusters.cluster_status(cluster);
        if (!rv?.ready)
            return res.status(404).end();

        const url = new URL(`/v1/cluster/${cluster}/bootstrap`,
            this.external_url).toString();
        return res.status(200).json(url);
    }

    /* Issue a one-time token which lets an edge cluster join without
     * an administrator's credentials. Run the bootstrap script with
     * ACS_ENROL_TOKEN set to the token. */
    async enrol (req, res) {
        const { cluster } = req.params;

        const ok = await this.fplus.Auth.check_acl(
            req.auth, Edge.Perm.Clusters, cluster, true);
        if (!ok) return res.status(403).end();

        const rv = await this.clusters.enrol(cluster);
        if (!rv) return res.status(404).end();

        const bootstrap = new URL(`/v1/cluster/${cluster}/bootstrap`,
            this.external_url).toString();
        return res.status(200).json({ ...rv, bootstrap });
    }

    async unenrol (req, res) {
        const { cluster } = req.params;

        const ok = await this.fplus.Auth.check_acl(
            req.auth, Edge.Perm.Clusters, cluster, true);
        if (!ok) return res.status(403).end();

        const found = await this.clusters.unenrol(cluster);
        return res.status(found ? 204 : 404).end();
    }

    async cluster_status (req, res) {
        const { cluster } = req.params;

        const ok = await this.fplus.Auth.check_acl(
            req.auth, Edge.Perm.Clusters, cluster, true);
        if (!ok) return res.status(403).end();

        const rv = await this.clusters.cluster_status(cluster);
        if (rv)
            return res.status(200).json(rv);
        else
            return res.status(404).end();
    }

    /* Manage secrets lets a client set or delete any key. Create
     * secrets only lets it add a key which is not there yet, so it
     * cannot overwrite a secret someone else saved. `create` says
     * whether the client may add a new key, which either allows. */
    async check_secret_access (principal, cluster) {
        const can = perm => this.fplus.Auth.check_acl(
            principal, perm, cluster, true);
        const manage = await can(Edge.Perm.Secrets);
        const create = manage || await can(Edge.Perm.CreateSecrets);
        return { manage, create };
    }

    /* Any client may ask what it may do with secrets on a cluster. The
     * Admin UI uses this, as Auth will not show a client its own ACL
     * without Read ACL. */
    async secret_access (req, res) {
        const { cluster } = req.params;
        const access = await this.check_secret_access(req.auth, cluster);
        return res.status(200).json(access);
    }

    async seal_secret (req, res) {
        const opts = { 
            ...req.params,
            content:    req, 
            dryrun:     "dryrun" in req.query,
        };

        const access = await this.check_secret_access(req.auth, opts.cluster);
        if (!access.create) return res.status(403).end();
        if (!access.manage) opts.create_only = true;

        const st = await this.secrets.seal_secret(opts);
        res.status(st).end();
    }

    async delete_sealed_secret (req, res) {
        const opts = {
            ...req.params,
            dryrun:         "dryrun" in req.query,
        }

        const access = await this.check_secret_access(req.auth, opts.cluster);
        if (!access.manage) return res.status(403).end();

        const st = await this.secrets.delete_secret(opts);
        res.status(st).end();
    }
}

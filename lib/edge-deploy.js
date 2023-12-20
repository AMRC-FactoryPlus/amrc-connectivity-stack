/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Deployment operator
 * Main entry point
 * Copyright 2023 AMRC
 */

import express from "express";

import { UUIDs } from "@amrc-factoryplus/utilities";

//import { Clusters }         from "./clusters.js";
import { SealedSecrets }    from "./secrets.js";
import { Edge }             from "./uuids.js";

export class EdgeDeploy {
    constructor (opts) {
        this.fplus      = opts.fplus;
        this.http_url   = opts.http_url;

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
        await this.fplus.Directory.register_service_url(
            Edge.Service.EdgeDeployment, this.http_url);

        const app = this.routes;
        //app.get("/cluster/:cluster/status", this.wrap(this.cluster_status));
        app.route("/cluster/:cluster/secret/:namespace/:name/:key")
            .put(this.wrap(this.seal_secret))
            .delete(this.wrap(this.delete_sealed_secret));

        return this;
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

    async seal_secret (req, res) {
        const opts = { 
            ...req.params,
            content:    req, 
            dryrun:     "dryrun" in req.query,
        };
        
        const ok = await this.fplus.Auth.check_acl(
            req.auth, Edge.Perm.Secrets, opts.cluster, true);
        if (!ok) return res.status(403).end();

        const st = await this.secrets.seal_secret(opts);
        res.status(st).end();
    }

    async delete_sealed_secret (req, res) {
        const opts = {
            ...req.params,
            dryrun:         "dryrun" in req.query,
        }

        const ok = await this.fplus.Auth.check_acl(
            req.auth, Edge.Perm.Secrets, opts.cluster, true);
        if (!ok) return res.status(403).end();

        const st = await this.secrets.delete_secret(opts);
        res.status(st).end();
    }
}

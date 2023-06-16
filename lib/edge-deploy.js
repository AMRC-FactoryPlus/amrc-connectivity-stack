/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Deployment operator
 * Main entry point
 * Copyright 2023 AMRC
 */

import child_process from "child_process";
import fs from "fs";
import fs_p from "fs/promises";
import path from "path";

import concat_stream from "concat-stream";
import express from "express";
import tmpfile from "tmp-promise";

import { Debug, UUIDs } from "@amrc-factoryplus/utilities";

import { Checkout } from "./checkout.js";
import { Git, Edge } from "./uuids.js";
import * as manifests from "./manifests.js";

const debug = new Debug();

export class EdgeDeploy {
    constructor (opts) {
        this.fplus      = opts.fplus;
        this.git_email  = opts.git_email;
        this.group      = opts.repo_group;
        this.cert_dir   = opts.cert_dir;

        this.log = debug.log.bind(debug, "edge");
        this.routes = express.Router();
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
        app.post("/cluster", this.wrap(this.create_cluster));
        app.get("/cluster/:cluster/status", this.wrap(this.cluster_status));
        app.route("/cluster/:cluster/secret/:namespace/:name/:key")
            .put(this.wrap(this.seal_secret))
            .delete(this.wrap(this.delete_sealed_secret));

        return this;
    }

    async create_cluster (req, res) {
        const { name, sources } = req.body;

        const ok = await this.fplus.Auth.check_acl(
            req.auth, Edge.Perm.Clusters, UUIDs.Null, false);
        if (!ok) return res.status(403).end();

        const repo = await this.create_repo(name);
        const uuid = await this.create_cluster_objects(req.body, repo.url);
        await this.populate_cluster_repo(repo, req.body);

        return res.status(201).json({ uuid });
    }

    async cluster_status (req, res) {
        const { cluster } = req.params;

        const ok = await this.fplus.Auth.check_acl(
            req.auth, Edge.Perm.Clusters, cluster, true);
        if (!ok) return res.status(403).end();

        const info = await this.fplus.ConfigDB.get_config(Edge.App.Cluster, cluster);
        if (!info) return res.status(404).end();

        return res.status(200).json({ ready: !!info.ready });
    }

    async create_repo (name) {
        const repo = `${this.group}/${name}`;
        this.log("Creating repo %s", repo);
        const res = await this.fplus.fetch({
            service:    Git.Service.Git,
            method:     "POST",
            url:        `/git/${repo}`,
        });
        if (res.status != 200)
            throw `Git: can't create repo ${repo}: ${res.status}`;
        return await res.json();
    }

    async create_cluster_objects (spec, repo) {
        const { name, kubeseal_cert } = spec;
        const namespace = spec.namespace ?? "fplus-edge";

        const cdb = this.fplus.ConfigDB;
        const uuid = await cdb.create_object(Edge.Class.Cluster);
        this.log("Created Edge Cluster %s", uuid);

        await cdb.put_config(UUIDs.App.Info, uuid, { name });
        await cdb.put_config(Edge.App.Cluster, uuid, {
            flux:           repo,
            namespace,
            kubeseal_cert,
        });

        return uuid;
    }

    async populate_cluster_repo (repo, spec) {
        this.log("Performing initial cluster deployment");
        const co = await Checkout.init({
            fplus:  this.fplus, 
            url:    repo.url,
        });
        await co.write_file("README.md", manifests.README);
        await co.commit("Add README.");
        await this.setup_repo_links(co, spec);
        await co.push();
        this.log("Pushed initial commits");
    }

    async setup_repo_links (co, spec) {
        if (!spec.sources) return;

        const git_base = await this.fplus.Discovery
            .service_url(Git.Service.Git);

        await this.write_sealed_secret(co, spec.kubeseal_cert, { 
            namespace:  FLUX_NS, 
            name:       "op1flux-secrets",
            key:        "username",
            content:    stream.Readable.from(`op1flux/${spec.name}`),
        });
        for (const source of spec.sources) {
            const name = source.replace("/", ".");
            const url = new URL(source, git_base).toString();

            this.log("Adding source %s", url);
            await co.write_manifest(manifests.git_repo(FLUX_NS, name, url));
            await co.write_manifest(manifests.flux_kust(FLUX_NS, name, name));
        }
        await co.commit("Written flux source manifests.");
    }

    async write_sealed_secret (co, x509, s_req) {
        const { namespace, name, key, content } = s_req;

        const sealed = await this.run_kubeseal(x509, s_req);
        this.log("Got sealed data: %s", sealed);

        const obj = await co.read_manifest(namespace, "SealedSecret", name) ??
            manifests.sealed_secret(namespace, name);
        obj.spec.encryptedData[key] = sealed;
        await co.write_manifest(obj);
        await co.commit("Updated sealed secret %s/%s/%s.", namespace, name, key);
    }

    async _seal_secret (cluster, s_req) {
        const info = await this.fplus.ConfigDB.get_config(Edge.App.Cluster, cluster);
        if (!info) return 404;

        const x509 = info.kubeseal_cert;
        if (!x509) return 503;

        const co = await Checkout.clone({ fplus: this.fplus, url: info.flux });
        await this.write_sealed_secret(co, x509, s_req);
        await co.push();

        return 204;
    }

    async seal_secret (req, res) {
        const { cluster, namespace, name, key } = req.params;
        const s_req = { namespace, name, key, content: req };
        
        const ok = await this.fplus.Auth.check_acl(
            req.auth, Edge.Perm.Secrets, cluster, true);
        if (!ok) return res.status(403).end();

        const st = await this._seal_secret(cluster, s_req);
        res.status(st).end();
    }

    async delete_sealed_secret (req, res) {
        const { cluster, namespace, name, key } = req.params;

        const ok = await this.fplus.Auth.check_acl(
            req.auth, Edge.Perm.Secrets, cluster, true);
        if (!ok) return res.status(403).end();

        const info = await this.fplus.ConfigDB.get_config(Edge.App.Cluster, cluster);
        if (!info) return res.status(404).end();

        const mf = [namespace, "SealedSecret", name];
        const co = await Checkout.clone({ fplus: this.fplus, url: info.flux });
        const obj = await co.read_manifest(...mf);
        if (obj) {
            const enc = obj.spec.encryptedData;
            delete enc[key];
            if (Object.keys(enc).length == 0)
                await co.unlink_manifest(...mf);
            else
                await co.write_manifest(obj);
            await co.push("Remove sealed secret %s/%s/%s.", namespace, name, key);
        }

        return res.status(204).end();
    }

    run_kubeseal (x509, s_req) {
        return tmpfile.withFile(async ({ path: cert }) => {
            await fs_p.writeFile(cert, x509);

            const sealed = await new Promise(resolve => {
                const kid = child_process.spawn("/usr/local/bin/kubeseal", [
                    "--cert", cert,
                    "--namespace", s_req.namespace,
                    "--name", s_req.name,
                    "--raw"]);
                s_req.content.pipe(kid.stdin);
                kid.stderr.pipe(concat_stream(
                    { encoding: "string" }, 
                    err => err && this.log("Kubeseal error: %s", err)));
                kid.stdout.pipe(concat_stream({ encoding: "string" }, resolve));
            });

            return sealed;
        }, { tmpdir: this.cert_dir, prefix: "cert-" });
    };
}

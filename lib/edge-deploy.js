/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Deployment operator
 * Main entry point
 * Copyright 2023 AMRC
 */

import fs from "fs";
import fs_p from "fs/promises";
import path from "path";

import express from "express";

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

        return this;
    }

    async create_cluster (req, res) {
        const { name, sources } = req.body;

        const repo = await this.create_repo(name);
        const uuid = await this.create_cluster_objects(req.body, repo.url);
        await this.populate_cluster_repo(repo, sources);

        return res.status(201).json({ uuid });
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

    async populate_cluster_repo (repo, sources) {
        this.log("Performing initial cluster deployment");
        const co = await Checkout.init({
            fplus:  this.fplus, 
            url:    repo.url,
        });
        await co.write_file("README.md", manifests.README);
        await co.commit("Add README.");
        await this.setup_repo_links(co, sources);
        await co.push("Initial cluster deployment.");
        this.log("Pushed initial commits");
    }

    async setup_repo_links (co, sources) {
        if (!sources) return;

        const git_base = await this.fplus.Discovery
            .service_url(Git.Service.Git);

        for (const source of sources) {
            const name = source.replace("/", ".");
            const url = new URL(source, git_base).toString();

            this.log("Adding source %s", url);
            await co.write_manifest(manifests.git_repo("flux-system", name, url));
            await co.write_manifest(manifests.flux_kust("flux-system", name, name));
        }
    }
}

/* Git server class.
 * This does authentication and runs `git-http-backend` as a CGI.
 * Copyright 2023 AMRC.
 */

import fs from "fs";
import fs_p from "fs/promises";
import path from "path";
import process from "process";

import cgi from "cgi";
import express from "express";
import git from "isomorphic-git";

import { Debug, UUIDs } from "@amrc-factoryplus/utilities";

import { Git } from "./uuids.js";

export class GitServer {
    constructor (opts) {
        this.data = opts.data;
        this.fplus = opts.fplus;
        this.http_url = opts.http_url;

        this.debug = new Debug();
        this.log = this.debug.log.bind(this.debug, "git");

        this.routes = express.Router();

        const git_http = path.join(opts.git_exec, "git-http-backend");
        this.cgi = cgi(git_http, {
            mountPoint: "/uuid",
            env: {
                GIT_PROJECT_ROOT: opts.data,
                REMOTE_USER: "flux",
                GIT_HTTP_EXPORT_ALL: 1,
            },
            stderr: process.stderr,
        });
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
            Git.Service.Git, this.http_url);

        this.fplus.Fetch.cache = "reload";

        const app = this.routes;

        app.all("/git/:group/:repo/:rest(*)", this.wrap(this.by_path));
        app.all("/uuid/:uuid/:rest(*)", this.wrap(this.by_uuid));
        app.get("/v1/storage", this.wrap(this.storage_list));
        app.delete("/v1/storage/:uuid", this.wrap(this.storage_delete));

        return this;
    }

    _resolve_uuid (klass, path) {
        return this.fplus.ConfigDB.resolve({
            app:    Git.App.Config,
            query:  { path },
        });
    }

    async by_path (req, res, next) {
        const { group, repo, rest } = req.params;
        const { service } = req.query;
        const path = `${group}/${repo}`;

        const uuid = await this._resolve_uuid(Git.Class.Repo, path);
        this.log("Resolved path %s to %s", path, uuid);

        const qs = service ? `?service=${service}` : "";
        req.url = `/uuid/${uuid}/${rest}${qs}`;
        next("route");
    }

    async by_uuid (req, res, next) {
        const { uuid, rest } = req.params;
        const push = rest == "git-receive-pack" ||
            req.query.service == "git-receive-pack";

        const ok = await this.fplus.Auth.check_acl(req.auth,
            push ? Git.Perm.Push : Git.Perm.Pull,
            uuid, true);
        if (!ok) return res.status(403).end();

        const config = await this.fplus.ConfigDB.get_config(
            Git.App.Config, uuid);
        if (!config) return res.status(404).end();

        this.log("%s access to %s (%s) by %s", 
            (push ? "Push" : "Pull"), uuid, config.path, req.auth);

        const data = `${this.data}/${uuid}`;
        fs_p.stat(data)
            .catch(() => git.init({
                fs,
                dir:            data,
                bare:           true,
                defaultBranch:  "main",
            }))
            .then(() => this.cgi(req, res, next));
    }

    async storage_list (req, res) {
        const ok = await this.fplus.Auth.check_acl(
            req.auth, Git.Perm.Manage_Storage, UUIDs.Null, false);
        if (!ok) return res.status(403).end();

        const list = await fs_p.readdir(this.data);
        return res.status(200).json(list);
    }

    async storage_delete (req, res) {
        const ok = await this.fplus.Auth.check_acl(
            req.auth, Git.Perm.Manage_Storage, UUIDs.Null, false);
        if (!ok) return res.status(403).end();

        const { uuid } = req.params;
        const dir = path.join(this.data, uuid);
        this.log(`Deleting repo dir ${dir}`);
        await fs_p.rm(dir, { force: true, recursive: true });
        return res.status(204).end();
    }

}

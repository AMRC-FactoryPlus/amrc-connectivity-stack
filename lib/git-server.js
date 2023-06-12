/* Git server class.
 * This does authentication and runs `git-http-backend` as a CGI.
 * Copyright 2023 AMRC.
 */

import fs from "fs";
import fs_p from "fs/promises";
import path from "path";
import process from "process";
import { format } from "util";

import cgi from "cgi";
import express from "express";
import git from "isomorphic-git";

import { Debug, UUIDs } from "@amrc-factoryplus/utilities";

import { Flux } from "./uuids.js";

const valid_name = /^[-a-zA-Z0-9_.]{3,}$/;

export class GitServer {
    constructor (opts) {
        this.data = opts.data;
        this.fplus = opts.fplus;

        this.debug = new Debug();
        this.log = this.debug.log.bind(this.debug, "git");

        this.routes = express.Router();

        const git_http = path.join(opts.git_exec, "git-http-backend");
        this.cgi = cgi(git_http, {
            mountPoint: "/",
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
        const app = this.routes;

        app.post("/:group/:repo", this.wrap(this.create));
        app.delete("/:group/:repo", this.wrap(this.del));
        app.all("/:group/:repo/*", this.wrap(this.authenticate));
        app.all("/:group/:repo/*", this.cgi);

        return this;
    }

    _resolve_uuid (klass, path) {
        return this.fplus.ConfigDB.resolve({
            app:    Flux.App.GitConfig,
            klass,
            query:  { path },
        });
    }

    async _resolve (params) {
        const { group, repo } = params;

        if (!valid_name.test(group)) {
            this.log(`Rejecting group name ${group}`);
            return;
        }
        if (!valid_name.test(repo)) {
            this.log(`Rejecting repo name ${repo}`);
            return;
        }

        const g_id = await this._resolve_uuid(Flux.Class.RepoGroup, group);
        if (!g_id) return;

        const path = `${group}/${repo}`;
        const r_id = await this._resolve_uuid(Flux.Class.GitRepo, path);

        return {
            group:  g_id,
            repo:   r_id,
            path:   path,
            data:   `${this.data}/${path}`,
        };
    }

    async check_perm (user, info, perm) {
        const auth = this.fplus.Auth;

        if (user == auth.root_principal) {
            log("Granting root rights to %s", user);
            return true;
        }

        const g_ok = await auth.check_acl(user, perm, info.group, true);
        if (g_ok) return true;

        if (!info.repo) return false;
        return await auth.check_acl(user, perm, info.repo, true);
    }

    async create (req, res) {
        const cdb = this.fplus.ConfigDB;

        const info = await this._resolve(req.params);
        if (!info) return res.status(404).end();

        const ok = await this.check_perm(req.auth, info, Flux.Perm.Create);
        if (!ok) return res.status(403).end();

        if (info.repo) return res.status(409).end();

        this.log(`Creating repo ${info.path}`);
        await git.init({fs, dir: info.data, bare: true});

        const uuid = await cdb.create_object(Flux.Class.GitRepo);
        this.log(`Allocated UUID ${uuid} to ${info.path}`);

        await cdb.put_config(UUIDs.App.Info, uuid,
            { name: `Git repo ${info.path}` });
        await cdb.put_config(Flux.App.GitConfig, uuid, { path: info.path });

        return res.status(200).json({ uuid });
    }

    async del (req, res) {
        return res.status(500).end();

        const ok = await this.check_perm(req.auth, Flux.Perm.Delete, repo);
        if (!ok) return res.status(403).end();

        this.debug.log("git", `Delete repo ${repo}`);
        const dir = `${this.data}/${cluster}`;

        await fs_p.rm(dir, { force: true, recursive: true });
        return res.status(204).end();
    }

    async authenticate (req, res, next) {
        const info = await this._resolve(req.params);
        if (!info) return res.status(404).end();

        const push = req.path.endsWith("/git-receive-pack") ||
            req.query.service == "git-receive-pack";

        this.log("%s access to %s by %s", 
            (push ? "Push" : "Pull"), info.path, req.auth);

        const ok = await this.check_perm(req.auth, info,
            push ? Flux.Perm.Push : Flux.Perm.Pull);
        if (!ok) return res.status(403).end();

        if (!info.repo) return res.status(404).end();
        
        next();
    }
}

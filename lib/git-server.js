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

import { Git } from "./uuids.js";

const valid_name = /^[-a-zA-Z0-9_.]{3,}$/;

function gi_name (info) {
    return `Git repo ${info.path}`;
}

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
            mountPoint: "/git",
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

        app.all("/git/:group/:repo/*", this.wrap(this.git_cgi));
        app.get("/v1/storage", this.wrap(this.storage_list));
        app.delete("/v1/storage/:uuid", this.wrap(this.storage_delete));

        app.all("/redir/:group/:repo/:git(*)", this.wrap(this.redirect));

        return this;
    }

    _resolve_uuid (klass, path) {
        return this.fplus.ConfigDB.resolve({
            app:    Git.App.Config,
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

        const g_id = await this._resolve_uuid(Git.Class.Group, group);
        if (!g_id) return;

        const r_path = `${group}/${repo}`;
        const r_id = await this._resolve_uuid(Git.Class.Repo, r_path);

        return {
            group:  g_id,
            repo:   r_id,
            path:   r_path,
            data:   r_id ? path.join(this.data, r_id) : undefined,
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

    async git_cgi (req, res, next) {
        const info = await this._resolve(req.params);
        if (!info) return res.status(404).end();

        const push = req.path.endsWith("/git-receive-pack") ||
            req.query.service == "git-receive-pack";

        this.log("%s access to %s by %s", 
            (push ? "Push" : "Pull"), info.path, req.auth);

        const ok = await this.check_perm(req.auth, info,
            push ? Git.Perm.Push : Git.Perm.Pull);
        if (!ok) return res.status(403).end();

        if (!info.repo) return res.status(404).end();
        
        this.log(`Creating repo ${info.repo} at ${info.data}`);
        await git.init({
            fs,
            dir:            info.data, 
            bare:           true,
            defaultBranch:  "main",
        });

        /* We must rewrite the request URL to get git-http-backend to
         * use the right storage directory. But we can't then let
         * express route the request, as it will route it wrong. So call
         * the cgi function directly. */
        req.url = req.url.replace(info.path, info.repo);
        this.cgi(req, res, next);
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

    async redirect (req, res) {
        const { group, repo, git } = req.params;
        const { service } = req.query;
        const path = `${group}/${repo}`;
        this.log("Redirect: %s", path);
        const uuid = await this._resolve_uuid(Git.Class.Repo, path);
        this.log("Resolved %s to %s", path, uuid);
        const qs = service ? `?service=${service}` : "";
        return res.redirect(307, `/git/${path}/${git}${qs}`);
    }
}

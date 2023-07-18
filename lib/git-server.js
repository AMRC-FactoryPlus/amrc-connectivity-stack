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
        await this.fplus.Directory.register_service_url(
            Git.Service.Git, this.http_url);

        this.fplus.Fetch.cache = "reload";

        const app = this.routes;

        app.post("/:group/:repo", this.wrap(this.create));
        app.delete("/:group/:repo", this.wrap(this.del));
        app.all("/:group/:repo/*", this.wrap(this.git_cgi));

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

        const path = `${group}/${repo}`;
        const r_id = await this._resolve_uuid(Git.Class.Repo, path);

        return {
            group:  g_id,
            repo:   r_id,
            path:   path,
            data:   `${this.data}/${r_id}`,
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

        const ok = await this.check_perm(req.auth, info, Git.Perm.Create);
        if (!ok) return res.status(403).end();

        if (info.repo) return res.status(409).end();

        const uuid = await cdb.create_object(Git.Class.Repo);
        this.log(`Allocated UUID ${uuid} to ${info.path}`);

        await cdb.put_config(UUIDs.App.Info, uuid, { name: gi_name(info) });
        await cdb.put_config(Git.App.Config, uuid, { path: info.path });

        return res.status(200).json({
            uuid,
            url:    new URL(req.originalUrl, this.http_url),
        });
    }

    async del (req, res) {
        const cdb = this.fplus.ConfigDB;

        const info = await this._resolve(req.params);
        if (!info) return res.status(404).end();

        const ok = await this.check_perm(req.auth, info, Git.Perm.Delete);
        if (!ok) return res.status(403).end();

        if (!info.repo) return res.status(404).end();

        this.log(`Deleting repo ${info.path}`);

        /* Don't actually delete the CDB object. There will likely still
         * be ACLs and maybe other things pointing to it, so we don't
         * want to lose the object entirely. Don't actually delete the
         * repo either, this is handled (if at all) by the purge API
         * below. */
        const uuid = info.repo;
        await cdb.delete_config(Git.App.Config, uuid);
        const gi = await cdb.get_config(UUIDs.App.Info, uuid)
            ?? { name: gi_name(info) };
        await cdb.put_config(UUIDs.App.Info, uuid, { ...gi, deleted: true });

        return res.status(204).end();
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
        req.url = req.url.replace(`/${info.path}`, `/${info.repo}`);
        this.cgi(req, res, next);
    }
}

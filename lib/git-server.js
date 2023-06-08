/* Git server class.
 * This does authentication and runs `git-http-backend` as a CGI.
 * Copyright 2023 AMRC.
 */

import fs from "fs";
import fs_p from "fs/promises";
import path from "path";
import process from "process";

import cgi from "cgi";
import git from "isomorphic-git";

import { Debug } from "@amrc-factoryplus/utilities";

const EdgeCluster = "bdb13634-0b3d-4e38-a065-9d88c12ee78d";
export const Perm = {
    All:        "c0c55c78-116e-4526-8ff4-e4595251f76c",
    Create:     "3668660f-f949-4657-be76-21967144c1a2",
    Delete:     "55870092-91b6-4d5e-828f-7637d080bf1c",
    Pull:       "12ecb694-b4b9-4d2a-927e-d100019f7ebe",
    Push:       "b2d8d437-5060-4202-bcc2-bd2beda09651",
};
const valid_cluster = /^[-a-zA-Z0-9_.]{3,}$/;

export class GitServer {
    constructor (opts) {
        this.data = opts.data;
        this.fplus = opts.fplus;
        this.debug = new Debug();

        const git_http = path.join(opts.git_exec, "git-http-backend");
        this.debug.log("git", "Git exec [%s] http [%s]",
            opts.git_exec, git_http);
        this.cgi = cgi(git_http, {
            mountPoint: "/cluster",
            env: {
                GIT_PROJECT_ROOT: opts.data,
                REMOTE_USER: "flux",
                GIT_HTTP_EXPORT_ALL: 1,
            },
            stderr: process.stderr,
        });
    }

    async init () { return this; }

    routes (app) {
        app.post("/cluster/:cluster", this.create.bind(this));
        app.delete("/cluster/:cluster", this.del_cl.bind(this));
        app.all("/cluster/:cluster/*", this.authenticate.bind(this));
        app.all("/cluster/:cluster/*", this.cgi);
    }

    async check_perm (auth, perm, repo) {
        const fplus = this.fplus;
        const log = this.debug.log.bind(this.debug, "git");
        
        if (!valid_cluster.test(repo)) {
            log("git", `Rejecting cluster name ${repo}`);
            return false;
        }

        if (auth && auth == fplus.Auth.root_principal) {
            log("Granting root rights to %s", auth);
            return true;
        }

        const clusters = await fplus.ConfigDB.search(
            EdgeCluster, { flux: repo });

        if (!clusters || clusters.length == 0) {
            log("Cluster not found for repo %s", repo);
            return false;
        }
        if (clusters.length > 1) {
            log("More than one cluster for repo %s", repo);
            return false;
        }
        log("Found cluster %s for repo %s", clusters[0], repo);

        return await this.fplus.Auth.check_acl(auth, perm, clusters[0], true);
    }

    async create (req, res) {
        const { cluster } = req.params;

        const ok = await this.check_perm(req.auth, Perm.Create, cluster);
        if (!ok) return res.status(403).end();

        this.debug.log("git", `Create repo ${cluster}`);
        const dir = `${this.data}/${cluster}`;

        await git.init({fs, dir, bare: true});
        return res.status(201).end();
    }

    async del_cl (req, res) {
        const { cluster } = req.params;

        const ok = await this.check_perm(req.auth, Perm.Delete, cluster);
        if (!ok) return res.status(403).end();

        this.debug.log("git", `Delete repo ${cluster}`);
        const dir = `${this.data}/${cluster}`;

        await fs_p.rm(dir, { force: true, recursive: true });
        return res.status(204).end();
    }

    async authenticate (req, res, next) {
        const { cluster } = req.params;
        const { service } = req.query;

        const log = this.debug.log.bind(this.debug, "git");

        const push = req.path.endsWith("/git-receive-pack") ||
            req.query.service == "git-receive-pack";

        log("%s access to %s by %s", 
            (push ? "Push" : "Pull"), cluster, req.auth);

        const ok = await this.check_perm(
            req.auth, push ? Perm.Push : Perm.Pull, cluster);
        if (!ok) return res.status(403).end();

        next();
    }
}

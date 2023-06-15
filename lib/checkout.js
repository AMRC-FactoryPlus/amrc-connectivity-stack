/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Deployment operator
 * Git checkout
 * Copyright 2023 AMRC
 */

import fs from "fs";
import fs_p from "fs/promises";
import path from "path";

import git from "isomorphic-git";
import http from "isomorphic-git/http/node/index.js";

import { Debug, UUIDs } from "@amrc-factoryplus/utilities";

import { Git } from "./uuids.js";
import * as manifests from "./manifests.js";

const debug = new Debug();

export class Checkout {
    constructor (opts) {
        this.fplus = opts.fplus;
        this.url = opts.url;

        this.prefix = path.join(this.fplus.opts.git_checkouts, "wd-");
        this.git_email = this.fplus.opts.git_email;
        this.log = debug.log.bind(debug, "git");
    }

    /* Assume we only attempt our repo */
    async git_auth (url, auth) {
        const bad = auth?.headers?.Authorization
            ?.match(/^Bearer\s+(\S+)$/)?.[1];
        const fp = this.fplus;
        const base = await fp.Discovery.service_url(Git.Service.Git);
        const tok = await fp.Fetch._service_token(base, bad);
        return {
            headers: {
                "Authorization": `Bearer ${tok}`,
            },
        };
    }

    async _setup () {
        this.dir = await fs_p.mkdtemp(this.prefix);
        this.log("Cloning %s into %s", this.url, this.dir);

        const git_auth = this.git_auth.bind(this);
        this.gitopts = {
            fs, http,
            dir:            this.dir,
            onAuth:         git_auth,
            onAuthFailure:  git_auth,
        };
    }

    async _set_config () {
        await git.setConfig({
           ...this.gitopts, 
            path:   "user.name",
            value:  "Edge deployment operator",
        });
        await git.setConfig({
            ...this.gitopts,
            path: "user.email",
            value: this.git_email,
        });
    }

    async clone () {
        await this._setup();
        await git.clone({
            ...this.gitopts,
            url:            this.url,
            singleBranch:   true,
            noTags:         true,
            depth:          1,
        });
        await this._set_config();

        return this;
    }

    static clone (opts) {
        return new Checkout(opts).clone();
    }

    async init () {
        await this._setup();
        await git.init({
            ...this.gitopts,
            defaultBranch:  "main",
        });
        await this._set_config();
        return this;
    }

    static init (opts) {
        return new Checkout(opts).init();
    }

    async commit (message) {
        this.log("Committing in %s: %s", this.dir, message);
        await git.add({ ...this.gitopts, filepath: "." });
        const sha = await git.commit({ ...this.gitopts, message });
        this.log("Committed: %s", sha);
    }

    async push (message) {
        if (message != null)
            await this.commit(message);
        this.log("Pushing to %s", this.url);
        const res = await git.push({ ...this.gitopts, url: this.url });
        this.log("Pushed: %o", res);
        await this.dispose();
    }

    async dispose () {
        this.log("Removing checkout %s", this.dir);
        await fs_p.rm(this.dir, { force: true, recursive: true });
    }

    async write_manifest (manifest) {
        const meta = manifest.metadata;
        const file = path.join(
            meta.namespace ?? "_cluster",
            manifest.kind,
            `${meta.name}.json`);

        const json = JSON.stringify(manifest, null, 4);
        await this.write_file(file, json);
    }

    async write_file (file, content) {
        const abs = path.join(this.dir, file);
        await fs_p.mkdir(path.dirname(abs), { recursive: true });
        await fs_p.writeFile(abs, content);
        this.log("Written file %s", abs);
    }

}

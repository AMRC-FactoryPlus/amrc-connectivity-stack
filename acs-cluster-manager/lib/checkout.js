/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Deployment operator
 * Git checkout
 * Copyright 2023 AMRC
 */

import fs from "fs";
import fs_p from "fs/promises";
import path from "path";
import util from "util";

import git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import yaml from "yaml";

import { UUIDs } from "@amrc-factoryplus/service-client";

import * as manifests from "./manifests.js";

function manifest_path (namespace, kind, name) {
    return path.join(
        namespace ?? "_cluster",
        kind, `${name}.yaml`);
}

export class Checkout {
    constructor (opts) {
        this.fplus = opts.fplus;
        this.uuid = opts.uuid;

        this.prefix = path.join(this.fplus.opts.git_checkouts, "wd-");
        this.git_email = this.fplus.opts.git_email;
        this.log = this.fplus.debug.bound("git");
    }

    async _setup () {
        const dir = this.dir = await fs_p.mkdtemp(this.prefix);
        const remote = await this.fplus.Git.remote({uuid: this.uuid});
        this.url = remote.url;
        
        this.log("Cloning %s into %s", remote.url, dir);
        this.gitopts = { fs, http, ...remote, dir };
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
            singleBranch:   true,
            noTags:         true,
            depth:          1,
        });
        await this._set_config();
        await this._ensure_branch("origin");

        return this;
    }

    async _ensure_branch (remote) {
        const branches = await git.listBranches({
            ...this.gitopts,
            remote,
        });
        if (branches.length) return;
        /* We have cloned an empty repo and we need to ensure whatever
         * we commit goes onto the server's default branch. For now
         * assume the default branch is called 'main'. */
        this.log("Creating default branch 'main' for empty repo %s", this.url);
        await git.branch({
            ...this.gitopts,
            ref:        "main",
            checkout:   true,
        });
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

    static async fetch_file (opts) {
        const co = await Checkout.clone(opts);
        const file = await co.read_file(opts.path);
        await co.dispose();
        return file;
    }

    async commit (message, ...args) {
        if (args.length)
            message = util.format(message, ...args);

        const sts = await git.statusMatrix(this.gitopts);
        if (!sts.some(st => st[2] != 1)) {
            this.log("No changes in %s, skipping commit", this.dir);
            return;
        }

        this.log("Committing in %s: %s", this.dir, message);
        await git.add({
            ...this.gitopts,
            filepath: sts.filter(st => st[2] == 2).map(st => st[0]),
        });
        await Promise.all(
            sts.filter(st => st[2] == 0)
                .map(st => git.remove({ ...this.gitopts, filepath: st[0] })));

        const sha = await git.commit({ ...this.gitopts, message });
        this.log("Committed: %s", sha);
    }

    async push (...commit) {
        if (commit.length)
            await this.commit(...commit);

        this.log("Pushing to %s", this.url);
        const res = await git.push({ ...this.gitopts });
        if (!res.ok)
            throw new Error(`Failed to push to ${this.url}`,
                { cause: res });
        this.log("Pushed %s", Object.keys(res.refs).join(", "));
        await this.dispose();
    }

    async dispose () {
        this.log("Removing checkout %s", this.dir);
        await fs_p.rm(this.dir, { force: true, recursive: true });
    }

    async write_file (file, content) {
        const abs = path.resolve(this.dir, file);

        /* Unlink the filehandle before we write, but hold it open to
         * ensure the inode is not reused. This avoids an iso-git bug
         * where it incorrectly decides a file hasn't changed because
         * the lstat result hasn't changed. (It only looks at timestamps
         * to the nearest second, which is fairly silly.) */
        const fh = await fs_p.open(abs).catch(e => null);
        if (fh) await fs_p.unlink(abs).catch(e => null);

        await fs_p.mkdir(path.dirname(abs), { recursive: true });
        await fs_p.writeFile(abs, content);

        await fh?.close().catch(e => null);
        this.log("Written file %s", abs);
    }

    path_for (...args) {
        return path.resolve(this.dir, ...args);
    }

    async _handle_enoent (cb, args) {
        const abs = this.path_for(...args);
        try {
            return await cb(abs);
        }
        catch (e) {
            if (e.code == "ENOENT")
                return;
            throw e;
        }
    }

    read_file (...args) {
        return this._handle_enoent(f => fs_p.readFile(f, "utf-8"), args);
    }

    unlink_file (...args) {
        return this._handle_enoent(f => fs_p.unlink(f) ?? true, args);
    }

    async mkdir (...args) {
        const dir = this.path_for(...args);
        await fs_p.mkdir(dir, { recursive: true });
        return dir;
    }

    async clean_dir (...args) {
        const dir = this.path_for(...args);
        await fs_p.rm(dir, { force: true, recursive: true });
        await fs_p.mkdir(dir, { recursive: true });
        return dir;
    }

    async write_manifests (dir, file, docs) {
        const fpath = path.join(dir, file);
        const content = docs.map(d => yaml.stringify(d, { directives: true }))
            .join("...\n");
        await this.write_file(fpath, content);
    }

    async read_manifests (dir, file) {
        const abs = path.resolve(this.dir, dir, file);
        const content = await this.read_file(abs);

        const docs = yaml.parseAllDocuments(content);
        if (docs.some(d => d.errors.length > 0)) {
            const rel = path.relative(this.dir, abs);
            throw new Error(`Bad YAML in '${rel}' in repo '${this.url}'`);
        }

        return docs.map(d => d.toJS());
    }

    async write_manifest (manifest) {
        const meta = manifest.metadata;
        const file = manifest_path(meta.namespace, manifest.kind, meta.name);
        const data = yaml.stringify(manifest);

        await this.write_file(file, data);
    }

    async read_manifest (namespace, kind, name) {
        const file = manifest_path(namespace, kind, name);
        const content = await this.read_file(file);
        if (content == undefined) return;

        const obj = yaml.parse(content);
        const meta = obj.metadata;
        if (meta.namespace != namespace || meta.name != name
            || obj.kind != kind
        )
            throw `Misplaced manifest ${this.url}/${file}`;

        return obj;
    }

    unlink_manifest (namespace, kind, name) {
        return this.unlink_file(manifest_path(namespace, kind, name));
    }

    async list_manifests (namespace, kind) {
        const rel = path.dirname(manifest_path(namespace, kind, "any"));
        const abs = path.join(this.dir, rel);
        const files = await fs_p.readdir(abs);
        return files
            .filter(f => f.endsWith(".yaml"))
            .map(f => [namespace, kind, f.slice(0, -5)]);
    }
}

/*
 * ACS Gateway Depot
 * The depot stick image, for people to download. stick/bake.sh builds
 * it, in a Job the Helm chart runs, on a volume we share with that Job.
 * We only report on it and serve it.
 * Copyright 2026 University of Sheffield AMRC
 */

import crypto               from "node:crypto";
import fs                   from "node:fs";
import path                 from "node:path";

import { DepotError }       from "./errors.js";

/* The gateways are amd64, and it is the one K3s binary we serve. */
const ARCH = "amd64";
/* A build that started this long ago has died. */
const BUILD_LIMIT = 60 * 60 * 1000;

export class Stick {
    constructor (opts) {
        this.dir            = opts.dir;
        this.gateway_dir    = opts.gateway_dir;
        this.public_url     = opts.public_url;
        this.ca_file        = opts.ca_file;
        this.versions       = opts.versions;

        this.log = opts.fplus.debug.bound("stick");
        this.name = `depot-stick-${ARCH}.iso`;
    }

    /* What a current stick is built from. stick/bake.sh works out the
     * same value. */
    made_from () {
        const hash = crypto.createHash("sha256");
        hash.update(`${this.public_url}\n${this.versions.UBUNTU_VERSION}\n`);
        hash.update(fs.readFileSync(
            path.join(this.gateway_dir, "agent", "agent.py")));
        if (this.ca_file) hash.update(fs.readFileSync(this.ca_file));
        return hash.digest("hex");
    }

    manifest () {
        if (!this.dir) return null;
        const file = path.join(this.dir, this.name);
        try {
            const info = JSON.parse(fs.readFileSync(file + ".json", "utf8"));
            return fs.existsSync(file) ? info : null;
        }
        catch { return null; }
    }

    building () {
        if (!this.dir) return false;
        try {
            const started = 1000 * Number(
                fs.readFileSync(path.join(this.dir, "building"), "utf8"));
            return Date.now() - started < BUILD_LIMIT;
        }
        catch { return false; }
    }

    /* `state` is ready, building or none. `current` is false when the
     * stick was built for an older version of this service: it still
     * works if our address has not changed. */
    status () {
        const info = this.manifest();
        const building = this.building();
        if (!info) return { state: building ? "building" : "none" };
        return {
            state:      "ready",
            building,
            current:    info.made_from == this.made_from(),
            arch:       info.arch,
            ubuntu:     info.ubuntu,
            size:       info.size,
            built_at:   info.built_at,
            name:       this.name,
            url:        `${this.public_url}/v1/payload/${this.name}`,
        };
    }

    path_for (name) {
        if (name != this.name || !this.manifest())
            throw new DepotError(404, "This service has no depot stick to download yet.");
        return path.join(this.dir, this.name);
    }
}

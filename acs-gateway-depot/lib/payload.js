/*
 * ACS Gateway Depot
 * The files a gateway downloads while it installs: the setup scripts as
 * one archive, and the K3s binary for its CPU.
 * Copyright 2026 University of Sheffield AMRC
 */

import crypto               from "node:crypto";
import fs                   from "node:fs";
import os                   from "node:os";
import path                 from "node:path";

import { DepotError }       from "./errors.js";
import { tar_gz }           from "./tar.js";

/* What goes in the archive, relative to the gateway directory. */
const CONTENTS = ["start.sh", "sh", "versions.env", "agent", "units"];

function sha256_file (file) {
    const hash = crypto.createHash("sha256");
    hash.update(fs.readFileSync(file));
    return hash.digest("hex");
}

export class Payload {
    constructor (opts) {
        this.gateway_dir = opts.gateway_dir;
        this.k3s_dir = opts.k3s_dir;
        this.log = opts.fplus.debug.bound("payload");
        this.k3s = new Map();
    }

    init () {
        for (const item of CONTENTS) {
            if (!fs.existsSync(path.join(this.gateway_dir, item)))
                throw new Error(`Gateway files are incomplete: ${item} is missing from ${this.gateway_dir}`);
        }
        /* The archive is built the same way every time, so a restart
         * gives it the same checksum, and a gateway that was told that
         * checksum before the restart can still fetch it. */
        const archive = tar_gz(this.gateway_dir, CONTENTS);
        this.archive_sha = crypto.createHash("sha256").update(archive).digest("hex");
        this.archive_file = path.join(os.tmpdir(), `gateway-${this.archive_sha}.tar.gz`);
        fs.writeFileSync(this.archive_file, archive);

        this.versions = Object.fromEntries(
            fs.readFileSync(path.join(this.gateway_dir, "versions.env"), "utf8")
                .split("\n")
                .map(l => /^([A-Za-z0-9_]+)="?([^"]*)"?$/.exec(l))
                .filter(Boolean)
                .map(m => [m[1], m[2]]));

        for (const arch of ["amd64", "arm64"]) {
            const file = path.join(this.k3s_dir, `k3s-${arch}`);
            if (!fs.existsSync(file)) continue;
            const sha = sha256_file(file);
            if (sha != this.versions[`K3S_SHA256_${arch}`])
                throw new Error(`${file} does not match the checksum in versions.env`);
            this.k3s.set(arch, { file, sha });
        }
        this.log("Payload ready: scripts %s, K3s %s for %s",
            this.archive_sha.slice(0, 12), this.versions.K3S_VERSION,
            [...this.k3s.keys()].join(", ") || "no architecture");
        return this;
    }

    archive_path (sha) {
        if (sha != this.archive_sha)
            throw new DepotError(404, "That archive is from an older version of this service. Start the install again.");
        return this.archive_file;
    }

    k3s_for (arch) {
        const k3s = this.k3s.get(arch);
        if (!k3s) throw new DepotError(409, `This service has no K3s binary for ${arch} gateways.`);
        return k3s;
    }
}

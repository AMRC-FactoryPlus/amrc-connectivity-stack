/*
 * ACS service setup
 * Check that the edge clusters will run this release's images
 * Copyright 2026 University of Sheffield AMRC
 *
 * Edge clusters deploy the Edge Agent, and its split driver sidecars,
 * from the edge Helm charts on the `main` branch of the central git
 * repo `shared/helm`. The edge-helm-charts step of each install or
 * upgrade commits this release's charts to the `acs` branch, and moves
 * `main` there too only if nobody has committed to `main`. A site that
 * has customised its charts must merge `acs` into `main` itself.
 *
 * Until it does, its edge clusters run the images of an older release.
 * A split driver first published in this release has no image at that
 * tag, so a connection moved to it would get no data. The split driver
 * step therefore only moves connections to a split driver when `main`
 * gives the Edge Agent chart the same default image (tag and registry)
 * as `acs`. It runs after edge-helm-charts, so `acs` is this release.
 *
 * Commits can't be compared: edge-helm-charts makes a new `acs` commit
 * on every run, so a site that has merged `acs` would never contain the
 * latest one. The image is what decides whether the sidecar can start.
 */

import fs   from "fs";
import os   from "os";
import path from "path";

import git  from "isomorphic-git";
import http from "isomorphic-git/http/node";
import yaml from "yaml";

/* The Edge Agent chart's values, relative to the repo root. */
export const VALUES = "charts/edge-agent/values.yaml";

/** The Edge Agent chart's default image, `{ registry, tag }`, from its
 * values file, or undefined if it has none. */
export function default_image (text) {
    const image = yaml.parse(text)?.image?.default;
    if (!image?.tag) return;
    return { registry: image.registry, tag: image.tag };
}

/** Compare the chart values on `main` and `acs`.
 * @arg main The values file on `main`, or undefined if it is missing.
 * @arg acs The same on `acs`.
 * @returns `{ ready: true, image }` if `main` deploys `acs`'s images,
 * otherwise `{ ready: false, reason }`.
 */
export function compare_charts (main, acs) {
    if (acs === undefined)
        return { ready: false, reason: `branch acs has no ${VALUES}` };
    if (main === undefined)
        return { ready: false, reason: `branch main has no ${VALUES}` };

    const [m, a] = [default_image(main), default_image(acs)];
    if (!a)
        return { ready: false, reason: `branch acs has no default image tag` };
    if (!m)
        return { ready: false, reason: `branch main has no default image tag` };

    const show = i => `${i.registry ?? "(no registry)"} tag ${i.tag}`;
    if (m.tag != a.tag || m.registry != a.registry)
        return {
            ready:  false,
            reason: `branch main deploys ${show(m)} but this release is ${show(a)}`,
        };
    return { ready: true, image: a };
}

/** The edge Helm chart repo, read for `compare_charts`. */
export class EdgeCharts {
    /**
     * @arg opts.fplus A ServiceClient, to find and authenticate to the
     * git service.
     * @arg opts.path The repo's path, as edge-helm-charts is given it.
     * @arg opts.dir A directory to fetch into. Its contents are
     * replaced.
     * @arg opts.read Instead of fetching: `read(branch)` returns that
     * branch's values file, or undefined. For tests.
     */
    constructor (opts) {
        this.fplus = opts.fplus;
        this.path = opts.path;
        this.dir = opts.dir ?? path.join(os.tmpdir(), "edge-charts-check");
        this.read = opts.read ?? this.fetch_and_read.bind(this);
    }

    /** Whether the edge clusters will run this release's images.
     * Returns `{ ready, reason }` and never throws: a check that can't
     * be made is not ready. */
    async check () {
        try {
            const [main, acs] = [await this.read("main"), await this.read("acs")];
            return compare_charts(main, acs);
        }
        catch (e) {
            return { ready: false, reason: `can't read ${this.path}: ${e.message ?? e}` };
        }
    }

    async fetch_and_read (branch) {
        if (!this.fetched) this.fetched = this.fetch();
        const opts = await this.fetched;

        let oid;
        try {
            oid = await git.resolveRef({ ...opts, ref: `refs/remotes/origin/${branch}` });
        }
        catch (e) {
            if (e instanceof git.Errors.NotFoundError) return;
            throw e;
        }
        return await read_file(opts, oid, VALUES);
    }

    /* Fetch the tips of main and acs, those that exist. Returns the
     * options to read the local copy with. */
    async fetch () {
        const remote = await this.fplus.Git.remote({ path: this.path });
        const opts = { fs, http, dir: this.dir, ...remote, remote: "origin" };

        const heads = await git.listServerRefs({
            http, url: remote.url,
            onAuth: remote.onAuth, onAuthFailure: remote.onAuthFailure,
            prefix: "refs/heads/",
        });

        fs.rmSync(this.dir, { recursive: true, force: true });
        await git.init({ ...opts, defaultBranch: "main" });
        await git.addRemote(opts);
        for (const ref of ["main", "acs"]) {
            if (!heads.some(h => h.ref == `refs/heads/${ref}`)) continue;
            await git.fetch({ ...opts, ref, singleBranch: true, depth: 1, tags: false });
        }
        return opts;
    }
}

/** A file's text at a commit, or undefined if it isn't there. */
export async function read_file (opts, oid, filepath) {
    try {
        const { blob } = await git.readBlob({ ...opts, oid, filepath });
        return Buffer.from(blob).toString("utf8");
    }
    catch (e) {
        if (e instanceof git.Errors.NotFoundError) return;
        throw e;
    }
}

/*
 * Factory+ NodeJS Utilities
 * Git service interface.
 * Copyright 2023 AMRC.
 */

/* This interface is a bit minimal, as I don't want to depend on a git
 * library. */

import { App, Service } from "../uuids.js";

import { ServiceInterface } from "./service-interface.js";

export default class Git extends ServiceInterface {
    constructor (fplus) {
        super(fplus);

        this.service = Service.Git;
    }

    base_url () {
        return this.fplus.Discovery.service_url(this.service);
    }

    /* This is suitable for isomorphic-git */
    async git_auth (url, auth) {
        const bad = auth?.headers?.Authorization
            ?.match(/^Bearer\s+(\S+)$/)?.[1];

        const base = await this.base_url();
        const tok = await this.fplus.Fetch.service_token(base, bad);

        return {
            headers: {
                "Authorization": `Bearer ${tok}`,
            },
        };
    }

    async repo_by_uuid (uuid) {
        const base = await this.base_url();
        return new URL(`uuid/${uuid}`, base).toString();
    }

    async repo_by_path (path) {
        const base = await this.base_url();
        return new URL(`git/${path}`, base).toString();
    }

    /* Options to splat into iso-git's options where a remote is
     * required. This does not include the http client as we don't know
     * which to use. */
    async remote (opts) {
        const url = opts.uuid 
            ? await this.repo_by_uuid(opts.uuid)
            : await this.repo_by_path(opts.path);
        const auth = this.git_auth.bind(this);
        return {
            url,
            onAuth:         auth,
            onAuthFailure:  auth,
        };
    }
}

/*
 * Factory+ NodeJS Utilities
 * Git service interface.
 * Copyright 2023 AMRC.
 */

/* This interface is a bit minimal, as I don't want to depend on a git
 * library. */

import { Service } from "../uuids.js";

import { ServiceInterface } from "./service-interface.js";

/** Git service interface. */
export class Git extends ServiceInterface {
    /** Private. Construct via ServiceClient. */
    constructor (fplus) {
        super(fplus);

        this.service = Service.Git;
        this.log = this.debug.log.bind(this.debug, "git");
    }

    base_url () {
        return this.fplus.Discovery.service_url(this.service);
    }

    /** Construct HTTP headers for a git request.
     * This constructs HTTP headers to authenticate a git HTTP request.
     * If a previous auth object is provided it will be assumed this has
     * received a 401 response and that token will be invalidated.
     * @arg url The URL of the git repo relative to the service URL
     * @arg auth A previous return value which has received a 401
     * @returns An object with a `headers` property
     */
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

    /** Construct the URL of a git repo, by UUID.
     * @arg uuid The UUID of a git repository
     */
    async repo_by_uuid (uuid) {
        const base = await this.base_url();
        return new URL(`uuid/${uuid}`, base).toString();
    }

    /** Construct the URL of a git repo, by path.
     * @arg path The path of a git repository
     */
    async repo_by_path (path) {
        const base = await this.base_url();
        return new URL(`git/${path}`, base).toString();
    }

    /** Options for `isomorphic-git`.
     * This generates an object suitable for the `remote` parameter to
     * `isomorphic-git` functions. The options object should have either
     * a `uuid` or a `path` key identifying the repo to access.
     * @arg opts Identification of the repo to access
     * @returns A remote object
     */
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

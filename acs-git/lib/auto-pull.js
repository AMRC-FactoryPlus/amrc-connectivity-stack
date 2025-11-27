/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import fs           from "fs";
import path from "path";

import duration     from "parse-duration";
import imm          from "immutable";
import git          from "isomorphic-git";
import http         from "isomorphic-git/http/node";
import rx           from "rxjs";

import * as rxx     from "@amrc-factoryplus/rx-util";

const duration_or_never = i => i == "never" ? -1 : duration(i);

class PullSpec extends imm.Record({
    uuid:       null,
    branch:     null,
    url:        null,
    ref:        "main",
    interval:   null,
    ff:         null,
    secret:     null,
}) {
    static of (uuid, branch, conf) {
        return new PullSpec({
            ...conf,
            uuid, branch,
            interval:   duration_or_never(conf.interval ?? "1h"),
            ff:         conf.merge,
            secret:     conf.auth.secretRef,
        });
    }

    get desc () { return `${this.uuid}@${this.branch}`; }
}

export class AutoPull {
    constructor (opts) {
        this.fplus  = opts.fplus;
        this.data   = opts.data;
        this.status = opts.status;
        this.secrets_dir = opts.secrets_dir || "/run/secrets";

        this.log = this.fplus.debug.bound("pull");
        this.credentials_cache = new Map();
    }

    async init () {
        this.pulls = this._init_pulls();

        return this;
    }

    /**
     * Read a secret from the filesystem
     * @param {string} name - The name of the secret
     * @returns {Promise<string|null>} - The secret value or null if not found
     */
    async readSecret(name) {
        try {
            // Try direct path first
            const secretPath = path.join(this.secrets_dir, name);
            try {
                const content = await fs.promises.readFile(secretPath, 'utf8');
                return content.toString().trim();
            } catch (err) {
                if (err.code !== "ENOENT") {
                    this.log("Error reading secret [%s]: %o", name, err);
                    return null;
                }

                // If not found, try to find it in subdirectories
                const entries = await fs.promises.readdir(this.secrets_dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        try {
                            const nestedPath = path.join(this.secrets_dir, entry.name, name);
                            const content = await fs.promises.readFile(nestedPath, 'utf8');
                            return content.toString().trim();
                        } catch (nestedErr) {
                            // Ignore ENOENT errors for nested paths
                            if (nestedErr.code !== "ENOENT") {
                                this.log("Error reading nested secret [%s/%s]: %o", entry.name, name, nestedErr);
                            }
                        }
                    }
                }
            }

            this.log("Secret not found in any location: %s", name);
            return null;
        } catch (err) {
            this.log("Error accessing secrets directory: %o", err);
            return null;
        }
    }

    /**
     * Get credentials from a secret
     * @param {string} secretRef - The secret reference (name)
     * @returns {Promise<{username: string, password: string}|null>} - The credentials or null
     */
    async getCredentials(secretRef) {
        // Check cache first
        if (this.credentials_cache.has(secretRef)) {
            return this.credentials_cache.get(secretRef);
        }

        const content = await this.readSecret(secretRef);
        if (!content) {
            this.log("Secret not found: %s", secretRef);
            return null;
        }

        try {
            // Try to parse as JSON
            const credentials = JSON.parse(content);
            if (credentials.username && credentials.password) {
                // Cache the credentials
                this.credentials_cache.set(secretRef, credentials);
                return credentials;
            }
        } catch (e) {
            // If not JSON, try to parse as username:password format
            const parts = content.split(':');
            if (parts.length === 2) {
                const credentials = {
                    username: parts[0],
                    password: parts[1]
                };
                // Cache the credentials
                this.credentials_cache.set(secretRef, credentials);
                return credentials;
            }
        }

        this.log("Invalid credentials format in secret: %s", secretRef);
        return null;
    }

    async gitAuth (spec) {
        this.log("Using authentication for %s from secret %s", spec.desc, spec.secret);
        this.log("Secrets directory is: %s", this.secrets_dir);

        try {
            // List available secrets for debugging
            const files = await fs.promises.readdir(this.secrets_dir);
            this.log("Available files in secrets directory: %o", files);

            // Get credentials from the secret
            const credentials = await this.getCredentials(spec.secret);

            if (!credentials) {
                this.log("WARNING: Authentication configured but credentials not found for %s", spec.desc);
                this.log("Secret reference: %s", spec.secret);
                return {};
            }

            this.log("Successfully loaded credentials for %s (username: %s)",
                spec.desc, credentials.username);

            return {
                // Add onAuth handler to provide credentials
                onAuth: () => {
                    this.log("Authentication requested for %s", spec.url);
                    return {
                        username: credentials.username,
                        password: credentials.password,
                    };
                },
                // Add onAuthFailure to handle auth failures
                onAuthFailure: (url, auth) => {
                    this.log("Authentication failed for %s with username %s",
                        spec.desc, auth?.username || 'unknown');
                    // Clear cache to force reload on next attempt
                    this.credentials_cache.delete(spec.secret);
                    return null; // Return null to abort the fetch
                },
            };
        } catch (err) {
            this.log("ERROR setting up authentication for %s: %o", spec.desc, err);
            return {};
        }
    }

    _init_pulls () {
        const updates = spec => rx.defer(() => rx.of(Math.random()*5000)).pipe(
            rx.mergeMap(jitter => rx.timer(jitter, spec.interval)),
            rx.tap({
                next:       () => this.log(`UPDATE ${spec.desc}`),
                subscribe:  () => this.log(`START ${spec.desc}`),
                finalize:   () => this.log(`STOP ${spec.desc}`),
            }),
            /* exhaustMap will avoid running another update if the
             * previous is still running */
            rx.exhaustMap(() => this.update(spec)
                .catch(e => this.log("UPDATE ERROR %s: %s", spec.desc, e))),
        );

        /* status.configs is a seq of imm.Map */
        return this.status.configs.pipe(
            rx.map(entries => entries.toSeq()
                .map(conf => imm.Seq.Keyed(conf.pull))
                .flatMap((pulls, uuid) => pulls
                    .map((pull, branch) => PullSpec.of(uuid, branch, pull)))
                .toSet()),
            rx.distinctUntilChanged(imm.is),
            rxx.mapStartStops(updates),
            rx.mergeAll(),
        );
    }

    async update(spec) {
        const gitdir = `${this.data}/${spec.uuid}`;
        const remote = `_update_${spec.branch}`;

        const get_ref = ref => git.resolveRef({ fs, gitdir, ref })
            .catch(e => e instanceof git.Errors.NotFoundError ? null
                : Promise.reject(e))
        const before = await get_ref(spec.branch);

        await fs.promises.stat(gitdir)
            .catch(() => git.init({
                fs, gitdir,
                bare:           true,
                defaultBranch:  "main",
            }))
        /* There should be noone else trying to create remotes on this
         * repo. However, this update() is not atomic, and if we are
         * killed partway through the remote will not be removed. So,
         * although it's slightly risky, just force creation of the
         * remote. (The alternatives would be to gensym a remote name,
         * which would then lead to leakage of remotes, or to implement
         * some sort of lock on the repo.) */
        await git.addRemote({ fs, gitdir, remote, url: spec.url, force: true });

        // Set up authentication if specified
        const fetchOptions = {
            fs, gitdir, http, remote,
            singleBranch: true,
            ref: spec.ref,
            ...(spec.secret ? await this.gitAuth(spec) : {}),
        };

        // Perform the fetch with authentication if configured
        const mirror = await git.fetch(fetchOptions);
        const sha1 = mirror.fetchHead;

        const set_branch = ref => {
            this.log("Updating %s branch %s to %s", spec.uuid, ref, sha1);
            return git.branch({ fs, gitdir, ref, object: sha1, force: true });
        };
        await set_branch(spec.branch);
        if (spec.ff) {
            const ff = await get_ref(spec.ff);
            if (ff == null || ff == before)
                await set_branch(spec.ff);
            else
                this.log("Leaving %s branch %s at %s", spec.uuid, spec.ff, ff);
        }

        await git.deleteRemote({ fs, gitdir, remote });
        this.status.update(spec.uuid);
    }

    run () {
        this.pulls.subscribe();
    }
}

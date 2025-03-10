/* ACS service setup
 * Git repo setup
 * Copyright 2025 University of Sheffield AMRC
 */

import { UUIDs }    from "@amrc-factoryplus/service-client";

import { Git }      from "./uuids.js";

class GitRepos {
    constructor (ss, local) {
        const { fplus } = ss;
        this.cdb    = fplus.ConfigDB;
        this.log    = fplus.debug.bound("repo");
        this.repos  = ss.config.repoMirror;
        this.shared = local.RepoGroup.Shared;
    }

    /* XXX This is not atomic. We also couldn't use the proposed
     * find-or-create API as the name is only part of the config. */
    async setup_repo (name, spec) {
        const { cdb, shared } = this;
        const path = `shared/${name}`;

        let uuid = await cdb.resolve({
            app:    Git.App.Config,
            query:  { path },
            klass:  shared,
        });
        if (!uuid) {
            this.log("Creating repo %s ∈ %s", path, shared);
            uuid = await cdb.create_object(shared);
        }

        this.log("Using %s for repo %s", uuid, path);
        await cdb.patch_config(UUIDs.App.Info, uuid, "merge", 
            { name: spec.name });
        await cdb.put_config(Git.App.Config, uuid, {
            path,
            pull:   spec.pull,
        });
    }

    async setup_repos () {
        const { cdb, repos } = this;

        for (const [name, repo] of Object.entries(repos)) {
            await this.setup_repo(name, repo);
        }
    }
}

export function setup_git_repos (ss, local) {
    return new GitRepos(ss, local).setup_repos();
}

/* ACS service setup
 * Edge Deployment Operator setup
 * Copyright 2023 AMRC
 */

import { UUIDs }            from "@amrc-factoryplus/utilities";

import { ServiceConfig }    from "./service-config.js";
import { mirror_repo }      from "./clusters/mirror-repo.js";
import { ACS, Clusters, Git }
                            from "./uuids.js";

class ClustersConfig extends ServiceConfig {
    constructor (opts) {
        super({...opts,
            name: "clusters",
            service: UUIDs.Service.Clusters,
        });
    }

    async setup_repo (rep, group, name) {
        const { Auth, CDB } = this;
        const repo = this.config.repo ??= {};

        const have = repo[rep];
        if (have && have.uuid) {
            this.log("Using existing repo %s: %s", rep, have.uuid);
            return;
        }

        const path = `${group}/${rep}`;
        this.log("Creating repo %s", path);
        const uuid = await CDB.create_object(Git.Class.Repo);
        this.log("Created repo %s: %s", path, uuid);
        await CDB.put_config(UUIDs.App.Info, uuid, { name });
        await CDB.put_config(Git.App.Config, uuid, { path });
        await Auth.add_to_group(this.config.group[group].uuid, uuid);
        repo[rep] = { uuid };
    }
}    

async function setup_config (ss, chart) {
    const conf = await new ClustersConfig({ ss }).init();

    await conf.setup_groups(
        ["shared",  UUIDs.Class.GitRepoGroup,   "Shared repositories"],
        ["cluster", UUIDs.Class.GitRepoGroup,   "Edge cluster repositories"],
        ["krbkeys", ACS.Class.UserGroup,        "Edge krbkeys accounts"],
        ["flux",    ACS.Class.UserGroup,        "Edge flux accounts"],
    );

    /* This is probably not the best place for this, but for now the EDO
     * code requires it. */
    conf.config.group.cluster.path = "cluster";

    for (const [key, repo] of Object.entries(ss.config.repoMirror)) {
        await conf.setup_repo(key, "shared", repo.name);
    }

    /* Set up the edge cluster Helm chart to use */
    conf.config.helm ??= {};
    conf.config.helm.cluster = chart;

    return await conf.finish();
}

async function setup_git_perms (ss, group) {
    const account_req = Clusters.Requirement.ServiceAccount;
    const aces = [
        [group.flux.uuid,   Git.Perm.Pull,      group.shared.uuid],
        [account_req,       Git.Perm.Pull,      group.shared.uuid],
        [account_req,       Git.Perm.Pull,      group.cluster.uuid],
        [account_req,       Git.Perm.Push,      group.cluster.uuid],
    ];
    for (const ace of aces) {
        await ss.fplus.Auth.add_ace(...ace);
    }
}

async function setup_git_mirrors (ss, repos) {
    for (const [key, repo] of Object.entries(ss.config.repoMirror)) {
        const uuid = repos[key].uuid;
        await mirror_repo({
            ss, uuid,
            source:     repo.url,
            ref:        repo.ref,
        });
    }
}

export async function setup_clusters (ss, helm) {
    const chart = ss.config.helmChart ?? helm.helm.cluster;
    const config = await setup_config(ss, chart);

    await setup_git_perms(ss, config.group);
    await setup_git_mirrors(ss, config.repo);


    return config;
}

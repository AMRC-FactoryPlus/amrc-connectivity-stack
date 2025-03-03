/* ACS service setup
 * Edge Deployment Operator setup
 * Copyright 2023 AMRC
 */

import { UUIDs }            from "@amrc-factoryplus/service-client";

import { ServiceConfig }    from "./service-config.js";
import { Auth, Clusters, Edge, Git }
                            from "./uuids.js";

class ClustersConfig extends ServiceConfig {
    constructor (opts) {
        super({...opts,
            name: "clusters",
            service: UUIDs.Service.Clusters,
        });
    }

    async create_repo (name) {
        const { CDB } = this;
        const repo = this.config.repo ??= {};

        const have = repo[name];
        if (have && have.uuid) {
            this.log("Using existing repo %s: %s", name, have.uuid);
            return have.uuid
        }

        this.log("Creating repo %s", name);
        const uuid = await CDB.create_object(UUIDs.Class.GitRepo);
        this.log("Created repo %s: %s", name, uuid);
        repo[name] = { uuid };
        return uuid;
    }

    async setup_repo (name, spec) {
        const { CDB } = this;

        const uuid = await this.create_repo(name);

        await CDB.patch_config(UUIDs.App.Info, uuid, "merge", 
            { name: spec.name });
        await CDB.put_config(Git.App.Config, uuid, {
            path:   `shared/${name}`,
            pull:   spec.pull,
        });
        const shared = this.config.group.shared.uuid;
        this.log("Adding %s ∈ %s", uuid, shared);
        await CDB.class_add_member(shared, uuid);
    }
}    

async function setup_config (ss, chart) {
    const conf = await new ClustersConfig({
        ss,
    }).init();

    const { GitRepo, GitRepoGroup } = UUIDs.Class;
    const { EdgeService, EdgeRole } = Auth.Class;
    const { ClusterGroups } = Clusters.Class;
    await conf.setup_groups(
        ["shared",  GitRepoGroup,   "Shared repo"],
        ["cluster", GitRepoGroup,   "Edge cluster repo"],
        ["krbkeys", EdgeRole,       "Edge krbkeys account"],
        ["flux",    EdgeRole,       "Edge flux account"],
    );
    await conf.setup_subgroups(
        [GitRepo,       "shared", "cluster"],
        [EdgeService,   "krbkeys", "flux"],
    );
    await conf.setup_members(
        [ClusterGroups, "flux", "krbkeys", "cluster"],
    );

    /* This is probably not the best place for this, but for now the EDO
     * code requires it. */
    conf.config.group.cluster.path = "cluster";

    for (const [name, repo] of Object.entries(ss.config.repoMirror)) {
        await conf.setup_repo(name, repo);
    }

    /* Set up the edge cluster Helm chart to use */
    conf.config.helm ??= {};
    conf.config.helm.cluster = chart;

    return await conf.finish();
}

async function setup_perms (auth, group) {
    const account_req = Clusters.Requirement.ServiceAccount;
    const { ManageObjects, ReadConfig, WriteConfig } = UUIDs.Permission.ConfigDB;
    const { ManageKerberos, ManageGroup, ManageACL } = UUIDs.Permission.Auth;
    const ReadKerberos = "e8c9c0f7-0d54-4db2-b8d6-cd80c45f6a5c";

    const aces = [
        [account_req,           Git.Perm.Pull,      group.shared.uuid,          true],
        [account_req,           Git.Perm.Pull,      group.cluster.uuid,         true],
        [account_req,           Git.Perm.Push,      group.cluster.uuid,         true],
        [group.flux.uuid,       Git.Perm.Pull,      group.shared.uuid,          true],
        [group.krbkeys.uuid,    ManageObjects,      Auth.Class.EdgeService,     false],
        [group.krbkeys.uuid,    ReadConfig,         UUIDs.App.Info,             false],
        [group.krbkeys.uuid,    WriteConfig,        UUIDs.App.Info,             false],
        [group.krbkeys.uuid,    ReadConfig,         UUIDs.App.SparkplugAddress, false],
        [group.krbkeys.uuid,    WriteConfig,        UUIDs.App.SparkplugAddress, false],
        /* XXX This is root-equivalent */
        [group.krbkeys.uuid,    ManageKerberos,     UUIDs.Special.Null,         false],
        [group.krbkeys.uuid,    ReadKerberos,       UUIDs.Special.Null,         false],
        [group.krbkeys.uuid,    ManageGroup,        Edge.Group.EdgeGroup,       true],
        /* XXX Not much use at present due to pure ranks. Composite
         * perms are a rank higher than ordinary perms. Unused. */
        [group.krbkeys.uuid,    ManageACL,          Edge.Group.EdgePermission,  true],
    ];
    for (const ace of aces) {
        auth.fplus.debug.log("clusters", "Adding %o", ace);
        await auth.add_grant({
            principal:  ace[0],
            permission: ace[1],
            target:     ace[2],
            plural:     ace[3],
        });
    }
}

export async function setup_clusters (ss, helm) {
    const chart = ss.config.helmChart ?? helm.helm.cluster;
    const config = await setup_config(ss, chart);

    await setup_perms(ss.fplus.Auth, config.group);

    return config;
}

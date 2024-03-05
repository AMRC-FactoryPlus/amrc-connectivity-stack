/* ACS service setup
 * Edge Deployment Operator setup
 * Copyright 2023 AMRC
 */

import { UUIDs }            from "@amrc-factoryplus/utilities";

import { ServiceConfig }    from "./service-config.js";
import { ACS, Clusters, Git }
                            from "./uuids.js";

class ClustersConfig extends ServiceConfig {
    constructor (opts) {
        super({...opts,
            name: "clusters",
            service: UUIDs.Service.Clusters,
        });

        this.group = opts.group;
    }

    async create_repo (name) {
        const { CDB } = this;
        const repo = this.config.repo ??= {};
        const path = `${this.group}/${name}`;

        const have = repo[name];
        if (have && have.uuid) {
            this.log("Using existing repo %s: %s", name, have.uuid);
            return have.uuid
        }

        this.log("Creating repo %s", path);
        const uuid = await CDB.create_object(Git.Class.Repo);
        this.log("Created repo %s: %s", path, uuid);
        repo[name] = uuid;
        await CDB.patch_config(Git.App.Config, uuid, "merge", { path });
        return uuid;
    }

    async setup_repo (name, spec) {
        const { Auth, CDB } = this;

        const uuid = await this.create_repo(name);

        await CDB.patch_config(UUIDs.App.Info, uuid, "merge", 
            { name: spec.name });
        await CDB.patch_config(Git.App.Config, uuid, "merge",
            { pull: spec.pull });
        await Auth.add_to_group(this.config.group[this.group].uuid, uuid);
    }
}    

async function setup_config (ss, chart) {
    const conf = await new ClustersConfig({
        ss,
        group:  "shared",
    }).init();

    await conf.setup_groups(
        ["shared",  UUIDs.Class.GitRepoGroup,   "Shared repositories"],
        ["cluster", UUIDs.Class.GitRepoGroup,   "Edge cluster repositories"],
        ["krbkeys", ACS.Class.UserGroup,        "Edge krbkeys accounts"],
        ["flux",    ACS.Class.UserGroup,        "Edge flux accounts"],
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

async function setup_perms (auth, group, edge) {
    const account_req = Clusters.Requirement.ServiceAccount;
    const { ManageObjects, ReadConfig, WriteConfig } = UUIDs.Permission.ConfigDB;
    const { ManageKerberos, ManageGroup, ManageACL } = UUIDs.Permission.Auth;
    const ReadKerberos = "e8c9c0f7-0d54-4db2-b8d6-cd80c45f6a5c";

    const aces = [
        [account_req,           Git.Perm.Pull,      group.shared.uuid],
        [account_req,           Git.Perm.Pull,      group.cluster.uuid],
        [account_req,           Git.Perm.Push,      group.cluster.uuid],
        [group.flux.uuid,       Git.Perm.Pull,      group.shared.uuid],
        [group.krbkeys.uuid,    ManageObjects,      ACS.Class.EdgeAccount],
        [group.krbkeys.uuid,    ReadConfig,         UUIDs.App.Info],
        [group.krbkeys.uuid,    WriteConfig,        UUIDs.App.Info],
        [group.krbkeys.uuid,    ReadConfig,         UUIDs.App.SparkplugAddress],
        [group.krbkeys.uuid,    WriteConfig,        UUIDs.App.SparkplugAddress],
        /* XXX This is root-equivalent */
        [group.krbkeys.uuid,    ManageKerberos,     UUIDs.Special.Null],
        [group.krbkeys.uuid,    ReadKerberos,       UUIDs.Special.Null],
        /* XXX This is root-equivalent due to lack of group member quoting */
        [group.krbkeys.uuid,    ManageGroup,        ACS.Group.EdgeGroups],
        [group.krbkeys.uuid,    ManageACL,          ACS.Group.EdgePermissions],
    ];
    for (const ace of aces) {
        auth.fplus.debug.log("clusters", "Adding %o", ace);
        await auth.add_ace(...ace);
    }

    for (const e of edge) {
        await auth.add_to_group(ACS.Group.EdgeGroups, e);
    }
}

export async function setup_clusters (ss, helm) {
    const chart = ss.config.helmChart ?? helm.helm.cluster;
    const config = await setup_config(ss, chart);

    const edge = Object.values(helm.group).map(g => g.uuid);
    await setup_perms(ss.fplus.Auth, config.group, edge);

    return config;
}

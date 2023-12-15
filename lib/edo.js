/* ACS service setup
 * Edge Deployment Operator setup
 * Copyright 2023 AMRC
 */

import { UUIDs }            from "@amrc-factoryplus/utilities";

import { ServiceConfig }    from "./service-config.js";
import { mirror_repo }      from "./edo/mirror-repo.js";
import { Git }              from "./uuids.js";

class EDOConfig extends ServiceConfig {
    constructor (opts) {
        super({...opts,
            name: "edo",
            service: UUIDs.Service.EdgeDeployment,
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
        await CDB.put_config(Git.Config, uuid, { path });
        await Auth.add_to_group(this.config[group].uuid, uuid);
        repo[rep] = { uuid };
    }
}    

export async function setup_edo (ss, helm) {
    const conf = await new EDOConfig({ ss });

    const klass = ss.config.class;
    await conf.setup_groups(
        ["shared",  klass.repoGroup,    "Shared repositories"],
        ["cluster", klass.repoGroup,    "Edge cluster repositories"],
        ["krbkeys", klass.edgeGroup,    "Edge krbkeys accounts"],
        ["flux",    klass.edgeGroup,    "Edge flux accounts"],
    );

    /* This is probably not the best place for this, but for now the EDO
     * code requires it. */
    conf.config.group.shared.path = "shared";

    for (const [key, repo] of Object.entries(ss.config.repoMirror)) {
        await conf.setup_repo(key, "shared", repo.name);
    }

    /* Set up the edge cluster Helm chart to use */
    conf.config.helm.cluster = ss.config.helmChart.cluster
        ?? helm.helm.cluster;

    const config = await conf.finish();

    for (const [key, repo] of Object.entries(ss.config.repoMirror)) {
        await mirror_repo({
            ss,
            uuid:       config.repo[key].uuid,
            source:     repo.url,
            ref:        repo.ref,
        });
    }

    return config;
}

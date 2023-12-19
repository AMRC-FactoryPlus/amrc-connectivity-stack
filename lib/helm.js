/* ACS service setup
 * Helm chart templates
 * Copyright 2023 AMRC
 */

import { UUIDs } from "@amrc-factoryplus/utilities";

import { ServiceConfig }    from "./service-config.js";
import { ACS, Clusters, EdgeAgent }    
                            from "./uuids.js";

class HelmConfig extends ServiceConfig {
    constructor (opts) {
        super({...opts,
            service:    Clusters.App.HelmTemplate,
            name:       "helm",
        });
    }

    async setup_helm (key, name, spec) {
        const { CDB } = this;
        const helm = this.config.helm ??= {};

        let uuid;
        if (helm[key]) {
            uuid = helm[key];
            this.log("Updating existing chart %s: %s", key, uuid);
        }
        else {
            uuid = await CDB.create_object(Clusters.Class.HelmChart);
            this.log("Created new Helm chart %s: %s", key, uuid);
        }

        await CDB.put_config(UUIDs.App.Info, uuid, { name });
        await CDB.put_config(Clusters.App.HelmTemplate, uuid, spec);
        helm[key] = uuid;
    }

    async setup_charts (...charts) {
        for (const c of charts) {
            await this.setup_helm(...c);
        }
    }
}

export async function setup_helm (ss) {
    const conf = await new HelmConfig({ 
        ss,
    }).init();

    const klass = ss.config.class;
    await conf.setup_groups(
        ["agent",   klass.edgeGroup,    "Edge Agent"],
        ["sync",    klass.edgeGroup,    "Edge Sync account"],
        ["monitor", klass.edgeGroup,    "Edge Monitor account"],
    );

    const acs = ss.acs_config;
    const group = conf.config.group;

    const auth = ss.fplus.Auth;
    await auth.add_to_group(ACS.Group.SparkplugNode, group.agent.uuid);
    await auth.add_ace(group.agent.uuid,
        UUIDs.Permission.ConfigDB.ReadConfig, EdgeAgent.App.Config);
    await auth.add_ace(group.agent.uuid,
        UUIDs.Permission.ConfigDB.ReadConfig, UUIDs.App.SparkplugAddress);

    await conf.setup_charts(
        ["cluster", "Edge cluster", {
            chart:  "edge-cluster",
            source: "helm-charts",
            values: {
                krb5: { realm: acs.realm },
                uuid: {
                    class: {
                        edgeAccount:    klass.edgeAccount,
                    },
                    group: {
                        edgeSync:       group.sync.uuid,
                        edgeMonitor:    group.monitor.uuid,
                } },
                cluster: {
                    name:       "{{name}}",
                    uuid:       "{{uuid}}",
                    domain:     acs.domain,
                    directory:  acs.directory,
        } } }],
        ["agent", "Edge agent", {
            chart:  "edge-agent",
            source: "helm-charts",
            values: {
                name:       "{{name}}",
                uuid:       "{{uuid}}",
                hostname:   "{{hostname}}",
                authGroup: {
                    edgeAgent:  group.agent.uuid,
        } } }],
    );

    return await conf.finish();
}

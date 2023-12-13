/* ACS service setup
 * Helm chart templates
 * Copyright 2023 AMRC
 */

import { UUIDs } from "@amrc-factoryplus/utilities";

import { ServiceConfig }    from "./service-config.js";

const HelmTemplate = "729fe070-5e67-4bc7-94b5-afd75cb42b03";
const HelmChart = "f9be0334-0ff7-43d3-9d8a-188d3e4d472b";

class HelmConfig extends ServiceConfig {
    constructor (opts) {
        super({...opts,
            service:    HelmTemplate,
            name:       "helm",
        });
    }

    async setup_helm (key, name, spec) {
        const { CDB, Auth } = this;
        const helm = this.config.helm ??= {};

        let uuid;
        if (helm[key]) {
            uuid = helm[key];
            this.log("Updating existing chart %s: %s", key, uuid);
        }
        else {
            uuid = await CDB.create_object(HelmChart);
            this.log("Created new Helm chart %s: %s", key, uuid);
        }

        await CDB.put_config(UUIDs.App.Info, uuid, { name });
        await CDB.put_config(HelmTemplate, uuid, spec);
        helm[key] = uuid;
    }

    async setup_charts (...charts) {
        for (const c of charts) {
            await this.setup_helm(...c);
        }
    }
}

export async function setup_helm (ss) {
    const conf = await new ServiceConfig({ 
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
                        edgeSync:       group.sync,
                        edgeMonitor:    group.monitor,
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
                    edgeAgent:  group.agent,
        } } }],
    );

    return await conf.finish();
}

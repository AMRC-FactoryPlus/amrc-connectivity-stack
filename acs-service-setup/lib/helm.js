/* ACS service setup
 * Helm chart templates
 * Copyright 2023 AMRC
 */

import { UUIDs } from "@amrc-factoryplus/service-client";

import { ServiceConfig }    from "./service-config.js";
import { ACS, Auth, Clusters, Edge }    
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

async function setup_perms (auth, group) {
    const { ReadConfig, WriteConfig } = UUIDs.Permission.ConfigDB;
    const { ReloadConfig } = Edge.Perm;
    const { EdgeNodeConsumer } = ACS.Role;

    /* XXX Until we can resolve the issues with dynamic MQTT ACLs,
     * just grant the Monitors the very big hammer of full
     * read/rebirth/reload rights. If we settled on SpGroup ==
     * Cluster we could reduce this to per-Group rights; this would
     * involve either a per-monitor explicit ACE or a new reflexive
     * UUID for group access. */

    const aces = [
        [group.agent.uuid,      ReadConfig,     Edge.App.AgentConfig],
        [group.sync.uuid,       ReadConfig,     Clusters.App.HelmRelease],
        [group.sync.uuid,       ReadConfig,     Clusters.App.HelmTemplate],
        [group.sync.uuid,       ReadConfig,     Edge.App.Deployment],
        [group.sync.uuid,       ReadConfig,     Edge.App.ClusterStatus],
        [group.sync.uuid,       WriteConfig,    Edge.App.ClusterStatus],
        [group.sync.uuid,       EdgeNodeConsumer, ACS.Device.ConfigDB],
        [group.monitor.uuid,    ReadConfig,     Edge.App.AgentConfig],
        [group.monitor.uuid,    EdgeNodeConsumer, ACS.Device.ConfigDB],
        [group.monitor.uuid,    ReloadConfig,   UUIDs.Special.Null],
    ];

    for (const a of aces) {
        auth.fplus.debug.log("helm", "Adding ACE %s", a.join(", "));
        await auth.add_ace(...a);
    }
}

export async function setup_helm (ss) {
    const conf = await new HelmConfig({ 
        ss,
    }).init();

    const { EdgeRole } = Auth.Class;
    const { SparkplugNode, SparkplugReader } = ACS.Group;
    const { EdgeGroup } = Edge.Group;
    await conf.setup_groups(
        ["agent",   EdgeRole,  "Active Edge Agent"],
        ["sync",    EdgeRole,  "Edge sync"],
        ["monitor", EdgeRole,  "Edge monitor"],
    );
    await conf.setup_subgroups(
        [SparkplugNode,     "agent", "monitor"],
        [SparkplugReader,   "monitor"],
    );
    await conf.setup_members(
        [EdgeGroup,     "agent", "sync", "monitor"],
    );

    const acs = ss.acs_config;
    const group = conf.config.group;

    await setup_perms(ss.fplus.Auth, group);

    await conf.setup_charts(
        ["cluster", "Edge cluster", {
            chart:  "edge-cluster",
            source: "helm-charts",
            values: {
                krb5: { realm: acs.realm },
                uuid: {
                    class: {
                        edgeAccount:    ACS.Class.EdgeAccount,
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
        ["modbus", "Modbus-REST adapter", {
            chart:  "modbus-rest",
            values: {
                name:       "{{name}}",
                uuid:       "{{uuid}}",
                hostname:   "{{hostname}}",
        } }],
    );

    return await conf.finish();
}

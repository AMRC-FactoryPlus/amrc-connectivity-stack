/* ACS service setup
 * Fixups from old configurations
 * Copyright 2023 AMRC
 */

import * as k8s from "@kubernetes/client-node";

import { UUIDs } from "@amrc-factoryplus/service-client";

import { ACS, Auth, Clusters } from "./uuids.js";

const APIVERSION = "factoryplus.app.amrc.co.uk/v1";
const ACCUUID = "krbkeys.factoryplus.app.amrc.co.uk/account-uuid";

export async function fixups (ss, local) {
    const { fplus } = ss;

    await new FixupAccounts(fplus, local).run();

    return;
}

class FixupAccounts {
    constructor (fplus, local) {
        this.fplus = fplus;
        this.log = fplus.debug.bound("accounts");
        this.Local = local;
    }

    async run () {
        await this.central_krbkeys();
        await this.edge_accounts();
    }

    async set_owner (obj, owner) {
        if (!owner) {
            this.log("Can't find correct owner for %s");
            return;
        }
        this.log("Setting ownership of %s to %s", obj, owner);
        await this.fplus.ConfigDB.patch_config(UUIDs.App.Registration,
            obj, "merge", { owner });
    }

    /* We need to reset ownership on account objects which should be owned
     * by krbkeys. For central krbkeys we don't know whether additional
     * resources have been deployed so we need to check the cluster. */
    async central_krbkeys () {
        this.log("Resetting ownership on central KerberosKey accounts");
        
        const kc = new k8s.KubeConfig();
        kc.loadFromCluster();
        const namespace = kc.getContextObject(kc.currentContext).namespace;
        const objs = k8s.KubernetesObjectApi.makeApiClient(kc);
        
        const kks = await objs.list(APIVERSION, "KerberosKey", namespace);

        const accounts = kks.items
            .map(k => k.metadata?.annotations?.[ACCUUID])
            .filter(v => v != null);

        for (const a of accounts)
            await this.set_owner(a, ACS.ServiceAccount.KrbKeys);
    }

    /* For edge accounts we have to make a few more assumptions as we
     * don't have access to the edge cluster. So we assume all Edge Flux
     * and Edge Krbkeys accounts were created by cluster-manager, and
     * all other Edge accounts were created by the edge krbkeys. */
    async edge_accounts () {
        this.log("Resetting ownership on edge accounts");

        const auth = this.fplus.Auth;
        const cdb = this.fplus.ConfigDB;

        const clmgrs = await cdb.class_members(Clusters.Requirement.ServiceAccount)
            .catch(() => []);
        if (clmgrs.length > 1)
            throw new Error("Multiple Cluster Manager service accounts");
        const clmgr = clmgrs[0];

        const members = c => cdb.class_members(c)
            .then(l => new Set(l))
            .catch(() => new Set());

        /* Edge Agents are owned by their creators. These will have to
         * be fixed manually as we have no way of knowing who they are.
         * For now the edge krbkeys have change-membership permission on
         * all Edge Agents; this isn't ideal but I haven't worked out
         * how to implement a class of Agents per cluster yet.
         */
        //const agent = await members(Auth.Class.EdgeAgent);
        
        const service = await members(Auth.Class.EdgeService);
        const flux = await members(this.Local.Role.EdgeFlux);
        const krbkeys = await members(this.Local.Role.EdgeKrbkeys);

        const for_cl = flux.union(krbkeys);
        const for_kk = service.difference(for_cl);

        if (clmgr) {
            this.log("Setting ownership for Cluster Manager accounts");
            for (const a of for_cl)
                await this.set_owner(a, clmgr);
        }
        else {
            this.log("No Cluster Manager account");
        }

        /* Now we have to place the edge accounts with their owners. To
         * do this we need to extract the clusters from the UPNs. */
        const upns = await Promise.all([...krbkeys, ...for_kk]
            .map(u => auth.get_identity(u, "kerberos")
                .then(upn => [u, /^[^/]+\/([^/@]+)/.exec(upn)?.[1]])));
        const clusters = new Map(upns.filter(([u, c]) => c));

        const cluster_kk = new Map([...krbkeys]
            .map(k => [clusters.get(k), k])
            .filter(([k, v]) => k));

        this.log("Setting ownership for edge krbkeys accounts");
        for (const e of for_kk)
            await this.set_owner(e, cluster_kk.get(clusters.get(e)));
    }
}

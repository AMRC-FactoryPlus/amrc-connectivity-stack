/* ACS service setup
 * Fixups from old configurations
 * Copyright 2023 AMRC
 */

import k8s from "@kubernetes/client-node";

import { Auth } from "./uuids.js";

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

    /* We need to reset ownership on account objects which should be owned
     * by krbkeys. For central krbkeys we don't know whether additional
     * resources have been deployed so we need to check the cluster. */
    async central_krbkeys () {
        const kc = new k8s.KubeConfig();
        kc.loadFromCluster();
        const namespace = kc.getContextObject(kc.currentContext).namespace;
        const objs = k8s.KubernetesObjectApi.makeApiClient(kc);
        
        const { response, body } = await objs.list(APIVERSION, "KerberosKey", namespace);
        if (response.statusCode != 200)
            throw new Error(`Can't list KerberosKeys: ${response.statusCode}`);

        const accounts = body.items
            .map(k => k.metadata?.annotations?.[ACCUUID])
            .filter(v => v != null);
        this.log("CENTRAL KRBKEYS: %o", accounts);
    }

    /* For edge accounts we have to make a few more assumptions as we
     * don't have access to the edge cluster. So we assume all Edge Flux
     * and Edge Krbkeys accounts were created by cluster-manager, and
     * all other Edge accounts were created by the edge krbkeys. */
    async edge_accounts () {
        const auth = this.fplus.Auth;
        const cdb = this.fplus.ConfigDB;

        const members = c => cdb.class_members(c).then(l => new Set(l));

        const agent = await members(Auth.Class.EdgeAgent);
        const service = await members(Auth.Class.EdgeService);
        const flux = await members(this.Local.Role.EdgeFlux);
        const krbkeys = await members(this.Local.Role.EdgeKrbkeys);

        const clmgr = flux.union(krbkeys);
        const edge = service.difference(clmgr).union(agent);

        this.log("CLUSTER MANAGER: %o", clmgr);
        this.log("EDGE KRBKEYS: %o", edge);

        /* Now we have to place the edge accounts with their owners. To
         * do this we need to extract the clusters from the UPNs. */
        const upns = await Promise.all([...krbkeys, ...edge]
            .map(u => auth.get_identity(u, "kerberos")
                .then(upn => [u, /^[^/]+\/([^/@]+)/.exec(upn)?.[1]])));
        const clusters = new Map(upns.filter(([u, c]) => c));
        this.log("CLUSTERS: %o", clusters);

        const kk_c = new Map([...krbkeys]
            .map(k => [clusters.get(k), k])
            .filter(([k, v]) => k));
        this.log("KRBKEYS: %o", kk_c);

        for (const e of edge) {
            this.log("EDGE ACCOUNT %s OWNER %s", e, kk_c.get(clusters.get(e)));
        }
    }
}

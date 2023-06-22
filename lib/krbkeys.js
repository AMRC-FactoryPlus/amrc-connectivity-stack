/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Deployment operator
 * KrbKeys / Kubernetes interaction
 * Copyright 2023 AMRC
 */

import k8s          from "@kubernetes/client-node";

import { Debug }    from "@amrc-factoryplus/utilities";

import { KRB, FLUX, krb_key }    from "./manifests.js";

const debug = new Debug();

export class KrbKeys {
    constructor (opts) {
        this.fplus      = opts.fplus;

        this.log = debug.log.bind(debug, "krbkeys");

        const kc = this.kc = new k8s.KubeConfig();
        kc.loadFromCluster();
        this.namespace = kc.getContextObject(kc.currentContext).namespace;
    }

    async create_krbkey (spec) {
        const { uuid, principal } = spec;

        this.log("Creating KerberosKey for %s", principal);
        const krb = flux_krb_key(this.namespace, principal, uuid);
        this.log("Built KrbKey object: %o", krb);

        const api = this.kc.makeApiClient(k8s.CustomObjectsApi);
        const res = await api.createNamespacedCustomObject(
            KRB.group, KRB.version, this.namespace, KRB.plural, krb);
    }
}

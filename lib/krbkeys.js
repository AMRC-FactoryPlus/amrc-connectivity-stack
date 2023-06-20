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
        this.realm      = opts.realm;

        this.log = debug.log.bind(debug, "krbkeys");

        const kc = this.kc = new k8s.KubeConfig();
        kc.loadFromCluster();
        this.namespace = kc.getContextObject(kc.currentContext).namespace;
    }

    async create_krbkey (name, uuid) {
        this.log("Creating KerberosKey for cluster %s", uuid);
        const api = this.kc.makeApiClient(k8s.CustomObjectsApi);
        const krb = krb_key(this.namespace, this.realm, name, uuid);
        this.log("Built KrbKey object: %o", krb);
        const res = await api.createNamespacedCustomObject(
            KRB.group, KRB.version, this.namespace, KRB.plural, krb);

        this.log("K8s response: %o", res);
    }
}

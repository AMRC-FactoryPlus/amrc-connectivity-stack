/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Deployment operator
 * Manifest creation functions
 * Copyright 2023 AMRC
 */


/* The namespace here needs to be kept in sync with the flux system as
 * installed by the shared/flux-system repo. */
export const FLUX = {
    ns:         "flux-system",
    secret:     "op1flux-secrets",
    username:   "op1flux/%s",
    branch:     "main",
};
export const KRB = {
    group:      "factoryplus.app.amrc.co.uk",
    version:    "v1",
    kind:       "KerberosKey",
    plural:     "kerberos-keys",
};

export function sealed_secret (namespace, name) {
    return {
        apiVersion: "bitnami.com/v1alpha1",
        kind: "SealedSecret",
        metadata: { namespace, name },
        spec: {
            encryptedData: {},
            template: {
                data: null,
                metadata: { namespace, name },
                type: "Opaque",
    }, }, };
}

export function flux_krb_key (namespace, principal, cluster) {
    const kname = principal.replace(/@.*/, "").replaceAll("/", ".");
    return {
        apiVersion: `${KRB.group}/${KRB.version}`,
        kind: KRB.kind,
        metadata: {
            namespace, 
            name: kname,
        },
        spec: {
            principal,
            type:           "Password",
            secret:         `${FLUX.secret}/password`,
            cluster: {
                uuid:       cluster,
                namespace:  FLUX.ns,
    }, }, };
}

export function namespace (name) {
    return {
        apiVersion: "v1",
        kind: "Namespace",
        metadata: { name },
    };
}

/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Deployment operator
 * Manifest creation functions
 * Copyright 2023 AMRC
 */

import util from "util";

const interval = "3h0m0s";

export const README = `
This repo is managed by the Edge Deployment Operator.
As such some conventions need to be observed.

* All manifests must be 1-per-file.
* All manifests must be YAML, but any comments or formatting are likely
    to be removed by the operator.
* Namespaced objects go in \`NAMESPACE/KIND/NAME.yaml\`,
    e.g. \`fplus-edge/Deployment/edge-agent.yaml\`.
* Cluster-wide object go in \`_cluster/KIND/NAME.yaml\`.
`;

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

export function git_repo (name, url) {
    return {
        apiVersion: "source.toolkit.fluxcd.io/v1",
        kind: "GitRepository",
        metadata: { namespace: FLUX.ns, name },
        spec: {
          interval,
          ref: { branch: FLUX.branch },
          secretRef: { name: FLUX.secret },
          url,
    }, };
}

export function flux_kust (name, source) {
    return {
        apiVersion: "kustomize.toolkit.fluxcd.io/v1",
        kind: "Kustomization",
        metadata: { namespace: FLUX.ns, name },
        spec: {
            interval,
            path: "./",
            prune: true,
            sourceRef: {
                kind: "GitRepository",
                name: source,
    }, }, };
}

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

export function krb_key (namespace, realm, name, uuid) {
    const user = util.format(FLUX.username, name);
    const kname = user.replaceAll("/", ".");
    return {
        apiVersion: `${KRB.group}/${KRB.version}`,
        kind: KRB.kind,
        metadata: {
            namespace, 
            name: kname,
        },
        spec: {
            principal:      `${user}@${realm}`,
            type:           "Password",
            secret:         `${FLUX.secret}/password`,
            cluster: {
                uuid,
                namespace:  FLUX.ns,
    }, }, };
}

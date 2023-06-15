/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Deployment operator
 * Manifest creation functions
 * Copyright 2023 AMRC
 */

const interval = "3h0m0s";

export const README = `
This repo is managed by the Edge Deployment Operator.
As such some conventions need to be observed.

* All manifests should be 1-per-file.
* All manifests should be JSON.
* Namespaced objects go in \`NAMESPACE/KIND/NAME.json\`,
    e.g. \`fplus-edge/Deployment/edge-agent.json\`.
* Cluster-wide object go in \`_cluster/KIND/NAME.json\`.
`;

export function git_repo (namespace, name, url) {
    return {
        apiVersion: "source.toolkit.fluxcd.io/v1",
        kind: "GitRepository",
        metadata: { namespace, name, },
        spec: {
          interval,
          ref: { branch: "main" },
          secretRef: { name: "op1flux-secrets" },
          url,
    }, };
}

export function flux_kust (namespace, name, source) {
    return {
        apiVersion: "kustomize.toolkit.fluxcd.io/v1",
        kind: "Kustomization",
        metadata: { namespace, name },
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

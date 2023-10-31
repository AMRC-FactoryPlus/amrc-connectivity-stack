/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Sync Op
 * Cluster node list updates
 * Copyright 2023 AMRC
 */

import deep_equal       from "deep-equal";
import k8s              from "@kubernetes/client-node";
import rx               from "rxjs";

import * as rxx         from "@amrc-factoryplus/rx-util";
import { Debug, ServiceError, UUIDs } from "@amrc-factoryplus/utilities";

import { Edge }             from "./uuids.js";

const debug = new Debug();

const LABELS = {
    host:       "kubernetes.io/hostname",
    control:    "node-role.kubernetes.io/control-plane",
};

export class Nodes {
    constructor (opts) {
        this.fplus = opts.fplus;
        this.cluster = opts.cluster;
        this.kc = opts.kubeconfig;
        this.namespace = opts.namespace;

        this.cdb = this.fplus.ConfigDB;
        this.log = this.fplus.debug.log.bind(this.fplus.debug, "hosts");

        this.nodes = this.nodes_observable();
    }

    async init () {
        return this;
    }

    nodes_observable () {
        return rxx.k8s_watch({
            k8s,
            kubeconfig: this.kc,
            errors:     e => this.log("Error watching K8s nodes: %s", e),
            apiVersion: "v1",
            kind:       "Node",
            value:      obj => {
                const meta = obj.metadata;
                const info = obj.status.nodeInfo;
                return {
                    hostname:       meta.labels[LABELS.host],
                    arch:           info.architecture,
                    k8s_version:    info.kubeletVersion,
                    control_plane:  meta.labels[LABELS.control] == "true",
                };
            },
            equal:      deep_equal,
        });
    }

    run () {
        this.log("Subscribing nodes seq");
        this.nodes.pipe(
            rx.switchMap(this.nodes_update.bind(this)),
        ).subscribe();
    }

    nodes_update (nodes) {
        const cdb = this.fplus.ConfigDB;
        const app = Edge.App.ClusterStatus;

        /* XXX This PATCH-then-PUT logic is not atomic. We could end up
         * overwriting an existing entry entirely. Should the ConfigDB
         * be changed to accept a patch to a nonexistent config? (Of
         * course the patch would have to satisfy the schema, if any, on
         * its own.) */
        return rx.of(nodes.toJS()).pipe(
            rx.tap(data => 
                this.log("Updating hosts for %s: %o", this.cluster, data)),
            rx.map(data => ({ hosts: data })),
            rx.mergeMap(data => 
                cdb.patch_config(app, this.cluster, "merge", data)
                .catch(err => {
                    if (!(err instanceof ServiceError && err.status == 404))
                        throw err;
                    this.log("Cluster PATCH failed, trying PUT");
                    return cdb.put_config(app, this.cluster, data);
                })),
            rxx.retry_backoff(5000,
                e => this.log("Status update error: %s", e)),
        );
    }
}

/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Sync Op
 * Cluster node list updates
 * Copyright 2023 AMRC
 */

import deep_equal       from "deep-equal";
import * as k8s         from "@kubernetes/client-node";
import rx               from "rxjs";

import * as rxx         from "@amrc-factoryplus/rx-util";

import { Edge }             from "./uuids.js";

const LABELS = {
    host:           "kubernetes.io/hostname",
    control:        "node-role.kubernetes.io/control-plane",
    specialised:    "factoryplus.app.amrc.co.uk/specialised",
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
                const specialised = obj.spec.taints
                    ?.filter(t => t.key == LABELS.specialised)
                    ?.map(t => t.value)
                    ?.[0];
                const ready = obj.status.conditions
                    ?.some(c => c.type == "Ready" && c.status == "True");
                return {
                    hostname:       meta.labels[LABELS.host],
                    arch:           info.architecture,
                    k8s_version:    info.kubeletVersion,
                    control_plane:  meta.labels[LABELS.control] == "true",
                    os_version:     info.osImage,
                    ready, specialised,
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

        return rx.of(nodes.valueSeq().toArray()).pipe(
            rx.tap(hosts => 
                this.log("Updating hosts for %s: %o", this.cluster, hosts)),
            rx.map(hosts => ({ hosts })),
            rx.mergeMap(data => 
                cdb.patch_config(app, this.cluster, "merge", data)),
            rxx.retry_backoff(5000,
                e => this.log("Status update error: %s", e)),
        );
    }
}

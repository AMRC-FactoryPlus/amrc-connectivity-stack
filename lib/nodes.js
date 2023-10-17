/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Sync Op
 * Cluster node list updates
 * Copyright 2023 AMRC
 */

import deep_equal       from "deep-equal";
import * as imm         from "immutable";
import k8s              from "@kubernetes/client-node";
import rx               from "rxjs";

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
        const watch = new k8s.Watch(this.kc); 
        return new rx.Observable(obs => {
            /* watch returns a promise to a request, but this function
             * is not async. We don't need to await here; the callbacks
             * will get called when they are called. But when
             * unsubscription is requested we need to chain an abort
             * request onto the promise; usually (but not always) this
             * will execute immediately. */
            const reqp = watch.watch("/api/v1/nodes", {},
                (type, obj) => obs.next([type, obj]), 
                err => err == null ? obs.complete() : obs.error(err));

            return () => reqp.then(req => req.abort());
        }).pipe(
            rx.tap({ 
                subscribe: () => this.log("K8s nodes subscribed"),
                //next: v => this.log("K8s nodes value: %o", v),
                error: e => this.log("Error watching K8s nodes: %s", e),
            }),
            rx.retry({ delay: 5000 }),
            rx.map(([act, obj]) => [act, obj.metadata, obj.status.nodeInfo]),
            rx.map(([act, meta, info]) => [act, meta.uid, {
                hostname:       meta.labels[LABELS.host],
                arch:           info.architecture,
                k8s_version:    info.kubeletVersion,
                control_plane:  meta.labels[LABELS.control] == "true",
            }]),
            rx.scan(
                (nodes, [act, uuid, node]) => act == "DELETED"
                    ? nodes.delete(uuid)
                    : nodes.set(uuid, node),
                new imm.Map()),
            rx.distinctUntilChanged(deep_equal),
            rx.debounceTime(100),
        );
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
            rx.tap({ error: e => this.log("Status update error: %s", e) }),
            rx.retry({ delay: 5000 }),
        );
    }
}

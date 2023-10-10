/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Sync Op
 * Reconciliation operator
 * Copyright 2023 AMRC
 */

import deep_equal       from "deep-equal";
import * as imm         from "immutable";
import k8s              from "@kubernetes/client-node";
import rx               from "rxjs";

import { Debug, UUIDs } from "@amrc-factoryplus/utilities";

import { Edge }             from "./uuids.js";

const debug = new Debug();

export class Reconciler {
    constructor (opts) {
        this.fplus = opts.fplus;
        this.cdb = this.fplus.ConfigDB;
        this.log = this.fplus.debug.log.bind(this.fplus.debug, "reconcile");

        const kc = this.kc = new k8s.KubeConfig();
        kc.loadFromDefault();
        this.namespace = kc.getContextObject(kc.currentContext).namespace;

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
            rx.map(([act, obj]) => [act, {
                uuid:           obj.metadata.uid,
                hostname:       obj.metadata.labels["kubernetes.io/hostname"],
                arch:           obj.status.nodeInfo.architecture,
                k8s_version:    obj.status.nodeInfo.kubeletVersion,
            }]),
            rx.scan(
                (nodes, [act, node]) => act == "DELETED"
                    ? nodes.delete(node.uuid)
                    : nodes.set(node.uuid, node),
                new imm.Map()),
            rx.distinctUntilChanged(deep_equal),
            rx.debounceTime(100),
        );
    }

    run () {
        this.log("Subscribing nodes seq");
        this.nodes.subscribe(ns => this.log("NODES: %o", ns.toJS()));
    }
}

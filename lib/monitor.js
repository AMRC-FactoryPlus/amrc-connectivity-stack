/*
 * ACS Edge Monitor
 * Monitor class
 * Copyright 2023 AMRC
 */

import util         from "util";

import imm          from "immutable";
import rx           from "rxjs";
import k8s          from "@kubernetes/client-node";

import * as rxx             from "@amrc-factoryplus/rx-util";

import { AgentMonitor, NodeMonitor }    from "./node.js";
import { App }                          from "./uuids.js";

const CRD = {
    group:      "factoryplus.app.amrc.co.uk",
    version:    "v1",
    plural:     "sparkplugnodes",
};

const NodeSpec = imm.Record({ uuid: null, edge_agent: true });

export class Monitor {
    constructor (opts) {
        this.fplus = opts.fplus;

        this.log = this.fplus.debug.log.bind(this.fplus.debug, "monitor");
    }

    async init () {
        const kc = this.kubeconfig = new k8s.KubeConfig();
        kc.loadFromDefault();
        this.namespace = kc.getContextObject(kc.currentContext).namespace;
        this.k8s_watch = new k8s.Watch(kc);

        this.nodes = this._init_nodes();

        return this;
    }

    run () {
        this.nodes.subscribe(v => this.log("SP node: %o", v));
    }

    /* Watch the SparkplugNode objects on the cluster. Publishes
     * Immutable.Maps of the current state. */
    _init_nodes () {
        const path = util.format("/apis/%s/%s/namespaces/%s/%s",
            CRD.group, CRD.version, this.namespace, CRD.plural);
        this.log("Watching %s", path);
        
        /* Watch K8s SparkplugNode objects */
        const nodes = rxx.k8s_watch({
            watch:  this.k8s_watch,
            path,
            errors: e => this.log("SP node watch error: %s", e),
            value:  obj => obj.spec,
        }).pipe(
            /* We only care about the objects, not the k8s UUIDs, and we
             * can only handle Nodes with F+ UUIDs. */
            rx.map(ns => {
                const [uuids, addrs] = ns.valueSeq()
                    .partition(n => !n.uuid);
                for (const n of addrs)
                    this.log("Can't handle non-F+ Node %s", n.address);
                return uuids
                    .map(n => NodeSpec({
                        uuid:           n.uuid,
                        edge_agent:     n.edgeAgent,
                    }))
                    .toSet();
            }),
            /* Make sure one value is always available whenever we get a
             * new subscriber */
            rx.shareReplay(1),
        );
        /* Work out what's changed */
        const changes = nodes.pipe(
            rx.startWith(imm.Set()),
            rx.pairwise(),
            rx.mergeMap(([then, now]) => imm.Seq([
                then.subtract(now).map(u => [false, u]),
                now.subtract(then).map(u => [true, u]),
            ]).flatten()),
            rx.share(),
        );
        /* Split the changes into starts and stops */
        const [starts, stops] = rx.partition(changes, ch => ch[0])
            .map(seq => seq.pipe(rx.map(ch => ch[1])));

        /* When we get a "start", start a new sequence monitoring that
         * node. Merge the results into our output. */
        return starts.pipe(
            rx.tap(u => this.log("START: %s", u)),
            rx.flatMap(({edge_agent, uuid}) => {
                const stopper = stops.pipe(
                    rx.filter(stop => stop == uuid),
                    rx.tap(v => this.log("stopper for %s: %s", uuid, v)),
                );

                const MClass = edge_agent ? AgentMonitor : NodeMonitor;
                const monitor = new MClass({ 
                    fplus: this.fplus, 
                    uuid 
                });

                return monitor.checks().pipe(
                    rx.takeUntil(stopper),
                    rx.finalize(() => this.log("STOP: %s", uuid)),
                );
            }),
        );
    }
}

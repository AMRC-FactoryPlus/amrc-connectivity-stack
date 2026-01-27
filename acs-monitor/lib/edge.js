/* ACS Edge Monitor
 * Monitor class
 * Copyright 2023 AMRC
 */

import imm          from "immutable";
import rx           from "rxjs";
import * as k8s     from "@kubernetes/client-node";

import * as rxx     from "@amrc-factoryplus/rx-util";

import { NodeSpec } from "./nodespec.js";

const SecretStatus = imm.Record({
    uuid:           null,
    generation:     null,
    observed:       null,
    synced:         null,
});
SecretStatus.of = obj => SecretStatus({
    uuid:           obj.metadata.uid,
    generation:     obj.metadata.generation,
    observed:       obj.status?.observedGeneration,
    synced:         !!obj.status?.conditions
                        ?.some(c => c.type == "Synced" && c.status == "True"),
});

export class EdgeMonitor {
    constructor (opts) {
        this.fplus      = opts.fplus;
        this.sparkplug  = opts.sparkplug;

        this.log = this.fplus.debug.log.bind(this.fplus.debug, "monitor");
    }

    async init () {
        const kc = this.kubeconfig = new k8s.KubeConfig();
        kc.loadFromDefault();
        this.namespace = kc.getContextObject(kc.currentContext).namespace;

        const nodes = this._init_nodes();
        const [starts, stops] = this._node_start_stops(nodes);
        this.node_checks = this._init_node_checks(starts, stops);
        this.secrets = this._init_secrets();

        return this;
    }

    async run () {
        /* Create one watcher here. The only-one logic in the library
         * has a race condition. We must not do this in init() as we
         * have to let the Sparkplug node go first. */
        this.cdb_watch = await this.fplus.ConfigDB.watcher();

        this.node_checks.subscribe();
    }

    /* Watch the SparkplugNode objects on the cluster. Publishes
     * Immutable.Maps of the current state. */
    _init_nodes () {
        /* Watch K8s SparkplugNode objects. Converting to an immutable
         * NodeSpec at this point allows the distinct-until-changed to
         * work correctly. */
        return rxx.k8s_watch({
            k8s,
            kubeconfig:     this.kubeconfig,
            errors:         e => {
                if (!(e instanceof rxx.StoppedError))
                    this.log("SP node watch error: %s", e);
            },
            apiVersion:     "factoryplus.app.amrc.co.uk/v1",
            kind:           "SparkplugNode",
            namespace:      this.namespace,
            value:          obj => NodeSpec.of(obj.spec),
        }).pipe(
            /* We only care about the objects, not the k8s UUIDs, and we
             * can only handle Nodes with F+ UUIDs. */
            rx.map(ns => {
                const [uuids, addrs] = ns.valueSeq()
                    .partition(n => !n.uuid);
                for (const n of addrs)
                    this.log("Can't handle non-F+ Node %s", n.address);
                return uuids.toSet();
            }),
            /* Make sure one value is always available whenever we get a
             * new subscriber */
            rxx.shareLatest(),
        );
    }

    _node_start_stops (nodes) {
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
        return rx.partition(changes, ch => ch[0])
            .map(seq => seq.pipe(rx.map(ch => ch[1])));
    }

    _init_node_checks (starts, stops) {
        /* When we get a "start", start a new sequence monitoring that
         * node. Merge the results into our output. */
        return starts.pipe(
            rx.flatMap(spec => {
                /* Watch for a stop signal for this node UUID */
                const stopper = stops.pipe(
                    rx.filter(stop => stop.uuid == spec.uuid),
                );

                const monitor = spec.monitor(this);

                /* Run the monitor checks until we get a stop */
                return rx.from(monitor.init()).pipe(
                    rx.mergeMap(m => m.checks()),
                    rx.takeUntil(stopper),
                    rx.finalize(() => this.log(
                        "Stopped monitor for %s", spec.uuid)),
                );
            }),
        );
    }

    _init_secrets () {
        return rxx.k8s_watch({
            k8s,
            kubeconfig:     this.kubeconfig,
            errors:         e => this.log("SealedSecret watch error: %s", e),
            apiVersion:     "bitnami.com/v1alpha1",
            kind:           "SealedSecret",
            namespace:      this.namespace,
            key:            obj => obj.metadata.name,
            value:          obj => SecretStatus.of(obj),
        }).pipe(
            rxx.shareLatest(),
        );
    }
}

/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Deployment operator
 * Cluster handling
 * Copyright 2023 AMRC
 */

import stream from "stream";

import Imm      from "immutable";
import JMP      from "json-merge-patch";
import rx       from "rxjs";
import Template from "json-templates";

import { Debug, UUIDs }         from "@amrc-factoryplus/utilities";

import { Update, Delete }       from "./actions.js";
import { Checkout }             from "./checkout.js";
import { Edge }                 from "./uuids.js";

export class Clusters {
    constructor (opts) {
        this.fplus      = opts.fplus;
        /* This is used by actions.js */
        this.realm      = opts.realm;

        this.log        = this.fplus.debug.bound("edge");
    }

    async init () {
        const cdb = this.fplus.ConfigDB;
        const watcher = await cdb.watcher();

        /* XXX We could track changes here, but this is only updated by
         * service-setup on ACS upgrade. */
        this.config = await cdb.get_config(
            UUIDs.App.ServiceConfig, Edge.Service.EdgeDeployment);

        /* XXX We should track changes here, and update the cluster. */
        const tmpl = (app, obj) => cdb.get_config(app, obj)
            .then(t => Template(t));
        this.template = {
            flux:       await tmpl(Edge.App.Flux, Edge.App.Flux),
            cluster:    await tmpl(Edge.App.HelmChart, this.config.helm.cluster),
            helm:       await tmpl(Edge.App.HelmRelease, Edge.App.HelmRelease),
        };

        /* [uuid, patch] requesting status updates */
        this.status_updates = new rx.Subject();

        const clusters = this._init_clusters(cdb, watcher);

        this.status = this._init_status(cdb);
        this.status_patches = this._init_status_patches(cdb);
        this.cluster_updates = this._init_cluster_updates(clusters);

        return this;
    }

    /* Obs of Set(uuid) indicating the clusters in the ConfigDB */
    _init_clusters (cdb, watcher) {
        const app = Edge.App.Cluster;

        return watcher.application(app).pipe(
            rx.startWith(undefined),
            rx.switchMap(() => cdb.list_configs(app)),
            rx.map(cs => Imm.Set(cs)),
        );
    }

    /* Obs of Map(uuid, status) tracking current cluster status */
    _init_status (cdb) {
        const app = Edge.App.Status;

            /* Start by fetching objects with status entries */
        return rx.defer(() => cdb.list_configs(app)).pipe(
            /* Flatten the array into the sequence */
            rx.mergeAll(),
            /* Fetch the status records */
            rx.mergeMap(uuid => cdb.get_config(app, uuid)
                .then(config => [uuid, config])),
            /* Collect into a Map */
            rx.toArray(),
            rx.map(sts => Imm.Seq(sts).fromEntrySeq().toMap()),
            /* Make sure we get a result */
            rx.retry({ delay: 10000 }),

            /* Process updates */
            rx.mergeMap(initial => this.status_updates.pipe(
                rx.scan((status, update) => {
                    const [uuid, patch] = update;
                    if (patch == null)
                        return status.delete(uuid);
                    const st = status.get(uuid, {});
                    return status.set(uuid, JMP.apply(st, patch));
                }, initial),
                rx.startWith(initial),
            )),

            /* Cache latest result */
            rx.shareReplay(1),
        );
    }

    /* Push status updates to the ConfigDB */
    _init_status_patches (cdb) {
        const app = Edge.App.Status;

        return this.status_updates.pipe(
            /* It is important these happen in the right order */
            rx.concatMap(([uuid, patch]) => {
                /* Patch the ConfigDB entry */
                const task = patch == null
                    ? cdb.delete_config(app, uuid)
                    : cdb.patch_config(app, uuid, "merge", patch);
                /* Make sure we succeed before trying the next */
                return rx.from(task).pipe(rx.retry({ delay: 5000 }));
            }),
        );
    }

    _init_cluster_updates (clusters) {
        return clusters.pipe(
            rx.withLatestFrom(this.status),
            rx.mergeMap(([clusters, status]) => {
                /* We do not attempt to handle changes to a cluster
                 * configuration. This is not allowed. To change a
                 * cluster, destroy it, wait for the status to go, and
                 * recreate it. */
                const have = status.keySeq().toSet();
                const deleted = have.subtract(clusters);
                const created = clusters.subtract(have);
                const unfinished = status
                    .filter((st, cl) => !st.ready && !deleted.has(cl))
                    .keySeq();
                const updated = created.union(unfinished);

                const expand = (set, Type) => set.toSeq()
                    .map(uuid => new Type(this, uuid, status.get(uuid, {})));
                return rx.merge(
                    expand(updated, Update),
                    expand(deleted, Delete),
                );
            }),
            /* XXX This handles all updates serially. We could go
             * parallel per-cluster with groupBy but we need to ensure
             * that delete/create on a single cluster are not handled at
             * the same time. */
            rx.concatMap(act => act.apply()),
        );
    }

    async run () {
        /* Wait for the initial status fetch */
        await rx.firstValueFrom(this.status);
        /* Push status updates to the ConfigDB */
        this.status_patches.subscribe();
        this.cluster_updates.subscribe();
    }
}

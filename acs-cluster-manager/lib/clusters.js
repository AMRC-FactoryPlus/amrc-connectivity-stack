/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Deployment operator
 * Cluster handling
 * Copyright 2023 AMRC
 */

import crypto from "crypto";
import process from "process";
import stream from "stream";
import timers from "timers/promises";

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
        this.krbkeys    = opts.krbkeys;
        this.realm      = opts.realm;
        this.domain     = opts.external_domain;
        this.org_prefix = opts.org_prefix;

        this.log        = this.fplus.debug.bound("edge");
        this.cdb        = this.fplus.ConfigDB;
    }

    async init () {
        const { cdb } = this;
        const watcher = await cdb.watcher();

        await this._init_config(cdb, watcher);

        /* XXX We should track changes here, and update the cluster. */
        this.template = {
            flux:       await this.config_template(Edge.App.Flux),
            helm:       await this.config_template(Edge.App.HelmRelease),
            bootstrap:  await this.config_template(Edge.App.Bootstrap),
        };

        /* [uuid, patch] requesting status updates */
        this.status_updates = new rx.Subject();

        const clusters = this._init_clusters(cdb, watcher);

        this.status = this._init_status(cdb);
        this.status_patches = this._init_status_patches(cdb);
        this.cluster_updates = this._init_cluster_updates(clusters);

        return this;
    }

    async config_template (app, obj) {
        const { cdb } = this;
        const conf = await cdb.get_config(app, obj ?? app);
        return Template(conf);
    }

    async _init_config (cdb, watcher) {
        /* Exit and restart when service-setup runs */
        watcher.application(UUIDs.App.ServiceConfig)
            .subscribe(() => process.exit(0));

        this.config = await cdb.get_config(
            UUIDs.App.ServiceConfig, Edge.Service.EdgeDeployment);

        /* If we have no SS config, wait 10 minutes and then exit */
        if (!this.config) {
            await timers.setTimeout(10*60*1000);
            process.exit(0);
        }
    }

    flux_system () {
        return Checkout.fetch_file({
            fplus:  this.fplus,
            uuid:   this.config.repo.helm.uuid,
            path:   "flux-system/flux-system.yaml",
        });
    }

    /* Obs of Set(uuid) indicating the clusters in the ConfigDB */
    _init_clusters (cdb, watcher) {
        const app = Edge.App.Cluster;

        return watcher.application(app).pipe(
            /* Fetch regardless every 10 minutes */
            rx.mergeWith(rx.timer(0, 10*60*1000).pipe(
                /* Jitter fetches */
                rx.delayWhen(() => rx.timer(Math.random() * 5000)))),
            rx.switchMap(() => cdb.list_configs(app)),
            rx.map(cs => Imm.Set(cs)),
            rx.tap(cs => this.log("CLUSTERS: %o", cs.toJS())),
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

    async cluster_status (uuid) {
        const st = await rx.firstValueFrom(this.status);
        return st.get(uuid, {});
    }

    async bootstrap (uuid) {
        const status = await this.cluster_status(uuid);
        const flux = await this.flux_system();
        if (!status.ready || !flux) return null;

        const { namespace, name }           = status.spec;
        const { krbkeys, realm, domain }    = this;
        /* We pull values from the edge-cluster Helm chart values. This
         * means we need to stay in sync with that Helm chart. */
        const bootstrap = this.template.bootstrap({
            name, namespace,
            domain, realm, krbkeys,
            files:      "@@@@@",
        });
        this.log("Generated bootstrap for %s", uuid);

        bootstrap.files["flux-system.yaml"] = flux;
        bootstrap.files["self-link.yaml"] = status.self_link;
        
        const marker = crypto.randomBytes(15).toString("base64url");
        const files = Object.entries(bootstrap.files)
            .map(([n, f]) => `cat >${n} <<'${marker}'\n${f}\n${marker}`)
            .join("\n");
        return bootstrap.wrapper.replace("@@@@@", files);
    }

}

/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Sync Op
 * Deployment operator
 * Copyright 2023 AMRC
 */

import deep_equal       from "deep-equal";
import * as imm         from "immutable";
import k8s              from "@kubernetes/client-node";
import jmp              from "json-merge-patch";
import rx               from "rxjs";
import template         from "json-templates";

import { Debug, ServiceError, UUIDs } from "@amrc-factoryplus/utilities";

import { Edge }             from "./uuids.js";
import { LABELS }           from "./metadata.js";

const Resource = imm.Record({ apiVersion: null, kind: null });
Resource.prototype.toString = function () { 
    return `${this.apiVersion}/${this.kind}`;
};

export class Deployments {
    constructor (opts) {
        this.fplus = opts.fplus;
        this.cluster = opts.cluster;
        this.kc = opts.kubeconfig;
        this.namespace = opts.namespace;
       
        this.log = opts.fplus.debug.log.bind(opts.fplus.debug, "deploy");
    }

    async init () {
        const cdb = this.fplus.ConfigDB;
        this.log("Creating ConfigDB watcher");
        const watcher = await cdb.watcher();
        this.log("Got watcher: %o", watcher);

        const config = await this._init_config();
        const deployments = await this._init_deployments();
        this.manifests = this._init_manifests(config, deployments);

        return this;
    }

    run () {
        this.manifests.subscribe(ms => 
            this.reconcile_manifests(ms));
    }

    async _init_config () {
        const watcher = await this.fplus.ConfigDB.watcher();
        const app = Edge.App.SyncConfig;

        /* XXX Also watch our config (app, cluster) and merge onto the
         * global config? */
        return watcher.watch_config(app, app).pipe(
            rx.distinctUntilChanged(deep_equal),
            rx.map(conf => {
                const resources = imm.Set(conf.resources.map(r => Resource(r)));
                const labelled = jmp.merge(conf.template, {
                    metadata: {
                        namespace: this.namespace,
                        labels: {
                            [LABELS.managed]:   LABELS.sync,
                            [LABELS.uuid]:      "{{uuid}}",
                        },
                    },
                });

                return { resources, template: template(labelled) };
            }),
        );
    }

    async _init_deployments () {
        const app = Edge.App.Deployments;
        const cdb = this.fplus.ConfigDB;
        const watcher = await cdb.watcher();

        const lookup = list => rx.from(list).pipe(
            rx.mergeMap(agent => cdb.get_config(app, agent)
                .then(conf => ({ uuid: agent, config: conf }))),
            rx.toArray(),
        );

        return watcher
            .watch_search(app, { cluster: this.cluster })
            .pipe(rx.mergeMap(lookup));
    }

    _init_manifests (config, deployments) {
        return rx.combineLatest({ config, deployments }).pipe(
            rx.tap(opts => this.log("Reconcile needed: %o", opts)),
            rx.map(opts => ({
                resources: opts.config.resources,
                manifests: this.create_manifests(opts),
            })),
            rx.tap(o => this.log("Resources: %s, Manifests: %o", 
                o.resources, o.manifests.toJS())),
            rx.tap({ error: e => this.log("Error: %s", e) }),
            rx.retry({ delay: 5000 }),
        );
    }

    create_manifests ({ config, deployments }) {
        return imm.List(deployments)
            .flatMap(dep => dep.config.charts
                .map(chart => config.template({
                    uuid: dep.uuid,
                    chart: chart,
                    values: {
                        uuid: dep.uuid,
                        hostname: dep.config.hostname,
                    },
                })))
            .groupBy(Resource);
    }

    async reconcile_manifests ({ resources, manifests }) {
        const objs = k8s.KubernetesObjectApi.makeApiClient(this.kc);

        imm.Set.fromKeys(manifests)
            .subtract(resources)
            .forEach(r => this.log("Skipping resource kind %s", r));

        for (const res of resources) {
            this.log("Reconciling %s", res);

            const named = l => l
                .map(m => [m.metadata.name, m])
                .fromEntrySeq().toMap();
            const have = named(await this.get_resources(objs, res));
            const want = named(manifests.get(res));

            this.log("Have %s: %o", res, have.toJS());
            this.log("Want %s: %o", res, want.toJS());

            for (const [name, man] of want) {
                const old = have.get(name);
                if (old) {
                    const rv = old.metadata.resourceVersion;
                    this.log("REPLACE: %s, %o", rv, man);
                }
                else {
                    this.log("CREATE: %o", man);
                }
            }
            for (const [name, man] of have) {
                if (want.has(name))
                    continue;
                this.log("DELETE: %o", man);
            }
        }
    }

    async get_resources (objs, type) {
        const { response, body } = await objs.list(
            type.apiVersion, type.kind, this.namespace,
            null, null, null, null,
            { [LABELS.managed]: LABELS.sync },
        );
        if (response.statusCode != 200)
            throw `Can't list ${type}: ${response.statusCode}`;
        return imm.List(body.items);
    }
}

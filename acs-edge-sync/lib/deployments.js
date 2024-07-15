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

import { Edge }             from "./uuids.js";
import { LABELS }           from "./metadata.js";

const Resource = imm.Record({ apiVersion: null, kind: null });
Resource.prototype.toString = function () { 
    return `${this.apiVersion}/${this.kind}`;
};

class Reconciliation {
    constructor (deploy, manifests, resource) {
        this.deploy = deploy;
        this.manifests = manifests;
        this.resource = resource;

        this.log = deploy.log;
    }

    async prepare () {
        this.objs = k8s.KubernetesObjectApi.makeApiClient(this.deploy.kc);

        const named = l => (l ?? imm.List())
            .map(m => [m.metadata.name, m])
            .fromEntrySeq().toMap();

        this.have = named(await this.get_resources());
        this.want = named(this.manifests.get(this.resource));
        this.log("Have %o", this.have.toJS());
        this.log("Want %o", this.want.toJS());
    }

    async apply () {
        for (const [name, man] of this.want) {
            const old = this.have.get(name);
            if (old) {
                const rv = old.metadata.resourceVersion;
                const update = jmp.merge(man, 
                    { metadata: { resourceVersion: rv } });
                this.log("REPLACE: %o", update);
                await this.check(this.objs.replace(update));
                this.log("Finished replace");
            }
            else {
                this.log("CREATE: %o", man);
                const pr = this.objs.create(man);
                this.log("Create promise: %o", pr);
                await this.check(pr);
                this.log("Finished create");
            }
        }
        for (const [name, man] of this.have) {
            if (this.want.has(name))
                continue;
            this.log("DELETE: %s", name);
            await this.check(this.objs.delete(man));
            this.log("Finished delete");
        }
    }

    async check (pr) {
        const { response, body } = await pr;
        const st = response.statusCode;
        this.log("K8s status: %s", st);
        if (st < 200 || st > 299)
            throw `Can't update ${this.resource}: ${st}`;
    }

    async get_resources () {
        const { response, body } = await this.objs.list(
            this.resource.apiVersion, this.resource.kind, 
            this.deploy.namespace,
            /*pretty*/null, /*exact*/null, /*exportt*/null,
            /*fieldSelector*/null,
            /*labelSelector*/`${LABELS.managed}=${LABELS.sync}`,
        );
        if (response.statusCode != 200)
            throw `Can't list ${this.resource}: ${response.statusCode}`;
        return imm.List(body.items);
    }
} 

export class Deployments {
    constructor (opts) {
        this.fplus = opts.fplus;
        this.cluster = opts.cluster;
        this.kc = opts.kubeconfig;
        this.namespace = opts.namespace;
        this.values = opts.values;
       
        this.log = opts.fplus.debug.log.bind(opts.fplus.debug, "deploy");
    }

    async init () {
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
        const app = Edge.App.HelmRelease;

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
        const { Deployments, HelmChart } = Edge.App;
        const cdb = this.fplus.ConfigDB;
        const watcher = await cdb.watcher();

        /* Take a list of Deployment entry UUIDs. Look up the Deployment
         * entries (preserving the entry UUID), and then look up and
         * compile the Helm Chart templates referenced from there.
         * Returns an array of individual charts which need to be
         * deployed. */
        const lookup = list => rx.from(list).pipe(
            rx.mergeMap(agent => cdb.get_config(Deployments, agent)
                .then(config => ({ uuid: agent, config }))),
            rx.mergeMap(deployment => rx.from(deployment.config.charts).pipe(
                rx.mergeMap(ch => cdb.get_config(HelmChart, ch)),
                /* XXX We could cache (against an etag) to avoid
                 * recompiling every time... */
                rx.map(tmpl => template(tmpl)),
                rx.map(chart => ({ ...deployment, chart })))),
            rx.toArray(),
        );

        return watcher
            .watch_search(Deployments, { cluster: this.cluster })
            .pipe(rx.switchMap(lookup));
    }

    _init_manifests (config, deployments) {
        return rx.combineLatest({ config, deployments }).pipe(
            rx.tap(opts => this.log("Reconcile needed: %o", opts)),
            rx.map(opts => ({
                resources: opts.config.resources,
                manifests: this.create_manifests(opts),
            })),
            rx.tap(o => this.log("Resources: %s, Manifests: %o", 
                o.resources.toJS(), o.manifests.toJS())),
            rx.tap({ error: e => this.log("Error: %s", e) }),
            rx.retry({ delay: 5000 }),
        );
    }

    create_manifests ({ config, deployments }) {
        return imm.List(deployments)
            .map(deployment => {
                const { uuid, config } = deployment;
                const chart = deployment.chart({
                    uuid,
                    name:       config.name,
                    hostname:   config.hostname,
                });
                const values = [this.values, chart.values, config.values]
                    .map(v => v ?? {}).reduce(jmp.merge);
                return config.template({
                    uuid, values,
                    chart:  chart.chart,
                });
            })
            .groupBy(Resource);
    }

    async reconcile_manifests ({ resources, manifests }) {
        imm.Set.fromKeys(manifests)
            .subtract(resources)
            .forEach(r => this.log("Skipping resource kind %s", r));

        for (const res of resources) {
            this.log("Reconciling %s", res);

            const rec = new Reconciliation(this, manifests, res);
            await rec.prepare();
            await rec.apply();
        }
    }
}

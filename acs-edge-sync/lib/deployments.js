/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import * as imm         from "immutable";
import * as k8s         from "@kubernetes/client-node";
import jmp              from "json-merge-patch";
import rx               from "rxjs";
import compile_template from "json-templates";

import * as rxx         from "@amrc-factoryplus/rx-util";

import { Edge }         from "./uuids.js";
import { LABELS }       from "./metadata.js";
import { k8sname }      from "@amrc-factoryplus/service-client";

// Define a record type for Kubernetes resources to help with grouping
const Resource = imm.Record({ apiVersion: null, kind: null });
Resource.prototype.toString = function () {
    return `${this.apiVersion}/${this.kind}`;
};

/**
 * Base class for reconciling Kubernetes resources
 * Handles comparing existing resources with desired state and making necessary changes
 */
class Reconciliation {
    constructor(deploy, resource, manifests) {
        this.deploy = deploy;
        this.manifests = manifests;
        this.resource = resource;

        this.log = deploy.log;
    }

    async prepare () {
        this.objs = k8s.KubernetesObjectApi.makeApiClient(this.deploy.kc);

        // Helper function to convert a list of resources to a Map keyed
        // by name. This will also discard duplicates.
        const named = l => (l ?? imm.List())
            .map(m => [m.metadata.name, m])
            .fromEntrySeq().toMap();

        this.have = named(await this.get_resources());
        this.want = named(this.manifests);
        this.log("Have %o", this.have.toJS());
        this.log("Want %o", this.want.toJS());
    }

    async apply () {
        // Create or update resources that we want. Use SSA to avoid
        // issues with overwriting fields used by Flux.
        for (const [name, man] of this.want) {
            this.log("UPDATE: %s", name);
            await this.objs.patch(
                jmp.merge(man, {
                    metadata: {
                        namespace:  this.deploy.namespace,
                        labels: {
                            [LABELS.managed]:   LABELS.sync,
                }}}),
                /*pretty*/undefined, /*dryRun*/undefined,
                /*fieldManager*/LABELS.sync,
                /*force*/true,
                /*strategy*/"application/apply-patch+yaml",
            );
            this.log("Finished update for %s", name);
        }

        // Delete resources that we no longer want
        for (const [name, man] of this.have) {
            if (this.want.has(name))
                continue;
            this.log("DELETE: %s", name);
            await this.objs.delete(man);
            this.log("Finished delete");
        }
    }

    async get_resources () {
        /* We appear to have no choice but to list the full contents of
         * all resources. There doesn't appear to be any way to just
         * list e.g. names. */
        const body = await this.objs.list(
            this.resource.apiVersion, this.resource.kind,
            this.deploy.namespace,
            /*pretty*/undefined, /*exact*/undefined,
            /*exportt*/undefined, /*fieldSelector*/undefined,
            /*labelSelector*/`${LABELS.managed}=${LABELS.sync}`,
        );
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
        const config = this._init_config();
        const deployments = await this._init_deployments();
        this.manifests = this._init_manifests(config, deployments);

        return this;
    }

    run () {
        // Subscribe to manifest changes and reconcile when they change
        this.manifests.subscribe(ms =>
            this.reconcile_manifests(ms));
    }

    _init_config () {
        const cdb = this.fplus.ConfigDB;
        const app = Edge.App.K8sTemplate;

        /* This is a Directory lookup, and we don't yet have notify on
         * the Directory. So just do a lookup every 2h on the very slim
         * chance the ACS deployment ever changes. */
        const git = rxx.rx(
            rx.timer(0, 2*60*60*1000),
            rx.exhaustMap(() => this.fplus.Git.base_url()),
            rx.distinctUntilChanged(),
            rx.tap(b => this.log("New Git base: %s", b)),
            rx.map(base => uuid => new URL(`uuid/${uuid}`, base).toString()));

        const k8s = rxx.rx(
            cdb.search_app(Edge.App.K8sTemplate),
            rx.map(confs => ({
                /* We must explicitly list the resource types we are
                 * managing to handle the case where all resources of a
                 * type should be deleted. */
                resources:  confs.valueSeq()
                    .flatMap(c => c.resources)
                    .map(Resource)
                    .toSet(),
                templates:  confs.map(c => compile_template(c.template)),
            })),
            rx.tap(c => this.log("K8S CONFIG: %o", c)));

        return rx.combineLatest(k8s, git, (k8s, git) => ({ k8s, git }));
    }

    async _init_deployments () {
        const { Deployments, HelmChart } = Edge.App;
        const cdb = this.fplus.ConfigDB;

        /* Take a Map of Deployment entries. Look up the chart
         * templates. Returns an array of individual charts which need
         * to be deployed. */
        /* XXX This is now all sync and could be done with imm rather
         * than rx. */
        const lookup = ({ deployments, templates }) => rxx.rx(
            rx.from(deployments),
            // XXX - The support for the charts key is deprecated
            // and will be removed in a future version. This is here
            // for backward compatibility. New deployments should
            // use the chart key instead.
            rx.mergeMap(([uuid, spec]) => rxx.rx(
                spec.chart ? rx.of(spec.chart) : rx.from(spec.charts ?? []),
                rx.map(chart => ({ uuid, spec, chart })))),
            rx.map(({ uuid, spec, chart }) => ({
                uuid, spec,
                chart: templates.get(chart),
            })),
            rx.filter(d => d.chart),
            rx.toArray());

        /* Track deployments targetting this cluster */
        const deployments = cdb.search_app(Deployments, { cluster: this.cluster });

        /* Track and compile Helm Chart templates */
        const templates = rxx.rx(
            cdb.search_app(HelmChart),
            rx.map(charts => charts.map(compile_template)));

        return rxx.rx(
            rx.combineLatest({ templates, deployments }),
            rx.switchMap(lookup));
    }

    _init_manifests (config, deployments) {
        return rx.combineLatest(config, deployments).pipe(
            rx.tap(opts => this.log("Reconcile needed: %o", opts)),
            rx.map(([conf, deps]) => ({
                resources:  conf.k8s.resources,
                manifests:  this.create_manifests(conf, deps),
            })),
            //rx.tap(o => this.log("Resources: %o, Manifests: %o",
            //    o.resources.toJS(), o.manifests.toJS())),
            rx.tap({ error: e => this.log("Error: %s", e) }),
            rx.retry({ delay: 5000 }),
        );
    }

    /** Create manifests for deployment.
     * Some GitRepo resources may be duplicated.
     * @returns a Map from Resource to List of manifests
     */
    create_manifests (config, deployments) {
        const res = Edge.Resource;
        const { templates } = config.k8s;

        return imm.List(deployments)
            .flatMap(deployment => {
                const { uuid, spec } = deployment;
                const chart = deployment.chart({
                    uuid,
                    name:       spec.name,
                    hostname:   spec.hostname,
                });
                const hr_name = k8sname(chart.prefix ?? chart.chart, spec.name);
                const gr_name = k8sname("helm", chart.source ?? "charts");

                const hr = templates.get(res.HelmRelease)({
                    uuid,
                    name:   hr_name,
                    chart:  chart.chart,
                    source: gr_name,
                    values: [this.values, chart.values, spec.values]
                        .map(v => v ?? {})
                        .reduce(jmp.merge),
                });
                if (!chart.source)
                    return [hr];

                const url = config.git(chart.source);
                const gitrepo = templates.get(res.GitRepo)({
                    uuid:       chart.source,
                    name:       gr_name,
                    url,
                });

                return [hr, gitrepo];
            })
            .groupBy(Resource);
    }

    async reconcile_manifests({ resources, manifests }) {
        for (const type of resources) {
            this.log("Reconciling %s", type);

            const rec = new Reconciliation(this, type, manifests.get(type));
            await rec.prepare();
            await rec.apply();
        }
    }
}

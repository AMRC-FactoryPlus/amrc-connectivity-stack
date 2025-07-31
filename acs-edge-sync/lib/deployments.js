/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import deep_equal       from "deep-equal";
import * as imm         from "immutable";
import * as k8s         from "@kubernetes/client-node";
import jmp              from "json-merge-patch";
import rx               from "rxjs";
import template         from "json-templates";

import * as rxx         from "@amrc-factoryplus/rx-util";

import { Edge }             from "./uuids.js";
import { LABELS }           from "./metadata.js";

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
        const app = Edge.App.HelmRelease;

        /* This is a Directory lookup, and we don't yet have notify on
         * the Directory. So just do a lookup every 2h on the very slim
         * chance the ACS deployment ever changes. */
        const git = rxx.rx(
            rx.timer(0, 2*60*60*1000),
            rx.tap(() => this.log("Fetching Git base URL")),
            rx.exhaustMap(() => this.fplus.Git.base_url()),
            rx.distinctUntilChanged(),
            rx.tap(b => this.log("New Git base: %s", b)),
            rx.map(base => uuid => new URL(`uuid/${uuid}`, base).toString()),
            rx.tap(f => this.log("Git base map: %o", f)));

        const k8s = rxx.rx(
            cdb.watch_config(app, app),
            rx.tap(v => this.log("Raw config: %o", v)),
            rx.map(conf => ({
                /* We must explicitly list the resource types we are
                 * managing to handle the case where all resources of a
                 * type should be deleted. XXX This could be done
                 * better, the mix of ConfigDB and hardcoded templates
                 * is very messy. */
                resources:  imm.Set(conf.resources.map(Resource))
                    .add(Resource({
                        apiVersion: "source.toolkit.fluxcd.io/v1",
                        kind: "GitRepository",
                    })),
                template:   template(conf.template),
            })),
            rx.tap(c => this.log("Config: %o", c)));

        return rx.combineLatest(k8s, git, (k8s, git) => ({ ...k8s, git }));
    }

    async _init_deployments () {
        const { Deployments, HelmChart } = Edge.App;
        const cdb = this.fplus.ConfigDB;

        /* Take a list of Deployment entry UUIDs. Look up the Deployment
         * entries (preserving the entry UUID), and then look up and
         * compile the Helm Chart templates referenced from there.
         * Returns an array of individual charts which need to be
         * deployed. */
        const lookup = map => rx.from(map).pipe(
            rx.map(([uuid, spec]) => ({ uuid, spec })),
            // Extract the chart UUIDs from the deployment
            rx.map(dep => {
                const { spec } = dep;
                // XXX - The support for the charts key is deprecated
                // and will be removed in a future version. This is here
                // for backward compatibility. New deployments should
                // use the chart key instead.
                //
                // Handle both single chart and multiple charts
                const charts =
                    spec.chart ? rx.of(spec.chart) : rx.from(spec.charts ?? []);
                return [dep, charts];
            }),
            // For each chart UUID, get the chart template and extract the source
            rx.mergeMap(([deployment, charts]) => charts.pipe(
                // Get the chart template configuration using the chart UUID
                /* XXX We should track these via notify */
                rx.mergeMap(ch => cdb.get_config(HelmChart, ch)),
                rx.map(tmpl => ({
                    ...deployment,
                    chart: template(tmpl),
                })))),
            rx.toArray(),
        );

        // Watch for deployments targeting this cluster
        return rxx.rx(
            cdb.search_app(Deployments, { cluster: this.cluster }),
            rx.tap(ds => this.log("DEPLOYMENTS: %o", ds.toJS())),
            rx.switchMap(lookup));
    }

    _init_manifests (config, deployments) {
        return rx.combineLatest({ config, deployments }).pipe(
            rx.tap(opts => this.log("Reconcile needed: %o", opts)),
            rx.map(opts => ({
                resources:  opts.config.resources,
                manifests:  this.create_manifests(opts),
            })),
            rx.tap(o => this.log("Resources: %o, Manifests: %o",
                o.resources.toJS(), o.manifests.toJS())),
            rx.tap({ error: e => this.log("Error: %s", e) }),
            rx.retry({ delay: 5000 }),
        );
    }

    /** Create manifests for deployment.
     * Some GitRepo resources may be duplicated.
     * @returns a Map from Resource to List of manifests
     */
    create_manifests ({ config, deployments }) {
        return imm.List(deployments)
            .flatMap(deployment => {
                const { uuid, spec, tmpl } = deployment;
                const chart = deployment.chart({
                    uuid,
                    name:       spec.name,
                    hostname:   spec.hostname,
                });
                const manifests = [config.template({
                    uuid,
                    chart:  chart.chart,
                    source: "helm-" + (chart.source ?? "charts"),
                    prefix: chart.prefix ?? chart.chart,
                    values: [this.values, chart.values, spec.values]
                        .map(v => v ?? {})
                        .reduce(jmp.merge),
                })];
                if (chart.source) {
                    const url = config.git(chart.source);
                    manifests.push(this.create_gitrepo(`helm-${chart.source}`, url));
                }
                return manifests;
            })
            .groupBy(Resource);
    }

    /** Create a GitRepository resource */
    /* XXX This should be templated like the HelmReleases */
    create_gitrepo (name, url) {
        return {
            apiVersion: "source.toolkit.fluxcd.io/v1",
            kind: "GitRepository",
            metadata: { name },
            spec: {
                interval: "3m",
                ref: {
                    branch: "main"
                },
                secretRef: {
                    name: "flux-secrets"
                },
                url
            }
        };
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

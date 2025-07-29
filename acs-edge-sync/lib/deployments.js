/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import deep_equal       from "deep-equal";
import * as imm         from "immutable";
import k8s              from "@kubernetes/client-node";
import jmp              from "json-merge-patch";
import rx               from "rxjs";
import template         from "json-templates";

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
    constructor(deploy, manifests, resource) {
        this.deploy = deploy;
        this.manifests = manifests;
        this.resource = resource;

        this.log = deploy.log;
    }

    async prepare () {
        this.objs = k8s.KubernetesObjectApi.makeApiClient(this.deploy.kc);

        // Helper function to convert a list of resources to a Map keyed by name
        const named = l => (l ?? imm.List())
            .map(m => [m.metadata.name, m])
            .fromEntrySeq().toMap();

        this.have = named(await this.get_resources());
        this.want = named(this.manifests.get(this.resource));
        this.log("Have %o", this.have.toJS());
        this.log("Want %o", this.want.toJS());
    }

    async apply () {
        // Create or update resources that we want
        for (const [name, man] of this.want) {
            const old = this.have.get(name);
            if (old) {
                // Only compare and update the spec
                if (!deep_equal(old.spec, man.spec)) {
                    // Create a patch that only updates the spec
                    const patch = {
                        apiVersion: "helm.toolkit.fluxcd.io/v2beta1",
                        kind: "HelmRelease",
                        spec: man.spec,
                        metadata: {
                            name,
                            namespace: this.deploy.namespace
                        }
                    };
                    this.log("PATCH: %o", patch);
                    await this.check(this.objs.patch(
                        patch,
                        undefined,
                        undefined,
                        undefined,
                        undefined,
                        { headers: { 'Content-Type': 'application/merge-patch+json' } }
                    ));
                    this.log("Finished patch");
                }
            }
            else {
                this.log("CREATE: %o", man);
                const pr = this.objs.create(man);
                this.log("Create promise: %o", pr);
                await this.check(pr);
                this.log("Finished create");
            }
        }

        // Delete resources that we no longer want
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

/**
 * Specialized class for reconciling GitRepository resources
 * Creates and manages Flux GitRepository resources for Helm chart sources
 */
class GitRepoReconciliation {
    constructor(deploy, sources) {
        this.deploy = deploy;
        this.sources = sources; // Map of source name to repo URL
        this.log = deploy.log;
    }

    async prepare() {
        this.objs = k8s.KubernetesObjectApi.makeApiClient(this.deploy.kc);

        // Get existing GitRepository resources with our managed-by label
        const { response, body } = await this.objs.list(
            "source.toolkit.fluxcd.io/v1", "GitRepository",
            this.deploy.namespace,
            /*pretty*/null, /*exact*/null, /*exportt*/null,
            /*fieldSelector*/null,
            /*labelSelector*/`${LABELS.managed}=${LABELS.sync}`,
        );

        if (response.statusCode != 200)
            throw `Can't list GitRepositories: ${response.statusCode}`;

        // Convert to a map of name -> resource
        this.have = imm.Map(body.items.map(m => [m.metadata.name, m]));

        // Create map of desired GitRepository resources
        this.want = this.createGitRepoResources();

        this.log("Have GitRepos: %o", this.have.toJS());
        this.log("Want GitRepos: %o", this.want.toJS());
    }

    /**
     * Create GitRepository resources for each source
     * @returns {Map} Map of name -> GitRepository resource
     */
    createGitRepoResources() {
        return imm.Map(this.sources).map((url, name) => ({
            apiVersion: "source.toolkit.fluxcd.io/v1",
            kind: "GitRepository",
            metadata: {
                name,
                namespace: this.deploy.namespace,
                labels: {
                    [LABELS.managed]: LABELS.sync,
                }
            },
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
        }));
    }

    async apply() {
        // Create or update resources that we want
        for (const [name, man] of this.want) {
            const old = this.have.get(name);
            if (old) {
                // Only compare and update the spec
                if (!deep_equal(old.spec, man.spec)) {
                    // Create a patch that only updates the spec
                    const patch = {
                        apiVersion: "source.toolkit.fluxcd.io/v1",
                        kind: "GitRepository",
                        spec: man.spec,
                        metadata: {
                            name,
                            namespace: this.deploy.namespace
                        }
                    };
                    this.log("PATCH GitRepo: %o", patch);
                    await this.check(this.objs.patch(
                        patch,
                        undefined,
                        undefined,
                        undefined,
                        undefined,
                        { headers: { 'Content-Type': 'application/merge-patch+json' } }
                    ));
                    this.log("Finished patch GitRepo");
                }
            }
            else {
                this.log("CREATE GitRepo: %o", man);
                const pr = this.objs.create(man);
                this.log("Create GitRepo promise: %o", pr);
                await this.check(pr);
                this.log("Finished create GitRepo");
            }
        }

        // Delete resources that we no longer want
        for (const [name, man] of this.have) {
            if (this.want.has(name))
                continue;
            this.log("DELETE GitRepo: %s", name);
            await this.check(this.objs.delete(man));
            this.log("Finished delete GitRepo");
        }
    }

    async check(pr) {
        const { response, body } = await pr;
        const st = response.statusCode;
        this.log("K8s status: %s", st);
        if (st < 200 || st > 299)
            throw `Can't update GitRepository: ${st}`;
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
        // Subscribe to manifest changes and reconcile when they change
        this.manifests.subscribe(ms =>
            this.reconcile_manifests(ms));
    }

    async _init_config () {
        const cdb = this.fplus.ConfigDB;
        const app = Edge.App.HelmRelease;

        /* XXX Also watch our config (app, cluster) and merge onto the
         * global config? */
        return cdb.watch_config(app, app).pipe(
            rx.map(conf => {
                // Extract the resource types we need to reconcile
                const resources = imm.Set(conf.resources.map(r => Resource(r)));

                // Add our namespace and labels to the template
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
                    spec.chart ? rx.of(spec.chart) : rx.from(spec.charts);
                return [dep, charts];
            }),
            // For each chart UUID, get the chart template and extract the source
            rx.mergeMap(([deployment, charts]) => charts.pipe(
                // Get the chart template configuration using the chart UUID
                /* XXX We should track these via notify */
                rx.mergeMap(ch => cdb.get_config(HelmChart, ch)),
                // Pass the template directly to the deployment object
                // We'll extract the source in create_manifests
                rx.map(tmpl => ({
                    ...deployment,
                    chart: template(tmpl),
                    tmpl
                })))),
            rx.toArray(),
        );

        // Watch for deployments targeting this cluster
        return cdb
            .watch_search(Deployments, { cluster: this.cluster })
            .pipe(rx.switchMap(lookup));
    }

    _init_manifests (config, deployments) {
        return rx.combineLatest({ config, deployments }).pipe(
            rx.tap(opts => this.log("Reconcile needed: %o", opts)),
            rx.map(opts => ({
                resources: opts.config.resources,
                manifests: this.create_manifests(opts),
                // Pass the original deployments for source extraction
                deployments: opts.deployments,
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
                const { uuid, spec, tmpl } = deployment;
                const chart = deployment.chart({
                    uuid,
                    name:       spec.name,
                    hostname:   spec.hostname,
                });

                // Log the chart object to debug
                this.log("Chart object: %o", chart);

                const values = [this.values, chart.values, spec.values]
                    .map(v => v ?? {}).reduce(jmp.merge);

                // Extract source field from the template
                // If not specified, default to "helm-charts" for backward compatibility
                const source = tmpl.source || "helm-charts";

                // Log whether we're using the default or a specified source
                if (!tmpl.source) {
                    this.log("Chart template does not specify a source, using default 'helm-charts'");
                } else {
                    this.log("Using source '%s' from chart template", tmpl.source);
                }

                // Ensure we have a valid prefix for Kubernetes resource names
                // If prefix is specified in the template, use that
                // Otherwise, use the chart name from the template
                // This ensures we always have a valid prefix even if chart.chart is undefined
                const prefix = tmpl.prefix || tmpl.chart;

                // Log the prefix we're using
                this.log("Using prefix '%s' for chart '%s'", prefix, tmpl.chart);

                // Include the source and prefix in the template data
                return config.template({
                    uuid, values,
                    chart: chart.chart,
                    source,
                    prefix,
                });
            })
            .groupBy(Resource);
    }

    /**
     * Collect all unique sources from deployments and look up their repository URLs
     * Only collects sources that are explicitly specified in the chart templates
     * and are not the default "helm-charts" (which is created by the bootstrap process)
     * @param {Array} deployments - List of deployment objects with chart templates
     * @returns {Promise<Object>} - Map of source name to repository URL
     */
    async collectSources(deployments) {
        // Extract unique sources from deployments
        // We filter out "helm-charts" because it's already created by the bootstrap process
        // and doesn't need to be managed by our code
        const sources = imm.Set(
            deployments
                .filter(d => {
                    // Extract source from the template
                    const source = d.tmpl?.source;
                    // Only include explicitly specified sources that aren't the default
                    return source && source !== "helm-charts";
                })
                .map(d => d.tmpl.source)
        ).toJS();

        this.log("Unique non-default sources found: %o", sources);

        // Look up repository URLs for each source
        const sourceMap = {};
        for (const source of sources) {
            try {
                // Look up URL for the source
                const repoUrl = await this.fplus.Git.repo_by_uuid(source);
                if (repoUrl) {
                    this.log("Found URL for source %s: %s", source, repoUrl);
                    sourceMap[source] = repoUrl;
                } else {
                    this.log("Warning: Could not find URL for source %s", source);
                }
            } catch (err) {
                this.log("Error looking up URL for source %s: %s", source, err);
            }
        }

        return sourceMap;
    }

    async reconcile_manifests({ resources, manifests, deployments }) {
        // Skip resource kinds that aren't in our config
        imm.Set.fromKeys(manifests)
            .subtract(resources)
            .forEach(r => this.log("Skipping resource kind %s", r));

        // First, reconcile GitRepository resources for all unique sources
        this.log("Collecting sources from deployments");
        const sources = await this.collectSources(deployments);

        if (Object.keys(sources).length > 0) {
            this.log("Reconciling GitRepository resources for sources: %o", sources);
            const gitRepos = new GitRepoReconciliation(this, sources);
            await gitRepos.prepare();
            await gitRepos.apply();
        }

        // Then reconcile HelmRelease resources
        for (const res of resources) {
            this.log("Reconciling %s", res);

            const rec = new Reconciliation(this, manifests, res);
            await rec.prepare();
            await rec.apply();
        }
    }
}

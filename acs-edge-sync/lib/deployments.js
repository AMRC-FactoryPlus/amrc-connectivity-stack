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
        const watcher = await this.fplus.ConfigDB.watcher();
        const app = Edge.App.HelmRelease;

        /* XXX Also watch our config (app, cluster) and merge onto the
         * global config? */
        return watcher.watch_config(app, app).pipe(
            // Only emit when the config changes
            rx.distinctUntilChanged(deep_equal),
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
        const watcher = await cdb.watcher();

        /* Take a list of Deployment entry UUIDs. Look up the Deployment
         * entries (preserving the entry UUID), and then look up and
         * compile the Helm Chart templates referenced from there.
         * Returns an array of individual charts which need to be
         * deployed. */
        const lookup = list => rx.from(list).pipe(
            // For each deployment UUID, get the deployment config
            rx.mergeMap(agent => cdb.get_config(Deployments, agent)
                .then(spec => ({ uuid: agent, spec }))),
            // Extract the chart UUIDs from the deployment
            rx.map(dep => {
                const { spec } = dep;
                // Handle both single chart and multiple charts
                const charts =
                    spec.chart ? rx.of(spec.chart) : rx.from(spec.charts);
                return [dep, charts];
            }),
            // For each chart UUID, get the chart template and extract the source
            rx.mergeMap(([deployment, charts]) => charts.pipe(
                // Get the chart template configuration using the chart UUID
                rx.mergeMap(ch => cdb.get_config(HelmChart, ch)),
                /* XXX We could cache (against an etag) to avoid
                 * recompiling every time... */
                rx.map(tmpl => {
                    // Extract source field from the chart template
                    // If not specified, we'll use the default "helm-charts" repository
                    // This is a deliberate choice to maintain backward compatibility
                    // with existing chart templates that don't specify a source
                    const source = tmpl.source || "helm-charts";

                    return { tmpl, source };
                }),
                // Add the chart template and source to the deployment object
                // This is important because we'll use this source later in collectSources
                rx.map(({ tmpl, source }) => ({
                    ...deployment,
                    chart: template(tmpl),
                    source
                })))),
            rx.toArray(),
        );

        // Watch for deployments targeting this cluster
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
                const { uuid, spec, source } = deployment;
                const chart = deployment.chart({
                    uuid,
                    name:       spec.name,
                    hostname:   spec.hostname,
                });
                const values = [this.values, chart.values, spec.values]
                    .map(v => v ?? {}).reduce(jmp.merge);

                // Include the source in the template data
                // The source was extracted from the chart template in _init_deployments
                // and is now a property of the deployment object
                // We already defaulted to "helm-charts" in _init_deployments if not specified
                return config.template({
                    uuid, values,
                    chart: chart.chart,
                    source,
                    prefix: chart.prefix || chart.chart,
                });
            })
            .groupBy(Resource);
    }

    /**
     * Collect all unique sources from deployments and look up their repository URLs
     * Only collects sources that are explicitly specified in the chart templates
     * @param {Array} deployments - List of deployment objects with chart templates
     * @returns {Promise<Object>} - Map of source name to repository URL
     */
    async collectSources(deployments) {
        // Extract unique sources from deployments
        // Only include sources that are explicitly specified and not "helm-charts"
        const sources = imm.Set(
            deployments
                .filter(d => {
                    // The source comes from the chart template, which has already been
                    // extracted and added to the deployment object in _init_deployments
                    return d.source && d.source !== "helm-charts";
                })
                .map(d => d.source)
        ).toJS();

        this.log("Unique explicitly specified sources found: %o", sources);

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

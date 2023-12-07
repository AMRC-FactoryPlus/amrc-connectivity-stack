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
import { write_sealed_secret }  from "./kubeseal.js";
import * as manifests           from "./manifests.js";
import { FLUX }                 from "./manifests.js";
import { Git, Edge }            from "./uuids.js";

function expand (string, spec) {
    return string.replaceAll("%n", spec.name);
}

export class Clusters {
    constructor (opts) {
        this.fplus      = opts.fplus;
        this.realm      = opts.realm;

        this.log        = this.fplus.debug.bound("edge");
    }

    async init () {
        const cdb = this.fplus.ConfigDB;
        const watcher = await cdb.watcher();

        /* XXX We could track changes here, but this is only updated by
         * service-setup on ACS upgrade. */
        this.config = await cdb.get_config(Edge.App.Config, Edge.App.Config);

        /* XXX We should track changes here, and update the cluster. */
        const tmpl = (app, obj) => cdb.get_config(app, obj)
            .then(t => Template(t));
        this.template = {
            flux:       await tmpl(Edge.App.Template, Edge.App.Template),
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
        return rx.combineLatest({ clusters, status: this.status }).pipe(
            rx.mergeMap(({ clusters, status }) => {
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
             * parallel per-cluster with groupBy. */
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

    async create_cluster (spec) {
        spec = { ...spec };

        /* These all add fields to spec, so the order is important. */

        await this.find_template(spec);

        let st = await this.find_repo_urls(spec);
        if (st != 200) return [st];

        st = await this.create_repo(spec);
        if (st != 201) return [st];

        await this.create_cluster_objects(spec);
        await this.create_flux_user(spec);
        await this.populate_cluster_repo(spec);
        await this.krbkeys.create_krbkey(spec);

        return [201, { uuid: spec.uuid, flux: spec.flux }];
    }

    async cluster_status (cluster) {
        const info = await this.fplus.ConfigDB
            .get_config(Edge.App.Cluster, cluster);
        if (!info) return;

        const co = await Checkout.clone({ fplus: this.fplus, url: info.flux });
        const ready = await this.cluster_has_git_creds(co);
        co.dispose();

        return { ready };
    }

    async find_template (spec) {
        const cdb = this.fplus.ConfigDB;
        const uuid = await cdb.resolve({
            app:    Edge.App.Template,
            query:  { name: spec.template },
        });
        spec.template = await cdb.get_config(Edge.App.Template, uuid);
        this.log("Found template %s: %o", uuid, spec.template);
    }

    async find_repo_urls (spec) {
        const { links } = spec.template.repository;
        if (!links) return 200;

        const cdb = this.fplus.ConfigDB;

        spec.sources = [];
        for (const [source, s_spec] of Object.entries(links)) {
            this.log("Resolving repo %s", source)
            const info = await cdb.get_config(Git.App.Config, source);
            if (!info?.path) return 404;
            this.log("Resolved repo %s to %s", source, info.path);
            spec.sources.push({ ...s_spec, path: info.path });
        }

        return 200;
    }

    async create_repo (spec) {
        spec.repo = `${spec.template.repository.group}/${spec.name}`;
        this.log("Creating repo %s", spec.repo);

        const res = await this.fplus.fetch({
            service:    Git.Service.Git,
            method:     "POST",
            url:        `/git/${spec.repo}`,
        });

        switch (res.status) {
            case 200:
                /* For now fall through as git.* returns 200 for
                 * successful create. Maybe git.* should return 201/200
                 * rather than 200/409? */
            case 201:
                const json = await res.json();
                spec.repo_uuid = json.uuid;
                spec.flux = json.url;
                return 201;
            case 404:
            case 409:
                return res.status;
            default:
                throw `Git: can't create repo ${spec.repo}: ${res.status}`;
        }
    }

    async create_cluster_objects (spec) {
        const { name, kubeseal_cert, flux } = spec;
        const namespace = expand(spec.template.cluster.namespace, spec);

        const cdb = this.fplus.ConfigDB;
        const uuid = await cdb.create_object(Edge.Class.Cluster);
        this.log("Created Edge Cluster %s", uuid);

        await cdb.put_config(UUIDs.App.Info, uuid, { name });
        await cdb.put_config(Edge.App.Cluster, uuid, {
            flux, namespace, kubeseal_cert,
        });

        spec.uuid = uuid;
    }

    async create_flux_user (spec) {
        const flux = spec.template.flux;
        const user = expand(flux.username, spec);
        const name = expand(flux.name, spec);

        spec.principal = `${user}@${this.realm}`;

        const auth = this.fplus.Auth;
        this.log("Creating Flux principal %s in %s", spec.principal, flux.class);
        const princ = await auth.create_principal(
            flux.class, spec.principal, name);
        this.log("Created Flux principal %s", princ);

        this.log("Granting %s pull access to %s", princ, spec.repo_uuid);
        await auth.add_ace(princ, Git.Perm.Pull, spec.repo_uuid);
        for (const group of flux.groups) {
            this.log("Adding %s to auth group %s", princ, group);
            await auth.add_to_group(group, princ);
        }
    }

    async populate_cluster_repo (spec) {
        this.log("Performing initial cluster deployment");
        const co = await Checkout.init({
            fplus:  this.fplus, 
            url:    spec.flux,
        });
        await co.write_file("README.md", manifests.README);
        await co.commit("Add README.");
        await this.write_username_secret(co, spec);
        await this.setup_repo_links(co, spec);
        await this.create_namespace(co, spec);
        await co.push();
        this.log("Pushed initial commits");
    }

    async write_username_secret (co, spec) {
        await write_sealed_secret({
            log:        this.log,
            checkout:   co,
            x509:       spec.kubeseal_cert,
            namespace:  FLUX.ns,
            name:       FLUX.secret,
            key:        "username",
            content:    stream.Readable.from(spec.principal),
        });
    }

    async write_flux_source (co, repo, spec) {
        const git_base = await this.fplus.Discovery
            .service_url(Git.Service.Git);

        /* XXX I would like to use . rather than - here, but the flux
         * cli tool used for initial bootstrap won't allow it. */
        const name = repo.replace("/", "-");
        const url = new URL(`git/${repo}`, git_base).toString();

        this.log("Adding source %s", url);
        await co.write_manifest(manifests.git_repo(name, url, spec));
        await co.write_manifest(manifests.flux_kust(name, spec));
    }

    async setup_repo_links (co, spec) {
        const { sources } = spec;
        if (!sources) return;

        for (const source of sources) {
            await this.write_flux_source(co, source.path, source);
            await co.commit("Written shared flux source manifests.");
        }
        await this.write_flux_source(co, spec.repo, spec.template.repository);
        await co.commit("Written my own flux source manifests.");
    }

    async create_namespace (co, spec) {
        const { namespace } = spec.template.cluster;

        await co.write_manifest(manifests.namespace(namespace));
        await co.commit("Written namespace manifest.");
    }

    async cluster_has_git_creds (co) {
        /* Check every GitRepository has credentials */
        const repos = await co.list_manifests(FLUX.ns, "GitRepository");
        const secrets = await 
            Promise.all(repos.map(mani =>
                co.read_manifest(...mani)
                    .then(gitr => gitr.spec?.secretRef?.name)))
            .then(list => list.filter(i => i != null));
        
        for (const sname of secrets) {
            const sealed = await co.read_manifest(FLUX.ns, "SealedSecret", sname);
            if (!sealed) {
                this.log("No sealed secret %s", sname);
                return false;
            }
            const enc = sealed.spec.encryptedData;
            const creds = ("bearerToken" in enc) || 
                ("username" in enc && "password" in enc);
            if (!creds) {
                this.log("Missing keys in secret %s, we have: %s", 
                    sname, Object.keys(enc).join(", "));
                return false;
            }
        }

        return true;
    }

}

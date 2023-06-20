/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Deployment operator
 * Cluster handling
 * Copyright 2023 AMRC
 */

import stream from "stream";

import { Debug, UUIDs }         from "@amrc-factoryplus/utilities";

import { Checkout }             from "./checkout.js";
import { write_sealed_secret }  from "./kubeseal.js";
import * as manifests           from "./manifests.js";
import { Git, Edge }            from "./uuids.js";

const FLUX_NS = "flux-system";

const debug = new Debug();

export class Clusters {
    constructor (opts) {
        this.fplus      = opts.fplus;
        this.cert_dir   = opts.cert_dir;
        this.group      = opts.repo_group;

        this.log = debug.log.bind(debug, "edge");
    }

    async create_cluster (spec) {
        const [st, repo] = await this.create_repo(spec.name);
        if (st != 201) return [st];

        const uuid = await this.create_cluster_objects(spec, repo.url);
        await this.populate_cluster_repo(repo, spec);

        return [201, { uuid, flux: repo.url }];
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

    async create_repo (name) {
        const repo = `${this.group}/${name}`;

        this.log("Creating repo %s", repo);
        const res = await this.fplus.fetch({
            service:    Git.Service.Git,
            method:     "POST",
            url:        `/git/${repo}`,
        });

        switch (res.status) {
            case 200:
                /* For now fall through as git.* returns 200 for
                 * successful create. Maybe git.* should return 201/200
                 * rather than 200/409? */
            case 201:
                return [201, await res.json()];
            case 404:
            case 409:
                return [res.status];
            default:
                throw `Git: can't create repo ${repo}: ${res.status}`;
        }
    }

    async cluster_has_git_creds (co) {
        /* Check every GitRepository has credentials */
        const repos = await co.list_manifests(FLUX_NS, "GitRepository");
        const secrets = await 
            Promise.all(repos.map(mani =>
                co.read_manifest(...mani)
                    .then(gitr => gitr.spec?.secretRef?.name)))
            .then(list => list.filter(i => i != null));
        
        for (const sname of secrets) {
            const sealed = await co.read_manifest(FLUX_NS, "SealedSecret", sname);
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

    async create_cluster_objects (spec, repo) {
        const { name, kubeseal_cert } = spec;
        const namespace = spec.namespace ?? "fplus-edge";

        const cdb = this.fplus.ConfigDB;
        const uuid = await cdb.create_object(Edge.Class.Cluster);
        this.log("Created Edge Cluster %s", uuid);

        await cdb.put_config(UUIDs.App.Info, uuid, { name });
        await cdb.put_config(Edge.App.Cluster, uuid, {
            flux:           repo,
            namespace,
            kubeseal_cert,
        });

        return uuid;
    }

    async populate_cluster_repo (repo, spec) {
        this.log("Performing initial cluster deployment");
        const co = await Checkout.init({
            fplus:  this.fplus, 
            url:    repo.url,
        });
        await co.write_file("README.md", manifests.README);
        await co.commit("Add README.");
        await this.setup_repo_links(co, spec);
        await co.push();
        this.log("Pushed initial commits");
    }

    async setup_repo_links (co, spec) {
        if (!spec.sources) return;

        const git_base = await this.fplus.Discovery
            .service_url(Git.Service.Git);

        await write_sealed_secret({
            log:        this.log,
            checkout:   co,
            x509:       spec.kubeseal_cert,
            namespace:  FLUX_NS, 
            name:       "op1flux-secrets",
            key:        "username",
            content:    stream.Readable.from(`op1flux/${spec.name}`),
        });
        for (const source of spec.sources) {
            const name = source.replace("/", ".");
            const url = new URL(source, git_base).toString();

            this.log("Adding source %s", url);
            await co.write_manifest(manifests.git_repo(FLUX_NS, name, url));
            await co.write_manifest(manifests.flux_kust(FLUX_NS, name, name));
        }
        await co.commit("Written flux source manifests.");
    }
}

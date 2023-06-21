/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Deployment operator
 * Cluster handling
 * Copyright 2023 AMRC
 */

import stream from "stream";
import util from "util";

import { Debug, UUIDs }         from "@amrc-factoryplus/utilities";

import { Checkout }             from "./checkout.js";
import { KrbKeys }              from "./krbkeys.js";
import { write_sealed_secret }  from "./kubeseal.js";
import * as manifests           from "./manifests.js";
import { FLUX }                 from "./manifests.js";
import { Git, Edge }            from "./uuids.js";

const debug = new Debug();

export class Clusters {
    constructor (opts) {
        this.fplus      = opts.fplus;
        this.cert_dir   = opts.cert_dir;
        this.group      = opts.repo_group;

        this.log        = debug.log.bind(debug, "edge");
        this.krbkeys    = new KrbKeys(opts);
    }

    async create_cluster (spec) {
        spec = {
            ...spec, 
            repo: `${this.group}/${spec.name}`,
        };

        const [st, repo] = await this.create_repo(spec.repo);
        if (st != 201) return [st];

        spec.flux = repo.url;
        spec.uuid = await this.create_cluster_objects(spec);

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

    async create_repo (repo) {
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

    async create_cluster_objects (spec) {
        const { name, kubeseal_cert, flux } = spec;
        const namespace = spec.namespace ?? "fplus-edge";

        const cdb = this.fplus.ConfigDB;
        const uuid = await cdb.create_object(Edge.Class.Cluster);
        this.log("Created Edge Cluster %s", uuid);

        await cdb.put_config(UUIDs.App.Info, uuid, { name });
        await cdb.put_config(Edge.App.Cluster, uuid, {
            flux, namespace, kubeseal_cert,
        });

        return uuid;
    }

    async populate_cluster_repo (spec) {
        this.log("Performing initial cluster deployment");
        const co = await Checkout.init({
            fplus:  this.fplus, 
            url:    spec.flux,
        });
        await co.write_file("README.md", manifests.README);
        await co.commit("Add README.");
        await this.setup_repo_links(co, spec);
        await co.push();
        this.log("Pushed initial commits");
    }

    async write_flux_source (co, source) {
        const git_base = await this.fplus.Discovery
            .service_url(Git.Service.Git);

        const name = source.replace("/", ".");
        const url = new URL(`git/${source}`, git_base).toString();

        this.log("Adding source %s", url);
        await co.write_manifest(manifests.git_repo(name, url));
        await co.write_manifest(manifests.flux_kust(name, name));
    }

    async setup_repo_links (co, spec) {
        if (!spec.sources) return;

        await write_sealed_secret({
            log:        this.log,
            checkout:   co,
            x509:       spec.kubeseal_cert,
            namespace:  FLUX.ns,
            name:       FLUX.secret,
            key:        "username",
            content:    stream.Readable.from(
                util.format(FLUX.username, spec.name)),
        });
        for (const source of spec.sources) {
            await this.write_flux_source(co, source);
            await co.commit("Written shared flux source manifests.");
        }
        await this.write_flux_source(co, spec.repo);
        await co.commit("Written my own flux source manifests.");
    }
}

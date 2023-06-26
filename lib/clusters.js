/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Deployment operator
 * Cluster handling
 * Copyright 2023 AMRC
 */

import stream from "stream";

import { Debug, UUIDs }         from "@amrc-factoryplus/utilities";

import { Checkout }             from "./checkout.js";
import { KrbKeys }              from "./krbkeys.js";
import { write_sealed_secret }  from "./kubeseal.js";
import * as manifests           from "./manifests.js";
import { FLUX }                 from "./manifests.js";
import { Git, Edge }            from "./uuids.js";

const debug = new Debug();

function expand (string, spec) {
    return string.replaceAll("%n", spec.name);
}

export class Clusters {
    constructor (opts) {
        this.fplus      = opts.fplus;
        this.cert_dir   = opts.cert_dir;
        this.realm      = opts.realm;

        this.log        = debug.log.bind(debug, "edge");
        this.krbkeys    = new KrbKeys(opts);
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

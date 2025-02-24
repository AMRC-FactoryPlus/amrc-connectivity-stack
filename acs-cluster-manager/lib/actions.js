/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Deployment operator
 * Cluster actions
 * Copyright 2023 AMRC
 */

import jmp from "json-merge-patch";
import rx from "rxjs";
import yaml from "yaml";

import { UUIDs, ServiceError }  from "@amrc-factoryplus/service-client";

import { Checkout }     from "./checkout.js";
import { Git, Edge }    from "./uuids.js";

const README = `
This repo is managed by the Edge Deployment Operator.
As such some conventions need to be observed.

* Manifests created by hand go under the 'by-hand' directory.
* These must not conflict with the generated manifests.
* Other manifests must not be edited.

Generated manifests are named 'SERVICE/SUBSYSTEM/*', where SERVICE will
normally be 'edo'.
`;

function svc_catch (...codes) {
    return err => {
        if (err instanceof ServiceError && codes.includes(err.status))
            return;
        throw err;
    };
}

class Action {
    constructor (op, uuid, status) {
        this.op = op;
        this.uuid = uuid;
        this.status = status;

        this.fplus = op.fplus;
        this.cdb = op.fplus.ConfigDB;
        this.auth = op.fplus.Auth;

        this.config = op.config;
        this.prefix = op.org_prefix;

        this.log = op.fplus.debug.bound("cluster");
    }

    update (patch) {
        this.op.status_updates.next([this.uuid, patch]);
    }

    name () {
        const { spec, status, uuid } = this;
        const name = status?.spec?.name ?? spec?.name;

        if (name == undefined) {
            this.log("No cluster name, spec %o, status %o", spec, status);
            throw new Error(`No name available for cluster ${uuid}`);
        }

        return name;
    }

    principal (srv) {
        const name = this.name();
        return `${srv}/${name}@${this.op.realm}`;
    }
}

export class Update extends Action {
    async apply () {
        const { cdb, status, uuid } = this;

        this.spec = await cdb.get_config(Edge.App.Cluster, uuid);
        if (!this.spec) {
            this.log("Cluster %s has disappeared!", uuid);
            return;
        }
        if (status.ready) {
            this.log("Cluster %s is already set up", uuid);
            return;
        }

        this.log("Setting up cluster %s (%s)", this.name(), uuid);
        this.update({ spec: this.spec });
        await this.address();
        await this.accounts();
        await this.repo();
        this.update({ ready: true });
        this.log("Cluster %s is ready", this.name());
    }

    async address () {
        const { cdb, uuid, spec, prefix } = this;
        const name = this.name();

        const group_id = `${prefix}-${name}`;
        this.log("Cluster %s uses Sparkplug group %s", uuid, group_id);
        await cdb.put_config(UUIDs.App.SparkplugAddress, uuid, { group_id });
    }

    async accounts () {
        const { auth, cdb, uuid, spec, status } = this;
        const group = this.config.group;
        const name = this.name();

        if (!status.flux) {
            const flux = await cdb.create_object(Edge.Class.Account);
            /* XXX We should record this UUID at this point, but we need
             * to know we haven't finished with it. */
            this.log("Creating op1flux/%s as %s", name, flux);
            await cdb.put_config(UUIDs.App.Info, flux, 
                { name: `Edge flux: ${name}` });
            await auth.add_grant({
                principal:  flux,
                permission: Git.Perm.Pull,
                target:     uuid,
                plural:     false,
            });
            await auth.add_to_group(group.flux.uuid, flux);
            await auth.add_principal(flux, this.principal("op1flux"));
            this.update({ flux });
        }
        if (!status.krbkeys) {
            const krbkeys = await cdb.create_object(Edge.Class.Account);
            this.log("Creating op1krbkeys/%s as %s", name, krbkeys);
            await cdb.put_config(UUIDs.App.Info, krbkeys,
                { name: `Edge krbkeys: ${name}` });
            await auth.add_to_group(group.krbkeys.uuid, krbkeys);
            await auth.add_principal(krbkeys, this.principal("op1krbkeys"));
            this.update({ krbkeys });
        }
    }

    async repo () {
        const { uuid, spec } = this;
        const group = this.config.group.cluster;
        const name = this.name();
        const path = `${group.path}/${name}`;

        this.log("Creating repo for %s", name);
        await this.cdb.put_config(Git.App.Config, uuid, { path });
        await this.auth.add_to_group(group.uuid, uuid);

        const flux = await this.flux();

        this.log("Checking out repo %s", uuid);
        const co = await Checkout.clone({ fplus: this.fplus, uuid });
        await co.mkdir("by-hand");
        await co.write_file("README.md", README);

        const dir = await co.clean_dir("edo", "cluster");
        for (const [file, docs] of Object.entries(flux)) {
            await co.write_manifests(dir, file, docs);
        }
        await co.push("Cluster flux update");
        const self_link = flux["self-link.yaml"]
            .map(obj => yaml.stringify(obj, null, { directives: true }))
            .join("...\n");
        this.update({ self_link });
    }

    async flux () {
        const { uuid, spec } = this;
        const name = this.name();
        const git = this.fplus.Git;
        const template = this.op.template;

        /* Fetch our cluster helm chart template */
        const cluster_template = await this.op.config_template(
            Edge.App.HelmChart,
            spec.chart ?? this.config.helm.cluster);

        /* Build the cluster helm chart template */
        const cluster = cluster_template({ uuid, name });
        const values = jmp.merge(cluster.values, spec.values ?? {});
        /* Build the cluster HelmRelease manifest */
        const helm = template.helm({ ...cluster, uuid, values }).template;
        helm.metadata.namespace = spec.namespace;
        /* Build the initial repo contents */
        const flux = template.flux({
            helm,
            namespace:  spec.namespace,
            url: {
                self:   await git.repo_by_uuid(uuid),
                helm:   await git.repo_by_uuid(this.config.repo.helm.uuid),
            },
        });

        if (spec.bare)
            delete flux["flux-system.yaml"];

        return flux;
    }
}

export class Delete extends Action {
    async apply () {
        const { auth, cdb, status, uuid } = this;
        const group = this.config.group;
        const name = this.name();

        this.log("Removing cluster %s", name);

        const { flux, krbkeys } = status;
        if (flux) {
            this.log("Removing op1flux/%s (%s)", name, flux);
            await auth.delete_principal(flux)
                .catch(svc_catch(404));
            await auth.remove_from_group(group.flux.uuid, flux);
            await auth.delete_ace(flux, Git.Perm.Pull, uuid);
            await cdb.mark_object_deleted(flux)
                .catch(svc_catch(404));
        }
        if (krbkeys) {
            this.log("Removing op1krbkeys/%s (%s)", name, krbkeys);
            await auth.delete_principal(krbkeys)
                .catch(svc_catch(404));
            await auth.remove_from_group(group.krbkeys.uuid, krbkeys);
            await cdb.mark_object_deleted(krbkeys)
                .catch(svc_catch(404));
        }

        this.log("Removing repo for %s", name);
        await cdb.delete_config(Git.App.Config, uuid)
            .catch(svc_catch(404));
        this.log("Removing Sparkplug group for %s", name);
        await cdb.delete_config(UUIDs.App.SparkplugAddress, uuid)
            .catch(svc_catch(404));
        this.update(null);
        this.log("Removed cluster %s (%s)", name, uuid);
    }
}


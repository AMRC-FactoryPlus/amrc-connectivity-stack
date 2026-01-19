/*
 * Copyright (c) University of Sheffield AMRC 2025.
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
    constructor (op, uuid, spec, status) {
        this.op = op;
        this.uuid = uuid;
        this.spec = spec;
        this.status = status;

        this.fplus = op.fplus;
        this.cdb = op.fplus.ConfigDB;
        this.auth = op.fplus.Auth;

        this.config = op.config;
        this.prefix = op.org_prefix;

        this.log = op.fplus.debug.bound("cluster");
    }

    update (patch) {
        /* this.status is not live */
        jmp.apply(this.status, patch);
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
        const { cdb, spec, status, uuid } = this;

        this.fixup_account_status();

        if (status.ready) {
            this.log("Cluster %s is already set up", uuid);
            return;
        }

        this.log("Setting up cluster %s (%s)", this.name(), uuid);
        this.update({ spec });
        await this.address();
        await this.accounts();
        await this.repo();
        this.update({ ready: true });
        this.log("Cluster %s is ready", this.name());
    }

    fixup_account_status () {
        const { status } = this;

        const changes = new Map();

        for (const acc of ["flux", "krbkeys"]) {
            const uuid = status[acc];
            if (typeof uuid != "string") continue;
            changes.set("ready", false);
            changes.set(acc, { uuid });
        }

        if (!changes.size) return;
        const patch = Object.fromEntries(changes.entries());
        this.update(patch);
    }

    async address () {
        const { cdb, uuid, spec, prefix } = this;
        const name = this.name();

        const group_id = `${prefix}-${name}`;
        this.log("Cluster %s uses Sparkplug group %s", uuid, group_id);
        await cdb.put_config(UUIDs.App.SparkplugAddress, uuid, { group_id });
    }

    async accounts () {
        const { auth, cdb, uuid: cluster, spec, status } = this;
        const group = this.config.group;
        const name = this.name();

        const do_acc = async (role, perm) => {
            const st = status[role];
            if (st?.done) return;

            const upn = `op1${role}`;

            let uuid = st?.uuid;
            if (!uuid) {
                uuid = await cdb.create_object(Edge.Class.Account);
                this.update({ [role]: { uuid } });
            }
            this.log("Created %s/%s as %s", upn, name, uuid);

            await cdb.put_config(UUIDs.App.Info, uuid,
                { name: `Edge ${role}: ${name}` });

            if (perm) {
                /* This will succeed if we add a duplicate. This is
                 * important for migration. */
                const grant = await auth.add_grant({
                    principal:  uuid,
                    permission: perm,
                    target:     cluster,
                    plural:     false,
                });
            }

            await cdb.class_add_member(group[role].uuid, uuid);
            await auth.add_identity(uuid, "kerberos", this.principal(upn));
            this.update({ [role]: { done: true } });
        };

        await do_acc("flux", Git.Perm.Pull);
        await do_acc("krbkeys");
    }

    async repo () {
        const { uuid, spec } = this;
        const group = this.config.group.cluster;
        const name = this.name();
        const path = `${group.path}/${name}`;

        this.log("Creating repo for %s", name);
        await this.cdb.put_config(Git.App.Config, uuid, { path });
        await this.cdb.class_add_member(group.uuid, uuid);

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
        const helm = template.helm({
            ...cluster,
            uuid, name, values,
            prefix: "edge-cluster",
            source: "helm-charts"
        }).template;
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

        const rm_acc = async key => {
            const st = status[key];
            if (!st?.uuid) return;
            this.update({ [key]: { done: false } });

            this.log("Removing op1%s/%s (%s)", key, name, st.uuid);
            const grants = await auth.find_grants({ principal: st.uuid });
            for (const g of grants) {
                await auth.delete_grant(g)
                    .catch(svc_catch(403, 404));
            }
            await auth.delete_identity(st.uuid, "kerberos")
                .catch(svc_catch(404));
            await cdb.class_remove_member(group[key].uuid, st.uuid);
            /* I haven't worked out how to grant permission for this
             * yet. Currently this is a PATCH to Registration, and we
             * don't have support for fine-grained ACLs. */
            await cdb.mark_object_deleted(st.uuid)
                .catch(svc_catch(403, 404));
            this.update({ [key]: null });
        };

        await rm_acc("flux");
        await rm_acc("krbkeys");

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


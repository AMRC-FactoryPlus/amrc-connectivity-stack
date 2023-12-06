/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Deployment operator
 * Cluster actions
 * Copyright 2023 AMRC
 */

import rx from "rxjs";

import { UUIDs }        from "@amrc-factoryplus/utilities";

import { Git, Edge }    from "./uuids.js";

class Action {
    constructor (op, uuid, status) {
        this.op = op;
        this.uuid = uuid;
        this.status = status;

        this.cdb = op.fplus.ConfigDB;
        this.auth = op.fplus.Auth;
        this.config = op.config;

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
        await this.accounts();
        await this.repo();
        this.update({ ready: true });
        this.log("Cluster %s is ready", this.name());
    }

    async repo () {
        const { uuid, spec } = this;
        const group = this.config.group.cluster;
        const path = `${group.path}/${spec.name}`;

        this.log("Creating repo for %s", this.name());
        await this.cdb.put_config(Git.App.Config, uuid, { path });
        await this.auth.add_to_group(group.uuid, uuid);
    }

    async accounts () {
        const { auth, cdb, uuid, spec, status } = this;
        const group = this.config.group;
        const name = this.name();

        if (!status.flux) {
            const flux = await cdb.create_object(Edge.Class.Account);
            this.log("Creating up op1flux/%s as %s", name, flux);
            await cdb.put_config(UUIDs.App.Info, flux, 
                { name: `Edge flux: ${name}` });
            await auth.add_ace(flux, Git.Perm.Pull, uuid);
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
            await auth.delete_principal(flux);
            await auth.remove_from_group(group.flux.uuid, flux);
            await auth.delete_ace(flux, Git.Perm.Pull, uuid);
            await cdb.mark_object_deleted(flux);
        }
        if (krbkeys) {
            this.log("Removing op1krbkeys/%s (%s)", name, krbkeys);
            await auth.delete_principal(krbkeys);
            await auth.remove_from_group(group.krbkeys.uuid, krbkeys);
            await cdb.mark_object_deleted(krbkeys);
        }

        this.log("Removing repo for %s", name);
        await cdb.delete_config(Git.App.Config, uuid);
        this.update(null);
        this.log("Removed cluster %s (%s)", name, uuid);
    }
}


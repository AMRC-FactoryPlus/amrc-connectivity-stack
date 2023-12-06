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
    }

    update (patch) {
        this.op.status_updates.next([this.uuid, patch]);
    }

    principal (srv) {
        const { cluster, status, uuid } = this;
        const name = status.spec.name ?? cluster.name;
        if (name == undefined)
            throw new Error(`No name available for cluster ${uuid}`);
        return `${srv}/${name}@${this.op.realm}`;
    }
}

export class Update extends Action {
    async apply () {
        const { cdb, status, uuid } = this;

        this.cluster = await cdb.get_config(Edge.App.Cluster, uuid);
        if (!this.cluster) {
            this.log("Cluster %s has disappeared!", uuid);
            return;
        }
        if (status.ready) {
            this.log("Cluster %s is already set up", uuid);
            return;
        }

        this.update({ spec: this.cluster });
        await this.accounts();
        await this.repo();
        this.update({ ready: true });
    }

    async repo () {
        const { uuid, cluster } = this;
        const group = this.config.group.cluster;
        const path = `${group.path}/${cluster.name}`;

        await this.cdb.put_config(Git.App.Config, uuid, { path });
        await this.auth.add_to_group(group.uuid, uuid);
    }

    async accounts () {
        const { auth, cdb, cluster, status } = this;
        const group = this.config.group;

        if (!status.flux) {
            const flux = await cdb.create_object(Edge.Class.Account);
            await cdb.put_config(UUIDs.App.Info, flux, 
                { name: `Edge flux: ${cluster.name}` });
            await auth.add_ace(flux, Git.Perm.Pull, uuid);
            await auth.add_to_group(group.flux.uuid, flux);
            await auth.add_principal(flux, this.principal("op1flux"));
            this.update({ flux });
        }
        if (!status.krbkeys) {
            const krbkeys = await cdb.create_object(Edge.Class.Account);
            await cdb.put_config(UUIDs.App.Info, krbkeys,
                { name: `Edge krbkeys: ${cluster.name}` });
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

        const { flux, krbkeys } = status;
        if (flux) {
            await auth.delete_principal(flux);
            await auth.remove_from_group(group.flux.uuid, flux);
            await auth.delete_ace(flux, Git.Perm.Pull, uuid);
            await cdb.mark_object_deleted(flux);
        }
        if (krbkeys) {
            await auth.delete_principal(krbkeys);
            await auth.remove_from_group(group.krbkeys.uuid, krbkeys);
            await cdb.mark_object_deleted(krbkeys);
        }

        await cdb.delete_config(Git.App.Config, uuid);
        this.update(null);
    }
}


/* ACS service setup
 * Service config management
 * Copyright 2023 AMRC
 */

import { UUIDs }    from "@amrc-factoryplus/service-client";

export class ServiceConfig {
    constructor (opts) {
        this.ss = opts.ss;
        this.service = opts.service;

        this.fplus = opts.ss.fplus;
        this.Auth = this.fplus.Auth;
        this.CDB = this.fplus.ConfigDB;
        this.log = this.fplus.debug.bound(opts.name);
    }

    async init () {
        this.config = await this.CDB.get_config(
            UUIDs.App.ServiceConfig, this.service);
        this.config ??= {};
        this.log("Fetched existing config for %s: %o",
            this.service, this.config);

        return this;
    }

    async finish () {
        await this.CDB.put_config(
            UUIDs.App.ServiceConfig, this.service, this.config);
        this.log("Installed new config for %s: %o",
            this.service, this.config);
        return this.config;
    }

    async setup_group (path, klass, name) {
        const { CDB } = this;
        const group = this.config.group ??= {};

        const have = group[path];
        if (have && have.uuid) {
            this.log("Using existing group %s: %s", path, have.uuid);
            return;
        }

        this.log("Creating group %s", path);
        const uuid = await CDB.create_object(klass);
        this.log("Created group %s: %s", path, uuid);
        await CDB.put_config(UUIDs.App.Info, uuid, { name });
        group[path] = { uuid };
    }

    async setup_groups (...groups) {
        for (const g of groups) {
            await this.setup_group(...g);
        }
    }

    async setup_subgroups (...subgroups) {
        const { CDB } = this;
        const { group } = this.config;

        for (const [parent, ...paths] of subgroups) {
            for (const p of paths) {
                const obj = group[p].uuid;
                this.log("Adding %s ⊂ %s", obj, parent);
                await CDB.class_add_subclass(parent, obj);
            }
        }
    }

    async setup_members (...members) {
        const { CDB } = this;
        const { group } = this.config;

        for (const [parent, ...paths] of members) {
            for (const p of paths) {
                const obj = group[p].uuid;
                this.log("Adding %s ∈ %s", obj, parent);
                await CDB.class_add_member(parent, obj);
            }
        }
    }
}

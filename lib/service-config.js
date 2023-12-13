/* ACS service setup
 * Service config management
 * Copyright 2023 AMRC
 */

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
            UUIDs.App.ServiceSetup, this.service);
        this.config ??= {};

        return this;
    }

    async finish () {
        await this.CDB.put_config(
            UUIDs.App.ServiceSetup, this.service, this.config);
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

        log("Creating group %s", path);
        const uuid = await CDB.create_object(klass);
        log("Created group %s: %s", path, uuid);
        await CDB.put_config(UUIDs.App.Info, uuid, { name });
        group[path] = { uuid };
    }

    async setup_groups (...groups) {
        for (const g of groups) {
            await this.setup_group(...g);
        }
    }
}

/* ACS service setup
 * Service config management
 * Copyright 2023 AMRC
 */

import { UUIDs }    from "@amrc-factoryplus/service-client";

import { DumpLoader }   from "./dumps.js";

export class ServiceConfig {
    constructor (opts) {
        this.ss         = opts.ss;
        this.name       = opts.name;
        this.service    = opts.service;

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

    /* XXX This is not atomic. If s-s crashes we will leave behind
     * orphaned objects. */
    async setup_object (msg, config, key, klass) {
        const { CDB } = this;

        const have = config[key];
        if (have && have.uuid) {
            this.log("Using existing %s %s: %s", msg, key, have.uuid);
            return have.uuid;
        }

        this.log("Creating %s %s", msg, key);
        const uuid = await CDB.create_object(klass);

        this.log("Created %s %s: %s", msg, key, uuid);
        config[key] = { uuid };
        return uuid;
    }

    async setup_objects (type, klass, ...keys) {
        const config = this.config[type] ??= {};
        for (const k of keys) {
            await this.setup_object(type, config, klass, k);
        }
        return Object.fromEntries(
            Object.entries(config)
                .map(([k, { uuid }]) => [k, uuid]));
    }

    async setup_group (path, klass, name) {
        const { CDB } = this;

        const groups = this.config.group ??= {};
        const uuid = await this.setup_object("group", groups, path, klass);
        await CDB.put_config(UUIDs.App.Info, uuid, { name });
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

    async load_dumps (uuids, yaml) {
        const loader = new DumpLoader({
            fplus:      this.fplus,
            log:        this.log,
            acs_config: this.ss.acs_config,
            uuids,
        });

        await loader.load_from_file(yaml, `(${this.name}.js)`);
    }
}

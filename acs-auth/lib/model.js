/*
 * Factory+ / AMRC Connectivity Stack (ACS) Authorisation component
 * Database access (model)
 * Copyright 2022 AMRC
 */

import { UUIDs} from "@amrc-factoryplus/service-client";
import { DB } from "@amrc-factoryplus/pg-client";

import Queries from "./queries.js";
import {Perm} from "./uuids.js";
import { has_wild } from "./validate.js";

export default class Model extends Queries {
    constructor(opts) {
        const db = new DB({
            debug:      opts.debug,
            version:    Queries.DBVersion,
        });

        super(db.query.bind(db))

        this.debug = opts.debug;

        this.db = db;
        this.acl_cache_age = opts.acl_cache * 1000;
        this.root_principal = opts.root_principal;

        this.acl_cache = new Map();
    }

    async init() {
        await this.db.init();
        return this;
    }

    txn(work) {
        return this.db.txn({}, q => work(new Queries(q)));
    }

    async get_acl(principal, permission, by_uuid = false) {
        /* Create separate cache entries for by-krb and by-uuid lookups.
         * There is no chance of conflict, and the small risk of
         * duplicated cache entries is well worth avoiding needing to
         * look up princials / UUIDs. */
        const key = [principal, permission].join(",");
        const cache = this.acl_cache;

        const now = Date.now();
        const cached = cache.get(key);
        if (cached) {
            this.debug.log("acl", `Cached result ${cached.expiry} (${cached.expiry - now})`);
            if (cached.expiry > now)
                return cached.result;
            cache.delete(key);
        }

        const acl = await this.txn(async q => {
            const id = by_uuid
                ? await q.principal_by_uuid(principal)
                : await q.principal_by_krb(principal);
            return await q.acl_get(id, permission);
        });
        cache.set(key, {
            result: acl,
            expiry: now + this.acl_cache_age,
        });
        return acl;
    }

    async check_acl(principal, permission, target, wild) {
        if (this.root_principal && principal == this.root_principal)
            return true;

        const acl = await this.get_acl(principal, Perm.All);
        return acl.some(ace => ace.permission == permission
            && (ace.target == target
                || (wild && ace.target == UUIDs.Null)));
    }

    action_invoke(actions, key, ...args) {
        return key in actions
            ? this[actions[key]](...args)
            : 400;
    }

    async grant_request (r) {
        if (r.grant && !has_wild(r.permitted, r.grant.permission))
            return { status: 403 };

        return this.txn(async q => {
            if (r.uuid == null)
                return q.grant_new(r.grant);

            const [status, id] = await q.grant_find(r.uuid, r.permitted);
            if (status != 200) return { status };

            if (r.grant == null)
                await q.grant_delete(id);
            else
                await q.grant_update(id, r.grant);
            return { status: 204 };
        });
    }

    dump_validate(dump) {
        /* Parens essential due to stupid JS parsing magic (semicolon
         * insertion grrr) */
        return (
            dump.service == UUIDs.Service.Authentication
            && dump.version == 1
        );
    }

    dump_load(dump) {
        if (!this.dump_validate(dump))
            return 400;

        return 204;
        return this.txn(async q => {
            for (const ace of dump.aces ?? []) {
                await q.ace_add(ace);
            }
            for (const [grp, mems] of Object.entries(dump.groups ?? {})) {
                for (const mem of mems) {
                    await q.group_add(grp, mem);
                }
            }
            for (const pri of dump.principals ?? []) {
                await q.principal_add(pri);
            }

            return 204;
        });
    }

    dump_save() {
        return this.txn(async q => {
            const aces = await q.ace_get_all();
            const parents = await q.group_list();
            const groups = Object.fromEntries(
                await Promise.all(
                    parents.map(p =>
                        q.group_get(p)
                            .then(ms => [p, ms]))));
            const principals = await q.principal_get_all();

            return {
                service: UUIDs.Service.Authentication,
                version: 1,
                aces, groups, principals,
            };
        });
    }
}

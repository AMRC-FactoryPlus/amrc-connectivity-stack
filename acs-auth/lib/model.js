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
        this.log = opts.debug.bound("model");

        this.db = db;
        this.acl_cache_age = opts.acl_cache * 1000;
        this.root_principal = opts.root_principal;
        this.realm = opts.realm;

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

    /* The dump must be valid. We will get database errors (at best) if
     * it is not. */
    dump_load(dump) {
        const realm = this.realm;
        const krbs = Object.entries(dump.identities ?? {})
            .map(([uuid, { kerberos: upn }]) => ({
                uuid,
                kerberos:   /@/.test(upn) ? upn : `${upn}@${realm}`,
            }));
        const aces = Object.entries(dump.grants ?? {})
            .flatMap(([principal, perms]) => 
                Object.entries(perms)
                    .map(([p, t]) => [p, t ?? { [UUIDs.Special.Null]: false }])
                    .flatMap(([permission, targs]) =>
                        Object.entries(targs)
                            .flatMap(([target, plural]) =>
                                ({ principal, permission, target, plural }))));
        const uuids = new Set([
            ...aces.map(g => g.principal),
            ...aces.map(g => g.permission),
            ...aces.map(g => g.target),
            ...krbs.map(k => k.uuid),
        ]);

        return this.txn(async q => {
            const n_uuid = await q.dump_load_uuids(uuids);
            if (n_uuid.length)
                this.log("Inserted new UUIDs: %o", n_uuid);

            /* We want entirely duplicate entries to be silently
             * ignored, but mismatches to fail the dump. */
            const n_id = await q.dump_load_krbs(krbs)
                .catch(e => e?.code == "23505" ? null : Promise.reject(e));
            if (!n_id) return 409;
            if (n_id.length)
                this.log("Updated identity for %o", n_id);
                    
            const n_grant = await q.dump_load_aces(aces);
            if (n_grant.length)
                this.log("Updated grants: %o", n_grant);

            return 204;
        });
    }

    dump_save() {
        return 404;
//        return this.txn(async q => {
//            const aces = await q.ace_get_all();
//            const parents = await q.group_list();
//            const groups = Object.fromEntries(
//                await Promise.all(
//                    parents.map(p =>
//                        q.group_get(p)
//                            .then(ms => [p, ms]))));
//            const principals = await q.principal_get_all();
//
//            return {
//                service: UUIDs.Service.Authentication,
//                version: 1,
//                aces, groups, principals,
//            };
//        });
    }
}

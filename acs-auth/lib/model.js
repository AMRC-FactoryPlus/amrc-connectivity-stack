/*
 * Factory+ / AMRC Connectivity Stack (ACS) Authorisation component
 * Database access (model)
 * Copyright 2022 AMRC
 */

import { DB } from "@amrc-factoryplus/pg-client";

import Queries from "./queries.js";

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
    }

    async init() {
        await this.db.init();
        return this;
    }

    txn(work) {
        return this.db.txn({}, q => work(new Queries(q)));
    }

    /* The request structure here includes r.permitted, the set of
     * ManageACL permissions the user is granted. This is because we
     * must make some permission checks inside the txn; deleting an
     * existing grant requires ManageACL on that entry's perm, and
     * changing the perm requires ManageACL on both perms. */
    async grant_request (r) {
        if (r.grant && !r.permitted(r.grant.permission))
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

    /* This request does not check permissions. */
    _identity_request (r) {
        if (r.name == null)
            return this.identity_delete(r.uuid, r.kind);

        return this.txn(async q => {
            const pid = await q.uuid_find(r.uuid);
            const kid = await q.idkind_find(r.kind);
            if (!kid) return 404;

            return q.identity_add(pid, kid, r.name);
        });
    }

    async identity_request (r) {
        const status = await this._identity_request(r);
        return { status };
    }

    dump_request (r) {
        const uuids = [...new Set([
            ...r.grants.map(g => g.principal),
            ...r.grants.map(g => g.permission),
            ...r.grants.map(g => g.target),
            ...r.krbs.map(k => k.uuid),
        ])];

        const ids = r.krbs.map(k => k.uuid);
        if (!ids.every(u => r.permitted.id?.(u)))
            return { status: 403 };

        const gto = [...new Set(r.grants.map(g => g.principal))];

        return this.txn(async q => {
            const existing = await q.dump_existing_perms(gto);
            const perms = [...new Set([
                ...existing,
                ...r.grants.map(g => g.permission),
            ])];
            this.log("Need WriteACL on %o", perms);
            if (!perms.every(p => r.permitted.acl?.(p)))
                return { status: 403 };

            const n_uuid = await q.dump_load_uuids(uuids);
            if (n_uuid.length)
                this.log("Inserted new UUIDs: %o", n_uuid);

            /* We want entirely duplicate entries to be silently
             * ignored, but mismatches to fail the dump. */
            const n_id = await q.dump_load_krbs(r.krbs)
                .catch(e => e?.code == "23505" ? null : Promise.reject(e));
            if (!n_id) return { status: 409 };
            if (n_id.length)
                this.log("Updated identity for %o", n_id);
                    
            const n_grant = await q.dump_load_aces(r.grants);
            if (n_grant.length)
                this.log("Updated grants: %o", n_grant);

            return { status: 204 };
        });
    }
}

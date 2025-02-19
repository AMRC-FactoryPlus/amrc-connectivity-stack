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
        this.realm = opts.realm;
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
    identity_request (r) {
        if (r.name == null)
            return this.identity_delete(r.uuid, r.kind);

        return this.txn(async q => {
            const pid = await q.uuid_find(r.uuid);
            const kid = await q.idkind_find(r.kind);
            if (!kid) return 404;

            return q.identity_add(pid, kid, r.name);
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
}

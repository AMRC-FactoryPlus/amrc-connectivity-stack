/* ACS Auth service
 * Dump loading endpoints
 * Copyright 2025 University of Sheffield AMRC
 */


import { dump_schema }      from "./dump-schema.js";
import { Perm, Special }    from "./uuids.js";    

export class Loader {
    constructor (opts) {
        this.data   = opts.data;
        this.realm  = opts.realm; 

        this.log = opts.debug.bound("load");

        this.routes = this.load.bind(this);
    }

    async load(req, res) {
        const dump = req.body;

        if (!dump_schema(dump))
            req.fail(422, "Dump failed validation: %o", dump_schema.errors);

        const { data, realm } = this;

        const krbs = Object.entries(dump.identities ?? {})
            .map(([uuid, { kerberos: upn }]) => ({
                uuid,
                kerberos:   /@/.test(upn) ? upn : `${upn}@${realm}`,
            }));
        const grants = Object.entries(dump.grants ?? {})
            .flatMap(([principal, perms]) => 
                Object.entries(perms)
                    .map(([p, t]) => [p, t ?? { [Special.Wildcard]: false }])
                    .flatMap(([permission, targs]) =>
                        Object.entries(targs)
                            .flatMap(([target, plural]) =>
                                ({ principal, permission, target, plural }))));
        const uuids = new Set([
            ...grants.map(g => g.principal),
            ...grants.map(g => g.permission),
            ...grants.map(g => g.target),
            ...krbs.map(k => k.uuid),
        ]);

        const ids   = krbs.map(k => k.uuid);
        const perms = new Set(grants.map(g => g.permission));

        const perm_ok = await data.check_targ(req.auth, Perm.WriteACL, true);
        const id_ok = await data.check_targ(req.auth, Perm.WriteKrb, true);

        for (const id of ids) {
            if (!id_ok?.(id))
                req.fail(403, "Can't write identity for %s", id);
        }
        for (const perm of perms) {
            if (!perm_ok?.(perm))
                req.fail(403, "Can't grant permission for %s", perm);
        }

        const rv = await this.data.request({ type: "dump", grants, krbs, uuids });
        res.status(rv.status).end();
    }
}

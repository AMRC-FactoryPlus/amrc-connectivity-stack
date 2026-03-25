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
        const permitted = {
            acl:    await data.check_targ(req.auth, Perm.WriteACL, true),
            id:     await data.check_targ(req.auth, Perm.WriteACL, true),
        };

        const rv = await this.data.request({ type: "dump", grants, krbs, permitted });
        res.status(rv.status).end();
    }
}

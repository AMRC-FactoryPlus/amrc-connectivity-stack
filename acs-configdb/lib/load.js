/*
 * ACS ConfigDB
 * Dump loading endpoint
 * Copyright 2024 University of Sheffield AMRC
 */

import { UUIDs } from "@amrc-factoryplus/service-client";

import { Perm } from "./constants.js";
import { dump_schema } from "./dump-schema.js";

export class Loader {
    constructor (opts) {
        this.model = opts.model;
        this.auth = opts.auth;

        this.log = opts.fplus.debug.bound("load");

        this.routes = this.load.bind(this);
    }

    async load(req, res) {
        const dump = req.body;

        if (!dump_schema(dump)) {
            /* XXX this is an awful API */
            this.log("Dump failed validation: %o", dump_schema.errors);
            return res.status(422).end();
        }

        /* XXX These permission checks are very restrictive; they are
         * basically admin-only. If we are going to keep this strategy
         * then it won't be possible for ordinary users to use /load as
         * an atomic create endpoint. OTOH, doing detailed and correct
         * permission checking will be difficult from within the dump
         * code. */
        const perms = [
            Perm.CreateSpecificObj,
            Perm.WriteMembers, Perm.WriteMemberships,
            Perm.WriteSubclasses, Perm.WriteSuperclasses,
            Perm.TakeFrom,
            Perm.WriteApp,
        ];
        for (const perm of perms) {
            const ok = await this.auth.check_acl(req.auth, perm, UUIDs.Null, false);
            if (!ok) {
                this.log("Refusing dump (%s)", perm);
                return res.status(403).end();
            }
        }

        const st = await this.model.dump_load(dump);
        res.status(st).end();
    }
}

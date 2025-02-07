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

        const perms = {
            classes: Perm.Manage_Obj,
            objects: Perm.Manage_Obj,
            configs: Perm.Write_App,
        };
        for (const [key, perm] of Object.entries(perms)) {
            if (key in dump) {
                const ok = await this.auth.check_acl(
                    req.auth, perm, UUIDs.Null, false);
                if (!ok) {
                    this.log("Refusing dump (%s)", key);
                    return res.status(403).end();
                }
            }
        }

        const st = await this.model.dump_load(dump);
        res.status(st).end();
    }
}

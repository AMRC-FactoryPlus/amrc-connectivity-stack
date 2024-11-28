/*
 * ACS ConfigDB
 * Dump loading endpoint
 * Copyright 2024 University of Sheffield AMRC
 */

import { UUIDs } from "@amrc-factoryplus/service-client";

import { Perm } from "./constants.js";

export class Loader {
    constructor (opts) {
        this.model = opts.model;
        this.auth = opts.auth;

        this.log = opts.fplus.debug.bound("load");

        this.routes = this.load.bind(this);
    }

    async load(req, res) {
        const dump = req.body;
        const booleans = {
            "true": true, "false": false,
            "1": true, "0": false,
            on: true, off: false,
            yes: true, no: false,
        };

        const overwrite = booleans[req.query.overwrite];
        if (overwrite == undefined)
            return res.status(400).end();

        if (!await this.model.dump_validate(dump))
            return res.status(400).end();

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

        const st = await this.model.dump_load(dump, !!overwrite);
        res.status(st).end();
    }
}

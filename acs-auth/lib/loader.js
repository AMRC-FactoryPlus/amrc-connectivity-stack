/* ACS Auth service
 * Dump loading endpoints
 * Copyright 2025 University of Sheffield AMRC
 */


import { dump_schema } from "./dump-schema.js";

export class Loader {
    constructor (opts) {
        this.model = opts.model;

        this.log = opts.debug.bound("load");

        this.routes = this.load.bind(this);
    }

    async load(req, res) {
        const dump = req.body;

        if (!dump_schema(dump)) {
            this.log("Dump failed validation: %o", dump_schema.errors);
            return res.status(422).end();
        }

        /* XXX Check permissions. Probably I just want a 'load dump'
         * catchall permission? There's not much point trying to be
         * granular with this. */

        const st = await this.model.dump_load(dump);
        res.status(st).end();
    }
}

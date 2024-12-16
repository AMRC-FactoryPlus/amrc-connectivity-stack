/*
 * ACS Auth service
 * Database access code
 * Copyright 2024 University of Sheffield AMRC
 */

import { DB }       from "@amrc-factoryplus/pg-client";

import { Queries }  from "./queries.js";

export class Model extends Queries {
    constructor(opts) {
        const db = new DB({
            version: Queries.DBVersion,
        });

        super(db.query.bind(db))

        this.authz = opts.auth;
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
}

/* Factory+ services
 * Database access layer
 * Copyright 2024 University of Sheffield AMRC
 */

import { createRequire } from "module";
import timers from "timers/promises";

/* The 'pg' module is not properly ESM-compatible. While pure-JS use can
 * be accomplished with `import Pg from "pg"` this does not provide
 * access to the native (libpq) bindings. They are only available via
 * CommonJS import. */
const require = createRequire(import.meta.url);
const pg_cjs = require("pg");

export const Pg = pg_cjs.native ?? pg_cjs;

export class DB {
    constructor (opts) {
        this.isolation = opts.isolation ?? "read committed";
        this.readonly = opts.readonly;
        this.deferrable = opts.deferrable;
        this.version = opts.version;
        this.debug = opts.debug;

        this.pool = new Pg.Pool();
        this.txid = 0;
    }

    async init () {
        if (this.version != null)
            await this._check_version();
        return this;
    }

    async connect () {
        for (;;) {
            try {
                return await this.pool.connect();
            }
            catch (err) {
                switch (err.code) {
                case "ECONNREFUSED":
                case "EAI_AGAIN":
                case "EAI_FAIL":
                case "EAI_NONAME":
                        this.debug.log("db", 
                            "Connection failure, retrying in 10 seconds...");
                        await timers.setTimeout(10000);
                        break;
                    /* fall through */
                default:
                    throw err;
                }
            }
        }
    }

    async query (...args) {
        let cli = await this.connect();
        try {
            this.debug.log("query", "%O", args);
            return await cli.query(...args);
        }
        finally {
            cli.release();
        }
    }

    async txn (opts, next) {
        if (!next)
            [opts, next] = [{}, opts];

        const isolation = opts.isolation ?? this.isolation;
        const readonly = opts.readonly ?? this.readonly;
        const deferrable = opts.deferrable ?? this.deferrable;

        const begin = [
            "begin",
            isolation ? `isolation level ${isolation}` : "",
            readonly ? "read only" : "read write",
            deferrable ? "deferrable" : "",
        ].join(" ");

        const id = this.txid++;
        let tries = 0;
        while (++tries < 5) {
            let cli = await this.connect();
            let query = (...args) => {
                this.debug.log("query", "<%i:%i> %O", id, tries, args);
                return cli.query(...args);
            }

            try {
                await query(begin);
                let rv = await next(query);
                await query("commit");
                return rv;
            }
            catch (e) {
                await query("rollback");
                /* serialization failure, retry */
                if (e.code == "40001") {
                    this.debug.log("query", "Serialization failure, retrying...");
                    continue;
                }
                throw e;
            }
            finally {
                cli.release();
            }
        }

        throw "Database transaction failed!";
    }

    async _check_version () {
        let res = null;
        try {
            res = await this.query("select version from version");
        }
        catch (e) {
            /* 42P01 is 'relation not found', which I am assuming means
             * this is an empty database.
             */
            if (e.code != "42P01")
                throw e;
        }

        let db_ver = null;
        if (res != null) {
            if (res.rows.length != 1)
                throw "Database version table doesn't have one row!";
            db_ver = res.rows[0].version;
        }

        this.debug.log("db", `Database is at version ${db_ver}`);
        const cur_ver = this.version;
        if (db_ver == cur_ver)
            return;

        throw `I require database version ${cur_ver}`;
    }
}

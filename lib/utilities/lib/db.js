/* Factory+ directory
 * Database access layer
 * Copyright 2021 AMRC
 */

import timers from "timers/promises";

import { Debug } from "@amrc-factoryplus/service-client";

import { Pg } from "./deps.js";

const debug = new Debug({ verbose: process.env.VERBOSE });

export class DB {
    constructor (opts) {
        this.isolation = opts.isolation ?? "read committed";
        this.readonly = opts.readonly;
        this.deferrable = opts.deferrable;
        this.version = opts.version;

        this.pool = new Pg.Pool();
        this.txid = 0;
    }

    async init () {
        if (this.version != null)
            await this._check_version();
        return this;
    }

    async connect () {
        let tries = 10;
        while (1) {
            try {
                return await this.pool.connect();
            }
            catch (err) {
                switch (err.code) {
                case "ECONNREFUSED":
                case "EAI_AGAIN":
                case "EAI_FAIL":
                case "EAI_NONAME":
                    if (tries-- > 0) {
                        debug.log("db", 
                            "Connection failure, retrying in 3 seconds...");
                        await timers.setTimeout(3000);
                        break;
                    }
                    /* fall through */
                default:
                    throw err;
                }
            }
        }
    }

    async query (sql, params, verbose) {
        let cli = await this.connect();
        try {
            debug.log("query", "QUERY [%s] PARAMS [%o]", sql, params);
            return await cli.query(sql, params);
        }
        finally {
            cli.release();
        }
    }

    async txn (opts, next) {
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
            let query = (sql, params) => {
                debug.log("query", "TXN [%i:%i] QUERY [%s] PARAMS %o", 
                    id, tries, sql, params);
                return cli.query(sql, params);
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
                    debug.log("query", "Serialization failure, retrying...");
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

        debug.log("db", `Database is at version ${db_ver}`);
        const cur_ver = this.version;
        if (db_ver == cur_ver)
            return;

        //if (this.readonly)
            throw `I require database version ${cur_ver}`;
    }

    async _setup_db (ddl) {
        await this.txn({ verbose: true }, async query => {
            for (let sql of ddl) {
                await query(sql);
            }
        });
    }
            
}

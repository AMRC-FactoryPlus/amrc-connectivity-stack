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

/* How long to wait for a connection, in ms. This covers both opening
 * a new connection and waiting for a free one from the pool. */
const CONNECT_TIMEOUT = 30000;
/* How long to wait for the reply to one query, in ms. */
const QUERY_TIMEOUT = 60000;
/* How long a connection sits quiet before TCP starts probing it. */
const KEEPALIVE_IDLE = 30000;

function env_ms (name, dflt) {
    const val = Number.parseInt(process.env[name], 10);
    return val >= 0 ? val : dflt;
}

/* Decide whether an error from a query means the connection can no
 * longer be used. An ordinary SQL error carries a five-character
 * SQLSTATE in `code` and leaves the connection healthy. Anything else
 * came from libpq or from our own timeout: the server went away, the
 * network dropped, the GSS layer failed, or no reply arrived. Class 08
 * is 'connection exception' and class 57P is the server shutting down
 * or killing our session. */
export function is_connection_error (err) {
    const code = err?.code;
    if (typeof code != "string" || !/^[0-9A-Z]{5}$/.test(code))
        return true;
    return code.startsWith("08") || code.startsWith("57P");
}

/* Run queries on a client checked out from the pool, remembering
 * whether any of them broke the connection. */
class Session {
    constructor (cli, log) {
        this.cli = cli;
        this.log = log;
        this.broken = null;

        /* The pool only listens for errors on idle clients. A client
         * which reports one while we hold it has nobody listening, and
         * an unheard error event takes the process down. */
        this.on_error = err => {
            this.log("Connection failed: %s", err?.message ?? err);
            this.broken ??= err;
        };
        cli.on?.("error", this.on_error);
    }

    async query (...args) {
        try {
            return await this.cli.query(...args);
        }
        catch (err) {
            if (is_connection_error(err)) {
                this.log("Connection failed: %s", err?.message ?? err);
                this.broken ??= err;
            }
            throw err;
        }
    }

    /* Hand the client back. A broken connection must never go back
     * into the pool: passing the error makes the pool close it, so the
     * next caller opens a new one. */
    release () {
        /* A broken client keeps our listener: it can still report
         * errors while the pool is closing it. */
        if (!this.broken)
            this.cli.removeListener?.("error", this.on_error);
        this.cli.release(this.broken ?? undefined);
    }
}

export class DB {
    /* Opts is an object; properties as follows. ? means optional.
     *  debug:              A Debug object for logging.
     *  version?:           The database schema version we require.
     *  isolation?:         Default transaction isolation level.
     *  readonly?:          Default to read-only transactions.
     *  deferrable?:        Default to deferrable transactions.
     *  connect_timeout?:   How long to wait for a connection (ms).
     *  query_timeout?:     How long to wait for one query (ms).
     *  pool?:              Extra options for the pg Pool.
     *
     * The timeouts can also be set with PG_CONNECT_TIMEOUT_MS and
     * PG_QUERY_TIMEOUT_MS in the environment. 0 means wait for ever.
     */
    constructor (opts) {
        this.isolation = opts.isolation ?? "read committed";
        this.readonly = opts.readonly;
        this.deferrable = opts.deferrable;
        this.version = opts.version;
        this.debug = opts.debug;

        /* Without these a query on a connection whose server has
         * vanished waits for ever and keeps its place in the pool. Once
         * every place is taken every later query waits for ever too,
         * and the service stays up but never answers. */
        this.pool = new Pg.Pool({
            connectionTimeoutMillis: opts.connect_timeout
                ?? env_ms("PG_CONNECT_TIMEOUT_MS", CONNECT_TIMEOUT),
            query_timeout: opts.query_timeout
                ?? env_ms("PG_QUERY_TIMEOUT_MS", QUERY_TIMEOUT),
            keepAlive: true,
            keepAliveInitialDelayMillis: KEEPALIVE_IDLE,
            ...opts.pool,
        });
        /* The pool reports an error on an idle connection here, having
         * already thrown the connection away. With no listener the
         * error would take the whole process down. */
        this.pool.on("error", err => this.debug.log("db",
            "Idle connection failed: %s", err?.message ?? err));
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
                case "ENOTFOUND":
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

    async session () {
        const cli = await this.connect();
        return new Session(cli, (...a) => this.debug.log("db", ...a));
    }

    async query (...args) {
        const sess = await this.session();
        try {
            this.debug.log("query", "%O", args);
            return await sess.query(...args);
        }
        finally {
            sess.release();
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
            const sess = await this.session();
            let query = (...args) => {
                this.debug.log("query", "<%i:%i> %O", id, tries, args);
                return sess.query(...args);
            }
            let begun = false;

            try {
                await query(begin);
                begun = true;
                let rv = await next(query);
                await query("commit");
                return rv;
            }
            catch (e) {
                /* A broken connection can't roll back, and doesn't need
                 * to: the server drops the transaction when the
                 * connection closes. Don't let a failed rollback hide
                 * the error which got us here. */
                if (!sess.broken)
                    await query("rollback").catch(() => {});
                /* The connection was dead before we did anything, so
                 * it is safe to start again on a new one. */
                if (sess.broken && !begun) {
                    this.debug.log("db", "Stale connection, retrying...");
                    continue;
                }
                /* serialization failure, retry */
                if (e.code == "40001") {
                    this.debug.log("db", "Serialization failure, retrying...");
                    continue;
                }
                throw e;
            }
            finally {
                sess.release();
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

/* Factory+ services
 * Tests for database connection recovery
 * Copyright 2026 University of Sheffield AMRC
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { DB, is_connection_error } from "../lib/index.js";

const debug = { log: () => {} };

function sql_error (code) {
    return Object.assign(new Error(`SQL error ${code}`), { code });
}

/* A stand-in for a pooled client. `script` maps the start of a query
 * to an error to throw; everything else succeeds. */
function fake_client (script = {}) {
    const cli = {
        queries:    [],
        released:   [],
        async query (sql) {
            cli.queries.push(sql);
            const hit = Object.keys(script).find(k => sql.startsWith(k));
            if (hit) throw script[hit];
            return { rows: [] };
        },
        release (err) { cli.released.push(err); },
    };
    return cli;
}

/* A DB which hands out the given clients in order. */
function fake_db (...clients) {
    const db = new DB({ debug });
    db.pool.end();
    db.pool = { connect: async () => clients.shift() };
    return db;
}

test("ordinary SQL errors leave the connection usable", () => {
    assert.equal(is_connection_error(sql_error("23505")), false);
    assert.equal(is_connection_error(sql_error("40001")), false);
    assert.equal(is_connection_error(sql_error("42P01")), false);
});

test("errors without a SQLSTATE mean the connection is gone", () => {
    for (const msg of [
        "server closed the connection unexpectedly",
        "no connection to the server",
        "GSSAPI caller failed to retransmit all data needing to be retried",
        "Query read timeout",
    ])
        assert.equal(is_connection_error(new Error(msg)), true, msg);
    assert.equal(is_connection_error("a string"), true);
    assert.equal(is_connection_error(
        Object.assign(new Error("reset"), { code: "ECONNRESET" })), true);
});

test("server shutdown and connection-exception states are fatal", () => {
    assert.equal(is_connection_error(sql_error("57P01")), true);
    assert.equal(is_connection_error(sql_error("08006")), true);
});

test("query discards a broken connection", async () => {
    const broken = new Error("server closed the connection unexpectedly");
    const cli = fake_client({ select: broken });
    const db = fake_db(cli);

    await assert.rejects(db.query("select 1"), broken);
    assert.deepEqual(cli.released, [broken]);
});

test("query keeps the connection after a SQL error", async () => {
    const cli = fake_client({ select: sql_error("42P01") });
    const db = fake_db(cli);

    await assert.rejects(db.query("select 1"), { code: "42P01" });
    assert.deepEqual(cli.released, [undefined]);
});

test("txn rolls back and keeps the connection after a SQL error", async () => {
    const cli = fake_client({ insert: sql_error("23505") });
    const db = fake_db(cli);

    await assert.rejects(db.txn(q => q("insert into t")), { code: "23505" });
    assert.equal(cli.queries.at(-1), "rollback");
    assert.deepEqual(cli.released, [undefined]);
});

test("txn reports the real error when the connection dies", async () => {
    const broken = new Error("no connection to the server");
    const cli = fake_client({ insert: broken, rollback: new Error("again") });
    const db = fake_db(cli);

    await assert.rejects(db.txn(q => q("insert into t")), broken);
    /* No point rolling back on a dead connection. */
    assert.ok(!cli.queries.includes("rollback"));
    assert.deepEqual(cli.released, [broken]);
});

test("txn discards a connection whose rollback fails", async () => {
    const broken = new Error("server closed the connection unexpectedly");
    const cli = fake_client({ rollback: broken });
    const db = fake_db(cli);
    const mine = new Error("application error");

    await assert.rejects(db.txn(async () => { throw mine; }), mine);
    assert.deepEqual(cli.released, [broken]);
});

test("txn starts again when the connection was already dead", async () => {
    const broken = new Error("no connection to the server");
    const stale = fake_client({ begin: broken });
    const fresh = fake_client();
    const db = fake_db(stale, fresh);

    const rv = await db.txn(async q => { await q("select 1"); return 42; });
    assert.equal(rv, 42);
    assert.deepEqual(stale.released, [broken]);
    assert.deepEqual(fresh.released, [undefined]);
    assert.equal(fresh.queries.at(-1), "commit");
});

test("txn does not repeat work when the connection dies part way", async () => {
    const broken = new Error("server closed the connection unexpectedly");
    const cli = fake_client({ update: broken });
    const spare = fake_client();
    const db = fake_db(cli, spare);

    await assert.rejects(db.txn(q => q("update t")), broken);
    assert.deepEqual(spare.queries, []);
});

test("an error event on a client in use discards it", async () => {
    const { EventEmitter } = await import("node:events");
    const cli = Object.assign(new EventEmitter(), fake_client());
    const db = fake_db(cli);
    const broken = new Error("terminating connection");

    /* With nobody listening this emit would throw. */
    const res = await db.txn(async q => {
        cli.emit("error", broken);
        return "done";
    });
    assert.equal(res, "done");
    assert.deepEqual(cli.released, [broken]);
    /* It may complain again while it is being closed. */
    cli.emit("error", broken);
});

test("a healthy client is handed back with no listener left on it", async () => {
    const { EventEmitter } = await import("node:events");
    const cli = Object.assign(new EventEmitter(), fake_client());
    const db = fake_db(cli);

    await db.query("select 1");
    assert.equal(cli.listenerCount("error"), 0);
});

/* These need a real server: set PGHOST and friends. */
const live = { skip: !process.env.PGHOST && "no database (set PGHOST)" };

test("a killed connection is replaced", live, async () => {
    const db = new DB({ debug, query_timeout: 2000, pool: { max: 1 } });
    try {
        const pid = (await db.query("select pg_backend_pid() pid")).rows[0].pid;

        /* Kill the pooled connection from outside the pool. */
        const admin = new DB({ debug, query_timeout: 2000 });
        await admin.query("select pg_terminate_backend($1)", [pid]);
        await admin.pool.end();

        /* The first use may see the failure. It must not come back. */
        await db.query("select 1").catch(() => {});
        const res = await db.query("select pg_backend_pid() pid");
        assert.notEqual(res.rows[0].pid, pid);
        await db.txn(q => q("select 1"));
    }
    finally {
        await db.pool.end();
    }
});

test("a query with no reply times out and frees its place", live, async () => {
    const db = new DB({ debug, query_timeout: 300, pool: { max: 1 } });
    try {
        await assert.rejects(db.query("select pg_sleep(5)"),
            /Query read timeout/);
        /* With one place in the pool, this only works if the stuck
         * connection was thrown away. */
        const res = await db.query("select 1 one");
        assert.equal(res.rows[0].one, 1);
    }
    finally {
        await db.pool.end();
    }
});

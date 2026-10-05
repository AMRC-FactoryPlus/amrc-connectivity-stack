/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * I3xStore: the embedded SQLite database that holds the i3X namespace
 * and last values off the JS heap.
 *
 * The database is a cache of ConfigDB and the UNS. Rebuilding it from
 * nothing is always safe, so a schema change bumps SCHEMA_VERSION and
 * the old tables are dropped instead of migrated.
 *
 * node:sqlite is synchronous. Every method here runs to completion in
 * one event-loop turn, so readers between turns never see a half-done
 * write, the same guarantee the in-memory snapshot gave.
 */

import type { DatabaseSync, StatementSync } from "node:sqlite";

/** Bump this whenever the tables below change. */
export const SCHEMA_VERSION = 1;

const TABLES = `
    -- The object tree. seq gives Map insertion order: an upsert keeps
    -- it, so a replaced object stays where it was.
    create table object (
        seq             integer primary key,
        element_id      text not null unique,
        parent_id       text,
        type_element_id text not null,
        display_name    text not null,
        is_composition  integer not null,
        source          text not null           -- 'config' | 'uns'
    );
    create index object_parent_ix on object (parent_id, seq);
    create index object_type_ix on object (type_element_id, seq);

    -- InfluxDB query metadata for leaf metrics.
    create table metric_meta (
        element_id      text primary key,
        top_level       text not null,
        metric_path     text not null,
        metric_name     text not null,
        sparkplug_type  text not null,
        type_suffix     text not null
    ) without rowid;

    create table object_type (
        seq             integer primary key,
        element_id      text not null unique,
        display_name    text not null,
        schema_json     text not null
    );

    -- The schemas each device in the tree references. A device is in
    -- the tree exactly when it has rows here.
    create table device_schema (
        device_uuid     text not null,
        schema_uuid     text not null,
        primary key (device_uuid, schema_uuid)
    ) without rowid;
    create index device_schema_schema_ix on device_schema (schema_uuid);

    -- What the sync engine last applied from ConfigDB, per Device
    -- class member and per referenced schema.
    create table sync_device (
        uuid            text primary key,
        etag_devinfo    text,
        etag_info       text,
        sparkplug_name  text,
        info_name       text
    ) without rowid;

    create table sync_schema (
        uuid            text primary key,
        etag_schema     text,
        etag_info       text,
        info_name       text
    ) without rowid;

    -- The last known value of each leaf metric. anchor is the object
    -- whose composition value includes this leaf directly. seq keeps
    -- the order leaves were first seen in, which is the order of a
    -- composition's components.
    create table last_value (
        seq             integer primary key,
        element_id      text not null unique,
        anchor          text,
        device_uuid     text,
        value_json      text,
        timestamp       text,
        quality         text not null,
        source          text not null           -- 'uns' | 'influx'
    );
    create index last_value_anchor_ix on last_value (anchor, seq);
    create index last_value_device_ix on last_value (device_uuid);

    create table meta (
        key             text primary key,
        value           text
    ) without rowid;
`;

export interface I3xStoreOpts {
    /** File path, or ":memory:". */
    path?: string;
    /** Page cache limit in MiB. */
    cacheMb?: number;
    /** Must match the stored value or the database is rebuilt. Use it
     * for settings the stored rows depend on, such as the namespace. */
    fingerprint?: string;
    /**
     * Group commit: writes join one open transaction, committed this
     * many ms after the first write. A COMMIT costs far more than the
     * writes of one device or one UNS message, so committing each on
     * its own took most of the CPU. 0 commits every transaction at
     * once. The database is a cache, so a crash loses at most this
     * much, and each batch commits whole.
     */
    commitInterval?: number;
    log?: (msg: string, ...args: any[]) => void;
}

let warningFilter = false;

/**
 * Load node:sqlite. It prints an ExperimentalWarning the first time it
 * is loaded on Node 22; drop just that one. getBuiltinModule loads it
 * here, after the filter is in place, where a static import would load
 * it before any of our code runs.
 */
function loadSqlite(): typeof import("node:sqlite") {
    if (!warningFilter) {
        warningFilter = true;
        const emit = process.emitWarning;
        process.emitWarning = function (warning: any, ...args: any[]) {
            const type = typeof args[0] === "string" ? args[0] : args[0]?.type;
            const text = typeof warning === "string" ? warning : warning?.message;
            if ((type === "ExperimentalWarning" || warning?.name === "ExperimentalWarning")
                    && /SQLite/.test(text ?? ""))
                return;
            return (emit as any).call(process, warning, ...args);
        } as typeof process.emitWarning;
    }
    return process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
}

export class I3xStore {
    readonly db: DatabaseSync;
    readonly path: string;
    private statements: Map<string, StatementSync> = new Map();
    private depth = 0;
    private log: (msg: string, ...args: any[]) => void;
    private commitInterval: number;
    private batchOpen = false;
    private batchTimer: ReturnType<typeof setTimeout> | null = null;
    private commitFailureListeners: Set<(err: unknown) => void> = new Set();

    /** True if the database was opened with tables already in place,
     * rather than created or rebuilt now. */
    warm: boolean = false;

    constructor(opts: I3xStoreOpts = {}) {
        this.path = opts.path ?? ":memory:";
        this.log = opts.log ?? (() => {});
        this.commitInterval = opts.commitInterval ?? 250;
        const { DatabaseSync } = loadSqlite();
        this.db = new DatabaseSync(this.path);

        const cacheMb = opts.cacheMb ?? 64;
        this.db.exec(`
            pragma journal_mode = wal;
            pragma synchronous = normal;
            -- After a checkpoint, cut the WAL file back to 64 MiB; it
            -- otherwise stays as large as the largest batch made it.
            pragma journal_size_limit = 67108864;
            pragma cache_size = ${-Math.max(1, Math.floor(cacheMb)) * 1024};
            pragma temp_store = file;
            pragma foreign_keys = off;
        `);

        this.ensureSchema(opts.fingerprint ?? "");
    }

    private ensureSchema(fingerprint: string): void {
        const version = (this.db.prepare("pragma user_version").get() as any).user_version;
        let stored: string | undefined;
        if (version === SCHEMA_VERSION) {
            stored = (this.db.prepare("select value from meta where key = 'fingerprint'")
                .get() as any)?.value;
        }
        if (version === SCHEMA_VERSION && stored === fingerprint) {
            this.warm = true;
            return;
        }

        if (version !== 0)
            this.log("rebuilding database: schema %d (want %d), fingerprint %s",
                version, SCHEMA_VERSION, stored === fingerprint ? "same" : "changed");

        /* Drop everything, whatever version made it. */
        const old = this.db.prepare(
            "select type, name from sqlite_master where type in ('table', 'index') and name not like 'sqlite_%'",
        ).all() as Array<{ type: string; name: string }>;
        this.db.exec("begin");
        try {
            for (const { name } of old.filter(o => o.type === "table"))
                this.db.exec(`drop table if exists "${name.replace(/"/g, '""')}"`);
            this.db.exec(TABLES);
            this.db.prepare("insert into meta (key, value) values ('fingerprint', ?)")
                .run(fingerprint);
            this.db.exec(`pragma user_version = ${SCHEMA_VERSION}`);
            this.db.exec("commit");
        } catch (err) {
            this.db.exec("rollback");
            throw err;
        }
    }

    /** A prepared statement, cached by its SQL text. */
    prepare(sql: string): StatementSync {
        let st = this.statements.get(sql);
        if (!st) {
            st = this.db.prepare(sql);
            this.statements.set(sql, st);
        }
        return st;
    }

    /**
     * Run `fn` atomically: if it throws, everything it wrote is undone
     * and the exception passes on. Calls may nest; an inner failure
     * undoes only the inner call's writes. With group commit the
     * writes are committed with the rest of the current batch, so
     * other code in this process sees them at once and a crash may
     * lose them; without it they are committed before this returns.
     */
    transaction<T>(fn: () => T): T {
        if (this.commitInterval > 0) this.openBatch();
        const outer = this.depth === 0 && !this.batchOpen;
        const sp = `sp${this.depth}`;
        this.db.exec(outer ? "begin" : `savepoint ${sp}`);
        this.depth++;
        try {
            const rv = fn();
            this.db.exec(outer ? "commit" : `release ${sp}`);
            return rv;
        } catch (err) {
            if (outer) {
                this.db.exec("rollback");
            } else {
                this.db.exec(`rollback to ${sp}`);
                this.db.exec(`release ${sp}`);
            }
            throw err;
        } finally {
            this.depth--;
        }
    }

    private openBatch(): void {
        if (this.batchOpen) return;
        this.db.exec("begin");
        this.batchOpen = true;
        this.batchTimer = setTimeout(() => this.commit(), this.commitInterval);
        this.batchTimer.unref?.();
    }

    /**
     * Call `listener` when a group commit fails and its batch is rolled
     * back. Returns a function that removes the listener.
     */
    onCommitFailure(listener: (err: unknown) => void): () => void {
        this.commitFailureListeners.add(listener);
        return () => this.commitFailureListeners.delete(listener);
    }

    /** Commit the current batch now, if one is open. */
    commit(): void {
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }
        if (!this.batchOpen) return;
        if (this.depth > 0) {
            /* Not reachable from a timer; finish the transaction first. */
            this.batchTimer = setTimeout(() => this.commit(), this.commitInterval);
            return;
        }
        this.batchOpen = false;
        try {
            this.db.exec("commit");
        } catch (err) {
            /* For example a full disk. The batch is lost. The database
             * is a cache; listeners (the sync engine) arrange to write
             * what was lost again. */
            console.error("I3xStore: commit failed, batch discarded:", err);
            try { this.db.exec("rollback"); } catch { /* already closed */ }
            for (const l of this.commitFailureListeners) {
                try {
                    l(err);
                } catch (e) {
                    console.error("I3xStore: commit failure listener threw:", e);
                }
            }
        }
    }

    getMeta(key: string): string | undefined {
        const row = this.prepare("select value from meta where key = ?").get(key) as any;
        return row?.value ?? undefined;
    }

    setMeta(key: string, value: string | null): void {
        this.transaction(() => {
            if (value === null)
                this.prepare("delete from meta where key = ?").run(key);
            else
                this.prepare("insert into meta (key, value) values (?, ?) on conflict (key) do update set value = excluded.value")
                    .run(key, value);
        });
    }

    /** Size of the database file in bytes (pages in use), or 0 in memory. */
    sizeBytes(): number {
        const pages = (this.prepare("pragma page_count").get() as any).page_count;
        const size = (this.prepare("pragma page_size").get() as any).page_size;
        return pages * size;
    }

    /**
     * A new read-only connection to the same database file, for reads
     * that must see one consistent snapshot over several event-loop
     * turns (begin a transaction on it). The caller closes it. null for
     * an in-memory database, which only this connection can see.
     */
    openReader(): DatabaseSync | null {
        if (this.path === ":memory:" || this.path === "") return null;
        const { DatabaseSync } = loadSqlite();
        return new DatabaseSync(this.path, { readOnly: true });
    }

    close(): void {
        this.commit();
        this.statements.clear();
        this.db.close();
    }
}

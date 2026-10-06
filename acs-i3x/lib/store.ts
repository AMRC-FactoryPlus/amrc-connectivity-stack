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

import { rmSync, statSync } from "node:fs";
import { Worker } from "node:worker_threads";
import type { DatabaseSync, StatementSync } from "node:sqlite";

/** Bump this whenever the tables below change. */
export const SCHEMA_VERSION = 2;

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
    -- UNS-discovered rows only, for finding orphans without a scan.
    create index object_uns_ix on object (parent_id) where source = 'uns';

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
    /**
     * Commit the open batch early, at the end of the transaction that
     * takes it past this many changed rows. A COMMIT writes every dirty
     * page at once and holds the event loop while it does; this keeps
     * each one short. Default 2,000.
     */
    maxBatchChanges?: number;
    /**
     * Run WAL checkpoints in a worker thread, every this many ms,
     * instead of inside a COMMIT on the main thread. Default 100; 0
     * leaves SQLite's automatic checkpoints on the main thread. File
     * databases only.
     */
    checkpointInterval?: number;
    /** WAL size in bytes past which writers that can wait hold back
     * until the checkpoint has caught up (walBehind). Default 64 MiB. */
    walLimit?: number;
    log?: (msg: string, ...args: any[]) => void;
}

/* The checkpoint worker. It loads node:sqlite with the same warning
 * filter, and checkpoints PASSIVE: copy what it can without waiting
 * for, or blocking, the writer or readers. */
const CHECKPOINTER = `
const { workerData } = require("node:worker_threads");
const emit = process.emitWarning;
process.emitWarning = function (w, ...a) {
    const type = typeof a[0] === "string" ? a[0] : a[0]?.type;
    const text = typeof w === "string" ? w : w?.message;
    if ((type === "ExperimentalWarning" || w?.name === "ExperimentalWarning") && /SQLite/.test(text ?? "")) return;
    return emit.call(process, w, ...a);
};
const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
const db = new DatabaseSync(workerData.path);
db.exec("pragma busy_timeout = 1000");
const st = db.prepare("pragma wal_checkpoint(PASSIVE)");
setInterval(() => {
    const sh = workerData.shared;
    if (Atomics.load(sh, 3) === 1) return;
    try {
        const r = st.get();
        if (r && r.busy === 0) {
            Atomics.store(sh, 1, r.log);
            Atomics.store(sh, 2, r.checkpointed);
            Atomics.add(sh, 0, 1);
        }
    } catch (err) { console.error("I3xStore checkpoint worker:", err.message); }
}, workerData.interval);
`;

/** WAL size beyond which writers that can wait let the checkpoint finish. */
const WAL_LIMIT = 64 * 1024 * 1024;
/** Times walLimit at which the main thread checkpoints, whatever the cost. */
const WAL_HARD_FACTOR = 16;


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
    private maxBatchChanges: number;
    private batchStartChanges = 0;
    private checkpointer: Worker | null = null;
    private walLimit: number;
    /* Set while the main thread wants the worker to skip its turns. */
    private walShared: Int32Array | null = null;
    private lastHard = -Infinity;
    /* Frames copied when a reader was found holding the checkpoint
     * back, or -1. */
    private pinnedAt = -1;
    private pageSize = 4096;
    private batchOpen = false;
    private batchTimer: ReturnType<typeof setTimeout> | null = null;
    private commitFailureListeners: Set<(err: unknown) => void> = new Set();
    /* Commit failures since the last log line; logged at most once a
     * minute, as a full disk fails every batch. */
    private commitFailures = 0;
    private lastCommitFailureLog = 0;

    /** True if the database was opened with tables already in place,
     * rather than created or rebuilt now. */
    warm: boolean = false;

    constructor(opts: I3xStoreOpts = {}) {
        this.path = opts.path ?? ":memory:";
        this.log = opts.log ?? (() => {});
        this.commitInterval = opts.commitInterval ?? 250;
        this.maxBatchChanges = opts.maxBatchChanges ?? 2000;
        this.walLimit = opts.walLimit ?? WAL_LIMIT;

        try {
            this.db = this.open(opts);
        } catch (err) {
            /* A corrupt or truncated file (a node crash, a bad volume
             * restore) would fail every start. The database is a cache
             * of ConfigDB, so start again from nothing; the next sync
             * fills it. */
            if (this.path === ":memory:" || this.path === "") throw err;
            console.error(`I3xStore: cannot open ${this.path}; DELETING it and the WAL and starting a new database. The next sync rebuilds it from ConfigDB.`, err);
            for (const f of [this.path, `${this.path}-wal`, `${this.path}-shm`])
                rmSync(f, { force: true });
            this.warm = false;
            this.db = this.open(opts);
        }
        this.startCheckpointer(opts.checkpointInterval ?? 100);
    }

    /**
     * A WAL checkpoint copies the WAL into the database file and syncs
     * it. SQLite runs one inside whichever COMMIT takes the WAL past
     * 1,000 pages, which held the event loop for up to 700 ms during a
     * cold sync. Instead a worker thread, on its own connection, runs a
     * PASSIVE checkpoint (which never blocks the writer) every
     * `interval` ms; see walBehind for keeping the WAL bounded. If the worker cannot start, SQLite's own
     * checkpoints stay on.
     */
    private startCheckpointer(interval: number): void {
        if (this.path === ":memory:" || this.path === "" || !(interval > 0)) return;
        try {
            /* [0] checkpoints the worker has completed; [1] frames
             * in the WAL and [2] frames copied, at the last one;
             * [3] set while the main thread needs the worker to wait. */
            this.walShared = new Int32Array(new SharedArrayBuffer(16));
            this.pageSize = (this.db.prepare("pragma page_size").get() as any).page_size;
            const w = new Worker(CHECKPOINTER, {
                eval: true,
                workerData: { path: this.path, interval, shared: this.walShared },
            });
            /* If the worker dies, SQLite checkpoints on this thread again,
             * and nothing waits for the worker's reports. */
            const lost = (why: string, err?: unknown) => {
                if (this.checkpointer !== w) return;   // closed on purpose
                console.error(`I3xStore: checkpoint worker ${why}; checkpointing on the main thread:`, err ?? "");
                this.checkpointer = null;
                this.walShared = null;
                try { this.db.exec("pragma wal_autocheckpoint = 1000"); } catch { /* closed */ }
            };
            w.on("error", err => lost("failed", err));
            w.on("exit", code => lost(`exited (code ${code})`));
            w.unref();
            this.db.exec("pragma wal_autocheckpoint = 0");
            this.checkpointer = w;
        } catch (err) {
            console.error("I3xStore: cannot start the checkpoint worker:", err);
        }
    }

    /**
     * Throw if the file is shorter than the database it claims to hold,
     * as after a truncated copy or restore. Only checked with no WAL to
     * replay: pages in the WAL can legitimately extend past the file.
     */
    private checkLength(db: DatabaseSync): void {
        if (this.path === ":memory:" || this.path === "") return;
        let wal = 0;
        try { wal = statSync(`${this.path}-wal`).size; } catch { /* no WAL */ }
        if (wal > 0) return;
        const pages = (db.prepare("pragma page_count").get() as any).page_count;
        const size = (db.prepare("pragma page_size").get() as any).page_size;
        const file = statSync(this.path).size;
        if (pages * size > file)
            throw new Error(`database file is truncated: ${file} bytes, ${pages} pages of ${size}`);
    }

    /** Open the database and check or create its schema. On failure
     * the connection is closed before the error is thrown. */
    private open(opts: I3xStoreOpts): DatabaseSync {
        const { DatabaseSync } = loadSqlite();
        const db = new DatabaseSync(this.path);
        try {
            const cacheMb = opts.cacheMb ?? 64;
            db.exec(`
                pragma journal_mode = wal;
                pragma synchronous = normal;
                -- After a checkpoint, cut the WAL file back to 64 MiB; it
                -- otherwise stays as large as the largest batch made it.
                pragma journal_size_limit = 67108864;
                pragma cache_size = ${-Math.max(1, Math.floor(cacheMb)) * 1024};
                pragma temp_store = file;
                pragma foreign_keys = off;
            `);
            (this as { db: DatabaseSync }).db = db;
            this.checkLength(db);
            this.ensureSchema(opts.fingerprint ?? "");
            return db;
        } catch (err) {
            this.statements.clear();
            try { db.close(); } catch { /* already unusable */ }
            throw err;
        }
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
            this.hardCheckpoint();
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
            if (outer) this.afterCommit();
            /* A large batch would make a long COMMIT; end it now. */
            if (this.depth === 1 && this.batchOpen && this.batchChanges() >= this.maxBatchChanges) {
                this.depth--;
                try { this.commit(); } finally { this.depth++; }
            }
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

    /**
     * The last resort. Writers that cannot wait (UNS messages that add
     * objects, a full value queue) can keep the worker from ever
     * finishing a checkpoint. Once the WAL holds WAL_HARD_FACTOR times
     * walLimit (1 GiB by default), checkpoint here after a commit, at
     * most every 100 ms: a stall of the event loop, but the disk must
     * not fill.
     */
    private hardCheckpoint(): void {
        const sh = this.walShared;
        if (!sh) return;
        const paused = Atomics.load(sh, 3) === 1;
        if (!paused && Atomics.load(sh, 1) * this.pageSize < WAL_HARD_FACTOR * this.walLimit) return;
        const now = performance.now();
        if (now - this.lastHard < (paused ? 50 : 100)) return;
        this.lastHard = now;
        /* Two checkpoints cannot run at once, and a PASSIVE one does
         * nothing if another is running: ask the worker to start no
         * more, and try again after the next commit until this one
         * gets through. */
        Atomics.store(sh, 3, 1);
        const r = this.prepare("pragma wal_checkpoint(PASSIVE)").get() as any;
        if (!r || r.busy) return;
        Atomics.store(sh, 1, r.log);
        Atomics.store(sh, 2, r.checkpointed);
        Atomics.store(sh, 3, 0);
        this.log("WAL over %d MiB: checkpointed on the main thread", (WAL_HARD_FACTOR * this.walLimit) >> 20);
    }

    /** True when the WAL holds more than walLimit of frames. */
    private walOverLimit(): boolean {
        return !!this.walShared && Atomics.load(this.walShared, 1) * this.pageSize >= this.walLimit;
    }

    /**
     * True while writers that can wait should hold back. The worker's
     * checkpoints copy the WAL into the file, but SQLite rewinds the WAL
     * only once a checkpoint has caught up with every frame, and beside
     * a writer that never stops it never quite does: the WAL grew
     * without limit (52 GB in a 74k-device cold start). Copying the
     * rest on this thread would hold the event loop (650 ms measured,
     * mostly the sync). So once the WAL is over walLimit, the writers
     * that can wait (the sync engine, background value flushes) hold
     * back (walReady) until a checkpoint run after they stopped has
     * copied every frame; the next write then rewinds the WAL.
     */
    walBehind(): boolean {
        if (!this.walOverLimit()) {
            this.pinnedAt = -1;
            return false;
        }
        if (this.pinnedAt >= 0) {
            /* A reader holds the checkpoint back; holding writers back
             * would not help. Resume once the checkpoint moves again.
             * But a slow client that keeps reading can hold its
             * snapshot for many minutes, so past the hard cap hold the
             * writers that can wait back anyway, to bound the WAL. */
            const sh = this.walShared!;
            if (Atomics.load(sh, 1) * this.pageSize >= WAL_HARD_FACTOR * this.walLimit)
                return true;
            if (Atomics.load(sh, 2) <= this.pinnedAt && Atomics.load(sh, 1) !== Atomics.load(sh, 2))
                return false;
            this.pinnedAt = -1;
        }
        return true;
    }

    /**
     * Resolves when writers need not hold back (see walBehind), or after
     * `maxWait` ms whatever: a stuck checkpoint must not stop the sync.
     */
    async walReady(maxWait: number = 5000): Promise<void> {
        if (!this.walShared || !this.walBehind()) return;
        /* A checkpoint's counts are from when it started, and writes go
         * on while it runs. Wait for one that started after we stopped
         * writing and caught up with every frame. */
        this.commit();
        const sh = this.walShared;
        const start = Atomics.load(sh, 0);
        const until = performance.now() + maxWait;
        while (performance.now() < until) {
            await new Promise(r => setTimeout(r, 10));
            if (!this.walBehind()) return;
            if (Atomics.load(sh, 0) >= start + 2) {
                if (Atomics.load(sh, 1) === Atomics.load(sh, 2)) return;
                /* A checkpoint that started after we stopped writing
                 * still could not copy every frame: a reader (a long
                 * stream) holds it back. Stop waiting; walBehind stays
                 * false until the checkpoint moves on. */
                this.pinnedAt = Atomics.load(sh, 2);
                return;
            }
        }
    }

    private totalChanges(): number {
        return (this.prepare("select total_changes() n").get() as any).n;
    }

    private batchChanges(): number {
        return this.totalChanges() - this.batchStartChanges;
    }

    private openBatch(): void {
        if (this.batchOpen) return;
        this.db.exec("begin");
        this.batchOpen = true;
        this.batchStartChanges = this.totalChanges();
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
            this.commitFailures++;
            const now = Date.now();
            if (now - this.lastCommitFailureLog >= 60_000) {
                console.error("I3xStore: commit failed, batch discarded (%d failures since the last report):",
                    this.commitFailures, err);
                this.lastCommitFailureLog = now;
                this.commitFailures = 0;
            }
            try { this.db.exec("rollback"); } catch { /* already closed */ }
            for (const l of this.commitFailureListeners) {
                try {
                    l(err);
                } catch (e) {
                    console.error("I3xStore: commit failure listener threw:", e);
                }
            }
            return;
        }
        this.afterCommit();
    }

    /** Work after a successful commit. A failure here is not a failed
     * commit: the batch is safe, so log it and go on. */
    private afterCommit(): void {
        try {
            this.hardCheckpoint();
        } catch (err) {
            console.error("I3xStore: checkpoint after commit failed:", err);
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
        if (this.checkpointer) {
            this.checkpointer.terminate();
            this.checkpointer = null;
            /* Leave the file whole, as closing the last connection
             * would: the worker's connection may not have closed yet. */
            try {
                this.db.exec("pragma busy_timeout = 2000");
                this.db.prepare("pragma wal_checkpoint(TRUNCATE)").get();
            } catch (err) {
                console.error("I3xStore: final checkpoint failed:", err);
            }
        }
        this.statements.clear();
        this.db.close();
    }
}

/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * ConfigSync — keeps the SQLite object tree in step with ConfigDB.
 *
 * It replaces the per-object WATCH pipeline. It opens a fixed number
 * of ConfigDB subscriptions, however many devices there are:
 *
 *  - one WATCH of the Device class members;
 *  - one ETag SEARCH (v2/app/:app/etag/) each for DeviceInformation,
 *    Info and Schema.
 *
 * The database records, per device and per referenced schema, the
 * ETags of the configs it last applied. Whenever a SEARCH sends a full
 * snapshot (at start and after every reconnect) the stored ETags are
 * compared with it, and only the configs that differ are fetched. With
 * a warm database and no changes, a restart fetches nothing. After
 * that, each child update re-fetches the one config it names.
 *
 * Fetches go through an uncached ServiceClient, at most `concurrency`
 * at a time, at most one per device or schema. Applying a result is
 * synchronous (SQLite), so writes never interleave: each completes
 * before the next fetch result is handled.
 */

import * as rx from "rxjs";

import {
    DEVICE_CLASS_UUID,
    DEVICE_INFORMATION_APP_UUID,
    INFO_APP_UUID,
    SCHEMA_APP_UUID,
} from "./constants.js";
import type { ObjectTree } from "./object-tree.js";
import type { I3xStore } from "./store.js";
import { Slicer } from "./slicer.js";

/** The parts of an immutable.js Set we use. */
export interface MemberSet {
    has(uuid: string): boolean;
    [Symbol.iterator](): Iterator<string>;
}

/** The parts of an immutable.js Map we use. */
export interface EtagMap {
    get(uuid: string): string | undefined;
}

/** One value from ConfigDB.search_app_etags: the current ETags, and
 * the child this update changed (null for a full snapshot). */
export interface EtagChange {
    map: EtagMap;
    child: string | null;
}

/** Fetches one config entry and its ETag; `[]` if there is none. */
export interface ConfigFetcher {
    get_config_with_etag(app: string, obj: string): Promise<[any?, string?]>;
}

export interface ConfigSyncOpts {
    objectTree: ObjectTree;
    store: I3xStore;
    /** The members of the Device class. */
    members: rx.Observable<MemberSet>;
    /** The ETag SEARCH of one Application. */
    etags: (app: string) => rx.Observable<EtagChange>;
    fetcher: ConfigFetcher;
    /** Told when a device leaves the tree, to drop its values. */
    valueCache?: { removeDevice(uuid: string): void; removeElements?(ids: string[]): void };
    /** Fetches in flight at once. */
    concurrency?: number;
    /** Wait before retrying a failed fetch or a failed feed, ms. */
    retryDelay?: number;
    /** Once a cold sync has otherwise finished, how long configs may
     * keep failing before the tree is served without them, ms. */
    readyGrace?: number;
    log?: (msg: string, ...args: any[]) => void;
}

/** Build the feeds from an RxClient. */
export function configSyncFeeds(fplus: any) {
    const cdb = fplus.ConfigDB;
    return {
        members: cdb.watch_members(DEVICE_CLASS_UUID) as rx.Observable<MemberSet>,
        etags: (app: string) => cdb.search_app_etags(app) as rx.Observable<EtagChange>,
        /* The default fetch cache keeps every response for ever. */
        fetcher: fplus.uncached().ConfigDB as ConfigFetcher,
    };
}

type Kind = "devinfo" | "info" | "schema";
const APP: Record<Kind, string> = {
    devinfo: DEVICE_INFORMATION_APP_UUID,
    info:    INFO_APP_UUID,
    schema:  SCHEMA_APP_UUID,
};

interface DeviceRow {
    uuid: string;
    etag_devinfo: string | null;
    etag_info: string | null;
    sparkplug_name: string | null;
    info_name: any;
}

interface SchemaRow {
    uuid: string;
    etag_schema: string | null;
    etag_info: string | null;
    info_name: any;
}

/**
 * Runs `work(key)` for queued keys, at most `limit` at once and at most
 * one at a time per key. A key queued while it runs runs again after.
 */
class KeyedQueue {
    private pending: string[] = [];
    private head = 0;
    private queued = new Set<string>();
    private running = new Set<string>();
    private again = new Set<string>();

    constructor(
        private limit: number,
        private work: (key: string) => Promise<void>,
        private idle: () => void,
    ) {}

    get size(): number { return this.queued.size + this.running.size; }

    add(key: string): void {
        if (this.running.has(key)) {
            this.again.add(key);
            return;
        }
        if (this.queued.has(key)) return;
        this.queued.add(key);
        this.pending.push(key);
        this.pump();
    }

    private pump(): void {
        while (this.running.size < this.limit && this.head < this.pending.length) {
            const key = this.pending[this.head++];
            this.queued.delete(key);
            this.running.add(key);
            this.work(key)
                .catch(err => console.error("ConfigSync: %s failed:", key, err))
                .finally(() => {
                    this.running.delete(key);
                    if (this.again.delete(key)) this.add(key);
                    this.pump();
                });
        }
        if (this.head > 1024 && this.head * 2 > this.pending.length) {
            this.pending = this.pending.slice(this.head);
            this.head = 0;
        }
        if (this.size === 0) this.idle();
    }
}

export class ConfigSync {
    private tree: ObjectTree;
    private store: I3xStore;
    private opts: ConfigSyncOpts;
    private log: (msg: string, ...args: any[]) => void;
    private retryDelay: number;

    private members: MemberSet | null = null;
    private etags: Record<Kind, EtagMap | null> = { devinfo: null, info: null, schema: null };
    /** True once a full reconcile has run since the feeds started. */
    private reconciled = false;
    private reconcileTimer: ReturnType<typeof setTimeout> | null = null;
    private lostTimer: ReturnType<typeof setTimeout> | null = null;
    private reconciling = false;
    private reconcileAgain = false;
    private offCommitFailure: () => void;
    private retries = new Map<string, ReturnType<typeof setTimeout>>();
    /** Keys whose last fetch failed and has not succeeded since. */
    private failed = new Set<string>();
    /** When fetches started failing (Date.now), or 0. */
    private failingSince = 0;
    private graceTimer: ReturnType<typeof setTimeout> | null = null;
    private lastFailLog = 0;
    private subs: rx.Subscription[] = [];
    private queue: KeyedQueue;
    private stopped = false;

    /* Progress of the current batch of fetches, for the log. */
    private applied = 0;
    private batchStart = 0;

    /** Counters, for tests and the scale harness. */
    readonly stats = { fetches: 0, devicesApplied: 0, schemasApplied: 0, errors: 0 };

    constructor(opts: ConfigSyncOpts) {
        this.opts = opts;
        this.tree = opts.objectTree;
        this.store = opts.store;
        this.log = opts.log ?? (() => {});
        this.retryDelay = opts.retryDelay ?? 10_000;
        const limit = opts.concurrency ?? 16;
        /* A failed group commit rolls back changes we have applied and
         * recorded as applied. Compare everything again, after a pause
         * in case the disk is still full. */
        this.offCommitFailure = this.store.onCommitFailure(() => {
            this.stats.errors++;
            if (this.stopped || this.lostTimer) return;
            console.error("ConfigSync: a commit failed; checking ConfigDB again in %d ms",
                this.retryDelay);
            this.lostTimer = setTimeout(() => {
                this.lostTimer = null;
                this.scheduleReconcile();
            }, this.retryDelay);
            this.lostTimer.unref?.();
        });
        this.queue = new KeyedQueue(Number.isInteger(limit) && limit >= 1 ? limit : 16,
            key => this.work(key), () => this.onIdle());
    }

    /** Subscribe to ConfigDB. With a database from an earlier sync the
     * tree is served at once, and brought up to date as the feeds
     * arrive. */
    run(): this {
        if (this.store.getMeta("synced") === "1" && !this.tree.isReady()) {
            this.log("serving the stored tree while it is checked against ConfigDB");
            this.tree.setReady();
        }

        const retry = <T>(name: string) => rx.retry<T>({
            delay: (err: unknown) => {
                console.error(`ConfigSync: ${name} failed, retrying:`, err);
                return rx.timer(this.retryDelay);
            },
        });

        /* An exception in a subscriber is not an error on the feed:
         * RxJS rethrows it later, outside any handler, and Node exits.
         * Log it and count it instead; the next snapshot or update
         * compares again. */
        const guard = <T>(name: string, fn: (v: T) => void) => (v: T) => {
            try {
                fn(v);
            } catch (err) {
                this.stats.errors++;
                console.error(`ConfigSync: handling a ${name} update failed:`, err);
                /* Part of the change may not have been applied. */
                if (this.reconciled) this.scheduleReconcile();
            }
        };
        this.subs.push(this.opts.members.pipe(retry("Device class watch"))
            .subscribe(guard("Device class", m => this.onMembers(m))));
        for (const kind of Object.keys(APP) as Kind[]) {
            this.subs.push(this.opts.etags(APP[kind]).pipe(retry(`${kind} ETag search`))
                .subscribe(guard(`${kind} ETag`, c => this.onEtags(kind, c))));
        }
        return this;
    }

    stop(): void {
        this.stopped = true;
        this.subs.forEach(s => s.unsubscribe());
        this.subs = [];
        if (this.reconcileTimer) clearTimeout(this.reconcileTimer);
        if (this.lostTimer) clearTimeout(this.lostTimer);
        if (this.graceTimer) clearTimeout(this.graceTimer);
        this.offCommitFailure();
        for (const t of this.retries.values()) clearTimeout(t);
        this.retries.clear();
    }

    /** Fetches queued or running. */
    get pending(): number {
        return this.queue.size;
    }

    private haveAll(): boolean {
        return this.members !== null && this.etags.devinfo !== null
            && this.etags.info !== null && this.etags.schema !== null;
    }

    private onMembers(next: MemberSet): void {
        const prev = this.members;
        this.members = next;
        if (!this.haveAll()) return;
        /* A reconcile in progress may have passed this change by. */
        if (this.reconciling) this.reconcileAgain = true;
        if (!this.reconciled || prev === null) return this.scheduleReconcile();

        /* The watch sends the whole set each time; act on the change. */
        for (const uuid of prev) {
            if (!next.has(uuid)) this.removeDevice(uuid);
        }
        for (const uuid of next) {
            if (!prev.has(uuid)) this.checkDevice(uuid);
        }
        /* Removing a device may have ended the last wait on a retry. */
        if (this.queue.size === 0) this.onIdle();
    }

    private onEtags(kind: Kind, change: EtagChange): void {
        this.etags[kind] = change.map;
        if (!this.haveAll()) return;
        if (this.reconciling) this.reconcileAgain = true;
        if (change.child === null || !this.reconciled) return this.scheduleReconcile();

        const uuid = change.child;
        if (kind !== "schema" && this.members!.has(uuid)) this.checkDevice(uuid);
        if (kind !== "devinfo" && this.tree.isSchemaReferenced(uuid)) this.checkSchema(uuid);
    }

    /* Snapshots arrive together at start and after a reconnect, one per
     * feed. Compare once they have all landed. */
    private scheduleReconcile(): void {
        if (this.reconcileTimer || this.stopped) return;
        this.reconcileTimer = setTimeout(() => {
            this.reconcileTimer = null;
            if (this.reconciling) {
                /* One at a time; run again when this one ends. */
                this.reconcileAgain = true;
                return;
            }
            this.reconciling = true;
            this.reconcile()
                .catch(err => {
                    console.error("ConfigSync: reconcile failed:", err);
                    this.stats.errors++;
                })
                .finally(() => {
                    this.reconciling = false;
                    if (this.reconcileAgain) {
                        this.reconcileAgain = false;
                        this.scheduleReconcile();
                    }
                });
        }, 20);
    }

    /**
     * Compare everything stored with the current ETags. At 74k devices
     * that is hundreds of thousands of rows, so it reads them a page at
     * a time and pauses for the event loop between steps.
     */
    private async reconcile(): Promise<void> {
        if (!this.haveAll() || this.stopped) return;
        /* The Device class can change while this pauses: always read
         * the current set, this.members, never a copy from the start. */
        const t0 = Date.now();
        const slicer = new Slicer();
        const PAGE = 2000;

        const stored = new Map<string, DeviceRow>();
        for (let after = "";;) {
            const rows = this.store.prepare("select * from sync_device where uuid > ? order by uuid limit ?")
                .all(after, PAGE) as unknown as DeviceRow[];
            for (const r of rows) stored.set(r.uuid, r);
            await slicer.maybe();
            if (rows.length < PAGE) break;
            after = rows[rows.length - 1].uuid;
        }
        const gone = new Set<string>();
        for (const uuid of stored.keys()) {
            if (!this.members!.has(uuid)) gone.add(uuid);
            await slicer.maybe();
        }
        for (let after = "";;) {
            const uuids = this.tree.deviceUuidPage(after, PAGE);
            for (const uuid of uuids) if (!this.members!.has(uuid)) gone.add(uuid);
            await slicer.maybe();
            if (uuids.length < PAGE) break;
            after = uuids[uuids.length - 1];
        }
        for (const uuid of gone) {
            if (this.stopped) return;
            if (this.members!.has(uuid)) continue;    // joined meanwhile
            this.removeDevice(uuid);
            await slicer.maybe();
        }

        /* UNS nodes left hanging (from before a device left the tree,
         * or from an earlier run) and empty ISA-95 levels. */
        let orphans = 0;
        for (const ids of this.tree.dropOrphanSteps()) {
            if (ids.length) {
                this.opts.valueCache?.removeElements?.(ids);
                orphans += ids.length;
            }
            await slicer.maybe();
        }
        if (orphans) this.log("dropped %d orphan objects", orphans);

        let queued = 0;
        this.startBatch();
        for (const uuid of this.members!) {
            if (this.stopped) return;
            if (this.deviceNeeds(uuid, stored.get(uuid))) {
                this.queue.add(`d:${uuid}`);
                queued++;
            }
            await slicer.maybe();
        }

        const referenced = new Set(this.tree.getReferencedSchemaUuids());
        const storedSchemas = this.store.prepare("select * from sync_schema").all() as unknown as SchemaRow[];
        for (const r of storedSchemas) {
            if (!referenced.has(r.uuid)) this.dropSchema(r.uuid);
        }
        const bySchema = new Map(storedSchemas.map(r => [r.uuid, r]));
        for (const uuid of referenced) {
            if (this.schemaNeeds(uuid, bySchema.get(uuid))) {
                this.queue.add(`s:${uuid}`);
                queued++;
            }
        }

        this.log("reconciled with ConfigDB in %d ms: %d removed, %d to fetch",
            Date.now() - t0, gone.size, queued);
        this.reconciled = true;
        if (this.queue.size === 0) this.onIdle();
    }

    private startBatch(): void {
        if (this.queue.size === 0) {
            this.applied = 0;
            this.batchStart = Date.now();
        }
    }

    private deviceRow(uuid: string): DeviceRow | undefined {
        return this.store.prepare("select * from sync_device where uuid = ?").get(uuid) as unknown as DeviceRow | undefined;
    }

    private schemaRow(uuid: string): SchemaRow | undefined {
        return this.store.prepare("select * from sync_schema where uuid = ?").get(uuid) as unknown as SchemaRow | undefined;
    }

    private want(kind: Kind, uuid: string): string | null {
        return this.etags[kind]?.get(uuid) ?? null;
    }

    private deviceNeeds(uuid: string, row: DeviceRow | undefined): boolean {
        return !row
            || row.etag_devinfo !== this.want("devinfo", uuid)
            || row.etag_info !== this.want("info", uuid);
    }

    private schemaNeeds(uuid: string, row: SchemaRow | undefined): boolean {
        return !row
            || row.etag_schema !== this.want("schema", uuid)
            || row.etag_info !== this.want("info", uuid);
    }

    private checkDevice(uuid: string): void {
        if (this.deviceNeeds(uuid, this.deviceRow(uuid))) {
            this.startBatch();
            this.queue.add(`d:${uuid}`);
        }
    }

    private checkSchema(uuid: string): void {
        if (this.schemaNeeds(uuid, this.schemaRow(uuid))) {
            this.startBatch();
            this.queue.add(`s:${uuid}`);
        }
    }

    private async fetch(kind: Kind, uuid: string): Promise<{ config: any; etag: string | null }> {
        this.stats.fetches++;
        const [config, etag] = await this.opts.fetcher.get_config_with_etag(APP[kind], uuid);
        return { config: config ?? null, etag: etag ?? null };
    }

    private async work(key: string): Promise<void> {
        if (this.stopped) return;
        const uuid = key.slice(2);
        try {
            if (key.startsWith("d:")) await this.syncDevice(uuid);
            else await this.syncSchema(uuid);
            this.failed.delete(key);
        } catch (err) {
            this.stats.errors++;
            this.failed.add(key);
            if (!this.failingSince) this.failingSince = Date.now();
            console.error(`ConfigSync: fetching ${key} failed, retrying:`, err);
            if (!this.retries.has(key) && !this.stopped) {
                const t = setTimeout(() => {
                    this.retries.delete(key);
                    /* Forget the failure; checking queues the key again
                     * if it still needs fetching, and a new failure
                     * records it again. */
                    this.failed.delete(key);
                    try {
                        if (key.startsWith("d:")) {
                            if (this.members?.has(uuid)) this.checkDevice(uuid);
                        } else if (this.tree.isSchemaReferenced(uuid)) {
                            this.checkSchema(uuid);
                        }
                    } catch (err) {
                        this.stats.errors++;
                        console.error(`ConfigSync: retrying ${key} failed:`, err);
                        this.failed.add(key);
                    }
                    if (this.queue.size === 0) this.onIdle();
                }, this.retryDelay);
                t.unref?.();
                this.retries.set(key, t);
            }
        }
    }

    /** Stop retrying a key that no longer needs fetching. */
    private forget(key: string): void {
        const t = this.retries.get(key);
        if (t) clearTimeout(t);
        this.retries.delete(key);
        this.failed.delete(key);
    }

    /** Fetch whichever of a device's configs changed, and apply them. */
    private async syncDevice(uuid: string): Promise<void> {
        if (!this.members?.has(uuid)) return;
        const row = this.deviceRow(uuid);
        const needDI = !row || row.etag_devinfo !== this.want("devinfo", uuid);
        const needInfo = !row || row.etag_info !== this.want("info", uuid);
        if (!needDI && !needInfo) return;

        const [di, info] = await Promise.all([
            needDI ? this.fetch("devinfo", uuid) : null,
            needInfo ? this.fetch("info", uuid) : null,
        ]);
        /* Let the WAL checkpoint catch up before writing more. */
        await this.store.walReady();
        /* Removed from the Device class while we waited. */
        if (this.stopped || !this.members?.has(uuid)) return;

        const cur = this.deviceRow(uuid);
        const oldSchemas = this.tree.getDeviceSchemaUuids(uuid);
        const infoName = info ? info.config?.name ?? null : cur?.info_name ?? null;
        const sparkplugName = di ? di.config?.sparkplugName ?? null : cur?.sparkplug_name ?? null;

        this.store.transaction(() => {
            if (di) {
                this.tree.replaceDeviceSubtree(uuid, di.config,
                    infoName === null ? null : { name: infoName });
            } else {
                this.tree.updateDeviceName(uuid, infoName ?? sparkplugName ?? uuid);
            }
            this.store.prepare(`
                insert into sync_device (uuid, etag_devinfo, etag_info, sparkplug_name, info_name)
                values (?, ?, ?, ?, ?)
                on conflict (uuid) do update set
                    etag_devinfo = excluded.etag_devinfo,
                    etag_info = excluded.etag_info,
                    sparkplug_name = excluded.sparkplug_name,
                    info_name = excluded.info_name
            `).run(uuid,
                di ? di.etag : cur?.etag_devinfo ?? null,
                info ? info.etag : cur?.etag_info ?? null,
                sparkplugName, infoName);
        });

        if (di) this.schemasChanged(oldSchemas, this.tree.getDeviceSchemaUuids(uuid));
        this.stats.devicesApplied++;
        this.progress();
    }

    /** Fetch whichever of a schema's configs changed, and apply them. */
    private async syncSchema(uuid: string): Promise<void> {
        if (!this.tree.isSchemaReferenced(uuid)) return;
        const row = this.schemaRow(uuid);
        const needSchema = !row || row.etag_schema !== this.want("schema", uuid);
        const needInfo = !row || row.etag_info !== this.want("info", uuid);
        if (!needSchema && !needInfo) return;

        const [schema, info] = await Promise.all([
            needSchema ? this.fetch("schema", uuid) : null,
            needInfo ? this.fetch("info", uuid) : null,
        ]);
        await this.store.walReady();
        if (this.stopped || !this.tree.isSchemaReferenced(uuid)) return;

        const cur = this.schemaRow(uuid);
        const infoName = info ? info.config?.name ?? null : cur?.info_name ?? null;
        /* The stored type holds the schema body, or {} if there was
         * none, which names the type the same way. */
        const body = schema ? schema.config : this.tree.getObjectType(uuid)?.schema ?? null;

        this.store.transaction(() => {
            this.tree.addObjectType(uuid, body, infoName === null ? null : { name: infoName });
            this.store.prepare(`
                insert into sync_schema (uuid, etag_schema, etag_info, info_name)
                values (?, ?, ?, ?)
                on conflict (uuid) do update set
                    etag_schema = excluded.etag_schema,
                    etag_info = excluded.etag_info,
                    info_name = excluded.info_name
            `).run(uuid,
                schema ? schema.etag : cur?.etag_schema ?? null,
                info ? info.etag : cur?.etag_info ?? null,
                infoName);
        });
        this.stats.schemasApplied++;
    }

    /** Fetch newly referenced schemas; drop ones nothing references. */
    private schemasChanged(before: string[], after: string[]): void {
        const now = new Set(after);
        for (const s of after) this.checkSchema(s);
        for (const s of before) {
            if (!now.has(s) && !this.tree.isSchemaReferenced(s)) this.dropSchema(s);
        }
    }

    private dropSchema(uuid: string): void {
        this.forget(`s:${uuid}`);
        this.store.transaction(() => {
            this.tree.removeObjectType(uuid);
            this.store.prepare("delete from sync_schema where uuid = ?").run(uuid);
        });
    }

    private removeDevice(uuid: string): void {
        this.forget(`d:${uuid}`);
        const schemas = this.tree.getDeviceSchemaUuids(uuid);
        this.store.transaction(() => {
            this.tree.removeDevice(uuid);
            this.store.prepare("delete from sync_device where uuid = ?").run(uuid);
            this.opts.valueCache?.removeDevice(uuid);
        });
        this.schemasChanged(schemas, []);
    }

    private progress(): void {
        this.applied++;
        if (this.applied % 1000 === 0) {
            const s = (Date.now() - this.batchStart) / 1000;
            this.log("synced %d devices in %d s (%d/s), %d fetches pending",
                this.applied, s.toFixed(1), Math.round(this.applied / Math.max(s, 0.001)), this.queue.size);
        }
    }

    private onIdle(): void {
        if (!this.reconciled || this.stopped) return;
        /* A failed fetch waits on a retry timer, outside the queue. The
         * tree is not complete until it has succeeded, so do not mark it
         * ready, or record a completed sync, until then. */
        if (this.retries.size > 0 || this.failed.size > 0) return this.stillFailing();
        this.failingSince = 0;
        if (this.applied >= 1000) {
            this.log("sync complete: %d devices in %d s", this.applied,
                ((Date.now() - this.batchStart) / 1000).toFixed(1));
        }
        if (this.store.getMeta("synced") !== "1") this.store.setMeta("synced", "1");
        if (!this.tree.isReady()) {
            this.log("initial sync complete: %d objects", this.tree.objectCount());
            this.tree.setReady();
        }
    }

    /**
     * The queue is idle but some configs keep failing. Do not hold the
     * API at 503 for ever over them: after readyGrace, serve the tree
     * without them, say so loudly, and keep retrying. The sync is not
     * recorded as complete until a pass ends with no failures.
     */
    private stillFailing(): void {
        const grace = this.opts.readyGrace ?? 120_000;
        if (!this.failingSince) this.failingSince = Date.now();
        const wait = this.failingSince + grace - Date.now();
        if (wait > 0) {
            if (!this.graceTimer && !this.tree.isReady()) {
                this.graceTimer = setTimeout(() => {
                    this.graceTimer = null;
                    if (this.queue.size === 0) this.onIdle();
                }, wait);
                this.graceTimer.unref?.();
            }
            return;
        }
        const now = Date.now();
        if (now - this.lastFailLog >= grace) {
            this.lastFailLog = now;
            const keys = [...new Set([...this.failed, ...this.retries.keys()])];
            console.error("ConfigSync: %d configs have failed to fetch for %d s; serving the tree without them and still retrying: %s",
                keys.length, Math.round((now - this.failingSince) / 1000),
                keys.slice(0, 20).join(", ") + (keys.length > 20 ? ", ..." : ""));
        }
        if (!this.tree.isReady()) {
            this.log("initial sync complete except for failing configs: %d objects", this.tree.objectCount());
            this.tree.setReady();
        }
    }
}

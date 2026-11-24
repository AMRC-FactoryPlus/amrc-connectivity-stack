/*
 * ACS Edge Agent
 * Edge Scout: runs scans of a connection's addresses on its driver
 * and keeps their results in the Files service and ConfigDB
 * Copyright 2026 University of Sheffield
 *
 * The design is docs/architecture/edge-management/edge-scout.md and
 * the protocol with the driver is "Scouting" in docs/edge-split.md.
 * The Admin UI sends Node Control/Scout through cmdesc. This checks
 * the request, runs at most SCOUT_MAX_CONCURRENT scans at a time, one
 * per connection, streams the items through gzip into memory, uploads
 * the snapshot to a File object, and keeps a status entry per
 * connection in ConfigDB that the Admin UI watches.
 *
 * Data comes first. Messages from a driver wait in the scan's inbox,
 * and are handled in short slices only while the agent's CPU use is
 * inside the budget in scout-budget.ts. The agent asks the driver to
 * keep at most WINDOW items messages ahead of the agent's acks, so a
 * driver slows down to the agent's pace and the inbox stays small.
 */

import crypto from "crypto";
import { performance } from "perf_hooks";
import util from "util";

import type { DriverBroker } from "./driverBroker.js";
import type { DriverConnection } from "./devices/driver.js";
import { cgroup_cpu, CpuBudget, throttle_reader } from "./scout-budget.js";
import { scout_schemas, ScoutSchemas } from "./scout-schemas.js";
import {
    index_snapshot, MAX_BRANCHES, MAX_EXCLUDED, merge_flags, merged_items,
    read_lines, sha256_hash, SnapshotIndex, SnapshotWriter,
} from "./scout-snapshot.js";
import * as UUIDs from "./uuids.js";

/* The limits a scan gets when the request leaves them out, and the
 * most a request may ask for. */
export const DEFAULT_LIMITS = {
    items: 20_000, depth: 8, seconds: 120, pace_ms: 20, samples: false,
};
export const LIMIT_CEILINGS = { items: 50_000, depth: 32, seconds: 600 };

/* Scans waiting for a free slot, across the agent. */
export const QUEUE_MAX = 4;

/* The items messages a driver may send ahead of the agent's acks. */
export const WINDOW = 4;
/* The most bytes from a driver that may wait to be handled. A driver
 * that keeps to WINDOW never comes near it. Past it the agent stops
 * the scan at its size cap, keeping what it has handled. */
export const MAX_BACKLOG = 4 * 1024 * 1024;
/* Messages up to this size are read when they arrive, so the agent
 * sees a driver's end however far behind it is. Items wait their
 * turn. */
const PEEK_BYTES = 4096;

const MAX_OPTIONS = 8 * 1024;
const MAX_ITEMS_MESSAGE = 256 * 1024;
const MAX_DETAIL = 2 * 1024;
/* The largest status entry the agent writes, serialised. */
export const MAX_ENTRY = 16 * 1024;
const MAX_MESSAGE = 512;

/* The longest each string of an item may be. Longer strings are
 * truncated before the item is checked. */
const ITEM_STRINGS: Record<string, number> = {
    name: 256, address: 1024, path: 1024, description: 1024,
    unit: 64, sample: 256, root: 1024,
};
const ITEM_STRING_LIST = Object.entries(ITEM_STRINGS);
const ITEM_KEYS = [
    "id", "parent", "name", "kind", "address", "path", "type", "access",
    "unit", "description", "sample", "more", "root", "detail",
];

/* The share of its CPU limit the agent may use before scan work
 * waits, unless SCOUT_CPU_SHARE says otherwise. */
export const CPU_SHARE = 0.6;

export interface ScoutTiming {
    /* No message from the driver for this long ends a scan. */
    silence_ms:         number,
    /* Added to limits.seconds for the scan's deadline. */
    deadline_extra_ms:  number,
    /* A driver UP this long without subscribing to scout predates
     * scouting. */
    library_ms:         number,
    /* The least time between two progress writes. */
    throttle_ms:        number,
    /* The longest stop() waits for status writes. */
    stop_ms:            number,
    /* The first wait before a failed status write is tried again. It
     * doubles on each failure, up to retry_max_ms. */
    retry_ms:           number,
    retry_max_ms:       number,
    /* How long a connection stays busy after the agent ended a scan
     * the driver may still be stopping. This is more than the
     * libraries' stop grace (3 s at most) plus a request in flight. */
    drain_ms:           number,
}

export const DEFAULT_TIMING: ScoutTiming = {
    silence_ms:         30_000,
    deadline_extra_ms:  15_000,
    library_ms:         10_000,
    throttle_ms:        2_000,
    stop_ms:            5_000,
    retry_ms:           1_000,
    retry_max_ms:       60_000,
    drain_ms:           5_000,
};

export interface ScoutOpts {
    fplus:      any,
    broker:     DriverBroker,
    /* This agent's UUID, which goes in every status entry. */
    node:       string,
    env?:       Record<string, string | undefined>,
    timing?:    Partial<ScoutTiming>,
    schemas?:   ScoutSchemas,
    /* Tests only: the CPU budget for scan work. */
    budget?:    CpuBudget,
}

/* A message from the driver that hasn't been handled yet. Short ones
 * are parsed when they arrive. */
interface Inbound {
    payload:    Buffer,
    read:       boolean,
    msg:        any,
}

type ScanState = "queued" | "running" | "saving";

interface Scan {
    uuid:       string,
    /* The UUID without dashes, used on the driver topics. */
    id:         string,
    request:    string,
    sc:         ScoutConn,
    state:      ScanState,
    root:       string | null,
    folder_id:  string | null,
    options:    object,
    options_hash: string,
    limits:     typeof DEFAULT_LIMITS,
    started:    string,
    next_seq:   number,
    ids:        Set<string>,
    items:      number,
    rejected:   number,
    visited:    number,
    note:       string | null,
    writer:     SnapshotWriter | null,
    base:       SnapshotIndex | null,
    /* The write of the queued entry, which must be stored before the
     * File object is made. */
    queued_write: Promise<void>,
    /* Whether the File object exists. */
    created:    boolean,
    /* Whether the start, and a cancel, have gone to the driver, and
     * whether the driver's end has arrived. */
    sent_start: boolean,
    sent_cancel: boolean,
    driver_ended: boolean,
    /* A cap the agent enforced itself, so the scan ends truncated. */
    capped:     "items" | "size" | null,
    /* The operator asked to stop it before it started. */
    cancelled:  boolean,
    over:       boolean,
    silence?:   NodeJS.Timeout,
    deadline?:  NodeJS.Timeout,
    /* Saving and other async work, one step after another. */
    work:       Promise<void>,
    /* Messages from the driver waiting for the scheduler, their size,
     * and the items message being handled. */
    inbox:      Inbound[],
    inbox_bytes: number,
    cur:        { items: any[], i: number, seq: number } | null,
    /* The window the driver keeps to, from its accept, or null for a
     * driver that sends as fast as it likes. */
    window:     number | null,
}

interface ScoutConn {
    uuid:       string,
    conn:       DriverConnection,
    config_hash: string | null,
    /* The status entry as this agent last knew it, or null for none. */
    entry:      any,
    /* The entry last written or read, without `updated`. */
    written:    string | null,
    loaded:     boolean,
    load:       Promise<void>,
    library:    string | null,
    scan:       Scan | null,
    chain:      Promise<void>,
    write_timer?: NodeJS.Timeout,
    library_timer?: NodeJS.Timeout,
    /* A failed write is tried again from this timer. */
    retry_timer?: NodeJS.Timeout,
    retry_wait: number,
    /* Snapshots to delete once a stored entry no longer names them,
     * and the snapshots the stored entry names. */
    unwanted:   Set<string>,
    stored_files: Set<string>,
    /* The driver id of a scan the agent ended while the driver may
     * still be stopping it. New scans are refused until it ends. */
    draining:   string | null,
    drain_timer?: NodeJS.Timeout,
    off:        () => void,
}

const now = () => new Date().toISOString();

/* A message's JSON, or undefined if it is not JSON. */
function parse (payload: Buffer): any {
    try {
        return JSON.parse(payload.toString());
    }
    catch (e) {
        return undefined;
    }
}

function cut (s: unknown, n: number): string | null {
    if (s == null) return null;
    const str = String(s);
    return str.length > n ? str.slice(0, n) : str;
}

function env_int (env: Record<string, string | undefined>, name: string, dflt: number): number {
    const n = Number.parseInt(env[name] ?? "", 10);
    return n > 0 ? n : dflt;
}

/* An entry's text for comparing, without the time it was written. */
function entry_key (entry: any): string | null {
    if (!entry) return null;
    const { updated, ...rest } = entry;
    return JSON.stringify(rest);
}

/* The snapshots an entry names. */
function snapshot_files (entry: any): Set<string> {
    return new Set([entry?.current?.file, entry?.previous?.file]
        .filter((f): f is string => typeof f == "string"));
}

/* An excluded scope as the status entry holds it, with no other keys. */
function clean_scope (e: any) {
    return {
        id:     e.id,
        reason: e.reason,
        ...(Array.isArray(e.prefixes) ? { prefixes: e.prefixes } : {}),
    };
}

/* Thrown inside a scan to end it with a code. */
class ScanError extends Error {
    constructor (public code: string, message: string) {
        super(message);
    }
}

export class ScoutManager {
    fplus:      any
    broker:     DriverBroker
    node:       string
    timing:     ScoutTiming
    schemas:    ScoutSchemas
    max_concurrent: number
    max_bytes:  number
    max_gz_bytes: number
    budget:     CpuBudget

    /* Registered connections, by connection UUID and by driver id. */
    #conns:     Map<string, ScoutConn> = new Map()
    #by_id:     Map<string, ScoutConn> = new Map()
    #active:    Set<Scan> = new Set()
    #queue:     Scan[] = []
    #stopping   = false
    #on_scout   = this.#scout_sub.bind(this)
    /* Whether the scheduler is running, and whose turn is next. */
    #pumping    = false
    #turn       = 0

    constructor (opts: ScoutOpts) {
        this.fplus = opts.fplus;
        this.broker = opts.broker;
        this.node = opts.node;
        this.timing = { ...DEFAULT_TIMING, ...opts.timing };
        this.schemas = opts.schemas ?? scout_schemas();

        const env = opts.env ?? process.env;
        this.max_concurrent = env_int(env, "SCOUT_MAX_CONCURRENT", 1);
        this.max_bytes = env_int(env, "SCOUT_MAX_BYTES", 32 * 1024 * 1024);
        this.max_gz_bytes = env_int(env, "SCOUT_MAX_GZ_BYTES", 8 * 1024 * 1024);

        if (opts.budget)
            this.budget = opts.budget;
        else {
            const share = Number.parseFloat(env.SCOUT_CPU_SHARE ?? "");
            const { cpus, stat } = cgroup_cpu();
            this.budget = new CpuBudget({
                cpus, share: share > 0 && share <= 1 ? share : CPU_SHARE,
                throttled: throttle_reader(stat),
            });
            this.log("Scan work runs while the agent uses less than %s CPU%s",
                +this.budget.rate.toFixed(3),
                cpus == null ? "" : `, of its limit of ${cpus}, and not just after it was throttled`);
        }

        this.broker.on("scout", this.#on_scout);
    }

    /* State changes and failures go to stderr whatever DEBUG says, so
     * a site can see why a scan failed. */
    log (fmt: string, ...args: any[]) {
        console.error("scout: %s", util.format(fmt, ...args));
    }

    /* Take part in scouting for a connection, which the agent runs
     * under this UUID. Reads its status entry straight away. */
    add_connection (uuid: string, conn: DriverConnection, opts: { config_hash?: string | null } = {}) {
        if (this.#conns.has(uuid)) {
            this.log("Connection %s is in the config twice. Only the first can scan.", uuid);
            return;
        }

        const on_found = (data: string, payload: Buffer) => this.#found(sc, data, payload);
        const on_status = (status: string, old: string) => this.#status(sc, status, old);
        conn.on("found", on_found);
        conn.on("status", on_status);

        const sc: ScoutConn = {
            uuid, conn,
            config_hash: opts.config_hash ?? null,
            entry: null, written: null, loaded: false,
            load: Promise.resolve(),
            library: null, scan: null,
            chain: Promise.resolve(),
            retry_wait: 0, unwanted: new Set(), stored_files: new Set(),
            draining: null,
            off: () => {
                conn.off("found", on_found);
                conn.off("status", on_status);
            },
        };
        this.#conns.set(uuid, sc);
        this.#by_id.set(conn.id, sc);
        sc.load = this.#load(sc);

        if (this.broker.scouts(conn.id))
            this.#send_hello(sc);
    }

    /* Wait until every connection's status entry has been read and any
     * scan left over from before a restart recorded as interrupted. */
    async init () {
        await Promise.all([...this.#conns.values()].map(sc => sc.load));
        return this;
    }

    /* Cancel every scan and finish their status writes, so that an
     * in-process reload starts cleanly. */
    async stop () {
        if (this.#stopping) return;
        this.#stopping = true;
        this.broker.off("scout", this.#on_scout);

        for (const scan of [...this.#queue, ...this.#active])
            this.#interrupt(scan, "The Edge Agent restarted during the scan");

        /* A scan that is saving finishes, then its status write. */
        const settled = Promise.all([...this.#active].map(s => s.work))
            .then(() => Promise.all([...this.#conns.values()].map(sc => sc.chain)));
        let timer: NodeJS.Timeout | undefined;
        await Promise.race([
            settled,
            new Promise(r => timer = setTimeout(r, this.timing.stop_ms)),
        ]);
        clearTimeout(timer);

        for (const sc of this.#conns.values()) {
            sc.off();
            clearTimeout(sc.write_timer);
            clearTimeout(sc.library_timer);
            clearTimeout(sc.retry_timer);
            clearTimeout(sc.drain_timer);
        }
    }

    /* A Node Control/Scout command, already parsed from JSON. */
    request (req: any) {
        this.#request(req).catch(e =>
            this.log("Handling a scan request failed: %s", e?.stack ?? e));
    }

    /* The scans running or waiting, for tests and logging. */
    get active () { return this.#active.size; }
    get queued () { return this.#queue.length; }

    /* ---- Status entries ---- */

    /* Read the connection's entry. A scan it shows as queued or
     * running was running when this agent last stopped, so it is
     * recorded as interrupted and its File object deleted. */
    async #load (sc: ScoutConn) {
        let entry;
        try {
            entry = await this.fplus.ConfigDB.get_config(UUIDs.App.ScoutStatus, sc.uuid);
        }
        catch (e) {
            this.log("Can't read the scan status of connection %s: %s", sc.uuid, e);
            return;
        }
        sc.entry = entry ?? null;
        sc.written = entry_key(sc.entry);
        sc.stored_files = snapshot_files(sc.entry);
        sc.loaded = true;

        const st = sc.entry?.state;
        if (st != "queued" && st != "running") return;

        const lost = sc.entry.scan;
        this.log("Connection %s: scan %s was %s when the Edge Agent stopped", sc.uuid, lost, st);
        Object.assign(sc.entry, {
            state: "failed", code: "INTERRUPTED",
            message: "The Edge Agent restarted during the scan",
            finished: now(),
        });
        await this.#write(sc).catch(() => {});
        if (lost && !this.#referenced(sc, lost))
            await this.#delete_snapshot(lost);
    }

    /* Whether the entry has been read, trying again if it couldn't
     * be. Nothing is written over an entry this agent hasn't read,
     * because it may hold the current snapshot. */
    async #ready (sc: ScoutConn): Promise<boolean> {
        await sc.load;
        if (!sc.loaded) {
            sc.load = this.#load(sc);
            await sc.load;
        }
        return sc.loaded;
    }

    #referenced (sc: ScoutConn, file: string) {
        return sc.entry?.current?.file == file || sc.entry?.previous?.file == file;
    }

    #entry (sc: ScoutConn) {
        return sc.entry ??= { version: 1, node: this.node, supported: null };
    }

    /* Write the connection's entry if it has changed. Writes are made
     * one at a time, in order. The promise rejects if the write
     * failed, and a failed write is tried again later with the entry
     * as it is then, so the stored entry catches up. */
    #write (sc: ScoutConn): Promise<void> {
        clearTimeout(sc.write_timer);
        sc.write_timer = undefined;
        const p = sc.chain.then(() => this.#do_write(sc));
        sc.chain = p.then(
            () => this.#stored(sc),
            e => this.#retry_later(sc, e));
        return p;
    }

    /* An entry was stored, so the snapshots it no longer names can go. */
    #stored (sc: ScoutConn) {
        sc.retry_wait = 0;
        clearTimeout(sc.retry_timer);
        sc.retry_timer = undefined;
        for (const file of [...sc.unwanted]) {
            if (this.#referenced(sc, file) || sc.stored_files.has(file)) continue;
            sc.unwanted.delete(file);
            this.#delete_snapshot(file);
        }
    }

    #retry_later (sc: ScoutConn, e: any) {
        /* An invalid entry won't become valid by trying again, and an
         * entry that couldn't be read is read again on the next
         * request. */
        if (this.#stopping || !sc.loaded || sc.retry_timer) return;
        if (e instanceof ScanError && e.code != "STORE") return;
        sc.retry_wait = Math.min(
            sc.retry_wait ? sc.retry_wait * 2 : this.timing.retry_ms,
            this.timing.retry_max_ms);
        this.log("Connection %s: trying the scan status write again in %d s",
            sc.uuid, sc.retry_wait / 1000);
        sc.retry_timer = setTimeout(() => {
            sc.retry_timer = undefined;
            this.#write(sc).catch(() => {});
        }, sc.retry_wait);
    }

    async #do_write (sc: ScoutConn) {
        /* Never write over an entry this agent couldn't read: it may
         * hold the current snapshot. */
        if (!sc.loaded)
            throw new ScanError("STORE", "Can't read the scan status from ConfigDB");

        const entry = this.#fit(sc, { ...this.#entry(sc), version: 1, node: this.node });
        const key = entry_key(entry);
        if (key == sc.written) return;

        entry.updated = now();
        const bad = this.schemas.check("status", entry);
        if (bad) {
            this.log("Not writing an invalid scan status for %s: %s", sc.uuid, bad);
            throw new ScanError("AGENT", `The scan status is invalid: ${bad}`);
        }

        try {
            await this.fplus.ConfigDB.put_config(UUIDs.App.ScoutStatus, sc.uuid, entry);
        }
        catch (e) {
            this.log("Can't write the scan status of %s: %s", sc.uuid, e);
            throw new ScanError("STORE", `Can't write the scan status to ConfigDB: ${e}`);
        }
        sc.written = key;
        sc.stored_files = snapshot_files(entry);
    }

    /* Keep an entry under MAX_ENTRY: drop the oldest branches first,
     * then the prefixes of excluded scopes. */
    #fit (sc: ScoutConn, entry: any) {
        const size = () => Buffer.byteLength(JSON.stringify(entry));
        if (size() <= MAX_ENTRY) return entry;

        const refs = ["current", "previous"]
            .filter(k => entry[k])
            .map(k => entry[k] = {
                ...entry[k],
                branches: [...entry[k].branches],
                excluded: entry[k].excluded.map((e: any) => ({ ...e })),
            });
        let trimmed = false;
        for (const ref of refs) {
            while (ref.branches.length && size() > MAX_ENTRY) {
                ref.branches.shift();
                trimmed = true;
            }
        }
        for (const ref of refs) {
            for (const scope of ref.excluded) {
                if (size() <= MAX_ENTRY) break;
                if (scope.prefixes) {
                    delete scope.prefixes;
                    trimmed = true;
                }
            }
        }
        if (trimmed)
            this.log("The scan status of %s was over %d bytes, so older branches or excluded prefixes were left out",
                sc.uuid, MAX_ENTRY);
        return entry;
    }

    /* Write progress at most every throttle_ms. */
    #write_later (sc: ScoutConn) {
        if (sc.write_timer) return;
        sc.write_timer = setTimeout(() => {
            sc.write_timer = undefined;
            this.#write(sc).catch(() => {});
        }, this.timing.throttle_ms);
    }

    /* ---- Requests ---- */

    async #request (req: any) {
        const uuid_rx = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
        const conn = uuid_rx.test(req?.connection) ? req.connection : null;
        const request = uuid_rx.test(req?.request) ? req.request : null;

        const bad = this.schemas.check("ncmd", req);
        if (bad)
            return this.#refuse(conn, request, "REQUEST", `The scan request is malformed: ${bad}`);
        if (req.options && Buffer.byteLength(JSON.stringify(req.options)) > MAX_OPTIONS)
            return this.#refuse(conn, request, "REQUEST", `The scan options are over ${MAX_OPTIONS} bytes`);

        if (this.#stopping)
            return this.#refuse(conn, request, "NODRIVER", "The Edge Agent is restarting");

        const sc = this.#conns.get(conn);
        if (!sc)
            return this.#refuse(conn, request, "UNDEPLOYED",
                "This connection is not in the Edge Agent's config, or it is not a split driver");
        if (!await this.#ready(sc)) {
            this.log("Ignoring scan request %s: the scan status of %s can't be read", request, conn);
            return;
        }

        if (req.op == "cancel")
            return this.#cancel(sc, request);
        return this.#start_request(sc, req);
    }

    /* Record a refusal in last_request, leaving the scan fields alone. */
    async #refuse (conn: string | null, request: string | null, code: string, message: string) {
        this.log("Refused scan request %s for connection %s: %s %s", request, conn, code, message);
        if (!conn) return;

        const last_request = { request, code, message: cut(message, MAX_MESSAGE), at: now() };
        const sc = this.#conns.get(conn);
        if (sc) {
            this.#entry(sc).last_request = last_request;
            return this.#write(sc).catch(() => {});
        }

        /* A connection this agent doesn't run. Its entry may belong to
         * the agent that does, so leave that alone. */
        try {
            const cdb = this.fplus.ConfigDB;
            const old = await cdb.get_config(UUIDs.App.ScoutStatus, conn);
            if (old && old.node != this.node) {
                this.log("Not recording the refusal: connection %s belongs to node %s", conn, old.node);
                return;
            }
            const entry = { version: 1, supported: null, ...old,
                node: this.node, last_request, updated: now() };
            await cdb.put_config(UUIDs.App.ScoutStatus, conn, entry);
        }
        catch (e) {
            this.log("Can't record the refusal for connection %s: %s", conn, e);
        }
    }

    /* Why the driver can't take a scan now, or null if it can. */
    #driver_problem (sc: ScoutConn): [string, string] | null {
        const { conn } = sc;
        if (conn.status != "UP")
            return ["NODRIVER", `The driver isn't ready. Its status is ${conn.status}.`];
        if (!this.broker.scouts(conn.id)) {
            const up = conn.up_since == null ? 0 : Date.now() - conn.up_since;
            if (up >= this.timing.library_ms || this.#entry(sc).supported == "library")
                return ["LIBRARY", "The driver was built before scouting. Update the driver image."];
            return ["NODRIVER", "The driver has only just started. Try again in a few seconds."];
        }
        return null;
    }

    async #start_request (sc: ScoutConn, req: any) {
        const problem = this.#driver_problem(sc);
        if (problem)
            return this.#refuse(sc.uuid, req.request, ...problem);
        if (sc.scan)
            return this.#refuse(sc.uuid, req.request, "BUSY",
                "A scan is already queued or running on this connection");
        if (sc.draining)
            return this.#refuse(sc.uuid, req.request, "BUSY",
                "The driver is still stopping the last scan. Try again in a few seconds.");
        if (this.#active.size >= this.max_concurrent && this.#queue.length >= QUEUE_MAX)
            return this.#refuse(sc.uuid, req.request, "LIMIT",
                "The Edge Agent is running as many scans as it allows and its queue is full");

        const uuid = crypto.randomUUID();
        const options = req.options ?? {};
        const scan: Scan = {
            uuid, id: uuid.replace(/-/g, ""),
            request: req.request, sc,
            state: "queued",
            root: req.root ?? null,
            folder_id: req.folder_id ?? null,
            options,
            options_hash: sha256_hash(options),
            limits: clamp_limits(req.limits),
            started: now(),
            next_seq: 0, ids: new Set(), items: 0, rejected: 0,
            visited: 0, note: null,
            writer: null, base: null,
            queued_write: Promise.resolve(), created: false,
            sent_start: false, sent_cancel: false, driver_ended: false,
            capped: null, cancelled: false, over: false,
            work: Promise.resolve(),
            inbox: [], inbox_bytes: 0, cur: null, window: null,
        };
        sc.scan = scan;
        this.#queue.push(scan);

        Object.assign(this.#entry(sc), {
            scan: uuid, request: req.request, state: "queued",
            code: null, message: null,
            started: scan.started, finished: null,
            root: scan.root, folder_id: scan.folder_id,
            options_hash: scan.options_hash, config_hash: sc.config_hash,
            progress: null,
            last_request: { request: req.request, code: null, message: null, at: now() },
        });
        this.log("Connection %s: scan %s queued (request %s)", sc.uuid, uuid, req.request);
        scan.queued_write = this.#write(sc);
        scan.queued_write.catch(() => {});
        this.#pump();
    }

    async #cancel (sc: ScoutConn, request: string | null) {
        const scan = sc.scan;
        if (!scan || scan.over)
            return this.#refuse(sc.uuid, request, "NOTRUNNING", "There is no scan to stop on this connection");

        this.#entry(sc).last_request = { request, code: null, message: null, at: now() };
        this.log("Connection %s: stopping scan %s (request %s)", sc.uuid, scan.uuid, request);

        const queued = this.#queue.indexOf(scan);
        if (queued >= 0) {
            this.#queue.splice(queued, 1);
            return this.#end(scan, "cancelled", "CANCELLED", "Stopped before it started");
        }
        if (scan.state == "queued") {
            /* Starting: #start sees this once it has set up. */
            scan.cancelled = true;
            return this.#write(sc).catch(() => {});
        }
        if (scan.state == "running") {
            /* The driver ends the scan with CANCELLED. */
            this.#cancel_driver(scan);
            return this.#write(sc).catch(() => {});
        }
        /* Saving: too late to stop. */
        return this.#write(sc).catch(() => {});
    }

    /* Start queued scans while there are free slots. */
    #pump () {
        while (!this.#stopping && this.#queue.length && this.#active.size < this.max_concurrent) {
            const scan = this.#queue.shift()!;
            this.#active.add(scan);
            scan.work = this.#start(scan).catch(e => this.#fail(scan, e));
        }
    }

    async #start (scan: Scan) {
        const { sc } = scan;
        const problem = this.#driver_problem(sc);
        if (problem)
            throw new ScanError(...problem);

        /* The service-setup sweep deletes an object no status entry
         * names, so the entry naming this scan is stored first. */
        try {
            await scan.queued_write;
        }
        catch (e: any) {
            throw new ScanError("STORE", e instanceof ScanError ? e.message
                : `Can't write the scan status to ConfigDB: ${e}`);
        }
        if (scan.over) return;

        if (scan.folder_id != null) {
            const current = this.#entry(sc).current;
            if (!current)
                throw new ScanError("OPTIONS", "There is no scan to re-scan a branch of. Scan the whole connection first.");
            scan.base = await index_snapshot(read_lines(await this.#download(current.file)));
            if (!scan.base.parents.has(scan.folder_id))
                throw new ScanError("OPTIONS", `The folder ${cut(scan.folder_id, 200)} is not in the current scan`);
        }

        try {
            await this.fplus.ConfigDB.create_object(UUIDs.Class.ScoutResult, scan.uuid, true);
        }
        catch (e) {
            throw new ScanError("STORE", `Can't create the snapshot's File object in ConfigDB: ${e}`);
        }
        scan.created = true;
        if (scan.over) {
            await this.#delete_snapshot(scan.uuid);
            return;
        }

        scan.writer = new SnapshotWriter({ raw: this.max_bytes, gz: this.max_gz_bytes });
        /* A full scan's buffer is the snapshot. A branch scan's holds
         * only its items, which are merged when it ends. */
        if (scan.folder_id == null)
            scan.writer.force_write(this.#header(scan, scan.root, scan.options));

        if (scan.over) return;
        if (scan.cancelled)
            return this.#end(scan, "cancelled", "CANCELLED", "Stopped before it started");
        const again = this.#driver_problem(sc);
        if (again)
            throw new ScanError(...again);

        scan.state = "running";
        this.#entry(sc).state = "running";
        this.#write(sc).catch(() => {});
        this.log("Connection %s: scan %s running", sc.uuid, scan.uuid);

        this.#touch(scan);
        scan.sent_start = true;
        scan.deadline = setTimeout(
            () => this.#timeout(scan, `The scan passed its deadline of ${scan.limits.seconds} s`),
            scan.limits.seconds * 1000 + this.timing.deadline_extra_ms);
        this.#publish_scout(sc, {
            op: "start", id: scan.id, version: 1,
            root: scan.root, folder_id: scan.folder_id,
            options: scan.options, limits: scan.limits,
            window: WINDOW,
        });
    }

    #header (scan: Scan, root: string | null, options: object) {
        return {
            version:    1,
            scan:       scan.uuid,
            connection: scan.sc.uuid,
            driver:     scan.sc.library,
            started:    scan.started,
            root,
            folder_id:  scan.folder_id,
            options,
        };
    }

    /* Restart the silence timer. */
    #touch (scan: Scan) {
        clearTimeout(scan.silence);
        scan.silence = setTimeout(
            () => this.#timeout(scan, `The driver sent nothing for ${this.timing.silence_ms / 1000} s`),
            this.timing.silence_ms);
    }

    #timeout (scan: Scan, why: string) {
        if (scan.over || scan.state != "running") return;
        this.#cancel_driver(scan);
        /* What the agent stopped itself is kept. */
        if (scan.capped)
            return this.#queue_work(scan, () => this.#save(scan, null));
        this.#end(scan, "failed", "TIMEOUT", why);
    }

    /* ---- Messages from the driver ---- */

    /* Ask the driver to stop a scan, once. */
    #cancel_driver (scan: Scan) {
        if (scan.sent_cancel || !scan.sent_start || scan.driver_ended) return;
        scan.sent_cancel = true;
        this.#publish_scout(scan.sc, { op: "cancel", id: scan.id });
    }

    #publish_scout (sc: ScoutConn, msg: object) {
        this.broker.publish({
            id:         sc.conn.id,
            msg:        "scout",
            payload:    Buffer.from(JSON.stringify(msg)),
        }).catch(e => this.log("Can't publish to the scout topic of %s: %s", sc.conn.id, e));
    }

    #send_hello (sc: ScoutConn) {
        /* After the broker has finished the subscription. */
        setImmediate(() => {
            if (!this.#stopping)
                this.#publish_scout(sc, { op: "hello", version: 1 });
        });
    }

    #scout_sub (id: string, on: boolean) {
        const sc = this.#by_id.get(id);
        if (!sc) return;
        if (on) {
            clearTimeout(sc.library_timer);
            return this.#send_hello(sc);
        }
        /* A driver that has gone holds no scan. */
        this.#drained(sc);
        if (sc.scan?.state == "running")
            this.#interrupt(sc.scan, "The driver disconnected during the scan");
    }

    #status (sc: ScoutConn, status: string, old: string) {
        if (status == "UP" && old != "UP") {
            clearTimeout(sc.library_timer);
            sc.library_timer = setTimeout(() => this.#library_check(sc), this.timing.library_ms);
            return;
        }
        if (status == "UP") return;
        clearTimeout(sc.library_timer);
        /* This comes before the agent sends a new conf, so the cancel
         * reaches the driver first. */
        if (sc.scan?.state == "running")
            this.#interrupt(sc.scan, `The driver's status changed to ${status} during the scan`);
    }

    /* A driver UP for library_ms that never subscribed to scout. */
    async #library_check (sc: ScoutConn) {
        if (this.#stopping || sc.conn.status != "UP" || this.broker.scouts(sc.conn.id))
            return;
        if (!await this.#ready(sc)) return;
        const entry = this.#entry(sc);
        if (entry.supported == "library") return;
        this.log("Connection %s: the driver doesn't subscribe to scout, so it was built before scouting", sc.uuid);
        entry.supported = "library";
        this.#write(sc).catch(() => {});
    }

    #found (sc: ScoutConn, id: string, payload: Buffer) {
        if (this.#stopping) return;

        if (id == "hello")
            return this.#hello(sc, parse(payload));

        if (sc.draining == id) {
            const msg = parse(payload);
            if (msg !== undefined && !this.schemas.check("found", msg) && msg.type == "end")
                this.#drained(sc);
            return;
        }

        const scan = sc.scan;
        if (!scan || scan.id != id || scan.state != "running") {
            this.log("Connection %s: ignoring a message for scan %s, which isn't running", sc.uuid, id);
            return;
        }

        const entry: Inbound = { payload, read: false, msg: undefined };
        if (payload.length <= PEEK_BYTES) {
            entry.read = true;
            entry.msg = parse(payload);
        }
        /* The driver has finished, so only the agent's own work is
         * left, however long its backlog takes. */
        if (entry.msg?.type == "end" && !this.schemas.check("found", entry.msg)) {
            scan.driver_ended = true;
            clearTimeout(scan.silence);
            clearTimeout(scan.deadline);
        }
        else
            this.#touch(scan);

        scan.inbox.push(entry);
        scan.inbox_bytes += payload.length;
        if (scan.inbox_bytes > MAX_BACKLOG && !scan.capped) {
            this.log("Scan %s: %d bytes from the driver are waiting, over the %d byte limit",
                scan.uuid, scan.inbox_bytes, MAX_BACKLOG);
            this.#cap(scan, "size");
        }
        if (scan.capped) {
            /* Only the driver's end matters now. */
            scan.inbox = scan.inbox.filter(e => e.read);
            scan.inbox_bytes = scan.inbox.reduce((n, e) => n + e.payload.length, 0);
        }
        this.#schedule();
    }

    /* ---- The scheduler ---- */

    #has_work (scan: Scan) {
        return !scan.over && scan.state == "running"
            && (scan.cur != null || scan.inbox.length > 0);
    }

    #schedule () {
        if (this.#pumping || this.#stopping) return;
        this.#pumping = true;
        this.#run()
            .catch(e => this.log("The scan scheduler failed: %s", e?.stack ?? e))
            .finally(() => this.#pumping = false);
    }

    /* Handle driver messages in slices of budget.slice_ms, one scan
     * at a time in turn, while the CPU budget allows. Between slices
     * the event loop goes round, so data is never far behind. */
    async #run () {
        let waited = 0;
        for (;;) {
            await new Promise(r => setImmediate(r));
            const ready = [...this.#active].filter(s => this.#has_work(s));
            if (!ready.length || this.#stopping) return;

            const wait = this.budget.wait();
            if (wait > 0 && waited < this.budget.max_wait) {
                const ms = Math.min(wait, this.budget.max_wait - waited);
                waited += ms;
                await new Promise(r => setTimeout(r, ms).unref());
                continue;
            }
            waited = 0;
            const scan = ready[this.#turn++ % ready.length];
            await this.#step(scan, performance.now() + this.budget.slice_ms);
        }
    }

    /* Handle a scan's waiting messages until `until`. */
    async #step (scan: Scan, until: number) {
        try {
            while (this.#has_work(scan)) {
                if (scan.cur) {
                    if (!this.#items_slice(scan, until)) return;
                    if (scan.writer?.needs_drain) await scan.writer.drain();
                }
                else {
                    const entry = scan.inbox.shift()!;
                    scan.inbox_bytes -= entry.payload.length;
                    this.#handle(scan, entry);
                }
                if (performance.now() >= until) return;
            }
        }
        catch (e) {
            this.#fail(scan, e);
        }
    }

    /* One message from the driver, in the order they came. */
    #handle (scan: Scan, entry: Inbound) {
        const msg = entry.read ? entry.msg : parse(entry.payload);
        const bad = msg === undefined
            ? "it is not JSON"
            : this.schemas.check("found", msg);

        /* After the agent's own cap only the driver's end matters.
         * Items and progress the driver sent before it saw the cancel
         * are dropped, and so is any gap in seq among them. */
        if (scan.capped) {
            if (bad || msg.type != "end") return;
            scan.driver_ended = true;
            clearTimeout(scan.silence);
            clearTimeout(scan.deadline);
            return this.#queue_work(scan, () => this.#driver_end(scan, msg));
        }

        if (bad) {
            this.#cancel_driver(scan);
            return this.#end(scan, "failed", "AGENT", `The driver sent an invalid message: ${bad}`);
        }
        if (msg.seq != scan.next_seq) {
            this.#cancel_driver(scan);
            return this.#end(scan, "failed", "LOST",
                `A message from the driver was lost: expected ${scan.next_seq}, got ${msg.seq}`);
        }
        scan.next_seq++;

        switch (msg.type) {
        case "accept":
            scan.window = msg.window ?? null;
            return;
        case "progress":
            scan.visited = Math.max(scan.visited, msg.visited);
            scan.note = cut(msg.note, MAX_MESSAGE);
            return this.#progress(scan);
        case "items":
            if (entry.payload.length > MAX_ITEMS_MESSAGE) {
                this.log("Scan %s: dropped an items message of %d bytes, over the %d byte limit",
                    scan.uuid, entry.payload.length, MAX_ITEMS_MESSAGE);
                scan.rejected += msg.items.length;
                return this.#ack(scan, msg.seq);
            }
            if (scan.folder_id != null && scan.items == 0 && scan.rejected == 0
                && msg.items[0]?.id !== scan.folder_id)
            {
                this.#cancel_driver(scan);
                return this.#end(scan, "failed", "AGENT",
                    "The driver's first item is not the folder it was asked to scan again");
            }
            scan.cur = { items: msg.items, i: 0, seq: msg.seq };
            return;
        case "end":
            scan.driver_ended = true;
            clearTimeout(scan.silence);
            clearTimeout(scan.deadline);
            return this.#queue_work(scan, () => this.#driver_end(scan, msg));
        case "hello":
            return this.#hello(scan.sc, msg);
        }
    }

    /* Tell a driver that keeps to a window that every message up to
     * seq has been handled. It may be waiting for this, so the silence
     * timer starts again. */
    #ack (scan: Scan, seq: number) {
        if (scan.window == null || scan.capped || scan.over) return;
        this.#touch(scan);
        this.#publish_scout(scan.sc, { op: "ack", id: scan.id, seq });
    }

    #queue_work (scan: Scan, fn: () => Promise<void> | void) {
        scan.work = scan.work
            .then(() => scan.over ? undefined : fn())
            .catch(e => this.#fail(scan, e));
    }

    #hello (sc: ScoutConn, msg: any) {
        const bad = msg === undefined ? "it is not JSON" : this.schemas.check("found", msg);
        if (bad || msg.type != "hello") {
            this.log("Connection %s: ignoring an invalid hello: %s", sc.uuid, bad ?? "not a hello");
            return;
        }
        const supported = msg.supported && msg.versions.includes(1);
        sc.library = msg.library ?? null;
        this.log("Connection %s: the driver (%s) %s", sc.uuid, sc.library ?? "unknown library",
            supported ? "can scan" : "can't scan");

        if (sc.scan?.state == "running")
            this.#interrupt(sc.scan, "The driver sent a new hello during the scan");

        this.#ready(sc).then(ok => {
            const entry = this.#entry(sc);
            if (!ok || entry.supported === supported) return;
            entry.supported = supported;
            this.#write(sc).catch(() => {});
        });
    }

    #progress (scan: Scan) {
        Object.assign(this.#entry(scan.sc), {
            progress: {
                visited:    Math.max(scan.visited, scan.items),
                found:      scan.items,
                note:       scan.note,
            },
        });
        this.#write_later(scan.sc);
    }

    /* Write the current items message's items until `until`. Returns
     * true when the message is done. */
    #items_slice (scan: Scan, until: number): boolean {
        const cur = scan.cur!;
        const { items } = cur;
        let n = 0;
        while (cur.i < items.length && !scan.capped) {
            /* Look at the clock every 16 items, and always do some. */
            if ((++n & 15) == 0 && performance.now() >= until) return false;
            const raw = items[cur.i++];
            const item = this.#clean_item(scan, raw);
            if (!item) {
                scan.rejected++;
                continue;
            }
            if (scan.items >= scan.limits.items) {
                this.#cap(scan, "items");
                break;
            }
            if (!scan.writer!.write(item)) {
                this.#cap(scan, "size");
                break;
            }
            scan.ids.add(item.id);
            scan.items++;
        }
        scan.cur = null;
        this.#progress(scan);
        this.#ack(scan, cur.seq);
        return true;
    }

    /* An item as the snapshot stores it, or null to drop it. */
    #clean_item (scan: Scan, raw: any) {
        if (raw === null || typeof raw != "object" || Array.isArray(raw)) return null;
        if (typeof raw.id != "string" || raw.id.length == 0 || raw.id.length > 512) return null;
        if (scan.ids.has(raw.id)) return null;

        const item: any = {};
        for (const k of ITEM_KEYS)
            if (k in raw) item[k] = raw[k];
        for (const [k, n] of ITEM_STRING_LIST)
            if (typeof item[k] == "string" && item[k].length > n)
                item[k] = item[k].slice(0, n);
        /* Over-long detail is driver-specific extra, so lose it and
         * keep the item. */
        if (item.detail != null && Buffer.byteLength(JSON.stringify(item.detail)) > MAX_DETAIL)
            item.detail = null;

        if (this.schemas.check("item", item)) return null;
        return item;
    }

    /* The agent's own cap: stop the driver, and keep what arrived. */
    #cap (scan: Scan, why: "items" | "size") {
        if (scan.capped) return;
        scan.capped = why;
        this.log("Scan %s: stopped at the agent's %s cap after %d items", scan.uuid, why, scan.items);
        this.#cancel_driver(scan);
    }

    async #driver_end (scan: Scan, msg: any) {
        if (msg.error && !scan.capped) {
            const { code, message } = msg.error;
            this.log("Scan %s ended with %s: %s", scan.uuid, code, message ?? "");
            return this.#end(scan, code == "CANCELLED" ? "cancelled" : "failed",
                code, message ?? null);
        }
        return this.#save(scan, msg.error ? null : msg);
    }

    /* ---- Saving ---- */

    async #save (scan: Scan, end: any) {
        const { sc } = scan;
        scan.state = "saving";
        clearTimeout(scan.silence);
        clearTimeout(scan.deadline);
        this.log("Connection %s: saving scan %s (%d items, %d dropped)",
            sc.uuid, scan.uuid, scan.items, scan.rejected);

        const finished = now();
        const flags = scan.capped
            ? { exhaustive: false, truncated: true, reason: scan.capped,
                excluded: end?.excluded ?? [] }
            : { exhaustive: end.exhaustive, truncated: end.truncated,
                reason: end.reason ?? null, excluded: end.excluded ?? [] };
        flags.excluded = flags.excluded.slice(0, MAX_EXCLUDED).map(clean_scope);

        let buf: Buffer, ref: any;
        if (scan.folder_id == null) {
            scan.writer!.force_write({ end: {
                finished, ...flags,
                rejected: scan.rejected, items: scan.items, branches: [],
            } });
            buf = await scan.writer!.finish();
            ref = { items: scan.items, root: scan.root, options_hash: scan.options_hash,
                ...flags, branches: [] };
        }
        else
            [buf, ref] = await this.#merge(scan, flags, finished);

        await this.#upload(scan.uuid, buf);

        const entry = this.#entry(sc);
        const dropped = entry.previous?.file;
        Object.assign(entry, {
            state: "done", code: null, message: null, finished,
            progress: { visited: Math.max(scan.visited, scan.items), found: scan.items, note: null },
            previous: entry.current ?? null,
            current: {
                file:       scan.uuid,
                items:      ref.items,
                bytes_gz:   buf.length,
                exhaustive: ref.exhaustive,
                truncated:  ref.truncated,
                reason:     ref.reason,
                finished,
                root:       ref.root,
                options_hash: ref.options_hash,
                config_hash: sc.config_hash,
                excluded:   ref.excluded,
                branches:   ref.branches,
            },
        });
        this.#release(scan);
        this.log("Connection %s: scan %s done, %d items, %d bytes gzipped",
            sc.uuid, scan.uuid, ref.items, buf.length);

        /* The snapshot that dropped out goes only once the stored
         * entry no longer names it. A failed write is tried again
         * until it is stored. */
        if (dropped) sc.unwanted.add(dropped);
        await this.#write(sc).catch(() => {});
    }

    /* Merge a branch scan into the current snapshot, streaming both. */
    async #merge (scan: Scan, flags: any, finished: string): Promise<[Buffer, any]> {
        const base = scan.base!;
        const scan_buf = await scan.writer!.finish();
        const current = this.#entry(scan.sc).current;

        /* The merged snapshot has the same caps as a full scan, so
         * branch scans can't grow it without bound. */
        const out = new SnapshotWriter({ raw: this.max_bytes, gz: this.max_gz_bytes });
        out.force_write({ ...this.#header(scan, base.header.root ?? null, base.header.options ?? {}) });

        let items = 0;
        let capped: "items" | "size" | null = null;
        const lines = merged_items(base, scan.folder_id!,
            read_lines(await this.#download(current.file)), read_lines(scan_buf));
        for await (const item of lines) {
            if (items >= LIMIT_CEILINGS.items) {
                capped = "items";
                break;
            }
            if (!out.write(item)) {
                capped = "size";
                break;
            }
            items++;
            await out.drain();
        }
        /* Leaving the loop early closes both readers. */
        if (capped)
            this.log("Scan %s: the merged snapshot reached the agent's %s cap after %d items",
                scan.uuid, capped, items);

        const merged = merge_flags({
            exhaustive: base.end.exhaustive, truncated: base.end.truncated,
            reason: base.end.reason ?? null, excluded: base.end.excluded ?? [],
            branches: base.end.branches ?? [],
        }, { ...flags, folder_id: scan.folder_id!, finished });
        merged.excluded = merged.excluded.map(clean_scope);
        if (capped)
            Object.assign(merged, { exhaustive: false, truncated: true, reason: capped });

        out.force_write({ end: {
            finished, ...merged,
            rejected: (base.end.rejected ?? 0) + scan.rejected, items,
        } });
        const buf = await out.finish();
        return [buf, {
            items, root: base.header.root ?? null,
            options_hash: current.options_hash,
            ...merged,
        }];
    }

    /* ---- The Files service ---- */

    async #upload (uuid: string, body: Buffer) {
        const res = await this.fplus.Fetch.fetch({
            service:    UUIDs.Service.Files,
            url:        `/v1/file/${uuid}`,
            method:     "PUT",
            /* A Buffer, never a stream: Fetch sends the request again
             * after a 401, and a stream would be used up by then. */
            body,
            headers:    {
                "Content-Type":         "application/octet-stream",
                "Original-Filename":    `scout-${uuid}.ndjson.gz`,
            },
        });
        switch (res.status) {
        case 200:
        case 201:
        case 204:
            return;
        case 0:
            throw new ScanError("STORE", "Can't reach the Files service to save the scan");
        case 403:
            throw new ScanError("STORE", "The Files service refused the upload (403). The Edge Agent needs the Files Upload permission.");
        case 404:
            throw new ScanError("STORE", "The Files service can't find the snapshot's File object (404). The Edge Agent may lack the grant to create Edge scout result objects.");
        case 409:
            throw new ScanError("STORE", "The Files service already holds a snapshot with this UUID (409)");
        default:
            throw new ScanError("STORE", `The Files service answered ${res.status} to the upload`);
        }
    }

    async #download (uuid: string): Promise<AsyncIterable<any>> {
        const res = await this.fplus.Fetch.fetch({
            service:    UUIDs.Service.Files,
            url:        `/v1/file/${uuid}`,
            headers:    { Accept: "application/octet-stream" },
            cache:      "no-store",
        });
        if (res.status == 200 && res.body) return res.body;
        if (res.status == 403)
            throw new ScanError("STORE", "The Files service refused to give back the current scan (403). The Edge Agent needs Files Download on Edge scout results.");
        if (res.status == 404)
            throw new ScanError("STORE", "The current scan's snapshot is missing from the Files service (404)");
        throw new ScanError("STORE", `The Files service answered ${res.status} for the current scan`);
    }

    /* Delete a snapshot: its content in Files first, because Files
     * checks the object's class, then the ConfigDB object. */
    async #delete_snapshot (uuid: string) {
        try {
            const res = await this.fplus.Fetch.fetch({
                service:    UUIDs.Service.Files,
                url:        `/v1/file/${uuid}`,
                method:     "DELETE",
            });
            if (res.status != 204 && res.status != 200 && res.status != 404) {
                this.log("Can't delete snapshot %s from the Files service: %s", uuid, res.status);
                return;
            }
            await this.fplus.ConfigDB.delete_object(uuid);
            this.log("Deleted snapshot %s", uuid);
        }
        catch (e) {
            this.log("Can't delete snapshot %s: %s", uuid, e);
        }
    }

    /* ---- Ending a scan ---- */

    /* The scan stopped because the driver or the agent went away. */
    #interrupt (scan: Scan, why: string) {
        if (scan.over) return;
        const queued = this.#queue.indexOf(scan);
        if (queued >= 0) this.#queue.splice(queued, 1);
        if (scan.state == "running")
            this.#cancel_driver(scan);
        if (scan.state == "saving") return;
        this.#end(scan, "failed", "INTERRUPTED", why);
    }

    #fail (scan: Scan, e: any) {
        if (scan.over) {
            this.log("Scan %s: %s", scan.uuid, e?.message ?? e);
            return;
        }
        const code = e instanceof ScanError ? e.code : "AGENT";
        const message = e instanceof ScanError ? e.message : `${e?.message ?? e}`;
        if (!(e instanceof ScanError))
            this.log("Scan %s failed in the agent: %s", scan.uuid, e?.stack ?? e);
        this.#end(scan, "failed", code, message);
    }

    /* End a scan without a new snapshot. The previous snapshots stay
     * current, and this scan's File object is deleted. */
    #end (scan: Scan, state: "failed" | "cancelled", code: string, message: string | null) {
        if (scan.over) return;
        scan.over = true;
        const { sc } = scan;
        this.log("Connection %s: scan %s %s with %s%s", sc.uuid, scan.uuid, state, code,
            message ? `: ${message}` : "");

        Object.assign(this.#entry(sc), {
            state, code, message: cut(message, MAX_MESSAGE), finished: now(),
        });
        if (sc.entry.scan == scan.uuid && sc.entry.progress)
            sc.entry.progress = { ...sc.entry.progress, note: null };
        this.#write(sc).catch(() => {});

        const created = scan.created;
        this.#release(scan);
        /* No entry names this scan's object as a snapshot, so it can
         * go at once. If the write failed, the stored entry still
         * shows the scan running, and the next start records it as
         * interrupted. */
        if (created && !this.#referenced(sc, scan.uuid))
            this.#delete_snapshot(scan.uuid);
    }

    /* Free the scan's slot and start the next. */
    #release (scan: Scan) {
        scan.over = true;
        clearTimeout(scan.silence);
        clearTimeout(scan.deadline);
        scan.writer?.destroy();
        scan.writer = null;
        scan.base = null;
        scan.inbox = [];
        scan.inbox_bytes = 0;
        scan.cur = null;
        const q = this.#queue.indexOf(scan);
        if (q >= 0) this.#queue.splice(q, 1);
        this.#active.delete(scan);
        if (scan.sc.scan === scan) scan.sc.scan = null;
        /* The agent ended a scan the driver may still be stopping, so
         * keep the connection busy until the driver's end arrives. */
        if (scan.sent_start && !scan.driver_ended) {
            this.#cancel_driver(scan);
            this.#drain(scan.sc, scan.id);
        }
        this.#pump();
    }

    #drain (sc: ScoutConn, id: string) {
        if (!this.broker.scouts(sc.conn.id)) return;
        clearTimeout(sc.drain_timer);
        sc.draining = id;
        sc.drain_timer = setTimeout(() => this.#drained(sc), this.timing.drain_ms);
    }

    #drained (sc: ScoutConn) {
        clearTimeout(sc.drain_timer);
        sc.drain_timer = undefined;
        sc.draining = null;
    }
}

/* The limits for the driver: the defaults, overridden by the request,
 * and held to the ceilings. */
export function clamp_limits (req: any = {}): typeof DEFAULT_LIMITS {
    const lim = { ...DEFAULT_LIMITS };
    for (const k of ["items", "depth", "seconds", "pace_ms"] as const) {
        const v = req?.[k];
        if (Number.isInteger(v)) lim[k] = v;
    }
    if (typeof req?.samples == "boolean") lim.samples = req.samples;
    lim.items = Math.min(Math.max(lim.items, 1), LIMIT_CEILINGS.items);
    lim.depth = Math.min(Math.max(lim.depth, 1), LIMIT_CEILINGS.depth);
    lim.seconds = Math.min(Math.max(lim.seconds, 1), LIMIT_CEILINGS.seconds);
    lim.pace_ms = Math.max(lim.pace_ms, 0);
    return lim;
}

/* The config_hash of a connection, from the config as stored, before
 * secrets are filled in, so it hashes secret placeholders, never the
 * secrets. */
export function connection_hash (connection: any): string {
    return sha256_hash({
        connType:       connection?.connType ?? null,
        driverId:       connection?.driverId ?? null,
        DriverDetails:  connection?.DriverDetails ?? null,
    });
}

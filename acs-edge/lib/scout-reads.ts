/*
 * ACS Edge Agent
 * Edge Scout: live values, read from a connection's driver while the
 * Admin UI holds a lease
 * Copyright 2026 University of Sheffield
 *
 * The design is "Values" in docs/architecture/edge-management/
 * edge-scout.md and the protocol is "Scouting" in docs/edge-split.md.
 * The Admin UI sends watch and unwatch through Node Control/Scout. A
 * connection holds up to MAX_LEASES leases, each expiring lease_ms
 * after its last watch. While one is live the agent sends the driver a
 * read of the union of their addresses every interval, one at a time,
 * and keeps what comes back in the connection's Edge scout values
 * entry in ConfigDB, which the panel watches. Values never go into
 * Sparkplug.
 */

import crypto from "crypto";

import type { CpuBudget } from "./scout-budget.js";
import type { ScoutSchemas } from "./scout-schemas.js";
import * as UUIDs from "./uuids.js";

/* Leases a connection may hold, and the addresses read for them. */
export const MAX_LEASES = 4;
export const MAX_WATCHED = 40;
/* The largest values entry the agent writes, serialised. */
export const MAX_VALUES_ENTRY = 64 * 1024;
const MAX_VALUE = 1024;
const MAX_ERROR = 256;

export const DEFAULT_READ_INTERVAL = 5000;

export interface ReadTiming {
    /* A lease ends this long after its last watch. */
    lease_ms:           number,
    /* A read the driver hasn't answered in this long is a TIMEOUT. */
    read_timeout_ms:    number,
    /* The entry is written at least this often while a lease is live,
     * even when nothing changed. */
    values_refresh_ms:  number,
    /* The shortest interval between reads, whatever the environment
     * asks for. */
    read_min_ms:        number,
}

export const DEFAULT_READ_TIMING: ReadTiming = {
    lease_ms:           60_000,
    read_timeout_ms:    4_000,
    values_refresh_ms:  30_000,
    read_min_ms:        2_000,
};

/* The read interval from SCOUT_READ_INTERVAL_MS, held to the minimum. */
export function read_interval (env: Record<string, string | undefined>, min: number): number {
    const n = Number.parseInt(env.SCOUT_READ_INTERVAL_MS ?? "", 10);
    return Math.max(n > 0 ? n : DEFAULT_READ_INTERVAL, min);
}

export interface ReadsOpts {
    /* The connection's UUID, which keys the values entry. */
    uuid:       string,
    node:       string,
    fplus:      any,
    schemas:    ScoutSchemas,
    budget:     CpuBudget,
    timing:     ReadTiming,
    interval_ms: number,
    log:        (fmt: string, ...args: any[]) => void,
    /* Publish a message on the driver's scout topic. */
    publish:    (msg: object) => void,
    /* Why the driver can't take a read now, or null if it can. */
    problem:    () => string | null,
}

interface Lease {
    addresses:  string[],
    timer?:     NodeJS.Timeout,
}

interface Value {
    value:      string | null,
    type:       string | null,
    ts:         number | null,
    read:       string,
    error:      string | null,
}

interface InFlight {
    id:         string,
    addresses:  string[],
    timer?:     NodeJS.Timeout,
}

const now = () => new Date().toISOString();

function cut (s: unknown, n: number): string | null {
    if (s == null) return null;
    const str = String(s);
    return str.length > n ? str.slice(0, n) : str;
}

function parse (payload: Buffer): any {
    try {
        return JSON.parse(payload.toString());
    }
    catch (e) {
        return undefined;
    }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms).unref());

/* The live values of one connection. */
export class ConnReads {
    #o:         ReadsOpts
    #leases:    Map<string, Lease> = new Map()
    #watched:   string[] = []
    #dropped    = 0
    #values:    Map<string, Value> = new Map()
    #inflight:  InFlight | null = null
    #timer?:    NodeJS.Timeout
    #last_start = 0
    #running    = false
    #stopped    = false
    /* The entry last written without times, and when it was written. */
    #written:   string | null = null
    #written_at = 0
    #chain:     Promise<void> = Promise.resolve()

    constructor (opts: ReadsOpts) {
        this.#o = opts;
    }

    get leases () { return this.#leases.size; }
    get watched () { return [...this.#watched]; }
    get dropped () { return this.#dropped; }
    get busy () { return this.#inflight != null; }
    /* Status writes in order, for tests and stop(). */
    get settled () { return this.#chain; }

    /* Whether a watch for this lease would be refused for the cap. */
    full (lease: string): boolean {
        return !this.#leases.has(lease) && this.#leases.size >= MAX_LEASES;
    }

    /* Make a lease, or replace its addresses, for lease_ms. */
    watch (lease: string, addresses: string[]) {
        if (this.#stopped) return;
        const old = this.#leases.get(lease);
        if (old) clearTimeout(old.timer);
        const l: Lease = old ?? { addresses };
        l.addresses = [...new Set(addresses)];
        l.timer = setTimeout(() => this.#expire(lease), this.#o.timing.lease_ms);
        if (!old) {
            this.#leases.set(lease, l);
            this.#o.log("Connection %s: live values lease %s made, %d leases",
                this.#o.uuid, lease, this.#leases.size);
        }

        const before = new Set(this.#watched);
        this.#union();
        const added = this.#watched.some(a => !before.has(a));
        if (!this.#running)
            this.#start();
        else if (added)
            this.#schedule(0);
    }

    unwatch (lease: string) {
        const l = this.#leases.get(lease);
        if (!l) return;
        clearTimeout(l.timer);
        this.#leases.delete(lease);
        this.#o.log("Connection %s: live values lease %s ended", this.#o.uuid, lease);
        this.#changed();
    }

    #expire (lease: string) {
        if (!this.#leases.delete(lease)) return;
        this.#o.log("Connection %s: live values lease %s expired", this.#o.uuid, lease);
        this.#changed();
    }

    /* A lease ended. With none left, stop and write the empty entry. */
    #changed () {
        this.#union();
        if (this.#leases.size) return;
        this.#halt();
        this.#write_empty().catch(() => {});
    }

    /* The addresses to read: the union of the leases' addresses, in the
     * order the leases were made, cut at MAX_WATCHED. */
    #union () {
        const set = new Set<string>();
        const left = new Set<string>();
        for (const l of this.#leases.values())
            for (const a of l.addresses) {
                if (set.has(a)) continue;
                if (set.size < MAX_WATCHED) set.add(a);
                else left.add(a);
            }
        this.#watched = [...set];
        this.#dropped = left.size;
        for (const a of [...this.#values.keys()])
            if (!set.has(a)) this.#values.delete(a);
    }

    #start () {
        this.#running = true;
        this.#o.log("Connection %s: reading live values every %d ms",
            this.#o.uuid, this.#o.interval_ms);
        this.#schedule(0);
    }

    /* Stop reading. An answer still on its way is ignored. */
    #halt () {
        this.#running = false;
        clearTimeout(this.#timer);
        this.#timer = undefined;
        if (this.#inflight) clearTimeout(this.#inflight.timer);
        this.#inflight = null;
        this.#values.clear();
    }

    /* Read next in `ms`, but never sooner than read_min_ms after the
     * last read started. */
    #schedule (ms: number) {
        if (!this.#running || this.#stopped) return;
        const earliest = this.#last_start + this.#o.timing.read_min_ms - Date.now();
        clearTimeout(this.#timer);
        this.#timer = setTimeout(() => this.#tick(), Math.max(ms, earliest, 0));
    }

    async #tick () {
        this.#timer = undefined;
        if (!this.#running || this.#stopped) return;
        this.#schedule(this.#o.interval_ms);
        /* Never more than one read at a time. */
        if (this.#inflight || !this.#watched.length) return;
        this.#last_start = Date.now();

        const problem = this.#o.problem();
        if (problem) {
            this.#fail_all(problem);
            return this.#write();
        }

        /* Reads count against the scan CPU budget, so data comes first. */
        await this.#budget();
        if (!this.#running || this.#stopped || this.#inflight) return;

        const addresses = [...this.#watched];
        const id = crypto.randomBytes(16).toString("hex");
        const inflight: InFlight = { id, addresses };
        inflight.timer = setTimeout(() => this.#timeout(inflight),
            this.#o.timing.read_timeout_ms);
        this.#inflight = inflight;
        this.#o.publish({ op: "read", id, version: 1, addresses });
    }

    async #budget () {
        const { budget } = this.#o;
        let waited = 0;
        for (;;) {
            const wait = budget.wait();
            if (wait <= 0 || waited >= budget.max_wait) return;
            const ms = Math.min(wait, budget.max_wait - waited);
            waited += ms;
            await sleep(ms);
        }
    }

    #timeout (inflight: InFlight) {
        if (this.#inflight !== inflight) return;
        this.#inflight = null;
        this.#o.log("Connection %s: read %s timed out", this.#o.uuid, inflight.id);
        this.#fail_all("TIMEOUT", inflight.addresses);
        this.#write();
    }

    /* Record an error against addresses, keeping their last values so
     * the panel can still show them with their age. */
    #fail_all (error: string, addresses = this.#watched) {
        const watching = new Set(this.#watched);
        for (const a of addresses) {
            if (!watching.has(a)) continue;
            const old = this.#values.get(a);
            this.#values.set(a, old
                ? { ...old, error: cut(error, MAX_ERROR) }
                : { value: null, type: null, ts: null, read: now(), error: cut(error, MAX_ERROR) });
        }
    }

    /* A message on found/<id>. Returns true when it was for a read of
     * this connection, whether or not it was still wanted. */
    found (id: string, payload: Buffer): boolean {
        const inflight = this.#inflight;
        if (!inflight || inflight.id != id) return false;
        clearTimeout(inflight.timer);
        this.#inflight = null;
        this.#answer(inflight, parse(payload));
        return true;
    }

    #answer (inflight: InFlight, msg: any) {
        const { schemas } = this.#o;
        const bad = msg === undefined ? "it is not JSON" : schemas.check("found", msg);
        if (bad || (msg.type != "values" && msg.type != "end")) {
            this.#o.log("Connection %s: invalid answer to read %s: %s",
                this.#o.uuid, inflight.id, bad ?? `type ${msg.type}`);
            this.#fail_all("The driver sent an invalid answer", inflight.addresses);
            return this.#write();
        }
        if (msg.type == "end") {
            const { code, message } = msg.error ?? {};
            this.#o.log("Connection %s: read %s answered %s %s",
                this.#o.uuid, inflight.id, code, message ?? "");
            this.#fail_all(message ? `${code}: ${message}` : code, inflight.addresses);
            return this.#write();
        }

        /* Each value on its own, so one bad value doesn't lose the rest.
         * Values for addresses not asked for are dropped. */
        const asked = new Set(inflight.addresses);
        const answered = new Set<string>();
        const read = now();
        for (const raw of msg.values) {
            if (!raw || typeof raw != "object") continue;
            const address = raw.address;
            if (!asked.has(address) || answered.has(address)) continue;
            const v = {
                address,
                value:  typeof raw.value == "string" ? cut(raw.value, MAX_VALUE) : raw.value,
                type:   raw.type,
                ts:     raw.ts,
                error:  typeof raw.error == "string" ? cut(raw.error, MAX_ERROR) : raw.error,
            };
            if (schemas.check("common#/$defs/read_value", v)) continue;
            answered.add(address);
            if (!this.#watched.includes(address)) continue;
            this.#values.set(address,
                { value: v.value, type: v.type, ts: v.ts, read, error: v.error });
        }
        const missing = inflight.addresses.filter(a => !answered.has(a));
        if (missing.length)
            this.#fail_all("The driver gave no valid value", missing);
        this.#write();
    }

    /* ---- The values entry ---- */

    #entry () {
        const values: Record<string, Value> = {};
        for (const a of this.#watched) {
            const v = this.#values.get(a);
            if (v) values[a] = { ...v };
        }
        return {
            version:    1,
            node:       this.#o.node,
            updated:    now(),
            interval_ms: this.#o.interval_ms,
            leases:     this.#leases.size,
            dropped:    this.#dropped,
            values,
        };
    }

    /* Keep the entry under MAX_VALUES_ENTRY: the largest values go
     * first. */
    #fit (entry: any) {
        const size = () => Buffer.byteLength(JSON.stringify(entry));
        let trimmed = 0;
        while (size() > MAX_VALUES_ENTRY) {
            const largest = Object.values(entry.values as Record<string, Value>)
                .filter(v => v.value != null)
                .sort((a, b) => b.value!.length - a.value!.length)[0];
            if (!largest) break;
            largest.value = null;
            largest.error = "Too large to show";
            trimmed++;
        }
        if (trimmed)
            this.#o.log("Connection %s: %d live values were too large to show",
                this.#o.uuid, trimmed);
        return entry;
    }

    /* Write the entry after a read when a value, type, ts or error
     * changed, or the leases did, and at least every
     * values_refresh_ms. */
    #write (): Promise<void> {
        if (!this.#running || this.#stopped) return this.#chain;
        const entry = this.#fit(this.#entry());
        const key = values_key(entry);
        const stale = Date.now() - this.#written_at >= this.#o.timing.values_refresh_ms;
        if (key == this.#written && !stale) return this.#chain;
        return this.#put(entry, key);
    }

    #write_empty (): Promise<void> {
        const entry = {
            version: 1, node: this.#o.node, updated: now(), leases: 0, values: {},
        };
        return this.#put(entry, values_key(entry));
    }

    #put (entry: any, key: string): Promise<void> {
        this.#written = key;
        this.#written_at = Date.now();
        const p = this.#chain.then(async () => {
            const bad = this.#o.schemas.check("values", entry);
            if (bad) {
                this.#o.log("Not writing invalid live values for %s: %s", this.#o.uuid, bad);
                return;
            }
            try {
                await this.#o.fplus.ConfigDB.put_config(UUIDs.App.ScoutValues, this.#o.uuid, entry);
            }
            catch (e) {
                this.#o.log("Can't write the live values of %s: %s", this.#o.uuid, e);
                /* Write again next time. */
                if (this.#written == key) this.#written = null;
            }
        });
        this.#chain = p;
        return p;
    }

    /* At start-up: an entry left with live leases by an agent that
     * stopped is written empty, so the panel doesn't show stale values
     * as live. */
    async reset () {
        let entry;
        try {
            entry = await this.#o.fplus.ConfigDB.get_config(UUIDs.App.ScoutValues, this.#o.uuid);
        }
        catch (e) {
            this.#o.log("Can't read the live values of %s: %s", this.#o.uuid, e);
            return;
        }
        if (!(entry?.leases > 0) || this.#leases.size) return;
        this.#o.log("Connection %s: clearing live values left from before a restart", this.#o.uuid);
        await this.#write_empty();
    }

    /* End every lease. The entry is written empty if any were live. */
    async stop () {
        if (this.#stopped) return;
        const had = this.#leases.size > 0;
        for (const l of this.#leases.values()) clearTimeout(l.timer);
        this.#leases.clear();
        this.#union();
        this.#halt();
        this.#stopped = true;
        if (had) await this.#write_empty();
        await this.#chain;
    }
}

/* An entry's text for comparing, without the times it was written and
 * each value was read. */
function values_key (entry: any): string {
    const { updated, values, ...rest } = entry;
    const vals = Object.fromEntries(Object.entries(values as Record<string, Value>)
        .map(([a, { read, ...v }]) => [a, v]));
    return JSON.stringify({ ...rest, values: vals });
}

/*
 * ACS Edge Agent
 * Edge Scout snapshots: gzipped NDJSON writing, reading and the
 * streamed branch-scan merge
 * Copyright 2026 University of Sheffield
 */

import crypto from "crypto";
import { once } from "events";
import readline from "readline";
import { Readable } from "stream";
import zlib from "zlib";

/* How many branch scans a snapshot remembers. */
export const MAX_BRANCHES = 10;
/* How many excluded scopes a snapshot or a status entry may list. */
export const MAX_EXCLUDED = 8;

/* JSON with the keys of every object sorted, so equal values give
 * equal text whatever order their keys were written in. */
export function canonical_json (value: unknown): string {
    if (Array.isArray(value))
        return `[${value.map(canonical_json).join(",")}]`;
    if (value !== null && typeof value == "object") {
        const obj = value as Record<string, unknown>;
        return `{${Object.keys(obj).sort()
            .filter(k => obj[k] !== undefined)
            .map(k => `${JSON.stringify(k)}:${canonical_json(obj[k])}`)
            .join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

/* The `sha256:<hex>` hash the status entry uses. */
export function sha256_hash (value: unknown): string {
    return "sha256:" + crypto.createHash("sha256")
        .update(canonical_json(value)).digest("hex");
}

export interface WriterCaps {
    /* The most NDJSON bytes, before compression. */
    raw?:   number,
    /* The most gzipped bytes. */
    gz?:    number,
}

/* The NDJSON text gathered before it goes to gzip in one write. Each
 * write to a zlib stream costs a round trip to the thread pool, which
 * for one short line a write is most of the cost of a scan. */
const CHUNK_BYTES = 64 * 1024;

/* The gzip level. Level 3 makes a snapshot about 7% bigger than the
 * default of 6 and needs about half the CPU, and the agent's CPU is
 * what a scan must not use up. */
const GZIP_LEVEL = 3;

/* Writes NDJSON lines through gzip into memory. The caps bound what
 * the agent holds: `write` refuses a line that would pass either cap,
 * and `force_write` (for the header and end lines) does not. Lines
 * are gathered into chunks of CHUNK_BYTES before gzip sees them, and
 * gzip holds some input back, so the gzipped count lags behind what
 * has been written and the finished buffer can pass `gz` by that
 * much. */
export class SnapshotWriter {
    raw_bytes = 0
    gz_bytes = 0
    lines = 0
    #gz: zlib.Gzip
    #chunks: Buffer[] = []
    #pending: string[] = []
    #pending_bytes = 0
    #caps: Required<WriterCaps>
    #error: Error | null = null

    constructor (caps: WriterCaps = {}) {
        this.#caps = {
            raw:    caps.raw ?? Infinity,
            gz:     caps.gz ?? Infinity,
        };
        const gz = this.#gz = zlib.createGzip({ level: GZIP_LEVEL });
        gz.on("data", (chunk: Buffer) => {
            this.#chunks.push(chunk);
            this.gz_bytes += chunk.length;
        });
        gz.on("error", e => this.#error = e);
    }

    /* Write one line, or return false and write nothing if it would
     * pass a cap. */
    write (obj: unknown): boolean {
        const text = JSON.stringify(obj) + "\n";
        const n = Buffer.byteLength(text);
        if (this.raw_bytes + n > this.#caps.raw || this.gz_bytes > this.#caps.gz)
            return false;
        this.#put(text, n);
        return true;
    }

    force_write (obj: unknown) {
        const text = JSON.stringify(obj) + "\n";
        this.#put(text, Buffer.byteLength(text));
    }

    #put (text: string, n: number) {
        this.raw_bytes += n;
        this.lines++;
        this.#pending.push(text);
        this.#pending_bytes += n;
        if (this.#pending_bytes >= CHUNK_BYTES)
            this.#flush();
    }

    /* Hand the gathered lines to gzip. */
    #flush () {
        if (!this.#pending.length) return;
        this.#gz.write(this.#pending.join(""));
        this.#pending = [];
        this.#pending_bytes = 0;
    }

    /* Whether gzip has a backlog, so the writer should drain. */
    get needs_drain (): boolean {
        /* The types of this Node version lack writableNeedDrain. */
        return !!(this.#gz as any).writableNeedDrain;
    }

    /* Wait while gzip has a backlog, so the input it holds stays
     * bounded. */
    async drain () {
        if (this.needs_drain)
            await once(this.#gz, "drain");
    }

    async finish (): Promise<Buffer> {
        this.#flush();
        const done = once(this.#gz, "end");
        this.#gz.end();
        await done;
        if (this.#error) throw this.#error;
        const buf = Buffer.concat(this.#chunks);
        this.#chunks = [];
        return buf;
    }

    destroy () {
        this.#chunks = [];
        this.#pending = [];
        this.#gz.destroy();
    }
}

/* The parsed lines of a gzipped NDJSON source: a Buffer, or the body
 * of a fetch response. */
export async function* read_lines (source: Buffer | AsyncIterable<any>): AsyncGenerator<any> {
    const input = Buffer.isBuffer(source)
        ? Readable.from([source])
        : Readable.from(source as AsyncIterable<any>);
    const gunzip = zlib.createGunzip();
    input.on("error", e => gunzip.destroy(e));
    const lines = readline.createInterface({
        input:      input.pipe(gunzip),
        crlfDelay:  Infinity,
    });
    try {
        for await (const line of lines) {
            if (line.trim() == "") continue;
            yield JSON.parse(line);
        }
    }
    finally {
        lines.close();
        gunzip.destroy();
        input.destroy();
    }
}

export interface SnapshotIndex {
    header:     any,
    end:        any,
    /* Every item's parent, by id. */
    parents:    Map<string, string | null>,
}

/* The first pass over the current snapshot for a branch scan: its
 * header, its end line, and every item's parent. It never holds the
 * items themselves. Throws on a snapshot without a header or an end
 * line. */
export async function index_snapshot (lines: AsyncIterable<any>): Promise<SnapshotIndex> {
    let header: any = undefined;
    let end: any = undefined;
    const parents = new Map<string, string | null>();

    for await (const line of lines) {
        if (header === undefined) {
            if (line?.version !== 1 || !("scan" in line))
                throw new Error("The snapshot does not start with a header");
            header = line;
            continue;
        }
        if (end !== undefined)
            throw new Error("The snapshot has lines after its end line");
        if (line && typeof line.end == "object" && !("id" in line)) {
            end = line.end;
            continue;
        }
        if (typeof line?.id == "string")
            parents.set(line.id, line.parent ?? null);
    }
    if (header === undefined || end === undefined)
        throw new Error("The snapshot has no end line");
    if (Number.isInteger(end.items) && end.items != parents.size)
        throw new Error(`The snapshot's end line counts ${end.items} items but it has ${parents.size}`);

    return { header, end, parents };
}

/* A test for whether an id is the folder or below it in the current
 * snapshot, following each parent chain once. */
export function subtree_test (parents: Map<string, string | null>, folder_id: string) {
    const memo = new Map<string, boolean>();
    return (id: string): boolean => {
        const chain: string[] = [];
        let result = false;
        for (let at: string | null | undefined = id; at != null; at = parents.get(at)) {
            if (at == folder_id) { result = true; break; }
            const known = memo.get(at);
            if (known !== undefined) { result = known; break; }
            /* A cycle in the parent chain never reaches the folder. */
            if (chain.includes(at)) break;
            chain.push(at);
        }
        for (const c of chain) memo.set(c, result);
        return result;
    };
}

/* The items of a merged snapshot, streamed. `base` gives the current
 * snapshot's lines again (the second pass) and `scan` the branch
 * scan's items. It drops the replaced folder and everything under it,
 * adds the scan's items, gives the first of them (the folder) the
 * parent the folder had, and drops any added item whose id is still
 * present outside the replaced subtree, keeping the outside copy. */
export async function* merged_items (
    index: SnapshotIndex, folder_id: string,
    base: AsyncIterable<any>, scan: AsyncIterable<any>,
): AsyncGenerator<any> {
    const inside = subtree_test(index.parents, folder_id);
    const outside = (id: string) => index.parents.has(id) && !inside(id);

    for await (const line of base) {
        if (typeof line?.id != "string") continue;
        if (!inside(line.id)) yield line;
    }

    let first = true;
    for await (const item of scan) {
        if (typeof item?.id != "string") continue;
        const fix = first && item.id == folder_id;
        first = false;
        if (outside(item.id)) continue;
        yield fix ? { ...item, parent: index.parents.get(folder_id) ?? null } : item;
    }
}

export interface ScanFlags {
    exhaustive: boolean,
    truncated:  boolean,
    reason:     string | null,
    excluded:   any[],
}

export interface MergedFlags extends ScanFlags {
    branches:   { folder_id: string, finished: string }[],
}

/* The merged flags of a branch scan: exhaustive is the AND, truncated
 * the OR, the reason the branch's when it is truncated and otherwise
 * the base's, excluded the union by id keeping the base's copy, and
 * the branch appended to the last MAX_BRANCHES branches. */
export function merge_flags (
    base: ScanFlags & { branches?: MergedFlags["branches"] },
    scan: ScanFlags & { folder_id: string, finished: string },
): MergedFlags {
    const base_ex = base.excluded ?? [];
    const ids = new Set(base_ex.map(e => e.id));
    return {
        exhaustive: base.exhaustive && scan.exhaustive,
        truncated:  base.truncated || scan.truncated,
        reason:     scan.truncated ? scan.reason : base.reason,
        excluded:   [...base_ex, ...(scan.excluded ?? []).filter(e => !ids.has(e.id))]
                        .slice(0, MAX_EXCLUDED),
        branches:   [...(base.branches ?? []),
                        { folder_id: scan.folder_id, finished: scan.finished }]
                        .slice(-MAX_BRANCHES),
    };
}

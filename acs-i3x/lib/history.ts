/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * History — Translates i3X value and history requests into InfluxDB
 * Flux queries.
 *
 * Uses MetricMeta from ObjectTree to map elementIds to InfluxDB
 * measurement names and tag filters.
 *
 * Which bucket: the Sparkplug historian's bucket (`influxBucket`)
 * holds every device. When `influxUnsBucket` is set (the UNS historian
 * is deployed), a device that publishes to the UNS is read from both:
 * the UNS bucket holds data written only there (an import or a
 * backfill), and the Sparkplug bucket holds what came before the
 * device was published to the UNS. History is the union of the two,
 * one point per timestamp, the UNS bucket's on a clash. A current
 * value is the later of the two last points, the UNS bucket's on a
 * tie. Both historians write the same measurement, field and
 * topLevelInstance; the UNS historian's path tag also starts with the
 * device segment of the UNS topic (see seriesTargets).
 */

import { InfluxDB } from "@influxdata/influxdb-client";
import type { QueryApi } from "@influxdata/influxdb-client";
import type { MetricMeta, ObjectTree } from "./object-tree.js";
import type { I3xVqt, I3xValueResponse } from "./types/i3x.js";
import type { InfluxValue } from "./value-cache.js";
import { Semaphore } from "./semaphore.js";
import { Slicer } from "./slicer.js";

interface HistoryOpts {
    influxUrl: string;
    influxToken: string;
    influxOrg: string;
    influxBucket: string;
    /**
     * The UNS historian's bucket. Unset (the default) reads every
     * device from `influxBucket` only, as before.
     */
    influxUnsBucket?: string;
    objectTree: ObjectTree;
    /** Devices per bulk last-value query. */
    bulkChunkSize?: number;
    /** Bulk last-value queries allowed in flight at once. */
    bulkConcurrency?: number;
    /**
     * Most distinct measurements a bulk query filters on. A chunk
     * that needs more reads every series of its devices instead.
     */
    bulkMeasurementFilterMax?: number;
    /**
     * InfluxDB query timeout in ms. Defaults to 10 s, the client's
     * own default, set explicitly so the bulk queries' time budget
     * does not depend on the client library version.
     */
    queryTimeout?: number;
    /**
     * Flux queries allowed in flight across the whole process, for
     * current values and history alike. Default 4. Ignored if
     * `semaphore` is given.
     */
    influxConcurrency?: number;
    /** A semaphore to share with other users of InfluxDB. */
    semaphore?: Semaphore;
    /**
     * Where to keep current values read from InfluxDB, so the next
     * read of the same metric does not need a Flux query.
     */
    valueCache?: {
        recordInfluxValues(values: InfluxValue[]): void;
        recordInfluxEmpty?(leaves: Array<{ elementId: string; device: string | null; anchor: string | null }>): void;
    };
}

/** One row of the bulk last-value query. */
interface LastRow {
    _measurement: string;
    topLevelInstance: string;
    path?: string;
    _value: unknown;
    _time: string;
}

/**
 * Where one leaf's series lives: a bucket and the path tag to match.
 * An empty `path` matches only series without a path tag: the
 * Sparkplug historian writes a metric at the top level of its device
 * with an empty path, and the InfluxDB client leaves out a tag with an
 * empty value.
 */
interface SeriesTarget {
    bucket: string;
    path: string;
}

/** How often a failing bucket is logged, at most, in ms. */
const BUCKET_FAILURE_LOG_INTERVAL = 60_000;

/**
 * An RFC 3339 time from InfluxDB, padded to nine fractional digits so
 * that times compare correctly as strings and the same instant always
 * gives the same key. InfluxDB trims trailing zeros, so
 * "...:00Z" and "...:00.5Z" would otherwise sort the wrong way round.
 * Anything else is returned unchanged.
 */
function timeKey(t: string): string {
    const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/.exec(t);
    if (!m) return t;
    return `${m[1]}.${(m[2] ?? "").padEnd(9, "0")}Z`;
}

/** Map key for a series: measurement, device and path ("" for none). */
function seriesKey(measurement: string, tli: string, path: string): string {
    return `${measurement}\u0000${tli}\u0000${path}`;
}

/** Quote a value as a Flux string literal. */
function fluxString(value: string): string {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\$\{/g, "\\${")}"`;
}

function chunk<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        out.push(items.slice(i, i + size));
    }
    return out;
}

/**
 * Run `fn` over `items` with at most `limit` calls in flight. Rejects
 * with the first error, like Promise.all.
 */
async function mapLimit<T>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<void>,
): Promise<void> {
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const item = items[next++];
            await fn(item);
        }
    };
    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, worker),
    );
}

export class History {
    private bucket: string;
    private unsBucket?: string;
    private objectTree: ObjectTree;
    private queryApi: QueryApi;
    private bulkChunkSize: number;
    private bulkConcurrency: number;
    private bulkMeasurementFilterMax: number;
    private semaphore: Semaphore;
    private valueCache?: HistoryOpts["valueCache"];
    /** When each bucket's failure was last logged. */
    private bucketFailureLogged = new Map<string, number>();

    constructor(opts: HistoryOpts) {
        this.bucket = opts.influxBucket;
        /* The same bucket twice would only read it twice, with a path
         * no Sparkplug-bucket series has. */
        this.unsBucket = opts.influxUnsBucket && opts.influxUnsBucket !== opts.influxBucket
            ? opts.influxUnsBucket
            : undefined;
        this.objectTree = opts.objectTree;
        this.semaphore = opts.semaphore ?? new Semaphore(opts.influxConcurrency ?? 4);
        this.valueCache = opts.valueCache;
        this.bulkChunkSize = opts.bulkChunkSize ?? 100;
        this.bulkConcurrency = opts.bulkConcurrency ?? 4;
        this.bulkMeasurementFilterMax = opts.bulkMeasurementFilterMax ?? 50;

        const influx = new InfluxDB({
            url: opts.influxUrl,
            token: opts.influxToken,
            timeout: opts.queryTimeout ?? 10_000,
        });
        this.queryApi = influx.getQueryApi(opts.influxOrg);
    }

    /** Run one Flux query, waiting for a slot under the process-wide cap. */
    private query<T>(flux: string): Promise<T[]> {
        return this.semaphore.run(() => this.queryApi.collectRows<T>(flux));
    }

    /**
     * Run one query per bucket. When more than one bucket is read, a
     * bucket whose query fails (not authorised, missing, timed out)
     * counts as having no rows, so the other answers, as it would have
     * alone; the failure is logged (see bucketFailed). Rejects only if
     * every query fails. One bucket alone fails as it always has.
     */
    private async queryBuckets<T>(queries: Array<{ bucket: string; flux: string }>): Promise<T[][]> {
        if (queries.length === 1) return [await this.query<T>(queries[0].flux)];
        const settled = await Promise.allSettled(queries.map(q => this.query<T>(q.flux)));
        if (settled.every(r => r.status === "rejected"))
            throw (settled[0] as PromiseRejectedResult).reason;
        return settled.map((r, i) => {
            if (r.status === "fulfilled") return r.value;
            this.bucketFailed(queries[i].bucket, r.reason);
            return [];
        });
    }

    /** Log a bucket's failed query, at most once per bucket per
     * BUCKET_FAILURE_LOG_INTERVAL, as every read of a UNS device
     * would otherwise log it. */
    private bucketFailed(bucket: string, err: unknown): void {
        const now = Date.now();
        const last = this.bucketFailureLogged.get(bucket);
        if (last !== undefined && now - last < BUCKET_FAILURE_LOG_INTERVAL) return;
        this.bucketFailureLogged.set(bucket, now);
        console.error(`History: InfluxDB bucket ${JSON.stringify(bucket)} failed; `
            + `answering from the other bucket: ${(err as Error)?.message ?? err}`);
    }

    /**
     * Keep leaf values read from InfluxDB in the value cache, for
     * devices that publish to UNS. A stored value is replaced only by a
     * later UNS message, and a device without ISA-95 hierarchy sends
     * none: its value would be served as current for ever. Its leaves
     * are read from InfluxDB every time instead.
     */
    private async remember(values: Iterable<I3xValueResponse>): Promise<void> {
        if (!this.valueCache) return;
        /* Written a chunk at a time, pausing between: a large read can
         * return values for millions of leaves. */
        const slicer = new Slicer();
        let out: InfluxValue[] = [];
        const write = () => {
            /* Sync may move a device out of its hierarchy during a
             * pause, so check just before writing. */
            out = this.publishingToUns(out);
            try {
                if (out.length) this.valueCache!.recordInfluxValues(out);
            } catch (err) {
                console.error("History: storing InfluxDB values failed:", err);
            }
            out = [];
        };
        for (const v of values) {
            const meta = this.objectTree.getMetricMeta(v.elementId);
            if (!meta) continue;
            out.push({
                elementId: v.elementId,
                device: meta.topLevelInstanceUuid,
                anchor: this.objectTree.getObject(v.elementId)?.parentId ?? null,
                value: v.value,
                quality: v.quality,
                timestamp: v.timestamp,
            });
            if (out.length >= 1000) write();
            await slicer.maybe();
        }
        if (out.length) write();
    }

    /**
     * Record, for each composition read, the leaves InfluxDB had no
     * value for. With the values remember() keeps, every leaf the read
     * covered is then accounted for, so the value cache can answer the
     * composition next time (see ValueCache.compositionComplete).
     */
    private async rememberEmpty(
        plan: Map<string, { composition: boolean; leafIds: string[] }>,
        values: Map<string, I3xValueResponse>,
    ): Promise<void> {
        if (!this.valueCache?.recordInfluxEmpty) return;
        const slicer = new Slicer();
        let out: Array<{ elementId: string; device: string | null; anchor: string | null }> = [];
        const write = () => {
            /* Sync may have removed a device while InfluxDB was read, or
             * during a pause here. A marker for a leaf that has gone
             * would never be deleted, so check just before writing. */
            out = this.publishingToUns(out.filter(l => this.objectTree.getObject(l.elementId)));
            try {
                if (out.length) this.valueCache!.recordInfluxEmpty!(out);
            } catch (err) {
                console.error("History: storing empty InfluxDB results failed:", err);
            }
            out = [];
        };
        const devices = new Map<string, string | null>();
        for (const { composition, leafIds } of plan.values()) {
            if (!composition) continue;
            for (const leafId of leafIds) {
                await slicer.maybe();
                if (values.has(leafId)) continue;
                const anchor = this.objectTree.getObject(leafId)?.parentId ?? null;
                const device = this.objectTree.getMetricMeta(leafId)?.topLevelInstanceUuid
                    ?? this.deviceAbove(anchor, devices);
                /* No device: removeDevice could never delete the marker. */
                if (!device) continue;
                out.push({ elementId: leafId, device, anchor });
                if (out.length >= 1000) write();
            }
        }
        if (out.length) write();
    }

    /**
     * The entries whose device publishes to UNS (see remember). No
     * marker either for a device that does not: a composition with its
     * leaves is then never complete. It is answered from its UNS values
     * only, as on main, or read from InfluxDB whole when it has none.
     * Synchronous, so the answer holds until the caller has written.
     */
    private publishingToUns<T extends { device: string | null }>(entries: T[]): T[] {
        const known = new Map<string, boolean>();
        return entries.filter(e => {
            if (!e.device) return false;
            let yes = known.get(e.device);
            if (yes === undefined) known.set(e.device, yes = this.objectTree.publishesToUns(e.device));
            return yes;
        });
    }

    /**
     * The device an object belongs to: the nearest of `id` and its
     * ancestors that has schemas, as a device does. For a leaf without
     * MetricMeta, so its marker goes with its own device. Answers are
     * kept in `cache` by object, as siblings share their ancestors.
     */
    private deviceAbove(id: string | null, cache: Map<string, string | null>): string | null {
        const path: string[] = [];
        let found: string | null = null;
        for (let i = 0; id && i < 64; i++) {
            if (cache.has(id)) { found = cache.get(id)!; break; }
            path.push(id);
            if (this.objectTree.getDeviceSchemaUuids(id).length) { found = id; break; }
            id = this.objectTree.getObject(id)?.parentId ?? null;
        }
        for (const p of path) cache.set(p, found);
        return found;
    }

    /**
     * Get the current (last known) value for a leaf metric from InfluxDB.
     */
    async getCurrentValue(elementId: string): Promise<I3xValueResponse | null> {
        const meta = this.objectTree.getMetricMeta(elementId);
        if (!meta) return null;

        const targets = this.seriesTargets(meta);
        const results = await this.queryBuckets<{ _value: unknown; _time: string }>(
            targets.map(t => ({
                bucket: t.bucket,
                flux: this.buildSeriesQuery(meta, t, "  |> range(start: -30d)", "  |> last()"),
            })));

        /* The later of the buckets' last points; the first target's
         * (the UNS bucket's) on a tie. */
        let row: { _value: unknown; _time: string } | undefined;
        for (const rows of results) {
            const r = rows[0];
            if (r && (!row || timeKey(r._time) > timeKey(row._time))) row = r;
        }
        if (!row) return null;

        const result: I3xValueResponse = {
            elementId,
            isComposition: false,
            value: row._value,
            quality: "Good",
            timestamp: row._time,
        };
        await this.remember([result]);
        return result;
    }

    /**
     * Get the current value for a composition object by assembling
     * the last known values of all descendant leaf metrics.
     *
     * All leaves are read in one bulk query (see getCurrentValues)
     * rather than one query per leaf.
     */
    async getCompositionValue(elementId: string, maxDepth: number = 1): Promise<I3xValueResponse | null> {
        const values = await this.getValues([elementId], maxDepth);
        return values.get(elementId) ?? null;
    }

    /**
     * Current values for a batch of elementIds, as used by the bulk
     * value endpoint on a UNS cache miss.
     *
     * Composition objects are assembled from their descendant leaves
     * down to `maxDepth`, exactly as getCompositionValue always did.
     * Any other id is treated as a leaf, exactly as getCurrentValue
     * does. Every leaf needed by the whole batch is read with a small,
     * bounded number of Flux queries instead of one query per leaf.
     *
     * The returned map holds a value, or null, for every requested id.
     */
    async getValues(
        elementIds: string[],
        maxDepth: number = 1,
    ): Promise<Map<string, I3xValueResponse | null>> {
        // Work out which leaves each requested id needs.
        /* A composition high in the hierarchy expands to millions of
         * leaves: read them in steps, pausing for the event loop. */
        const slicer = new Slicer();
        const plan = new Map<string, { composition: boolean; leafIds: string[] }>();
        const allLeaves = new Set<string>();
        for (const id of elementIds) {
            if (plan.has(id)) continue;
            const obj = this.objectTree.getObject(id);
            const composition = !!obj?.isComposition;
            let leafIds: string[];
            if (!composition) {
                leafIds = [id];
            } else if (this.objectTree.iterateDescendantLeafIds) {
                leafIds = [];
                for (const leaf of this.objectTree.iterateDescendantLeafIds(id, maxDepth)) {
                    if (leaf !== null) leafIds.push(leaf);
                    await slicer.maybe();
                }
            } else {
                leafIds = this.objectTree.getDescendantLeafIds(id, maxDepth);
            }
            plan.set(id, { composition, leafIds });
            for (const leaf of leafIds) allLeaves.add(leaf);
            await slicer.maybe();
        }

        const leafValues = await this.getCurrentValues([...allLeaves]);
        await this.rememberEmpty(plan, leafValues);

        const out = new Map<string, I3xValueResponse | null>();
        for (const [id, { composition, leafIds }] of plan) {
            if (!composition) {
                out.set(id, leafValues.get(id) ?? null);
                continue;
            }

            // Components are added in getDescendantLeafIds order and the
            // latest timestamp is picked by string comparison, as before.
            const components: Record<string, I3xVqt> = {};
            let latestTimestamp = "";
            for (const leafId of leafIds) {
                await slicer.maybe();
                const val = leafValues.get(leafId);
                if (!val) continue;
                components[leafId] = {
                    value: val.value,
                    quality: val.quality,
                    timestamp: val.timestamp,
                };
                if (val.timestamp > latestTimestamp) {
                    latestTimestamp = val.timestamp;
                }
            }

            out.set(id, Object.keys(components).length === 0 ? null : {
                elementId: id,
                isComposition: true,
                value: null,
                quality: "Good",
                timestamp: latestTimestamp,
                components,
            });
        }
        return out;
    }

    /**
     * Last known values for many leaf metrics at once.
     *
     * Gives the same answer per leaf as getCurrentValue, but reads a
     * whole chunk of devices (topLevelInstance values) per Flux query:
     *
     *   range(start: -30d) |> filter(topLevelInstance in chunk)
     *     |> filter(_field == "value") |> last()
     *
     * last() runs per series, so this returns one row per series of
     * each device, in the same series order that the per-leaf query
     * sees. Each leaf then takes the first row whose measurement and
     * topLevelInstance match, and whose path matches the leaf's (no
     * path tag for a top-level metric). That is the same row
     * getCurrentValue returns as
     * rows[0] when a leaf has more than one series (for example after
     * a device rename changes the `device` tag).
     *
     * When a chunk's leaves need at most `bulkMeasurementFilterMax`
     * distinct measurements, the query also filters on those
     * measurements. Without that, a request for a few fields of
     * devices with thousands of tags would read every one of those
     * series. The filter only drops series no leaf in the chunk can
     * match, so the rows each leaf sees, and their order, are the same.
     *
     * Leaves without MetricMeta, or with no data in the window, are
     * absent from the returned map. With two buckets, a failed query
     * counts as no rows (see queryBuckets); the read fails only for a
     * leaf none of whose buckets answered.
     */
    async getCurrentValues(leafIds: string[]): Promise<Map<string, I3xValueResponse>> {
        const { values } = await this.readLast(leafIds, "-30d", this.bulkConcurrency);
        await this.remember(values.values());
        return values;
    }

    /**
     * For ValueCache's catch-up after a restart or reconnect: the last
     * value of each leaf that has a point at or after `start` (an RFC
     * 3339 time), matched exactly as getCurrentValues matches them.
     * `known` holds the leaves that have MetricMeta, so could be looked
     * up; a known leaf missing from `values` has no point since
     * `start`. Nothing is written to the value cache. Uses half the
     * bulk concurrency, leaving semaphore slots for the reads that fall
     * back to InfluxDB meanwhile.
     */
    async lastValuesSince(leafIds: string[], start: string): Promise<{
        known: Set<string>;
        values: Map<string, I3xValueResponse>;
    }> {
        return this.readLast(leafIds, start, Math.max(1, Math.floor(this.bulkConcurrency / 2)));
    }

    /** getCurrentValues over the window from `start`, without writing
     * the values back. */
    private async readLast(leafIds: string[], start: string, concurrency: number): Promise<{
        known: Set<string>;
        values: Map<string, I3xValueResponse>;
    }> {
        // Per leaf, the series key to look for in each bucket, in
        // order of preference.
        const wanted: Array<{ leafId: string; keys: Array<{ bucket: string; key: string }> }> = [];
        const known = new Set<string>();
        // Per bucket, the measurements each device's leaves need.
        const buckets = new Map<string, Map<string, Set<string>>>();
        const targetCache = new Map<string, boolean>();
        const slicer = new Slicer();
        for (const leafId of leafIds) {
            await slicer.maybe();
            const meta = this.objectTree.getMetricMeta(leafId);
            if (!meta) continue;
            known.add(leafId);
            const measurement = `${meta.metricName}:${meta.typeSuffix}`;
            const keys: Array<{ bucket: string; key: string }> = [];
            for (const t of this.seriesTargets(meta, targetCache)) {
                // A row without a path tag has key path "", which only
                // a top-level metric's target matches, as in the
                // per-leaf query.
                keys.push({
                    bucket: t.bucket,
                    key: seriesKey(measurement, meta.topLevelInstanceUuid, t.path),
                });
                let devices = buckets.get(t.bucket);
                if (!devices) buckets.set(t.bucket, devices = new Map());
                let measurements = devices.get(meta.topLevelInstanceUuid);
                if (!measurements) devices.set(meta.topLevelInstanceUuid, measurements = new Set());
                measurements.add(measurement);
            }
            wanted.push({ leafId, keys });
        }

        const out = new Map<string, I3xValueResponse>();
        if (wanted.length === 0) return { known, values: out };

        // First row seen per key, per bucket.
        const first = new Map<string, Map<string, { _value: unknown; _time: string }>>();
        const jobs: Array<{ bucket: string; tlis: string[] }> = [];
        for (const [bucket, devices] of buckets) {
            first.set(bucket, new Map());
            for (const tlis of chunk([...devices.keys()], this.bulkChunkSize))
                jobs.push({ bucket, tlis });
        }
        // Devices whose query failed, per bucket, and the first error.
        const failed = new Map<string, Set<string>>();
        let firstError: unknown;
        await mapLimit(jobs, concurrency, async ({ bucket, tlis }) => {
            const devices = buckets.get(bucket)!;
            const seen = first.get(bucket)!;
            const measurements = new Set<string>();
            for (const tli of tlis) {
                for (const m of devices.get(tli)!) measurements.add(m);
            }
            const filter = measurements.size <= this.bulkMeasurementFilterMax
                ? [...measurements]
                : undefined;
            let rows: LastRow[];
            try {
                rows = await this.query<LastRow>(this.buildBulkLastQuery(tlis, filter, start, bucket));
            } catch (err) {
                firstError ??= err;
                let f = failed.get(bucket);
                if (!f) failed.set(bucket, f = new Set());
                for (const tli of tlis) f.add(tli);
                return;
            }
            for (const row of rows) {
                const key = seriesKey(row._measurement, row.topLevelInstance, row.path ?? "");
                if (!seen.has(key)) seen.set(key, row);
            }
        });

        if (failed.size) {
            /* A leaf none of whose buckets answered fails the read, as
             * any failure did with one bucket. Otherwise a failed
             * bucket counts as having no rows (see queryBuckets). */
            for (const { leafId } of wanted) {
                await slicer.maybe();
                const meta = this.objectTree.getMetricMeta(leafId);
                if (!meta) continue;
                const targets = this.seriesTargets(meta, targetCache);
                if (targets.every(t => failed.get(t.bucket)?.has(meta.topLevelInstanceUuid)))
                    throw firstError;
            }
            for (const bucket of failed.keys()) this.bucketFailed(bucket, firstError);
        }

        for (const { leafId, keys } of wanted) {
            await slicer.maybe();
            /* The latest of the buckets' rows; the first bucket's on a
             * tie, as getCurrentValue picks. */
            let row: { _value: unknown; _time: string } | undefined;
            for (const { bucket, key } of keys) {
                const r = first.get(bucket)!.get(key);
                if (r && (!row || timeKey(r._time) > timeKey(row._time))) row = r;
            }
            if (!row) continue;
            out.set(leafId, {
                elementId: leafId,
                isComposition: false,
                value: row._value,
                quality: "Good",
                timestamp: row._time,
            });
        }
        return { known, values: out };
    }

    /**
     * The buckets a leaf's series is read from, in order of
     * preference, with the path tag to match in each.
     *
     * The Sparkplug bucket's path is the metric's path within its
     * device. The UNS historian writes everything between "Edge" and
     * the metric name (UnsTopic.GetMetricPath), so its path is the
     * device segment, then "/" and that path; for a metric at the top
     * level of its device, the device segment alone.
     *
     * The UNS bucket is read only when it is configured, the device
     * publishes to the UNS (ObjectTree.publishesToUns), and its device
     * segment is known (ObjectTree.unsDeviceSegment). Otherwise only
     * the Sparkplug bucket is read, as before. `cache` holds answers
     * by device for a caller that looks up many leaves.
     */
    seriesTargets(meta: MetricMeta, cache?: Map<string, boolean>): SeriesTarget[] {
        const sparkplug: SeriesTarget = {
            bucket: this.bucket,
            path: meta.metricPath,
        };
        if (!this.unsBucket) return [sparkplug];

        const tli = meta.topLevelInstanceUuid;
        let publishes = cache?.get(tli);
        if (publishes === undefined) {
            publishes = this.objectTree.publishesToUns(tli);
            cache?.set(tli, publishes);
        }
        if (!publishes) return [sparkplug];
        const segment = this.objectTree.unsDeviceSegment(tli);
        if (!segment) return [sparkplug];

        return [
            {
                bucket: this.unsBucket,
                path: meta.metricPath ? `${segment}/${meta.metricPath}` : segment,
            },
            sparkplug,
        ];
    }

    /**
     * One leaf's query against one bucket: the range, the series
     * filters, then the final step. Every tag value is quoted with
     * fluxString; `range` and `final` are built by us, never from
     * client input.
     */
    private buildSeriesQuery(meta: MetricMeta, target: SeriesTarget, range: string, final: string): string {
        const measurement = `${meta.metricName}:${meta.typeSuffix}`;
        /* A top-level Sparkplug metric has no path tag. Matching any
         * path would also read a same-named metric deeper in the
         * device. */
        const pathFilter = target.path === ""
            ? `  |> filter(fn: (r) => not exists r["path"] or r["path"] == "")`
            : `  |> filter(fn: (r) => r["path"] == ${fluxString(target.path)})`;
        return [
            `from(bucket: ${fluxString(target.bucket)})`,
            range,
            `  |> filter(fn: (r) => r["_measurement"] == ${fluxString(measurement)})`,
            `  |> filter(fn: (r) => r["topLevelInstance"] == ${fluxString(meta.topLevelInstanceUuid)})`,
            pathFilter,
            `  |> filter(fn: (r) => r["_field"] == "value")`,
            final,
        ].filter(Boolean).join("\n");
    }

    /**
     * Build the bulk last-value query for a chunk of devices, and
     * optionally only those measurements, over the window from `start`
     * (a Flux duration or an RFC 3339 time we made, never client
     * input). Uses `or` chains of equality tests, directly after
     * range(), because InfluxDB pushes those down to the storage index.
     */
    buildBulkLastQuery(
        topLevelInstances: string[],
        measurements?: string[],
        start: string = "-30d",
        bucket: string = this.bucket,
    ): string {
        const anyOf = (tag: string, values: string[]) => values
            .map((v) => `r[${fluxString(tag)}] == ${fluxString(v)}`)
            .join(" or ");
        const measurementFilter = measurements
            ? `  |> filter(fn: (r) => ${anyOf("_measurement", measurements)})`
            : "";
        return [
            `from(bucket: ${fluxString(bucket)})`,
            `  |> range(start: ${start})`,
            measurementFilter,
            `  |> filter(fn: (r) => ${anyOf("topLevelInstance", topLevelInstances)})`,
            `  |> filter(fn: (r) => r["_field"] == "value")`,
            `  |> last()`,
        ].filter(Boolean).join("\n");
    }

    /**
     * Build the Flux queries for historical data of a leaf metric, one
     * per bucket it is read from (see seriesTargets), in order of
     * preference. `startTime` and `endTime` are RFC 3339 times the API
     * has validated.
     *
     * Returns null when the elementId has no MetricMeta. Without meta we
     * have no measurement name and no topLevelInstance to filter on, so
     * there is no safe query to build: the caller-supplied elementId must
     * never be used as a tag value itself.
     */
    buildFluxQueries(
        elementId: string,
        startTime: string,
        endTime: string,
    ): string[] | null {
        return this.historyQueries(elementId, startTime, endTime)?.map(q => q.flux) ?? null;
    }

    /** buildFluxQueries, with the bucket each query reads. */
    private historyQueries(
        elementId: string,
        startTime: string,
        endTime: string,
    ): Array<{ bucket: string; flux: string }> | null {
        const meta = this.objectTree.getMetricMeta(elementId);
        if (!meta) return null;
        return this.seriesTargets(meta).map(t => ({
            bucket: t.bucket,
            flux: this.buildSeriesQuery(meta, t,
                `  |> range(start: ${startTime}, stop: ${endTime})`,
                `  |> sort(columns: ["_time"])`),
        }));
    }

    /** The first (preferred) of buildFluxQueries, or null. */
    buildFluxQuery(
        elementId: string,
        startTime: string,
        endTime: string,
    ): string | null {
        return this.buildFluxQueries(elementId, startTime, endTime)?.[0] ?? null;
    }

    /**
     * Query InfluxDB for historical data and return I3xVqt results.
     */
    async queryHistory(
        elementId: string,
        startTime: string,
        endTime: string,
        _maxDepth?: number,
    ): Promise<I3xVqt[]> {
        // Only support history on leaf metrics (those with MetricMeta).
        // Composition objects would return all child metrics mixed together
        // which is not useful. The reference implementation behaves the same.
        const obj = this.objectTree.getObject(elementId);
        if (obj?.isComposition) return [];

        // No MetricMeta means we cannot identify a metric series for this
        // elementId. Return no data rather than guessing at a filter: a
        // leaf with no meta is indistinguishable from an unknown element.
        const queries = this.historyQueries(elementId, startTime, endTime);
        if (queries === null) return [];

        const results = await this.queryBuckets<{ _value: unknown; _time: string }>(queries);

        let rows = results[0];
        if (results.length > 1) {
            /* The union of the buckets, one point per timestamp: the
             * first bucket's (the UNS bucket's) where both have one.
             * Where both historians recorded a point, it is the same. */
            const byTime = new Map<string, { _value: unknown; _time: string }>();
            for (const bucketRows of results) {
                for (const row of bucketRows) {
                    const key = timeKey(row._time);
                    if (!byTime.has(key)) byTime.set(key, row);
                }
            }
            rows = [...byTime.entries()]
                .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
                .map(e => e[1]);
        }

        return rows.map((row) => ({
            value: row._value,
            quality: "Good" as const,
            timestamp: row._time,
        }));
    }
}

/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * History — Translates i3X value and history requests into InfluxDB
 * Flux queries against the sparkplug (default) bucket.
 *
 * Uses MetricMeta from ObjectTree to map elementIds to InfluxDB
 * measurement names and tag filters.
 */

import { InfluxDB } from "@influxdata/influxdb-client";
import type { QueryApi } from "@influxdata/influxdb-client";
import type { ObjectTree } from "./object-tree.js";
import type { I3xVqt, I3xValueResponse } from "./types/i3x.js";
import type { InfluxValue } from "./value-cache.js";
import { Semaphore } from "./semaphore.js";

interface HistoryOpts {
    influxUrl: string;
    influxToken: string;
    influxOrg: string;
    influxBucket: string;
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
    valueCache?: { recordInfluxValues(values: InfluxValue[]): void };
}

/** One row of the bulk last-value query. */
interface LastRow {
    _measurement: string;
    topLevelInstance: string;
    path?: string;
    _value: unknown;
    _time: string;
}

/** Map key for a series: measurement, device and (optionally) path. */
function seriesKey(measurement: string, tli: string, path?: string): string {
    return path === undefined
        ? `${measurement}\u0000${tli}`
        : `${measurement}\u0000${tli}\u0000${path}`;
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
    private objectTree: ObjectTree;
    private queryApi: QueryApi;
    private bulkChunkSize: number;
    private bulkConcurrency: number;
    private bulkMeasurementFilterMax: number;
    private semaphore: Semaphore;
    private valueCache?: { recordInfluxValues(values: InfluxValue[]): void };

    constructor(opts: HistoryOpts) {
        this.bucket = opts.influxBucket;
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

    /** Keep leaf values read from InfluxDB in the value cache. */
    private remember(values: Iterable<I3xValueResponse>): void {
        if (!this.valueCache) return;
        const out: InfluxValue[] = [];
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
        }
        try {
            this.valueCache.recordInfluxValues(out);
        } catch (err) {
            console.error("History: storing InfluxDB values failed:", err);
        }
    }

    /**
     * Get the current (last known) value for a leaf metric from InfluxDB.
     */
    async getCurrentValue(elementId: string): Promise<I3xValueResponse | null> {
        const meta = this.objectTree.getMetricMeta(elementId);
        if (!meta) return null;

        const measurement = `${meta.metricName}:${meta.typeSuffix}`;
        const pathFilter = meta.metricPath
            ? `  |> filter(fn: (r) => r["path"] == "${meta.metricPath}")`
            : "";

        const query = [
            `from(bucket: "${this.bucket}")`,
            `  |> range(start: -30d)`,
            `  |> filter(fn: (r) => r["_measurement"] == "${measurement}")`,
            `  |> filter(fn: (r) => r["topLevelInstance"] == "${meta.topLevelInstanceUuid}")`,
            pathFilter,
            `  |> filter(fn: (r) => r["_field"] == "value")`,
            `  |> last()`,
        ].filter(Boolean).join("\n");

        const rows = await this.query<{ _value: unknown; _time: string }>(query);

        if (rows.length === 0) return null;

        const row = rows[0];
        const result: I3xValueResponse = {
            elementId,
            isComposition: false,
            value: row._value,
            quality: "Good",
            timestamp: row._time,
        };
        this.remember([result]);
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
        const plan = new Map<string, { composition: boolean; leafIds: string[] }>();
        const allLeaves = new Set<string>();
        for (const id of elementIds) {
            if (plan.has(id)) continue;
            const obj = this.objectTree.getObject(id);
            const composition = !!obj?.isComposition;
            const leafIds = composition
                ? this.objectTree.getDescendantLeafIds(id, maxDepth)
                : [id];
            plan.set(id, { composition, leafIds });
            for (const leaf of leafIds) allLeaves.add(leaf);
        }

        const leafValues = await this.getCurrentValues([...allLeaves]);

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
     * topLevelInstance match, and whose path matches when the leaf
     * has a path. That is the same row getCurrentValue returns as
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
     * absent from the returned map.
     */
    async getCurrentValues(leafIds: string[]): Promise<Map<string, I3xValueResponse>> {
        const wanted: Array<{ leafId: string; key: string }> = [];
        // Measurements each device's leaves need.
        const devices = new Map<string, Set<string>>();
        for (const leafId of leafIds) {
            const meta = this.objectTree.getMetricMeta(leafId);
            if (!meta) continue;
            const measurement = `${meta.metricName}:${meta.typeSuffix}`;
            // A leaf without a path is not filtered on path at all by
            // the per-leaf query, so match it on measurement and
            // device only.
            const key = meta.metricPath
                ? seriesKey(measurement, meta.topLevelInstanceUuid, meta.metricPath)
                : seriesKey(measurement, meta.topLevelInstanceUuid);
            wanted.push({ leafId, key });
            let measurements = devices.get(meta.topLevelInstanceUuid);
            if (!measurements) devices.set(meta.topLevelInstanceUuid, measurements = new Set());
            measurements.add(measurement);
        }

        const out = new Map<string, I3xValueResponse>();
        if (wanted.length === 0) return out;

        // First row seen per key. Both the path-qualified and the
        // path-less key are recorded for every row.
        const first = new Map<string, { _value: unknown; _time: string }>();
        const chunks = chunk([...devices.keys()], this.bulkChunkSize);
        await mapLimit(chunks, this.bulkConcurrency, async (tlis) => {
            const measurements = new Set<string>();
            for (const tli of tlis) {
                for (const m of devices.get(tli)!) measurements.add(m);
            }
            const filter = measurements.size <= this.bulkMeasurementFilterMax
                ? [...measurements]
                : undefined;
            const rows = await this.query<LastRow>(this.buildBulkLastQuery(tlis, filter));
            for (const row of rows) {
                const path = row.path ?? "";
                const withPath = seriesKey(row._measurement, row.topLevelInstance, path);
                const noPath = seriesKey(row._measurement, row.topLevelInstance);
                if (!first.has(withPath)) first.set(withPath, row);
                if (!first.has(noPath)) first.set(noPath, row);
            }
        });

        for (const { leafId, key } of wanted) {
            const row = first.get(key);
            if (!row) continue;
            out.set(leafId, {
                elementId: leafId,
                isComposition: false,
                value: row._value,
                quality: "Good",
                timestamp: row._time,
            });
        }
        this.remember(out.values());
        return out;
    }

    /**
     * Build the bulk last-value query for a chunk of devices, and
     * optionally only those measurements. Uses `or` chains of equality
     * tests, directly after range(), because InfluxDB pushes those
     * down to the storage index.
     */
    buildBulkLastQuery(topLevelInstances: string[], measurements?: string[]): string {
        const anyOf = (tag: string, values: string[]) => values
            .map((v) => `r[${fluxString(tag)}] == ${fluxString(v)}`)
            .join(" or ");
        const measurementFilter = measurements
            ? `  |> filter(fn: (r) => ${anyOf("_measurement", measurements)})`
            : "";
        return [
            `from(bucket: ${fluxString(this.bucket)})`,
            `  |> range(start: -30d)`,
            measurementFilter,
            `  |> filter(fn: (r) => ${anyOf("topLevelInstance", topLevelInstances)})`,
            `  |> filter(fn: (r) => r["_field"] == "value")`,
            `  |> last()`,
        ].filter(Boolean).join("\n");
    }

    /**
     * Build a Flux query for historical data of a leaf metric.
     *
     * Returns null when the elementId has no MetricMeta. Without meta we
     * have no measurement name and no topLevelInstance to filter on, so
     * there is no safe query to build: the caller-supplied elementId must
     * never be used as a tag value itself.
     */
    buildFluxQuery(
        elementId: string,
        startTime: string,
        endTime: string,
    ): string | null {
        const meta = this.objectTree.getMetricMeta(elementId);
        if (!meta) return null;

        const measurement = `${meta.metricName}:${meta.typeSuffix}`;
        const pathFilter = meta.metricPath
            ? `  |> filter(fn: (r) => r["path"] == "${meta.metricPath}")`
            : "";

        return [
            `from(bucket: "${this.bucket}")`,
            `  |> range(start: ${startTime}, stop: ${endTime})`,
            `  |> filter(fn: (r) => r["_measurement"] == "${measurement}")`,
            `  |> filter(fn: (r) => r["topLevelInstance"] == "${meta.topLevelInstanceUuid}")`,
            pathFilter,
            `  |> filter(fn: (r) => r["_field"] == "value")`,
            `  |> sort(columns: ["_time"])`,
        ].filter(Boolean).join("\n");
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
        const query = this.buildFluxQuery(elementId, startTime, endTime);
        if (query === null) return [];

        const rows = await this.query<{ _value: unknown; _time: string }>(query);

        return rows.map((row) => ({
            value: row._value,
            quality: "Good" as const,
            timestamp: row._time,
        }));
    }
}

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

    constructor(opts: HistoryOpts) {
        this.bucket = opts.influxBucket;
        this.objectTree = opts.objectTree;
        this.bulkChunkSize = opts.bulkChunkSize ?? 100;
        this.bulkConcurrency = opts.bulkConcurrency ?? 4;

        const influx = new InfluxDB({
            url: opts.influxUrl,
            token: opts.influxToken,
        });
        this.queryApi = influx.getQueryApi(opts.influxOrg);
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

        const rows: Array<{ _value: unknown; _time: string }> =
            await this.queryApi.collectRows(query);

        if (rows.length === 0) return null;

        const row = rows[0];
        return {
            elementId,
            isComposition: false,
            value: row._value,
            quality: "Good",
            timestamp: row._time,
        };
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
     * Leaves without MetricMeta, or with no data in the window, are
     * absent from the returned map.
     */
    async getCurrentValues(leafIds: string[]): Promise<Map<string, I3xValueResponse>> {
        const wanted: Array<{ leafId: string; key: string }> = [];
        const devices = new Set<string>();
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
            devices.add(meta.topLevelInstanceUuid);
        }

        const out = new Map<string, I3xValueResponse>();
        if (wanted.length === 0) return out;

        // First row seen per key. Both the path-qualified and the
        // path-less key are recorded for every row.
        const first = new Map<string, { _value: unknown; _time: string }>();
        const chunks = chunk([...devices], this.bulkChunkSize);
        await mapLimit(chunks, this.bulkConcurrency, async (tlis) => {
            const rows = await this.queryApi.collectRows<LastRow>(this.buildBulkLastQuery(tlis));
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
        return out;
    }

    /**
     * Build the bulk last-value query for a chunk of devices. Uses an
     * `or` chain of equality tests because InfluxDB pushes those down
     * to the storage index.
     */
    buildBulkLastQuery(topLevelInstances: string[]): string {
        const tliFilter = topLevelInstances
            .map((tli) => `r["topLevelInstance"] == ${fluxString(tli)}`)
            .join(" or ");
        return [
            `from(bucket: ${fluxString(this.bucket)})`,
            `  |> range(start: -30d)`,
            `  |> filter(fn: (r) => ${tliFilter})`,
            `  |> filter(fn: (r) => r["_field"] == "value")`,
            `  |> last()`,
        ].join("\n");
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

        const rows: Array<{ _value: unknown; _time: string }> =
            await this.queryApi.collectRows(query);

        return rows.map((row) => ({
            value: row._value,
            quality: "Good" as const,
            timestamp: row._time,
        }));
    }
}

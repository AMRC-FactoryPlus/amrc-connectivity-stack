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
}

export class History {
    private bucket: string;
    private objectTree: ObjectTree;
    private queryApi: QueryApi;

    constructor(opts: HistoryOpts) {
        this.bucket = opts.influxBucket;
        this.objectTree = opts.objectTree;

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
     */
    async getCompositionValue(elementId: string, maxDepth: number = 1): Promise<I3xValueResponse | null> {
        const obj = this.objectTree.getObject(elementId);
        if (!obj) return null;

        const leafIds = this.objectTree.getDescendantLeafIds(elementId, maxDepth);
        const components: Record<string, I3xVqt> = {};

        // Query all leaves in parallel
        const results = await Promise.all(
            leafIds.map(async (leafId) => {
                const val = await this.getCurrentValue(leafId);
                return { leafId, val };
            }),
        );

        let latestTimestamp = "";
        for (const { leafId, val } of results) {
            if (val) {
                components[leafId] = {
                    value: val.value,
                    quality: val.quality,
                    timestamp: val.timestamp,
                };
                if (val.timestamp > latestTimestamp) {
                    latestTimestamp = val.timestamp;
                }
            }
        }

        if (Object.keys(components).length === 0) return null;

        return {
            elementId,
            isComposition: true,
            value: null,
            quality: "Good",
            timestamp: latestTimestamp,
            components,
        };
    }

    /**
     * Build a Flux query for historical data of a leaf metric.
     */
    buildFluxQuery(
        elementId: string,
        startTime: string,
        endTime: string,
    ): string {
        const meta = this.objectTree.getMetricMeta(elementId);

        if (meta) {
            // Leaf metric with metadata — precise query
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

        // Fallback: try using the elementId as a topLevelInstance UUID
        const instanceUuid = this.objectTree.getInstanceUuid(elementId) ?? elementId;
        return [
            `from(bucket: "${this.bucket}")`,
            `  |> range(start: ${startTime}, stop: ${endTime})`,
            `  |> filter(fn: (r) => r["topLevelInstance"] == "${instanceUuid}")`,
            `  |> filter(fn: (r) => r["_field"] == "value")`,
            `  |> sort(columns: ["_time"])`,
        ].join("\n");
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

        const query = this.buildFluxQuery(elementId, startTime, endTime);

        const rows: Array<{ _value: unknown; _time: string }> =
            await this.queryApi.collectRows(query);

        return rows.map((row) => ({
            value: row._value,
            quality: "Good" as const,
            timestamp: row._time,
        }));
    }
}

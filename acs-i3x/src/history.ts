/*
 * History — Translates i3X history requests into InfluxDB Flux queries
 * and maps results to I3xVqt arrays.
 */

import { InfluxDB } from "@influxdata/influxdb-client";
import type { QueryApi } from "@influxdata/influxdb-client";
import type { ObjectTree } from "./object-tree.js";
import type { I3xVqt } from "./types/i3x.js";

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
     * Build a Flux query string for the given elementId and time range.
     *
     * The query shape depends on the elementId format:
     * - Contains "/" -> leaf metric: filter by bottomLevelInstance
     * - UUID not found in ObjectTree (or found with null parent) -> device: filter by topLevelInstance
     * - UUID found in ObjectTree with a parent -> sub-object: filter by usesInstances regex
     */
    buildFluxQuery(
        elementId: string,
        startTime: string,
        endTime: string,
    ): string {
        let instanceFilter: string;

        if (elementId.includes("/")) {
            // Leaf metric: "instanceUuid/metricName"
            const instanceUuid = elementId.split("/")[0];
            instanceFilter =
                `  |> filter(fn: (r) => r["bottomLevelInstance"] == "${instanceUuid}")`;
        } else {
            // Check if this UUID is a sub-object in the ObjectTree
            const obj = this.objectTree.getObject(elementId);
            if (obj && obj.parentId !== null) {
                // Sub-object: use regex match on usesInstances tag
                instanceFilter =
                    `  |> filter(fn: (r) => r["usesInstances"] =~ /${elementId}/)`;
            } else {
                // Device-level (top-level or unknown): use topLevelInstance
                instanceFilter =
                    `  |> filter(fn: (r) => r["topLevelInstance"] == "${elementId}")`;
            }
        }

        return [
            `from(bucket: "${this.bucket}")`,
            `  |> range(start: ${startTime}, stop: ${endTime})`,
            instanceFilter,
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

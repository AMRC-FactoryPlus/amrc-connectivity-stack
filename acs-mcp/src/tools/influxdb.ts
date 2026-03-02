/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { InfluxDB } from "@influxdata/influxdb-client";

/**
 * ACS tag conventions used by historian-sparkplug and historian-uns.
 *
 * Sparkplug historian tags:
 *   topLevelInstance, bottomLevelInstance, usesInstances,
 *   topLevelSchema, bottomLevelSchema, usesSchemas,
 *   group, node, device, path, unit
 *
 * UNS historian additionally writes ISA-95 tags:
 *   enterprise, site, area, workCenter, workUnit
 *
 * Measurement names follow the pattern: metricName:typeSuffix
 *   :i = integer, :u = unsigned int, :d = float/double, :b = boolean, :s = string
 * All values are stored in a field called "value".
 */

// InfluxDB connection (initialised lazily from env vars)
let queryApi: ReturnType<InfluxDB["getQueryApi"]> | null = null;
let influxOrg: string | null = null;
let defaultBucket: string = "default";

function getInfluxConfig(): { available: boolean; message?: string } {
    const url = process.env.INFLUX_URL;
    const token = process.env.INFLUX_TOKEN;
    influxOrg = process.env.INFLUX_ORG ?? null;
    defaultBucket = process.env.INFLUX_BUCKET || "default";

    if (!url || !token || !influxOrg) {
        return {
            available: false,
            message:
                "InfluxDB is not configured. Set INFLUX_URL, INFLUX_TOKEN, and INFLUX_ORG environment variables to enable time-series query tools.",
        };
    }

    const influxDB = new InfluxDB({ url, token });
    queryApi = influxDB.getQueryApi(influxOrg);
    return { available: true };
}

/**
 * Execute a Flux query and return the rows as an array of objects.
 */
async function executeFluxQuery(
    query: string
): Promise<Record<string, unknown>[]> {
    if (!queryApi) {
        throw new Error("InfluxDB query API is not initialised.");
    }
    const rows: Record<string, unknown>[] = [];
    return new Promise((resolve, reject) => {
        queryApi!.queryRows(query, {
            next(row, tableMeta) {
                rows.push(tableMeta.toObject(row));
            },
            error(error) {
                reject(error);
            },
            complete() {
                resolve(rows);
            },
        });
    });
}

/**
 * Build a Flux filter expression from a map of tag → value pairs.
 * Only non-empty values are included.
 */
function buildTagFilters(
    tags: Record<string, string | undefined>
): string {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(tags)) {
        if (value !== undefined && value !== "") {
            parts.push(`r["${key}"] == "${value}"`);
        }
    }
    return parts.length > 0
        ? `  |> filter(fn: (r) => ${parts.join(" and ")})`
        : "";
}

/** Format query results as a readable table string. */
function formatResults(rows: Record<string, unknown>[]): string {
    if (rows.length === 0) return "No results found.";
    // Limit to 500 rows to avoid overwhelming output
    const limited = rows.slice(0, 500);
    const truncated = rows.length > 500;
    const formatted = JSON.stringify(limited, null, 2);
    return truncated
        ? `${formatted}\n\n(Showing 500 of ${rows.length} results. Use a more specific query or shorter time range to see all data.)`
        : formatted;
}

// Shared Zod schemas for ACS tag filters
const acsTagFilters = {
    group: z.string().optional().describe("Sparkplug group ID"),
    node: z.string().optional().describe("Sparkplug node ID"),
    device: z.string().optional().describe("Sparkplug device ID"),
    topLevelSchema: z
        .string()
        .optional()
        .describe("Top-level Schema_UUID for the device"),
    topLevelInstance: z
        .string()
        .optional()
        .describe("Top-level Instance_UUID for the device"),
    path: z
        .string()
        .optional()
        .describe('Metric path within the device (e.g. "CNC/Axes/1/Position")'),
    enterprise: z.string().optional().describe("ISA-95 Enterprise name"),
    site: z.string().optional().describe("ISA-95 Site name"),
    area: z.string().optional().describe("ISA-95 Area name"),
    workCenter: z.string().optional().describe("ISA-95 Work Center name"),
    workUnit: z.string().optional().describe("ISA-95 Work Unit name"),
};

/**
 * Register InfluxDB tools with the MCP server.
 * InfluxDB connection is optional — tools return helpful errors if not configured.
 */
export function registerInfluxDBTools(server: McpServer): void {
    const config = getInfluxConfig();

    const notConfiguredResponse = {
        content: [
            {
                type: "text" as const,
                text:
                    config.message ??
                    "InfluxDB is not configured.",
            },
        ],
        isError: true,
    };

    // -------------------------------------------------------------------------
    // influx_query — Execute a raw Flux query
    // -------------------------------------------------------------------------
    server.tool(
        "influx_query",
        "Execute a raw Flux query against the ACS InfluxDB instance. Use this when you need full control over the query. " +
        "Remember: ACS measurements are named 'metricName:typeSuffix' (e.g. 'Temperature:d') and all values are in a field called 'value'. " +
        "Available tags include: group, node, device, topLevelSchema, bottomLevelSchema, usesSchemas, topLevelInstance, bottomLevelInstance, usesInstances, path, unit, " +
        "and ISA-95 tags: enterprise, site, area, workCenter, workUnit.",
        {
            query: z.string().describe("The Flux query to execute"),
        },
        async ({ query }) => {
            if (!config.available) return notConfiguredResponse;
            try {
                const rows = await executeFluxQuery(query);
                return {
                    content: [
                        {
                            type: "text",
                            text: formatResults(rows),
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error executing Flux query: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );

    // -------------------------------------------------------------------------
    // influx_list_buckets — List available buckets
    // -------------------------------------------------------------------------
    server.tool(
        "influx_list_buckets",
        "List all available InfluxDB buckets in the ACS instance.",
        {},
        async () => {
            if (!config.available) return notConfiguredResponse;
            try {
                const query = "buckets()";
                const rows = await executeFluxQuery(query);
                const buckets = rows.map((r) => ({
                    name: r.name,
                    id: r.id,
                    retentionPolicy: r.retentionPolicy,
                    retentionPeriod: r.retentionPeriod,
                }));
                return {
                    content: [
                        {
                            type: "text",
                            text:
                                buckets.length > 0
                                    ? `Found ${buckets.length} buckets:\n\n${JSON.stringify(buckets, null, 2)}`
                                    : "No buckets found.",
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error listing buckets: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );

    // -------------------------------------------------------------------------
    // influx_list_measurements — List measurements in a bucket
    // -------------------------------------------------------------------------
    server.tool(
        "influx_list_measurements",
        "List all measurements in an InfluxDB bucket. " +
        "ACS measurements follow the naming pattern 'metricName:typeSuffix' " +
        "(e.g. 'Temperature:d' for a double, 'Running:b' for a boolean). " +
        "You can optionally filter by ACS tags to find measurements for a specific device or schema.",
        {
            bucket: z
                .string()
                .optional()
                .describe(
                    `Bucket name (defaults to "${defaultBucket}")`
                ),
            ...acsTagFilters,
        },
        async ({ bucket, ...tags }) => {
            if (!config.available) return notConfiguredResponse;
            try {
                const b = bucket || defaultBucket;
                const tagFilter = buildTagFilters(tags);
                const query = `
import "influxdata/influxdb/schema"
schema.measurements(bucket: "${b}")`.trim();
                // If we have tag filters, use a different approach
                const finalQuery = tagFilter
                    ? `from(bucket: "${b}")
  |> range(start: -30d)
${tagFilter}
  |> keep(columns: ["_measurement"])
  |> distinct(column: "_measurement")`
                    : query;

                const rows = await executeFluxQuery(finalQuery);
                const measurements = rows.map(
                    (r) => r._value ?? r._measurement ?? r.name
                );
                const unique = [...new Set(measurements)];
                return {
                    content: [
                        {
                            type: "text",
                            text:
                                unique.length > 0
                                    ? `Found ${unique.length} measurements in bucket "${b}":\n\n${unique.join("\n")}`
                                    : `No measurements found in bucket "${b}".`,
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error listing measurements: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );

    // -------------------------------------------------------------------------
    // influx_get_latest — Get latest values for a device/metric
    // -------------------------------------------------------------------------
    server.tool(
        "influx_get_latest",
        "Get the most recent value(s) from InfluxDB, filtered by ACS tags. " +
        "Use this to check the current state of a device or metric. " +
        "Returns the latest data point(s) with all associated tags.",
        {
            bucket: z
                .string()
                .optional()
                .describe(
                    `Bucket name (defaults to "${defaultBucket}")`
                ),
            measurement: z
                .string()
                .optional()
                .describe(
                    'Measurement name including type suffix (e.g. "Temperature:d")'
                ),
            limit: z
                .number()
                .optional()
                .describe("Max number of results to return (default 10)"),
            ...acsTagFilters,
        },
        async ({ bucket, measurement, limit, ...tags }) => {
            if (!config.available) return notConfiguredResponse;
            try {
                const b = bucket || defaultBucket;
                const n = limit ?? 10;
                const tagFilter = buildTagFilters(tags);
                const measurementFilter = measurement
                    ? `  |> filter(fn: (r) => r["_measurement"] == "${measurement}")`
                    : "";

                const query = `from(bucket: "${b}")
  |> range(start: -30d)
${measurementFilter}
${tagFilter}
  |> last()
  |> limit(n: ${n})`;

                const rows = await executeFluxQuery(query);
                return {
                    content: [
                        {
                            type: "text",
                            text: formatResults(rows),
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error fetching latest values: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );

    // -------------------------------------------------------------------------
    // influx_get_history — Get time-range history for a metric
    // -------------------------------------------------------------------------
    server.tool(
        "influx_get_history",
        "Get historical time-series data from InfluxDB over a time range, filtered by ACS tags. " +
        "Use this to analyse trends, review device behaviour, or investigate issues. " +
        "Returns data points with timestamps and all associated tags.",
        {
            bucket: z
                .string()
                .optional()
                .describe(
                    `Bucket name (defaults to "${defaultBucket}")`
                ),
            measurement: z
                .string()
                .optional()
                .describe(
                    'Measurement name including type suffix (e.g. "Temperature:d")'
                ),
            start: z
                .string()
                .describe(
                    'Start of the time range. Supports relative (e.g. "-1h", "-7d") or absolute (RFC3339, e.g. "2024-01-01T00:00:00Z").'
                ),
            stop: z
                .string()
                .optional()
                .describe(
                    'End of the time range (default: now). Supports relative or absolute.'
                ),
            aggregateWindow: z
                .string()
                .optional()
                .describe(
                    'Optional: aggregate data into windows (e.g. "1m", "1h", "1d"). Uses mean by default.'
                ),
            aggregateFn: z
                .enum(["mean", "median", "sum", "count", "min", "max", "first", "last"])
                .optional()
                .describe(
                    "Aggregate function to use with aggregateWindow (default: mean)"
                ),
            limit: z
                .number()
                .optional()
                .describe("Max number of results to return (default 500)"),
            ...acsTagFilters,
        },
        async ({
            bucket,
            measurement,
            start,
            stop,
            aggregateWindow,
            aggregateFn,
            limit,
            ...tags
        }) => {
            if (!config.available) return notConfiguredResponse;
            try {
                const b = bucket || defaultBucket;
                const n = limit ?? 500;
                const tagFilter = buildTagFilters(tags);
                const measurementFilter = measurement
                    ? `  |> filter(fn: (r) => r["_measurement"] == "${measurement}")`
                    : "";
                const stopClause = stop ? `, stop: ${stop.startsWith("-") ? stop : `${stop}`}` : "";
                const rangeStart = start.startsWith("-") ? start : start;

                let aggregation = "";
                if (aggregateWindow) {
                    const fn = aggregateFn ?? "mean";
                    aggregation = `  |> aggregateWindow(every: ${aggregateWindow}, fn: ${fn}, createEmpty: false)`;
                }

                const query = `from(bucket: "${b}")
  |> range(start: ${rangeStart}${stopClause})
${measurementFilter}
${tagFilter}
  |> filter(fn: (r) => r["_field"] == "value")
${aggregation}
  |> limit(n: ${n})`;

                const rows = await executeFluxQuery(query);
                return {
                    content: [
                        {
                            type: "text",
                            text: formatResults(rows),
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error fetching history: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );

    // -------------------------------------------------------------------------
    // influx_list_tag_values — List unique values for a tag
    // -------------------------------------------------------------------------
    server.tool(
        "influx_list_tag_values",
        "List unique values for a specific tag in an InfluxDB bucket. " +
        "Use this for discovery — e.g. list all Sparkplug groups, nodes, devices, " +
        "schema UUIDs, instance UUIDs, ISA-95 enterprises, sites, etc. " +
        "Available ACS tags: group, node, device, topLevelSchema, bottomLevelSchema, " +
        "usesSchemas, topLevelInstance, bottomLevelInstance, usesInstances, path, unit, " +
        "enterprise, site, area, workCenter, workUnit.",
        {
            bucket: z
                .string()
                .optional()
                .describe(
                    `Bucket name (defaults to "${defaultBucket}")`
                ),
            tag: z
                .string()
                .describe(
                    'The tag key to list values for (e.g. "group", "device", "topLevelSchema", "enterprise")'
                ),
            ...acsTagFilters,
        },
        async ({ bucket, tag, ...tags }) => {
            if (!config.available) return notConfiguredResponse;
            try {
                const b = bucket || defaultBucket;
                // Remove the tag we're querying from the filter tags
                const filterTags = { ...tags };
                delete filterTags[tag as keyof typeof filterTags];
                const tagFilter = buildTagFilters(filterTags);

                const query = `import "influxdata/influxdb/schema"
schema.tagValues(bucket: "${b}", tag: "${tag}")`;

                // If we have additional filters, use a manual approach
                const finalQuery = tagFilter
                    ? `from(bucket: "${b}")
  |> range(start: -30d)
${tagFilter}
  |> keep(columns: ["${tag}"])
  |> distinct(column: "${tag}")`
                    : query;

                const rows = await executeFluxQuery(finalQuery);
                const values = rows.map((r) => r._value ?? r[tag]);
                const unique = [...new Set(values)].filter(
                    (v) => v !== undefined && v !== null && v !== ""
                );

                return {
                    content: [
                        {
                            type: "text",
                            text:
                                unique.length > 0
                                    ? `Found ${unique.length} unique values for tag "${tag}" in bucket "${b}":\n\n${unique.join("\n")}`
                                    : `No values found for tag "${tag}" in bucket "${b}".`,
                        },
                    ],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error listing tag values: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                    isError: true,
                };
            }
        }
    );
}

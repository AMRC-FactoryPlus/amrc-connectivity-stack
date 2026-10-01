/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * Unit tests for the bulk current-value path in History
 * (getCurrentValues, getValues, getCompositionValue). InfluxDB is
 * mocked here; test/history-influx.test.ts checks the same path
 * against a real InfluxDB.
 */

import { jest } from "@jest/globals";
import { History } from "../lib/history.js";
import type { ObjectTree, MetricMeta } from "../lib/object-tree.js";

type Row = {
    _measurement: string;
    topLevelInstance: string;
    path?: string;
    _value: unknown;
    _time: string;
};

function meta(tli: string, metricName: string, metricPath = "", typeSuffix = "d"): MetricMeta {
    return { topLevelInstanceUuid: tli, metricPath, metricName, sparkplugType: "Double", typeSuffix };
}

/*
 * A small tree:
 *   dev-A (composition)
 *     a-temp            leaf, no path       Temp:d
 *     a-status (comp)
 *       a-status-rpm    leaf, path Status   RPM:d
 *       a-status-deep (comp)
 *         a-deep-x      leaf, path Status/Deep  X:d
 *   dev-B (composition)
 *     b-temp            leaf, no path       Temp:d
 *   orphan-leaf         leaf with no meta
 */
function makeTree() {
    const objects: Record<string, { isComposition: boolean }> = {
        "dev-A": { isComposition: true },
        "a-temp": { isComposition: false },
        "a-status": { isComposition: true },
        "a-status-rpm": { isComposition: false },
        "a-status-deep": { isComposition: true },
        "a-deep-x": { isComposition: false },
        "dev-B": { isComposition: true },
        "b-temp": { isComposition: false },
        "orphan-leaf": { isComposition: false },
    };
    const children: Record<string, string[]> = {
        "dev-A": ["a-temp", "a-status"],
        "a-status": ["a-status-rpm", "a-status-deep"],
        "a-status-deep": ["a-deep-x"],
        "dev-B": ["b-temp"],
    };
    const metas: Record<string, MetricMeta> = {
        "a-temp": meta("tli-A", "Temp"),
        "a-status-rpm": meta("tli-A", "RPM", "Status"),
        "a-deep-x": meta("tli-A", "X", "Status/Deep"),
        "b-temp": meta("tli-B", "Temp"),
    };
    // Same algorithm as ObjectTree.getDescendantLeafIds.
    const getDescendantLeafIds = (id: string, maxDepth = 0, depth = 0): string[] => {
        if (maxDepth > 0 && depth >= maxDepth) return [];
        const out: string[] = [];
        for (const c of children[id] ?? []) {
            if (!objects[c].isComposition) out.push(c);
            else out.push(...getDescendantLeafIds(c, maxDepth, depth + 1));
        }
        return out;
    };
    return {
        getObject: jest.fn((id: string) => objects[id] ? { elementId: id, ...objects[id] } : undefined),
        getMetricMeta: jest.fn((id: string) => metas[id]),
        getDescendantLeafIds: jest.fn(getDescendantLeafIds),
    } as unknown as ObjectTree;
}

function makeHistory(rows: Row[] | ((q: string) => Row[] | Promise<Row[]>), opts: {
    tree?: ObjectTree; bulkChunkSize?: number; bulkConcurrency?: number; bucket?: string;
} = {}) {
    const history = new History({
        influxUrl: "http://influx:8086",
        influxToken: "t",
        influxOrg: "o",
        influxBucket: opts.bucket ?? "default",
        objectTree: opts.tree ?? makeTree(),
        bulkChunkSize: opts.bulkChunkSize,
        bulkConcurrency: opts.bulkConcurrency,
    });
    const collectRows = jest.fn(async (q: string) =>
        typeof rows === "function" ? rows(q) : rows);
    (history as any).queryApi = { collectRows };
    return { history, collectRows };
}

const T1 = "2026-09-30T10:00:00.000Z";
const T2 = "2026-09-30T11:00:00.000Z";
const T3 = "2026-09-30T12:00:00.000Z";

describe("History bulk current values", () => {
    describe("getCurrentValues", () => {
        it("reads every leaf of a device with one query", async () => {
            const { history, collectRows } = makeHistory([
                { _measurement: "Temp:d", topLevelInstance: "tli-A", _value: 20, _time: T1 },
                { _measurement: "RPM:d", topLevelInstance: "tli-A", path: "Status", _value: 900, _time: T2 },
                { _measurement: "X:d", topLevelInstance: "tli-A", path: "Status/Deep", _value: 1, _time: T3 },
            ]);
            const out = await history.getCurrentValues(["a-temp", "a-status-rpm", "a-deep-x"]);
            expect(collectRows).toHaveBeenCalledTimes(1);
            expect(out.get("a-temp")).toEqual({ elementId: "a-temp", isComposition: false, value: 20, quality: "Good", timestamp: T1 });
            expect(out.get("a-status-rpm")).toEqual({ elementId: "a-status-rpm", isComposition: false, value: 900, quality: "Good", timestamp: T2 });
            expect(out.get("a-deep-x")?.value).toBe(1);
        });

        it("builds a query with the same window, field filter and last() as the per-leaf query", async () => {
            const { history, collectRows } = makeHistory([]);
            await history.getCurrentValues(["a-temp", "b-temp"]);
            const q = collectRows.mock.calls[0][0];
            expect(q).toContain(`from(bucket: "default")`);
            expect(q).toContain(`|> range(start: -30d)`);
            expect(q).toContain(`r["topLevelInstance"] == "tli-A" or r["topLevelInstance"] == "tli-B"`);
            expect(q).toContain(`|> filter(fn: (r) => r["_field"] == "value")`);
            expect(q).toMatch(/\|> last\(\)$/);
        });

        it("takes the first row per series when a leaf has several series", async () => {
            // Two series for the same leaf, e.g. before and after a
            // device rename. The per-leaf query returns rows[0], so the
            // first row wins even though the second is newer.
            const { history } = makeHistory([
                { _measurement: "RPM:d", topLevelInstance: "tli-A", path: "Status", _value: 1, _time: T1 },
                { _measurement: "RPM:d", topLevelInstance: "tli-A", path: "Status", _value: 2, _time: T3 },
            ]);
            const out = await history.getCurrentValues(["a-status-rpm"]);
            expect(out.get("a-status-rpm")?.value).toBe(1);
            expect(out.get("a-status-rpm")?.timestamp).toBe(T1);
        });

        it("matches a leaf with a path only on that exact path", async () => {
            const { history } = makeHistory([
                { _measurement: "RPM:d", topLevelInstance: "tli-A", path: "Other", _value: 1, _time: T1 },
                { _measurement: "RPM:d", topLevelInstance: "tli-A", _value: 2, _time: T1 },
            ]);
            const out = await history.getCurrentValues(["a-status-rpm"]);
            expect(out.has("a-status-rpm")).toBe(false);
        });

        it("matches a leaf without a path on the first row of any path, as the unfiltered per-leaf query does", async () => {
            const { history } = makeHistory([
                { _measurement: "Temp:d", topLevelInstance: "tli-A", path: "Deep/Er", _value: 5, _time: T1 },
                { _measurement: "Temp:d", topLevelInstance: "tli-A", _value: 6, _time: T3 },
            ]);
            const out = await history.getCurrentValues(["a-temp"]);
            expect(out.get("a-temp")?.value).toBe(5);
        });

        it("does not match another device's row", async () => {
            const { history } = makeHistory([
                { _measurement: "Temp:d", topLevelInstance: "tli-B", _value: 7, _time: T1 },
            ]);
            const out = await history.getCurrentValues(["a-temp", "b-temp"]);
            expect(out.has("a-temp")).toBe(false);
            expect(out.get("b-temp")?.value).toBe(7);
        });

        it("skips leaves without MetricMeta and issues no query when none have it", async () => {
            const { history, collectRows } = makeHistory([]);
            const out = await history.getCurrentValues(["orphan-leaf", "not-an-object"]);
            expect(out.size).toBe(0);
            expect(collectRows).not.toHaveBeenCalled();
        });

        it("chunks devices and bounds the number of queries in flight", async () => {
            const tlis = Array.from({ length: 23 }, (_, i) => `tli-${i}`);
            const tree = {
                getObject: () => ({ isComposition: false }),
                getMetricMeta: (id: string) => meta(id, "Temp"),
                getDescendantLeafIds: () => [],
            } as unknown as ObjectTree;
            let inFlight = 0;
            let maxInFlight = 0;
            const { history, collectRows } = makeHistory(async (q: string) => {
                inFlight++;
                maxInFlight = Math.max(maxInFlight, inFlight);
                await new Promise((r) => setTimeout(r, 5));
                inFlight--;
                return tlis
                    .filter((t) => q.includes(`"${t}"`))
                    .map((t) => ({ _measurement: "Temp:d", topLevelInstance: t, _value: t, _time: T1 }));
            }, { tree, bulkChunkSize: 5, bulkConcurrency: 2 });

            const out = await history.getCurrentValues(tlis);
            expect(collectRows).toHaveBeenCalledTimes(5); // ceil(23 / 5)
            expect(maxInFlight).toBe(2);
            expect(out.size).toBe(23);
            for (const t of tlis) expect(out.get(t)?.value).toBe(t);
        });

        it("rejects when a query fails, like the per-leaf path", async () => {
            const { history } = makeHistory(() => { throw new Error("Request timed out"); });
            await expect(history.getCurrentValues(["a-temp"])).rejects.toThrow("Request timed out");
        });

        it("quotes tag values and the bucket as Flux string literals", async () => {
            const tree = {
                getObject: () => ({ isComposition: false }),
                getMetricMeta: () => meta(`we"ird\\${"$"}{x}`, "Temp"),
                getDescendantLeafIds: () => [],
            } as unknown as ObjectTree;
            const { history, collectRows } = makeHistory([], { tree, bucket: `b"k` });
            await history.getCurrentValues(["x"]);
            const q = collectRows.mock.calls[0][0];
            expect(q).toContain(`from(bucket: "b\\"k")`);
            expect(q).toContain(`r["topLevelInstance"] == "we\\"ird\\\\\\\${x}"`);
        });

        it("filters on the chunk's measurements, directly after range()", async () => {
            const { history, collectRows } = makeHistory([]);
            await history.getCurrentValues(["a-temp", "a-status-rpm", "b-temp"]);
            expect(collectRows.mock.calls[0][0].split("\n").slice(1, 4)).toEqual([
                `  |> range(start: -30d)`,
                `  |> filter(fn: (r) => r["_measurement"] == "Temp:d" or r["_measurement"] == "RPM:d")`,
                `  |> filter(fn: (r) => r["topLevelInstance"] == "tli-A" or r["topLevelInstance"] == "tli-B")`,
            ]);
        });

        it("filters each chunk only on the measurements its own devices need", async () => {
            const { history, collectRows } = makeHistory([], { bulkChunkSize: 1 });
            await history.getCurrentValues(["a-status-rpm", "b-temp"]);
            const queries = collectRows.mock.calls.map((c) => c[0]);
            expect(queries[0]).toContain(`r["_measurement"] == "RPM:d")`);
            expect(queries[0]).not.toContain(`Temp:d`);
            expect(queries[1]).toContain(`r["_measurement"] == "Temp:d")`);
            expect(queries[1]).not.toContain(`RPM:d`);
        });

        it("drops the measurement filter above bulkMeasurementFilterMax", async () => {
            const leaves = Array.from({ length: 51 }, (_, i) => `m${i}`);
            const tree = {
                getObject: () => ({ isComposition: false }),
                getMetricMeta: (id: string) => meta("tli-A", id),
                getDescendantLeafIds: () => [],
            } as unknown as ObjectTree;
            const { history, collectRows } = makeHistory([], { tree });

            await history.getCurrentValues(leaves.slice(0, 50));
            expect(collectRows.mock.calls[0][0]).toContain(`r["_measurement"] == "m49:d")`);

            await history.getCurrentValues(leaves);
            expect(collectRows.mock.calls[1][0]).not.toContain(`_measurement`);
            expect(collectRows.mock.calls[1][0]).toBe(history.buildBulkLastQuery(["tli-A"]));
        });

        it("quotes measurement names as Flux string literals", () => {
            const { history } = makeHistory([]);
            const q = history.buildBulkLastQuery(["tli-A"], [`a"b:s`, `c\\d:s`, `e${"$"}{f}:s`]);
            expect(q).toContain(
                `filter(fn: (r) => r["_measurement"] == "a\\"b:s" or r["_measurement"] == "c\\\\d:s"`
                + ` or r["_measurement"] == "e\\${"$"}{f}:s")`);
        });
    });

    describe("getValues", () => {
        const rows: Row[] = [
            { _measurement: "Temp:d", topLevelInstance: "tli-A", _value: 20, _time: T1 },
            { _measurement: "RPM:d", topLevelInstance: "tli-A", path: "Status", _value: 900, _time: T3 },
            { _measurement: "X:d", topLevelInstance: "tli-A", path: "Status/Deep", _value: 1, _time: T2 },
            { _measurement: "Temp:d", topLevelInstance: "tli-B", _value: 30, _time: T2 },
        ];

        it("reads a whole batch of compositions and leaves with one query", async () => {
            const { history, collectRows } = makeHistory(rows);
            const out = await history.getValues(["dev-A", "dev-B", "a-temp"], 0);
            expect(collectRows).toHaveBeenCalledTimes(1);
            expect(out.get("a-temp")?.value).toBe(20);
            expect(out.get("dev-B")).toEqual({
                elementId: "dev-B", isComposition: true, value: null, quality: "Good", timestamp: T2,
                components: { "b-temp": { value: 30, quality: "Good", timestamp: T2 } },
            });
        });

        it("assembles compositions to maxDepth, in leaf order, with the latest timestamp", async () => {
            const { history } = makeHistory(rows);
            const d1 = (await history.getValues(["dev-A"], 1)).get("dev-A")!;
            expect(Object.keys(d1.components!)).toEqual(["a-temp"]);
            expect(d1.timestamp).toBe(T1);

            const d2 = (await history.getValues(["dev-A"], 2)).get("dev-A")!;
            expect(Object.keys(d2.components!)).toEqual(["a-temp", "a-status-rpm"]);
            expect(d2.timestamp).toBe(T3);

            const d0 = (await history.getValues(["dev-A"], 0)).get("dev-A")!;
            expect(Object.keys(d0.components!)).toEqual(["a-temp", "a-status-rpm", "a-deep-x"]);
        });

        it("returns null for unknown ids, leaves without meta, and compositions with no data", async () => {
            const { history } = makeHistory([]);
            const out = await history.getValues(["nope", "orphan-leaf", "dev-A"], 0);
            expect(out.get("nope")).toBeNull();
            expect(out.get("orphan-leaf")).toBeNull();
            expect(out.get("dev-A")).toBeNull();
        });

        it("leaves out components with no data", async () => {
            const { history } = makeHistory([rows[1]]);
            const d = (await history.getValues(["dev-A"], 0)).get("dev-A")!;
            expect(Object.keys(d.components!)).toEqual(["a-status-rpm"]);
        });

        it("handles repeated ids", async () => {
            const { history, collectRows } = makeHistory(rows);
            const out = await history.getValues(["dev-B", "dev-B"], 1);
            expect(out.size).toBe(1);
            expect(collectRows).toHaveBeenCalledTimes(1);
        });
    });

    describe("InfluxDB client", () => {
        it("sets an explicit 10 s query timeout, or the one given", () => {
            const timeout = (queryTimeout?: number) => {
                const history = new History({
                    influxUrl: "http://influx:8086", influxToken: "t", influxOrg: "o",
                    influxBucket: "default", objectTree: makeTree(), queryTimeout,
                });
                // The client keeps its connection options on the transport.
                return (history as any).queryApi.transport.defaultOptions.timeout;
            };
            expect(timeout()).toBe(10_000);
            expect(timeout(2_500)).toBe(2_500);
        });
    });

    describe("getCompositionValue", () => {
        it("uses one query for the whole composition and defaults maxDepth to 1", async () => {
            const tree = makeTree();
            const { history, collectRows } = makeHistory([
                { _measurement: "Temp:d", topLevelInstance: "tli-A", _value: 20, _time: T1 },
                { _measurement: "RPM:d", topLevelInstance: "tli-A", path: "Status", _value: 900, _time: T3 },
            ], { tree });
            const v = await history.getCompositionValue("dev-A");
            expect(collectRows).toHaveBeenCalledTimes(1);
            expect((tree.getDescendantLeafIds as jest.Mock)).toHaveBeenCalledWith("dev-A", 1);
            expect(Object.keys(v!.components!)).toEqual(["a-temp"]);
        });

        it("returns null for an unknown id", async () => {
            const { history } = makeHistory([]);
            expect(await history.getCompositionValue("nope")).toBeNull();
        });
    });
});

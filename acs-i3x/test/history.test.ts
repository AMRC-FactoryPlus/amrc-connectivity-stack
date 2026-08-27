/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { jest } from "@jest/globals";
import { History } from "../lib/history.js";
import type { ObjectTree } from "../lib/object-tree.js";
import type { I3xVqt } from "../lib/types/i3x.js";

/*
 * Mock QueryApi: collectRows returns whatever we configure.
 */
function createMockQueryApi() {
    return {
        collectRows: jest.fn<(query: string) => Promise<any[]>>()
            .mockResolvedValue([]),
    };
}

/*
 * Minimal mock ObjectTree: provides getObject, getMetricMeta,
 * and getDescendantLeafIds stubs.
 */
function createMockObjectTree(opts?: {
    knownUuids?: Set<string>;
    metricMeta?: Map<string, any>;
}): ObjectTree {
    const knownUuids = opts?.knownUuids ?? new Set<string>();
    const metricMeta = opts?.metricMeta ?? new Map<string, any>();

    return {
        getObject: jest.fn((elementId: string) => {
            if (knownUuids.has(elementId)) {
                return {
                    elementId,
                    displayName: elementId,
                    typeElementId: "some-type",
                    parentId: "some-parent",
                    isComposition: true,
                    isExtended: false,
                };
            }
            return undefined;
        }),
        getMetricMeta: jest.fn((elementId: string) => metricMeta.get(elementId)),
        getDescendantLeafIds: jest.fn((_elementId: string) => []),
    } as unknown as ObjectTree;
}

const BUCKET = "factory-plus";
const INFLUX_URL = "http://influx:8086";
const INFLUX_TOKEN = "test-token";
const INFLUX_ORG = "amrc";

/*
 * MetricMeta for a leaf, keyed by elementId. Anything not in here has
 * no meta and must not produce a query.
 */
function leafMeta(elementId: string, metricName: string = "Temperature") {
    return new Map([
        [elementId, {
            topLevelInstanceUuid: "aaaa-1111-2222-3333",
            metricPath: "",
            metricName,
            sparkplugType: "Double",
            typeSuffix: "d",
        }],
    ]);
}

function makeHistory(opts?: {
    queryApi?: ReturnType<typeof createMockQueryApi>;
    objectTree?: ObjectTree;
}) {
    const queryApi = opts?.queryApi ?? createMockQueryApi();
    const objectTree = opts?.objectTree ?? createMockObjectTree();

    const history = new History({
        influxUrl: INFLUX_URL,
        influxToken: INFLUX_TOKEN,
        influxOrg: INFLUX_ORG,
        influxBucket: BUCKET,
        objectTree,
    });

    // Inject the mock queryApi for testing
    (history as any).queryApi = queryApi;

    return { history, queryApi, objectTree };
}

describe("History", () => {
    describe("buildFluxQuery", () => {
        it("for a leaf metric with MetricMeta uses measurement name and topLevelInstance + path filters", () => {
            const metricMeta = new Map([
                ["leaf-element-1", {
                    topLevelInstanceUuid: "aaaa-1111-2222-3333",
                    metricPath: "Phases/1",
                    metricName: "Temperature",
                    sparkplugType: "FloatLE",
                    typeSuffix: "d",
                }],
            ]);
            const objectTree = createMockObjectTree({ metricMeta });
            const { history } = makeHistory({ objectTree });

            const query = history.buildFluxQuery(
                "leaf-element-1",
                "2024-01-01T00:00:00Z",
                "2024-01-02T00:00:00Z",
            );

            expect(query).toContain(`from(bucket: "${BUCKET}")`);
            expect(query).toContain(`r["_measurement"] == "Temperature:d"`);
            expect(query).toContain(`r["topLevelInstance"] == "aaaa-1111-2222-3333"`);
            expect(query).toContain(`r["path"] == "Phases/1"`);
            expect(query).toContain(`r["_field"] == "value"`);
            expect(query).toContain("sort(columns: [\"_time\"])");
        });

        it("for a leaf metric without metricPath omits path filter", () => {
            const metricMeta = new Map([
                ["leaf-no-path", {
                    topLevelInstanceUuid: "bbbb-2222-3333-4444",
                    metricPath: "",
                    metricName: "Voltage",
                    sparkplugType: "Double",
                    typeSuffix: "d",
                }],
            ]);
            const objectTree = createMockObjectTree({ metricMeta });
            const { history } = makeHistory({ objectTree });

            const query = history.buildFluxQuery(
                "leaf-no-path",
                "2024-01-01T00:00:00Z",
                "2024-01-02T00:00:00Z",
            );

            expect(query).toContain(`r["_measurement"] == "Voltage:d"`);
            expect(query).toContain(`r["topLevelInstance"] == "bbbb-2222-3333-4444"`);
            expect(query).not.toContain("path");
        });

        it("returns null for an elementId with no MetricMeta", () => {
            const objectTree = createMockObjectTree();
            const { history } = makeHistory({ objectTree });

            const query = history.buildFluxQuery(
                "device-uuid-1234",
                "2024-01-01T00:00:00Z",
                "2024-01-02T00:00:00Z",
            );

            expect(query).toBeNull();
        });

        it("never interpolates an unknown elementId into a tag filter", () => {
            const objectTree = createMockObjectTree();
            const { history } = makeHistory({ objectTree });

            // A device object UUID is also its InfluxDB topLevelInstance
            // tag value, so this must not become a query at all.
            const query = history.buildFluxQuery(
                "e1f2a3b4-5566-7788-99aa-bbccddeeff00",
                "2024-01-01T00:00:00Z",
                "2024-01-02T00:00:00Z",
            );

            expect(query).toBeNull();
        });

        it("includes correct bucket, startTime, and endTime", () => {
            const metricMeta = new Map([
                ["leaf-element-1", {
                    topLevelInstanceUuid: "aaaa-1111-2222-3333",
                    metricPath: "Phases/1",
                    metricName: "Temperature",
                    sparkplugType: "FloatLE",
                    typeSuffix: "d",
                }],
            ]);
            const objectTree = createMockObjectTree({ metricMeta });
            const { history } = makeHistory({ objectTree });
            const start = "2024-06-01T12:00:00Z";
            const end = "2024-06-02T12:00:00Z";

            const query = history.buildFluxQuery(
                "leaf-element-1",
                start,
                end,
            );

            expect(query).toContain(`from(bucket: "${BUCKET}")`);
            expect(query).toContain(`range(start: ${start}, stop: ${end})`);
        });
    });

    describe("queryHistory", () => {
        it("maps InfluxDB rows to I3xVqt array", async () => {
            const mockQueryApi = createMockQueryApi();
            const rows = [
                { _value: 42.5, _time: "2024-01-01T00:00:00Z" },
                { _value: 43.1, _time: "2024-01-01T00:01:00Z" },
                { _value: 44.0, _time: "2024-01-01T00:02:00Z" },
            ];
            mockQueryApi.collectRows.mockResolvedValue(rows);

            const objectTree = createMockObjectTree({
                metricMeta: leafMeta("device-uuid/Temperature"),
            });
            const { history } = makeHistory({ queryApi: mockQueryApi, objectTree });

            const result = await history.queryHistory(
                "device-uuid/Temperature",
                "2024-01-01T00:00:00Z",
                "2024-01-02T00:00:00Z",
            );

            expect(result).toHaveLength(3);
            expect(result[0]).toEqual({
                value: 42.5,
                quality: "Good",
                timestamp: "2024-01-01T00:00:00Z",
            });
            expect(result[1]).toEqual({
                value: 43.1,
                quality: "Good",
                timestamp: "2024-01-01T00:01:00Z",
            });
            expect(result[2]).toEqual({
                value: 44.0,
                quality: "Good",
                timestamp: "2024-01-01T00:02:00Z",
            });
        });

        it("returns empty array for no results", async () => {
            const mockQueryApi = createMockQueryApi();
            mockQueryApi.collectRows.mockResolvedValue([]);

            const objectTree = createMockObjectTree({
                metricMeta: leafMeta("device-uuid/Temperature"),
            });
            const { history } = makeHistory({ queryApi: mockQueryApi, objectTree });

            const result = await history.queryHistory(
                "device-uuid/Temperature",
                "2024-01-01T00:00:00Z",
                "2024-01-02T00:00:00Z",
            );

            expect(result).toEqual([]);
            expect(result).toHaveLength(0);
        });

        it("quality is always 'Good' for historical data", async () => {
            const mockQueryApi = createMockQueryApi();
            const rows = [
                { _value: 0, _time: "2024-01-01T00:00:00Z" },
                { _value: null, _time: "2024-01-01T00:01:00Z" },
                { _value: "string-val", _time: "2024-01-01T00:02:00Z" },
                { _value: -999, _time: "2024-01-01T00:03:00Z" },
            ];
            mockQueryApi.collectRows.mockResolvedValue(rows);

            const objectTree = createMockObjectTree({
                metricMeta: leafMeta("device-uuid/Metric", "Metric"),
            });
            const { history } = makeHistory({ queryApi: mockQueryApi, objectTree });

            const result = await history.queryHistory(
                "device-uuid/Metric",
                "2024-01-01T00:00:00Z",
                "2024-01-02T00:00:00Z",
            );

            for (const vqt of result) {
                expect(vqt.quality).toBe("Good");
            }
        });

        it("calls collectRows with the correct Flux query", async () => {
            const mockQueryApi = createMockQueryApi();
            const objectTree = createMockObjectTree({
                metricMeta: leafMeta("instance-uuid/Pressure", "Pressure"),
            });
            const { history } = makeHistory({ queryApi: mockQueryApi, objectTree });

            const elementId = "instance-uuid/Pressure";
            const start = "2024-03-01T00:00:00Z";
            const end = "2024-03-02T00:00:00Z";

            await history.queryHistory(elementId, start, end);

            expect(mockQueryApi.collectRows).toHaveBeenCalledTimes(1);
            const calledQuery = mockQueryApi.collectRows.mock.calls[0][0];
            expect(calledQuery).toBe(history.buildFluxQuery(elementId, start, end));
        });

        it("returns [] and issues no query for an elementId with no MetricMeta", async () => {
            const mockQueryApi = createMockQueryApi();
            const objectTree = createMockObjectTree();
            const { history } = makeHistory({ queryApi: mockQueryApi, objectTree });

            const result = await history.queryHistory(
                "e1f2a3b4-5566-7788-99aa-bbccddeeff00",
                "2024-01-01T00:00:00Z",
                "2024-01-02T00:00:00Z",
            );

            expect(result).toEqual([]);
            expect(mockQueryApi.collectRows).not.toHaveBeenCalled();
        });

        it("does not read another device's history when its UUID is passed as an elementId", async () => {
            const mockQueryApi = createMockQueryApi();
            // The victim device's data, as Influx would return it if the
            // old fallback filter were still built.
            mockQueryApi.collectRows.mockResolvedValue([
                { _value: 99.9, _time: "2024-01-01T00:00:00Z" },
            ]);
            // The victim UUID is not in the tree at all, so getObject
            // returns undefined and the composition guard does not fire:
            // this is exactly the path the old fallback branch took.
            const objectTree = createMockObjectTree({
                metricMeta: leafMeta("mine/Temperature"),
            });
            const { history } = makeHistory({ queryApi: mockQueryApi, objectTree });

            const result = await history.queryHistory(
                "victim-device-uuid",
                "2024-01-01T00:00:00Z",
                "2024-01-02T00:00:00Z",
            );

            expect(result).toEqual([]);
            expect(mockQueryApi.collectRows).not.toHaveBeenCalled();
        });
    });
});

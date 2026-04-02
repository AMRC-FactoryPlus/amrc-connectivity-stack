import { jest } from "@jest/globals";
import { History } from "../src/history.js";
import type { ObjectTree } from "../src/object-tree.js";
import type { I3xVqt } from "../src/types/i3x.js";

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
 * getInstanceUuid, and getDescendantLeafIds stubs.
 */
function createMockObjectTree(opts?: {
    knownUuids?: Set<string>;
    metricMeta?: Map<string, any>;
    instanceUuids?: Map<string, string>;
}): ObjectTree {
    const knownUuids = opts?.knownUuids ?? new Set<string>();
    const metricMeta = opts?.metricMeta ?? new Map<string, any>();
    const instanceUuids = opts?.instanceUuids ?? new Map<string, string>();

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
        getInstanceUuid: jest.fn((configDbUuid: string) => instanceUuids.get(configDbUuid)),
        getDescendantLeafIds: jest.fn((_elementId: string) => []),
    } as unknown as ObjectTree;
}

const BUCKET = "factory-plus";
const INFLUX_URL = "http://influx:8086";
const INFLUX_TOKEN = "test-token";
const INFLUX_ORG = "amrc";

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

        it("for a device UUID (no MetricMeta) falls back to topLevelInstance filter", () => {
            const instanceUuids = new Map([
                ["device-uuid-1234", "instance-uuid-5678"],
            ]);
            const objectTree = createMockObjectTree({ instanceUuids });
            const { history } = makeHistory({ objectTree });

            const query = history.buildFluxQuery(
                "device-uuid-1234",
                "2024-01-01T00:00:00Z",
                "2024-01-02T00:00:00Z",
            );

            expect(query).toContain(`r["topLevelInstance"] == "instance-uuid-5678"`);
            expect(query).toContain(`r["_field"] == "value"`);
            expect(query).not.toContain("_measurement");
        });

        it("for unknown elementId (no MetricMeta, no instanceUuid) uses elementId as topLevelInstance", () => {
            const objectTree = createMockObjectTree();
            const { history } = makeHistory({ objectTree });

            const query = history.buildFluxQuery(
                "unknown-uuid",
                "2024-01-01T00:00:00Z",
                "2024-01-02T00:00:00Z",
            );

            expect(query).toContain(`r["topLevelInstance"] == "unknown-uuid"`);
            expect(query).toContain(`r["_field"] == "value"`);
        });

        it("includes correct bucket, startTime, and endTime", () => {
            const { history } = makeHistory();
            const start = "2024-06-01T12:00:00Z";
            const end = "2024-06-02T12:00:00Z";

            const query = history.buildFluxQuery(
                "device-uuid-1234",
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

            const { history } = makeHistory({ queryApi: mockQueryApi });

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

            const { history } = makeHistory({ queryApi: mockQueryApi });

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

            const { history } = makeHistory({ queryApi: mockQueryApi });

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
            const { history } = makeHistory({ queryApi: mockQueryApi });

            const elementId = "instance-uuid/Pressure";
            const start = "2024-03-01T00:00:00Z";
            const end = "2024-03-02T00:00:00Z";

            await history.queryHistory(elementId, start, end);

            expect(mockQueryApi.collectRows).toHaveBeenCalledTimes(1);
            const calledQuery = mockQueryApi.collectRows.mock.calls[0][0];
            expect(calledQuery).toBe(history.buildFluxQuery(elementId, start, end));
        });
    });
});

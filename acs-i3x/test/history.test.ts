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
 * Minimal mock ObjectTree: getObject returns an object for known UUIDs,
 * undefined for unknown ones.
 */
function createMockObjectTree(knownUuids: Set<string> = new Set()): ObjectTree {
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
        it("for a leaf metric (elementId contains '/') uses bottomLevelInstance filter", () => {
            const { history } = makeHistory();
            const instanceUuid = "aaaa-1111-2222-3333";
            const metricName = "Temperature";
            const elementId = `${instanceUuid}/${metricName}`;

            const query = history.buildFluxQuery(
                elementId,
                "2024-01-01T00:00:00Z",
                "2024-01-02T00:00:00Z",
            );

            expect(query).toContain(`from(bucket: "${BUCKET}")`);
            expect(query).toContain(`r["bottomLevelInstance"] == "${instanceUuid}"`);
            expect(query).toContain(`r["_field"] == "value"`);
            expect(query).toContain("sort(columns: [\"_time\"])");
            // Should NOT contain topLevelInstance or usesInstances
            expect(query).not.toContain("topLevelInstance");
            expect(query).not.toContain("usesInstances");
        });

        it("for a device UUID (not in ObjectTree sub-objects) uses topLevelInstance filter", () => {
            // objectTree.getObject returns undefined for this UUID -> device-level
            const objectTree = createMockObjectTree(new Set());
            const { history } = makeHistory({ objectTree });
            const deviceUuid = "device-uuid-1234";

            const query = history.buildFluxQuery(
                deviceUuid,
                "2024-01-01T00:00:00Z",
                "2024-01-02T00:00:00Z",
            );

            expect(query).toContain(`r["topLevelInstance"] == "${deviceUuid}"`);
            expect(query).toContain(`r["_field"] == "value"`);
            // Should NOT contain bottomLevelInstance or usesInstances
            expect(query).not.toContain("bottomLevelInstance");
            expect(query).not.toContain("usesInstances");
        });

        it("for a sub-object UUID (found in ObjectTree with a parentId) uses usesInstances regex filter", () => {
            const subObjectUuid = "sub-object-uuid-5678";
            const objectTree = createMockObjectTree(new Set([subObjectUuid]));
            const { history } = makeHistory({ objectTree });

            const query = history.buildFluxQuery(
                subObjectUuid,
                "2024-01-01T00:00:00Z",
                "2024-01-02T00:00:00Z",
            );

            expect(query).toContain(`r["usesInstances"] =~ /${subObjectUuid}/`);
            expect(query).toContain(`r["_field"] == "value"`);
            // Should NOT contain bottomLevelInstance or topLevelInstance
            expect(query).not.toContain("bottomLevelInstance");
            expect(query).not.toContain("topLevelInstance");
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

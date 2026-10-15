/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * Reading a device that publishes to the UNS from the UNS historian's
 * bucket as well as the Sparkplug bucket, and MetricMeta for leaves
 * that i3X finds from UNS messages.
 */

import { jest } from "@jest/globals";
import { History } from "../lib/history.js";
import { ObjectTree } from "../lib/object-tree.js";
import type { MetricMeta } from "../lib/object-tree.js";
import { createMockFplus } from "./helpers/mock-services.js";

const SP_BUCKET = "sparkplug-bucket";
const UNS_BUCKET = "uns-bucket";
const DEV = "11111111-0000-0000-0000-000000000001";
const OTHER = "22222222-0000-0000-0000-000000000002";
const HIERARCHY = "84ac3397-f3a2-440a-99e5-5bb9f6a75091";
const DEVINFO_SCHEMA = "2dd093e9-1450-44c5-be8c-c0d78e48219b";

function meta(tli: string, metricPath: string, metricName: string = "Current"): MetricMeta {
    return { topLevelInstanceUuid: tli, metricPath, metricName, sparkplugType: "Double", typeSuffix: "d" };
}

/** A mock tree: leaves by id, which devices publish to the UNS, and
 * their device segments. */
function mockTree(opts: {
    metas: Record<string, MetricMeta>;
    publishing?: string[];
    segments?: Record<string, string>;
}) {
    const publishing = new Set(opts.publishing ?? []);
    return {
        getObject: jest.fn((id: string) => opts.metas[id]
            ? { elementId: id, displayName: id, typeElementId: "t", parentId: opts.metas[id].topLevelInstanceUuid, isComposition: false }
            : undefined),
        getMetricMeta: jest.fn((id: string) => opts.metas[id]),
        publishesToUns: jest.fn((uuid: string) => publishing.has(uuid)),
        unsDeviceSegment: jest.fn((uuid: string) => opts.segments?.[uuid]),
        getDescendantLeafIds: jest.fn(() => []),
    } as unknown as ObjectTree & {
        publishesToUns: jest.Mock;
        unsDeviceSegment: jest.Mock;
    };
}

function makeHistory(tree: ObjectTree, unsBucket?: string, bucket: string = SP_BUCKET) {
    const history = new History({
        influxUrl: "http://influx:8086",
        influxToken: "t",
        influxOrg: "o",
        influxBucket: bucket,
        influxUnsBucket: unsBucket,
        objectTree: tree,
    });
    const collectRows = jest.fn<(q: string) => Promise<any[]>>().mockResolvedValue([]);
    (history as any).queryApi = { collectRows };
    return { history, collectRows };
}

const START = "2026-01-01T00:00:00Z";
const END = "2026-01-02T00:00:00Z";

describe("bucket choice", () => {
    const metas = {
        nested: meta(DEV, "Phases/1"),
        top: meta(DEV, "", "Status"),
        other: meta(OTHER, "Phases/1"),
    };

    it("reads only the Sparkplug bucket when no UNS bucket is configured", () => {
        const tree = mockTree({ metas, publishing: [DEV], segments: { [DEV]: "Device_A" } });
        const { history } = makeHistory(tree);
        const qs = history.buildFluxQueries("nested", START, END)!;
        expect(qs).toHaveLength(1);
        expect(qs[0]).toContain(`from(bucket: "${SP_BUCKET}")`);
        expect(qs[0]).toContain(`r["path"] == "Phases/1"`);
        expect(tree.publishesToUns).not.toHaveBeenCalled();
    });

    it("reads the UNS bucket first, then the Sparkplug bucket, for a nested metric of a UNS device", () => {
        const tree = mockTree({ metas, publishing: [DEV], segments: { [DEV]: "Device_A" } });
        const { history } = makeHistory(tree, UNS_BUCKET);
        const qs = history.buildFluxQueries("nested", START, END)!;
        expect(qs).toHaveLength(2);
        expect(qs[0]).toContain(`from(bucket: "${UNS_BUCKET}")`);
        expect(qs[0]).toContain(`r["path"] == "Device_A/Phases/1"`);
        expect(qs[0]).toContain(`r["_measurement"] == "Current:d"`);
        expect(qs[0]).toContain(`r["topLevelInstance"] == "${DEV}"`);
        expect(qs[0]).toContain(`range(start: ${START}, stop: ${END})`);
        expect(qs[1]).toContain(`from(bucket: "${SP_BUCKET}")`);
        expect(qs[1]).toContain(`r["path"] == "Phases/1"`);
        expect(history.buildFluxQuery("nested", START, END)).toBe(qs[0]);
    });

    it("matches a top-level metric on the device segment alone in the UNS bucket", () => {
        const tree = mockTree({ metas, publishing: [DEV], segments: { [DEV]: "Device_A" } });
        const { history } = makeHistory(tree, UNS_BUCKET);
        const qs = history.buildFluxQueries("top", START, END)!;
        expect(qs[0]).toContain(`r["path"] == "Device_A")`);
        expect(qs[0]).toContain(`r["_measurement"] == "Status:d"`);
        // The Sparkplug bucket keeps its old rule: no path filter.
        expect(qs[1]).not.toContain(`r["path"]`);
    });

    it("reads only the Sparkplug bucket for a device that does not publish to the UNS", () => {
        const tree = mockTree({ metas, publishing: [DEV], segments: { [DEV]: "Device_A", [OTHER]: "Device_B" } });
        const { history } = makeHistory(tree, UNS_BUCKET);
        const qs = history.buildFluxQueries("other", START, END)!;
        expect(qs).toHaveLength(1);
        expect(qs[0]).toContain(`from(bucket: "${SP_BUCKET}")`);
    });

    it("reads only the Sparkplug bucket when the device segment is unknown", () => {
        const tree = mockTree({ metas, publishing: [DEV] });
        const { history } = makeHistory(tree, UNS_BUCKET);
        expect(history.buildFluxQueries("nested", START, END)).toHaveLength(1);
    });

    it("ignores a UNS bucket that is the Sparkplug bucket", () => {
        const tree = mockTree({ metas, publishing: [DEV], segments: { [DEV]: "Device_A" } });
        const { history } = makeHistory(tree, SP_BUCKET);
        expect(history.buildFluxQueries("nested", START, END)).toHaveLength(1);
    });

    it("returns null without MetricMeta", () => {
        const tree = mockTree({ metas, publishing: [DEV], segments: { [DEV]: "Device_A" } });
        const { history } = makeHistory(tree, UNS_BUCKET);
        expect(history.buildFluxQueries("unknown", START, END)).toBeNull();
    });

    it("quotes every tag value", () => {
        const tree = mockTree({
            metas: { q: meta(DEV, `Phases/"1"`, `Cur\\rent`) },
            publishing: [DEV],
            segments: { [DEV]: `Dev"ice` },
        });
        const { history } = makeHistory(tree, UNS_BUCKET);
        const qs = history.buildFluxQueries("q", START, END)!;
        expect(qs[0]).toContain(`r["path"] == "Dev\\"ice/Phases/\\"1\\""`);
        expect(qs[0]).toContain(`r["_measurement"] == "Cur\\\\rent:d"`);
        expect(qs[1]).toContain(`r["path"] == "Phases/\\"1\\""`);
    });
});

describe("queryHistory across both buckets", () => {
    it("returns the union, one point per timestamp, the UNS bucket's on a clash", async () => {
        const tree = mockTree({ metas: { leaf: meta(DEV, "Phases/1") }, publishing: [DEV], segments: { [DEV]: "Device_A" } });
        const { history, collectRows } = makeHistory(tree, UNS_BUCKET);
        collectRows.mockImplementation(async (q: string) => q.includes(UNS_BUCKET)
            ? [
                { _value: 10, _time: "2026-01-01T00:00:01Z" },
                { _value: 30, _time: "2026-01-01T00:00:03Z" },
            ]
            : [
                { _value: 0, _time: "2026-01-01T00:00:00.5Z" },
                { _value: 99, _time: "2026-01-01T00:00:01.000Z" },
                { _value: 20, _time: "2026-01-01T00:00:02Z" },
            ]);
        const out = await history.queryHistory("leaf", START, END);
        expect(collectRows).toHaveBeenCalledTimes(2);
        expect(out.map(v => v.value)).toEqual([0, 10, 20, 30]);
    });

    it("reads one bucket only, unchanged, for a device that does not publish to the UNS", async () => {
        const tree = mockTree({ metas: { leaf: meta(OTHER, "Phases/1") } });
        const { history, collectRows } = makeHistory(tree, UNS_BUCKET);
        collectRows.mockResolvedValue([
            { _value: 1, _time: "2026-01-01T00:00:01Z" },
            { _value: 1, _time: "2026-01-01T00:00:01Z" },
        ]);
        const out = await history.queryHistory("leaf", START, END);
        expect(collectRows).toHaveBeenCalledTimes(1);
        expect(out).toHaveLength(2);
    });
});

describe("current value across both buckets", () => {
    const setup = () => {
        const tree = mockTree({
            metas: { a: meta(DEV, "Phases/1"), b: meta(DEV, "", "Status"), c: meta(OTHER, "Phases/1") },
            publishing: [DEV],
            segments: { [DEV]: "Device_A" },
        });
        return { tree, ...makeHistory(tree, UNS_BUCKET) };
    };

    it("getCurrentValue takes the later last point", async () => {
        const { history, collectRows } = setup();
        collectRows.mockImplementation(async (q: string) => q.includes(UNS_BUCKET)
            ? [{ _value: 1, _time: "2026-01-01T00:00:01Z" }]
            : [{ _value: 2, _time: "2026-01-01T00:00:01.5Z" }]);
        expect((await history.getCurrentValue("a"))!.value).toBe(2);
    });

    it("getCurrentValue takes the UNS bucket's point on a tie, and a point found in only one bucket", async () => {
        const { history, collectRows } = setup();
        collectRows.mockImplementation(async (q: string) => q.includes(UNS_BUCKET)
            ? [{ _value: 1, _time: "2026-01-01T00:00:01Z" }]
            : [{ _value: 2, _time: "2026-01-01T00:00:01.000Z" }]);
        expect((await history.getCurrentValue("a"))!.value).toBe(1);

        collectRows.mockImplementation(async (q: string) => q.includes(UNS_BUCKET)
            ? [{ _value: 5, _time: "2026-01-01T00:00:01Z" }]
            : []);
        expect((await history.getCurrentValue("a"))!.value).toBe(5);
    });

    it("bulk reads ask the UNS bucket only for UNS devices, and agree with getCurrentValue", async () => {
        const { history, collectRows } = setup();
        const unsRows = [
            { _measurement: "Current:d", topLevelInstance: DEV, path: "Device_A/Phases/1", _value: 1, _time: "2026-01-01T00:00:05Z" },
            { _measurement: "Status:d", topLevelInstance: DEV, path: "Device_A", _value: 7, _time: "2026-01-01T00:00:01Z" },
        ];
        const spRows = [
            { _measurement: "Current:d", topLevelInstance: DEV, path: "Phases/1", _value: 2, _time: "2026-01-01T00:00:04Z" },
            { _measurement: "Status:d", topLevelInstance: DEV, _value: 8, _time: "2026-01-01T00:00:02Z" },
            { _measurement: "Current:d", topLevelInstance: OTHER, path: "Phases/1", _value: 3, _time: "2026-01-01T00:00:03Z" },
        ];
        collectRows.mockImplementation(async (q: string) => q.includes(UNS_BUCKET) ? unsRows : spRows);

        const values = await history.getCurrentValues(["a", "b", "c"]);
        expect(values.get("a")!.value).toBe(1);
        expect(values.get("b")!.value).toBe(8);
        expect(values.get("c")!.value).toBe(3);

        const queries = collectRows.mock.calls.map(c => c[0]);
        const unsQueries = queries.filter(q => q.includes(UNS_BUCKET));
        expect(unsQueries).toHaveLength(1);
        expect(unsQueries[0]).toContain(DEV);
        expect(unsQueries[0]).not.toContain(OTHER);
        expect(queries.filter(q => q.includes(SP_BUCKET))).toHaveLength(1);
    });

    it("buildBulkLastQuery takes a bucket", () => {
        const { history } = setup();
        expect(history.buildBulkLastQuery([DEV], undefined, "-30d", UNS_BUCKET))
            .toContain(`from(bucket: "${UNS_BUCKET}")`);
        expect(history.buildBulkLastQuery([DEV])).toContain(`from(bucket: "${SP_BUCKET}")`);
    });
});

/* ---- The real ObjectTree ---- */

function makeTree(): ObjectTree {
    return new ObjectTree({
        fplus: createMockFplus(),
        namespaceName: "Factory+",
        namespaceUri: "urn:factoryplus:ns",
    });
}

function devInfo(sparkplugName: string | undefined, enterprise: string | null = "Ent") {
    const originMap: any = {
        Schema_UUID: "schema-top",
        Instance_UUID: DEV,
        Phases: {
            Schema_UUID: "schema-phases",
            "1": {
                Schema_UUID: "schema-phase",
                Current: { Sparkplug_Type: "FloatLE" },
            },
        },
    };
    if (enterprise) {
        originMap.Device_Information = {
            Schema_UUID: DEVINFO_SCHEMA,
            ISA95_Hierarchy: { Schema_UUID: HIERARCHY, Enterprise: { Value: enterprise } },
        };
    }
    return { schema: "schema-top", sparkplugName, originMap };
}

describe("ObjectTree: MetricMeta for leaves found from UNS", () => {
    it("derives MetricMeta for a nested leaf, as the historians tag it", () => {
        const tree = makeTree();
        tree.addDevice(DEV, devInfo("Device_A"), { name: "Device A" });
        const leaf = tree.addCompositionFromUns([DEV], ["schema-top"], ["Extras", "Group_1", "Speed"], ["Ent"],
            { deviceSegment: "Device_A", type: "Int32" })!;
        expect(tree.getNodeSource(leaf)).toBe("uns");
        expect(tree.getMetricMeta(leaf)).toEqual({
            topLevelInstanceUuid: DEV,
            metricPath: "Extras/Group_1",
            metricName: "Speed",
            sparkplugType: "Int32",
            typeSuffix: "i",
        });
    });

    it("derives MetricMeta for a top-level leaf, and a string type when Type is missing", () => {
        const tree = makeTree();
        tree.addDevice(DEV, devInfo("Device_A"), { name: "Device A" });
        const leaf = tree.addCompositionFromUns([DEV], ["schema-top"], ["Status"], ["Ent"],
            { deviceSegment: "Device_A" })!;
        expect(tree.getMetricMeta(leaf)).toMatchObject({ metricPath: "", metricName: "Status", typeSuffix: "s" });
    });

    it("keeps a config leaf's MetricMeta, and gives a config composition none", () => {
        const tree = makeTree();
        tree.addDevice(DEV, devInfo("Device_A"), { name: "Device A" });
        const leaf = tree.addCompositionFromUns([DEV], ["schema-top"], ["Phases", "1", "Current"], ["Ent"],
            { deviceSegment: "Device_A", type: "Int8" })!;
        expect(tree.getNodeSource(leaf)).toBe("config");
        expect(tree.getMetricMeta(leaf)).toMatchObject({ sparkplugType: "FloatLE", typeSuffix: "d", metricPath: "Phases/1" });

        const comp = tree.addCompositionFromUns([DEV], ["schema-top"], ["Phases", "1"], ["Ent"],
            { deviceSegment: "Device_A", type: "Double" })!;
        expect(tree.getObject(comp)!.isComposition).toBe(true);
        expect(tree.getMetricMeta(comp)).toBeUndefined();
    });

    it("keeps the derived MetricMeta when the device is rebuilt from config", () => {
        const tree = makeTree();
        tree.addDevice(DEV, devInfo("Device_A"), { name: "Device A" });
        const leaf = tree.addCompositionFromUns([DEV], ["schema-top"], ["Phases", "1", "Extra"], ["Ent"],
            { deviceSegment: "Device_A", type: "Double" })!;
        tree.replaceDeviceSubtree(DEV, devInfo("Device_A"), { name: "Device A" });
        expect(tree.getMetricMeta(leaf)).toMatchObject({ metricPath: "Phases/1", metricName: "Extra" });
    });
});

describe("ObjectTree: UNS device segment", () => {
    it("starts from sparkplugName, and the segment seen on a UNS topic wins", () => {
        const tree = makeTree();
        tree.addDevice(DEV, devInfo("Device_A"), { name: "Device A" });
        expect(tree.unsDeviceSegment(DEV)).toBe("Device_A");

        tree.addCompositionFromUns([DEV], ["schema-top"], ["Status"], ["Ent"], { deviceSegment: "Device_A2" });
        expect(tree.unsDeviceSegment(DEV)).toBe("Device_A2");

        // A config rebuild does not replace what UNS showed...
        tree.replaceDeviceSubtree(DEV, devInfo("Device_B"), { name: "Device A" });
        expect(tree.unsDeviceSegment(DEV)).toBe("Device_A2");
        // ...but the next UNS message does.
        tree.addCompositionFromUns([DEV], ["schema-top"], ["Status"], ["Ent"], { deviceSegment: "Device_B" });
        expect(tree.unsDeviceSegment(DEV)).toBe("Device_B");
    });

    it("is undefined without sparkplugName or UNS messages, and goes with the device", () => {
        const tree = makeTree();
        tree.addDevice(DEV, devInfo(undefined), { name: "Device A" });
        expect(tree.unsDeviceSegment(DEV)).toBeUndefined();
        tree.replaceDeviceSubtree(DEV, devInfo("Device_A"), { name: "Device A" });
        expect(tree.unsDeviceSegment(DEV)).toBe("Device_A");
        tree.removeDevice(DEV);
        expect(tree.unsDeviceSegment(DEV)).toBeUndefined();
    });
});

describe("ObjectTree and History together", () => {
    it("reads a UNS-created leaf of a UNS device from both buckets", async () => {
        const tree = makeTree();
        tree.addDevice(DEV, devInfo("Device_A"), { name: "Device A" });
        const leaf = tree.addCompositionFromUns([DEV], ["schema-top"], ["Phases", "1", "Extra"], ["Ent"],
            { deviceSegment: "Device_A", type: "Double" })!;
        const { history, collectRows } = makeHistory(tree, UNS_BUCKET);

        const qs = history.buildFluxQueries(leaf, START, END)!;
        expect(qs).toHaveLength(2);
        expect(qs[0]).toContain(`r["path"] == "Device_A/Phases/1"`);
        expect(qs[0]).toContain(`r["_measurement"] == "Extra:d"`);
        expect(qs[1]).toContain(`r["path"] == "Phases/1"`);

        collectRows.mockImplementation(async (q: string) => q.includes(UNS_BUCKET)
            ? [{ _value: 4, _time: "2026-01-01T00:00:01Z" }] : []);
        expect((await history.getCurrentValue(leaf))!.value).toBe(4);
    });

    it("reads a device without ISA-95 hierarchy from the Sparkplug bucket only", () => {
        const tree = makeTree();
        tree.addDevice(DEV, devInfo("Device_A", null), { name: "Device A" });
        expect(tree.publishesToUns(DEV)).toBe(false);
        const leaf = tree.getChildElementIds(DEV)
            .flatMap(p => tree.getChildElementIds(p))
            .flatMap(p => tree.getChildElementIds(p))[0];
        expect(tree.getMetricMeta(leaf)).toBeDefined();
        const { history } = makeHistory(tree, UNS_BUCKET);
        const qs = history.buildFluxQueries(leaf, START, END)!;
        expect(qs).toHaveLength(1);
        expect(qs[0]).toContain(`from(bucket: "${SP_BUCKET}")`);
    });
});

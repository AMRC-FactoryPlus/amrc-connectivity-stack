/*
 * ACS Data Access Service
 * Unit tests for Sub-device (SparkplugSubset) datasets.
 *
 * These run against fakes, so they need no cluster.
 */

import { Map as IMap, Set as ISet } from "immutable";
import * as rx from "rxjs";
import { describe, expect, test } from "vitest";

import { UUIDs } from "@amrc-factoryplus/service-client";

import { APIv1 } from "../../lib/api-v1.js";
import { DataFlow } from "../../lib/dataflow.js";
import { DataAccess as Constants } from "../../lib/constants.js";
import { walk_origin_map, resolve_metric } from "../../lib/origin-map.js";
import { source_queries, MAX_PREDICATES } from "../../lib/flux-query.js";
import { MAX_METRICS } from "../../lib/sparkplug-subset-handler.js";

const DEVICE = "55555555-5555-5555-5555-555555555555";
const CHARS = "1e74e2b2-44a3-44ff-8b2c-8c14a5f15c0b";
const AXIS = "a1a1a1a1-0000-4000-8000-000000000001";
const SUBSET = "66666666-6666-6666-6666-666666666666";
const UNION = "77777777-7777-7777-7777-777777777777";
const GONE = "99999999-9999-4999-8999-999999999999";

const SUBSET_APP = Constants.App.SparkplugSubset;

/* Shaped like a real DeviceInformation origin map: a metric on the
 * device itself, an object with an Instance_UUID, a plain folder with no
 * Instance_UUID, and one metric not recorded to the historian. */
const ORIGIN_MAP = {
    Schema_UUID: "d6de8765-bfbe-4f6b-b5d8-822dbd7f3a49",
    Instance_UUID: DEVICE,
    Switch_Closed: {
        Sparkplug_Type: "Boolean",
        Record_To_Historian: true,
        Schema_UUID: "b16275f1-e443-4c41-a482-fcbdfbd20769",
    },
    Characteristics: {
        Schema_UUID: "0ff890b0-1ddb-4cb0-96eb-b0e87039df2f",
        Instance_UUID: CHARS,
        Current_AC: {
            Sparkplug_Type: "FloatLE",
            Record_To_Historian: true,
            Eng_Unit: "A",
            Documentation: "True RMS current",
        },
        Debug: { Sparkplug_Type: "String", Record_To_Historian: false },
    },
    Axes: {
        X: {
            Instance_UUID: AXIS,
            Position: {
                Actual: { Sparkplug_Type: "Double", Record_To_Historian: true },
            },
        },
    },
};

function query_text (queries) {
    return queries.map(q => q.toString());
}

describe("walk_origin_map", () => {
    const { instances, metrics } = walk_origin_map(ORIGIN_MAP, DEVICE);

    test("maps every Instance_UUID to its object path", () => {
        expect(instances.get(DEVICE)).toBe("");
        expect(instances.get(CHARS)).toBe("Characteristics");
        expect(instances.get(AXIS)).toBe("Axes/X");
    });

    test("lists only metrics recorded to the historian", () => {
        expect(metrics.map(m => m.path)).toEqual([
            "Switch_Closed",
            "Characteristics/Current_AC",
            "Axes/X/Position/Actual",
        ]);
    });

    test("references each metric from its nearest enclosing instance", () => {
        expect(metrics).toContainEqual({
            instance: CHARS, metric: "Current_AC",
            path: "Characteristics/Current_AC",
            type: "FloatLE", unit: "A", documentation: "True RMS current",
        });
        expect(metrics.find(m => m.path == "Switch_Closed").instance).toBe(DEVICE);

        /* Position is a plain folder, so the metric path keeps it. */
        const actual = metrics.find(m => m.path == "Axes/X/Position/Actual");
        expect(actual.instance).toBe(AXIS);
        expect(actual.metric).toBe("Position/Actual");
    });

    test("a device with no origin map has no metrics", () => {
        const { instances, metrics } = walk_origin_map(undefined, DEVICE);
        expect(metrics).toEqual([]);
        expect(instances.get(DEVICE)).toBe("");
    });
});

describe("resolve_metric", () => {
    const { instances } = walk_origin_map(ORIGIN_MAP, DEVICE);

    test("splits the full name into the path tag and measurement name", () => {
        expect(resolve_metric(instances, { instance: AXIS, metric: "Position/Actual" }))
            .toEqual({ path: "Axes/X/Position", name: "Actual" });
        expect(resolve_metric(instances, { instance: CHARS, metric: "Current_AC" }))
            .toEqual({ path: "Characteristics", name: "Current_AC" });
    });

    test("a metric at the device root has no path tag", () => {
        expect(resolve_metric(instances, { instance: DEVICE, metric: "Switch_Closed" }))
            .toEqual({ path: null, name: "Switch_Closed" });
    });

    test("follows a renamed parent object", () => {
        const renamed = structuredClone(ORIGIN_MAP);
        renamed.Electrical = renamed.Characteristics;
        delete renamed.Characteristics;

        const { instances } = walk_origin_map(renamed, DEVICE);
        expect(resolve_metric(instances, { instance: CHARS, metric: "Current_AC" }))
            .toEqual({ path: "Electrical", name: "Current_AC" });
    });

    test("returns null when the instance has gone", () => {
        expect(resolve_metric(instances, { instance: GONE, metric: "Current_AC" }))
            .toBeNull();
    });
});

describe("source_queries", () => {
    const bucket = "default";

    test("a whole-device source is one query with no metric filter", () => {
        const [q, ...rest] = query_text(source_queries({
            bucket, source: { device_uuid: DEVICE },
        }));
        expect(rest).toEqual([]);
        expect(q).toContain(`r.topLevelInstance == "${DEVICE}"`);
        expect(q).not.toContain("r.path");
    });

    test("a sub-device with no resolved metrics reads nothing", () => {
        expect(source_queries({
            bucket, source: { device_uuid: DEVICE, metrics: [] },
        })).toEqual([]);
    });

    test("filters each metric on its path tag and suffixed measurement", () => {
        const [q] = query_text(source_queries({ bucket, source: {
            device_uuid: DEVICE,
            metrics: [
                { path: "Axes/X/Position", name: "Actual" },
                { path: null, name: "Switch_Closed" },
            ],
        }}));
        expect(q).toContain(`(r.path == "Axes/X/Position" and r._measurement =~ /^Actual:[iudbs]$/)`);
        expect(q).toContain(`or (not exists r.path and r._measurement =~ /^Switch_Closed:[iudbs]$/)`);
    });

    test("splits large selections into several queries", () => {
        const metrics = Array.from({ length: MAX_PREDICATES * 2 + 1 },
            (_, i) => ({ path: "P", name: `M${i}` }));
        const queries = query_text(source_queries({ bucket,
            source: { device_uuid: DEVICE, metrics } }));

        expect(queries).toHaveLength(3);
        expect(queries[2]).toContain(`/^M${MAX_PREDICATES * 2}:[iudbs]$/`);
        expect(queries[2]).not.toContain(`/^M0:[iudbs]$/`);
    });

    test("escapes quotes and regex syntax in names", () => {
        const [q] = query_text(source_queries({ bucket, source: {
            device_uuid: DEVICE,
            metrics: [{ path: `A") |> drop(columns: ["x`, name: "a.b(c)" }],
        }}));
        expect(q).toContain(`r.path == "A\\") |> drop(columns: [\\"x"`);
        expect(q).toContain(`/^a\\.b\\(c\\):[iudbs]$/`);
    });

    test("the measurement filter accepts a name with or without its suffix", () => {
        const [q] = query_text(source_queries({ bucket,
            source: { device_uuid: DEVICE }, measurement: "Temp" }));
        expect(q).toContain(`r._measurement =~ /^Temp(:[iudbs])?$/`);

        const [q2] = query_text(source_queries({ bucket,
            source: { device_uuid: DEVICE }, measurement: `Temp:d"` }));
        expect(q2).toContain(`/^Temp:d"(:[iudbs])?$/`);
    });

    test("uses the source's time range", () => {
        const [q] = query_text(source_queries({ bucket, source: {
            device_uuid: DEVICE,
            from: "2026-01-01T00:00:00.000Z", to: "2026-02-01T00:00:00.000Z",
        }}));
        expect(q).toContain(`start: time(v: "2026-01-01T00:00:00.000Z")`);
        expect(q).toContain(`stop: time(v: "2026-02-01T00:00:00.000Z")`);
    });
});

/* Builds an APIv1 wired to fakes. `datasets` maps a dataset UUID to
 * { structure, config }, the shape DataFlow produces. */
function make_api ({ datasets = {}, origin_map = ORIGIN_MAP, allowed = true } = {}) {
    const acl_checks = [];
    const calls = { get_config: 0, created: [], put: [] };

    const api = new APIv1({
        data: { datasets: rx.of(IMap(datasets)) },
        auth: {
            async check_acl (principal, perm, target) {
                acl_checks.push([perm, target]);
                return allowed;
            },
        },
        cdb: {
            async get_config (app, obj) {
                calls.get_config++;
                if (app == UUIDs.App.DeviceInformation && obj == DEVICE && origin_map)
                    return { originMap: origin_map, sparkplugName: "Test" };
                return undefined;
            },
            async create_object (klass) {
                calls.created.push(klass);
                return SUBSET;
            },
            async put_config (app, obj, config) {
                calls.put.push({ app, obj, config });
            },
        },
        debug: { bound: () => () => {} },
        influxReader: {},
    });

    return { api, acl_checks, calls, handler: api.handlers[SUBSET_APP] };
}

function make_res () {
    return {
        code: null,
        body: null,
        status (code) { this.code = code; return this; },
        json (body) { this.body = body; return this; },
    };
}

describe("SparkplugSubset handler", () => {
    const { handler } = make_api();
    const valid = {
        source: DEVICE,
        metrics: [
            { instance: AXIS, metric: "Position/Actual" },
            { instance: DEVICE, metric: "Switch_Closed" },
        ],
    };

    test("accepts a valid config", () => {
        expect(() => handler.validate_config(valid)).not.toThrow();
    });

    test.each([
        ["no config", null],
        ["bad source", { ...valid, source: "nope" }],
        ["no metrics", { source: DEVICE }],
        ["empty metrics", { source: DEVICE, metrics: [] }],
        ["bad instance", { source: DEVICE, metrics: [{ instance: "x", metric: "A" }] }],
        ["empty metric path", { source: DEVICE, metrics: [{ instance: AXIS, metric: "" }] }],
        ["leading slash", { source: DEVICE, metrics: [{ instance: AXIS, metric: "/A" }] }],
        ["double slash", { source: DEVICE, metrics: [{ instance: AXIS, metric: "A//B" }] }],
        ["duplicate", { source: DEVICE, metrics: [valid.metrics[0], valid.metrics[0]] }],
        ["too many", { source: DEVICE, metrics: Array.from({ length: MAX_METRICS + 1 },
            (_, i) => ({ instance: AXIS, metric: `M${i}` })) }],
    ])("rejects %s with 422", (_, config) => {
        expect(() => handler.validate_config(config)).toThrow(
            expect.objectContaining({ status: 422 }));
    });

    test("needs USE_SPARKPLUG on the source device", async () => {
        const { handler, acl_checks } = make_api({ allowed: false });
        expect(await handler.check_sources_permissions("tester", valid)).toBe(false);
        expect(acl_checks).toEqual([[Constants.Perm.UseSparkplug, DEVICE]]);
    });

    test("resolves references through the current origin map", async () => {
        const leaves = await handler.resolve({
            dataset_uuid: SUBSET, config: valid,
            inherited_range: { from: null, to: null },
        });
        expect(leaves).toEqual([{
            dataset_uuid: SUBSET,
            device_uuid: DEVICE,
            from: null, to: null,
            metrics: [
                { path: "Axes/X/Position", name: "Actual" },
                { path: null, name: "Switch_Closed" },
            ],
        }]);
    });

    test("drops references whose instance has gone, never widening the read", async () => {
        const leaves = await handler.resolve({
            dataset_uuid: SUBSET,
            config: { source: DEVICE, metrics: [{ instance: GONE, metric: "A" }] },
            inherited_range: { from: null, to: null },
        });
        expect(leaves[0].metrics).toEqual([]);
    });

    test("with no origin map, only metrics on the device itself resolve", async () => {
        const { handler } = make_api({ origin_map: null });
        const [leaf] = await handler.resolve({
            dataset_uuid: SUBSET, config: valid,
            inherited_range: { from: null, to: null },
        });
        expect(leaf.metrics).toEqual([{ path: null, name: "Switch_Closed" }]);
    });

    test("never references another dataset", () => {
        expect(handler.references(valid, SUBSET)).toBe(false);
    });
});

describe("SparkplugSubset path entries", () => {
    test("validation accepts { path } entries alongside { instance, metric }", () => {
        const { handler } = make_api();
        expect(() => handler.validate_config({ source: DEVICE, metrics: [
            { path: "Axes/X/Position/Actual" },
            { instance: DEVICE, metric: "Switch_Closed" },
        ]})).not.toThrow();
    });

    test.each([
        ["extra fields", { path: "Switch_Closed", instance: DEVICE }],
        ["an empty path", { path: "" }],
        ["a trailing slash", { path: "Axes/X/" }],
        ["a non-string path", { path: 42 }],
    ])("validation rejects a path entry with %s", (_, ref) => {
        const { handler } = make_api();
        expect(() => handler.validate_config({ source: DEVICE, metrics: [ref] }))
            .toThrow(expect.objectContaining({ status: 422 }));
    });

    test("normalising converts paths to the stored form", async () => {
        const { handler } = make_api();
        const config = await handler.normalise_config({ source: DEVICE, metrics: [
            { path: "Axes/X/Position/Actual" },
            { path: "Switch_Closed" },
            { instance: CHARS, metric: "Current_AC" },
        ]});
        expect(config).toEqual({ source: DEVICE, metrics: [
            { instance: AXIS, metric: "Position/Actual" },
            { instance: DEVICE, metric: "Switch_Closed" },
            { instance: CHARS, metric: "Current_AC" },
        ]});
    });

    test("a config with no path entries is stored as given, with no lookup", async () => {
        const { handler, calls } = make_api();
        const config = { source: DEVICE, metrics: [{ instance: CHARS, metric: "Current_AC" }] };
        expect(await handler.normalise_config(config)).toBe(config);
        expect(calls.get_config).toBe(0);
    });

    test.each([
        ["a path that does not exist", "Axes/Y/Position/Actual"],
        ["a metric not recorded to the historian", "Characteristics/Debug"],
        ["an object rather than a metric", "Characteristics"],
    ])("normalising rejects %s with 422", async (_, path) => {
        const { handler } = make_api();
        await expect(handler.normalise_config({ source: DEVICE, metrics: [{ path }] }))
            .rejects.toMatchObject({ status: 422 });
    });

    test("normalising rejects a path that duplicates a UUID entry", async () => {
        const { handler } = make_api();
        await expect(handler.normalise_config({ source: DEVICE, metrics: [
            { path: "Characteristics/Current_AC" },
            { instance: CHARS, metric: "Current_AC" },
        ]})).rejects.toMatchObject({ status: 422 });
    });
});

describe("POST v1/structure with path entries", () => {
    const body = {
        structure: SUBSET_APP,
        config: { source: DEVICE, metrics: [{ path: "Axes/X/Position/Actual" }] },
    };

    test("stores the normalised config", async () => {
        const { api, calls } = make_api();
        const res = make_res();
        await api.structure_create({ body, auth: "tester" }, res);

        expect(res.code).toBe(200);
        expect(calls.put).toEqual([{ app: SUBSET_APP, obj: SUBSET, config: {
            source: DEVICE,
            metrics: [{ instance: AXIS, metric: "Position/Actual" }],
        }}]);
    });

    test("an unknown path creates nothing", async () => {
        const { api, calls } = make_api();
        await expect(api.structure_create({ auth: "tester", body: {
            ...body,
            config: { source: DEVICE, metrics: [{ path: "No/Such/Metric" }] },
        }}, make_res())).rejects.toMatchObject({ status: 422 });

        expect(calls.created).toEqual([]);
        expect(calls.put).toEqual([]);
    });

    test("without USE_SPARKPLUG the origin map is never read", async () => {
        const { api, calls } = make_api({ allowed: false });
        await expect(api.structure_create({ body, auth: "tester" }, make_res()))
            .rejects.toMatchObject({ status: 403 });
        expect(calls.get_config).toBe(0);
    });
});

describe("resolve_dataset with a sub-device", () => {
    test("a union carries the sub-device's metrics through", async () => {
        const { api } = make_api({ datasets: {
            [SUBSET]: { structure: SUBSET_APP, config: {
                source: DEVICE,
                metrics: [{ instance: CHARS, metric: "Current_AC" }],
            }},
            [UNION]: { structure: Constants.App.UnionComponents, config: [SUBSET] },
        }});

        const leaves = await api.resolve_dataset(UNION);
        expect(leaves).toEqual([expect.objectContaining({
            device_uuid: DEVICE,
            metrics: [{ path: "Characteristics", name: "Current_AC" }],
        })]);
    });
});

describe("GET /sparkplug-sources/:uuid/metrics", () => {
    test("lists the device's selectable metrics", async () => {
        const { api } = make_api();
        const res = make_res();
        await api.sparkplug_source_metrics({ params: { uuid: DEVICE }, auth: "tester" }, res);

        expect(res.code).toBe(200);
        expect(res.body.map(m => m.path)).toContain("Axes/X/Position/Actual");
    });

    test("refuses without USE_SPARKPLUG", async () => {
        const { api } = make_api({ allowed: false });
        await expect(api.sparkplug_source_metrics(
            { params: { uuid: DEVICE }, auth: "tester" }, make_res()))
            .rejects.toMatchObject({ status: 403 });
    });

    test("rejects an invalid device UUID", async () => {
        const { api } = make_api();
        await expect(api.sparkplug_source_metrics(
            { params: { uuid: "nope" }, auth: "tester" }, make_res()))
            .rejects.toMatchObject({ status: 422 });
    });
});

describe("DataFlow", () => {
    test("treats a sub-device dataset as valid", async () => {
        const config = {
            source: DEVICE,
            metrics: [{ instance: CHARS, metric: "Current_AC" }],
        };
        const cdb = {
            /* DataFlow builds these in its constructor; this test only
             * reads the dataset map. */
            watch_member_members: () => rx.of(IMap()),
            watch_members_subclasses: () => rx.of(IMap()),
            watch_members: () => rx.of(ISet([SUBSET_APP])),
            search_app: app => rx.of(app == SUBSET_APP
                ? IMap([[SUBSET, config]]) : IMap()),
        };
        const data = new DataFlow({
            debug: { bound: () => () => {} }, cdb, auth: {},
        });

        const datasets = await rx.firstValueFrom(data.valid_datasets);
        expect(datasets.get(SUBSET)).toMatchObject({
            structure: SUBSET_APP, config, from: null, to: null,
        });
    });
});

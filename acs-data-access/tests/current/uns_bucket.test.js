/*
 * ACS Data Access Service
 * Unit tests for reading the UNS bucket: the Flux for uns sources,
 * the CSV columns, and the series route across both stores.
 *
 * These run against fakes, so they need no cluster and no InfluxDB.
 * They check the Flux text Data Access builds, not what InfluxDB does
 * with it.
 */

import * as rx from "rxjs";
import { describe, expect, test } from "vitest";

import { DataFlow } from "../../lib/dataflow.js";
import {
    build_flux_queries, flux_regex_escape, uns_path_test,
} from "../../lib/flux.js";
import { InfluxReader } from "../../lib/influx-reader.js";
import { SeriesReader } from "../../lib/series-reader.js";
import {
    parse_request, mean_query, merge_runs, check_coverage, SeriesError,
    shape_means, uns_folder,
} from "../../lib/series.js";
import { csv_device_path } from "../../lib/utils.js";
import {
    DEVICE, OTHER_DEVICE, UNS_DS, MIXED, FROM, TO, DATASETS, debug,
    make_api, make_res,
} from "../uns_fixtures.js";

/*
 * ---------------------------------------------------------------
 * Flux for the uns bucket
 * ---------------------------------------------------------------
 */

describe("Flux for uns sources", () => {
    const bucket = "uns";

    test("uns_path_test accepts any first segment", () => {
        expect(uns_path_test("Axes/X/Position"))
            .toBe(String.raw`r.path =~ /^[^\/]+\/Axes\/X\/Position$/`);
        expect(uns_path_test(null)).toBe(String.raw`r.path =~ /^[^\/]+$/`);
        expect(uns_path_test("")).toBe(String.raw`r.path =~ /^[^\/]+$/`);
    });

    test("escapes RE2 metacharacters, slashes and control characters", () => {
        expect(flux_regex_escape(String.raw`a.b*c+d?(e)[f]{g}|h^i$j\k/l`))
            .toBe(String.raw`a\.b\*c\+d\?\(e\)\[f\]\{g\}\|h\^i\$j\\k\/l`);
        expect(flux_regex_escape("a\nb\u007f")).toBe(String.raw`a\x{0a}b\x{7f}`);
    });

    test("a whole device has no path test", () => {
        const [q, ...rest] = build_flux_queries({ bucket,
            source: { device_uuid: DEVICE, store: "uns" } });
        expect(rest).toEqual([]);
        expect(q).toContain(`from(bucket: "uns")`);
        expect(q).toContain(`r.topLevelInstance ==\n                    "${DEVICE}"`);
        expect(q).not.toContain("r.path");
    });

    test("metrics test the device ID segment and then the folder", () => {
        const [q] = build_flux_queries({ bucket, source: {
            device_uuid: DEVICE, store: "uns",
            metrics: [
                { path: "Axes/X/Position", name: "Actual" },
                { path: null, name: "Switch_Closed" },
            ],
        }});
        expect(q).toContain(String.raw`(r.path =~ /^[^\/]+\/Axes\/X\/Position$/ and (r._measurement == "Actual:i"`);
        expect(q).toContain(String.raw`(r.path =~ /^[^\/]+$/ and (r._measurement == "Switch_Closed:i"`);
        expect(q).not.toContain("not exists r.path");
        expect(q).not.toContain("r.path ==");
    });

    test("a download selector with a path tests the uns form", () => {
        const [q] = build_flux_queries({ bucket,
            source: { device_uuid: DEVICE, store: "uns" },
            filter: { metrics: ["Axes/X/Position/Actual", "Speed"] },
        });
        expect(q).toContain(String.raw`(r.path =~ /^[^\/]+\/Axes\/X\/Position$/ and (r._measurement == "Actual:i"`);
        /* A name-only selector matches the name at any path, as before. */
        expect(q).toContain(`(r._measurement == "Speed:i"`);
        expect(q).not.toContain(`r.path == "Axes/X/Position"`);
    });

    test("the measurement filter is unchanged", () => {
        const [q] = build_flux_queries({ bucket,
            source: { device_uuid: DEVICE, store: "uns" },
            filter: { measurement: "Speed:d" },
        });
        expect(q).toContain(`r._measurement ==\n                    "Speed:d"`);
    });

    test("never writes [^/], which would end the regex literal", () => {
        const [q] = build_flux_queries({ bucket, source: {
            device_uuid: DEVICE, store: "uns",
            metrics: [{ path: "a/b", name: "c" }, { path: null, name: "d" }],
        }, filter: { metrics: ["e/f"] } });
        expect(q).not.toContain("[^/]");
        expect(q).toContain(String.raw`[^\/]`);
    });

    test("escapes a folder that holds regex metacharacters", () => {
        const [q] = build_flux_queries({ bucket, source: {
            device_uuid: DEVICE, store: "uns",
            metrics: [{ path: "Line (1)/Stage.2", name: "Temp" }],
        }});
        expect(q).toContain(String.raw`r.path =~ /^[^\/]+\/Line \(1\)\/Stage\.2$/`);
    });

    test("a sparkplug source is unchanged", () => {
        const [q] = build_flux_queries({ bucket: "default", source: {
            device_uuid: DEVICE, store: "sparkplug",
            metrics: [{ path: "Axes/X/Position", name: "Actual" }, { path: null, name: "S" }],
        }});
        expect(q).toContain(`(r.path == "Axes/X/Position" and`);
        expect(q).toContain(`(not exists r.path and`);
        expect(q).not.toContain("=~");
    });
});

/*
 * ---------------------------------------------------------------
 * CSV
 * ---------------------------------------------------------------
 */

describe("CSV columns from the uns bucket", () => {
    test("a nested metric takes its device from the first path segment", () => {
        expect(csv_device_path(
            { path: "Press_1/Axes/X/Position", _measurement: "Actual:d" }, "uns"))
            .toEqual({ device: "Press_1", path: "Axes/X/Position/Actual" });
    });

    test("a root metric's path is the device ID alone", () => {
        expect(csv_device_path({ path: "Press_1", _measurement: "Switch_Closed:b" }, "uns"))
            .toEqual({ device: "Press_1", path: "Switch_Closed" });
    });

    test("default rows are unchanged", () => {
        expect(csv_device_path(
            { device: "Press_1", path: "Axes/X/Position", _measurement: "Actual:d" }, "sparkplug"))
            .toEqual({ device: "Press_1", path: "Axes/X/Position/Actual" });
        expect(csv_device_path({ device: "Press_1", _measurement: "Switch_Closed:b" }))
            .toEqual({ device: "Press_1", path: "Switch_Closed" });
    });

    /* An InfluxReader whose fake query API answers by bucket. */
    function make_reader (answers) {
        const queries = [];
        const influx_client = {
            getQueryApi () {
                return {
                    response (query) {
                        queries.push(query);
                        const bucket = /from\(bucket: "([^"]+)"\)/.exec(query)[1];
                        const answer = answers[bucket];
                        return {
                            async *iterateRows () {
                                if (answer instanceof Error) throw answer;
                                for (const o of answer ?? [])
                                    yield { values: [], tableMeta: { toObject: () => o } };
                            },
                        };
                    },
                };
            },
        };
        const reader = new InfluxReader({
            debug, influx_org: "org", influx_client,
            buckets: { sparkplug: "default", uns: "uns" },
        });
        return { reader, queries };
    }

    async function export_csv (reader, sources) {
        let text = "";
        for await (const chunk of reader.exportDevices(sources))
            text += chunk;
        return text.split("\n").filter(l => l != "");
    }

    const T = "2026-01-01T00:00:00Z";

    test("a union of both stores gives identical columns", async () => {
        const { reader, queries } = make_reader({
            default: [{ device: "Press_1", path: "Axes/X", _measurement: "Load:d",
                _time: T, _value: 1, unit: "N" }],
            uns: [
                { path: "Oven_2/Zone", _measurement: "Temp:d", _time: T, _value: 2, unit: "degC" },
                { path: "Oven_2", _measurement: "Door:b", _time: T, _value: true },
            ],
        });
        const lines = await export_csv(reader, [
            { device_uuid: DEVICE, store: "sparkplug", from: FROM, to: TO },
            { device_uuid: OTHER_DEVICE, store: "uns", from: FROM, to: TO },
        ]);

        expect(queries.map(q => /from\(bucket: "([^"]+)"\)/.exec(q)[1])).toEqual(["default", "uns"]);
        expect(lines).toEqual([
            "device,metric,timestamp,value,unit,path,device_uuid,instance_uuid,schema_uuid",
            `Press_1,Load,${T},1,N,Axes/X/Load,,,`,
            `Oven_2,Temp,${T},2,degC,Zone/Temp,,,`,
            `Oven_2,Door,${T},true,,Door,,,`,
        ]);
    });

    test("a source with no store reads the default bucket", async () => {
        const { reader, queries } = make_reader({});
        await export_csv(reader, [{ device_uuid: DEVICE, from: FROM, to: TO }]);
        expect(queries[0]).toContain(`from(bucket: "default")`);
    });

    const missing = () => Object.assign(new Error("bucket \"uns\" not found"),
        { name: "HttpError", statusCode: 404 });

    test("a missing UNS bucket reads as empty", async () => {
        const { reader } = make_reader({
            uns: missing(),
            default: [{ device: "Press_1", _measurement: "S:b", _time: T, _value: true }],
        });
        const lines = await export_csv(reader, [
            { device_uuid: OTHER_DEVICE, store: "uns", from: FROM, to: TO },
            { device_uuid: DEVICE, store: "sparkplug", from: FROM, to: TO },
        ]);
        expect(lines).toEqual([
            "device,metric,timestamp,value,unit,path,device_uuid,instance_uuid,schema_uuid",
            `Press_1,S,${T},true,,S,,,`,
        ]);
    });

    test("a missing default bucket is still an error", async () => {
        const { reader } = make_reader({ default: missing() });
        await expect(export_csv(reader, [
            { device_uuid: DEVICE, store: "sparkplug", from: FROM, to: TO },
        ])).rejects.toMatchObject({ statusCode: 404 });
    });
});

describe("downloading a UNS dataset on a site with no UNS bucket", () => {
    test("answers uns_unavailable", async () => {
        const { api } = make_api({ buckets: { sparkplug: "default" } });
        const res = make_res();
        await api.dataset_data({ params: { uuid: UNS_DS }, auth: "tester",
            body: { from: FROM, to: TO } }, res);

        expect(res.code).toBe(503);
        expect(res.body.error).toBe("uns_unavailable");
    });
});

/*
 * ---------------------------------------------------------------
 * Series
 * ---------------------------------------------------------------
 */

describe("series requests name a store", () => {
    const body = { devices: [DEVICE], from: FROM, to: TO, count: true, every: "1h" };

    test("a device request reads sparkplug unless it asks for uns", () => {
        expect(parse_request(body).store).toBe("sparkplug");
        expect(parse_request({ ...body, store: "uns" }).store).toBe("uns");
    });

    test("an unknown store is refused", () => {
        expect(() => parse_request({ ...body, store: "default" }))
            .toThrow(expect.objectContaining({ status: 422, error: "invalid_request" }));
    });

    test("a dataset request may not name a store", () => {
        const { devices, ...rest } = body;
        expect(parse_request({ ...rest, dataset: UNS_DS }).store).toBeNull();
        expect(() => parse_request({ ...rest, dataset: UNS_DS, store: "uns" }))
            .toThrow(expect.objectContaining({ status: 422 }));
    });

    test("check_coverage refuses a long count when a store has no summary", () => {
        const req = parse_request(
            { dataset: UNS_DS, from: "2025-01-01T00:00:00Z", to: TO, count: true, every: "1d" },
            Date.parse(TO), { coverage: () => true });
        const ready = s => s == "sparkplug";

        expect(() => check_coverage(req, ready, ["sparkplug"])).not.toThrow();
        expect(() => check_coverage(req, ready, ["sparkplug", "uns"]))
            .toThrow(expect.objectContaining({ status: 422 }));
    });
});

describe("mean_query for the uns bucket", () => {
    const metrics = [
        { device: DEVICE, metric: "Axes/X/Load", path: "Axes/X", name: "Load", type: null },
        { device: DEVICE, metric: "Speed", path: "", name: "Speed", type: "d" },
    ];
    const windows = [[Date.parse(FROM), Date.parse(TO)]];

    test("tests the uns path form and groups on the whole path, with no per-point map", () => {
        const q = mean_query({ bucket: "uns", metrics, windows, every: "1h", store: "uns" });

        expect(q).toContain(String.raw`r.path =~ /^[^\/]+\/Axes\/X$/`);
        expect(q).toContain(String.raw`r.path =~ /^[^\/]+$/`);
        expect(q).toContain(`group(columns: ["topLevelInstance", "path", "_measurement"])`);
        expect(q).not.toContain("map(");
        expect(q).not.toContain("regexp");
        expect(q).not.toContain("[^/]");
    });

    test("puts the time zone option first on calendar steps", () => {
        const q = mean_query({ bucket: "uns", metrics, windows, every: "1d", store: "uns" });
        expect(q.startsWith(`import "timezone"\noption location`)).toBe(true);
    });

    test("the default bucket's query is unchanged", () => {
        const q = mean_query({ bucket: "default", metrics, windows, every: "1h" });
        expect(q).not.toContain("regexp");
        expect(q).toContain(`r.path == "Axes/X"`);
    });
});

describe("shape_means for the uns bucket", () => {
    const T = s => Date.parse(s);
    const t0 = "2026-01-01T00:00:00Z";
    const row = (result, path, measurement, value) =>
        ({ result, topLevelInstance: DEVICE, path, _measurement: measurement, _time: t0, _value: value });

    test("uns_folder strips the device segment", () => {
        expect(uns_folder("Mill_1/Axes/X")).toBe("Axes/X");
        expect(uns_folder("Mill_1")).toBe("");
        expect(uns_folder(undefined)).toBe("");
    });

    test("matches the requested folder from the whole uns path", () => {
        const rows = [row("mean", "Mill_1/Axes/X", "Load:d", "2"), row("n", "Mill_1/Axes/X", "Load:d", "4"),
                      row("mean", "Mill_1", "Speed:d", "7"), row("n", "Mill_1", "Speed:d", "1")];
        const [load, speed] = shape_means(rows, [
            { device: DEVICE, metric: "Axes/X/Load", path: "Axes/X", name: "Load", type: null },
            { device: DEVICE, metric: "Speed", path: "", name: "Speed", type: "d" },
        ], "5m", "uns");
        expect(load.points).toEqual([[T(t0), 2, 4]]);
        expect(speed.points).toEqual([[T(t0), 7, 1]]);
    });

    test("merges one folder's series under two device IDs by point count", () => {
        const rows = [row("mean", "Mill_1/Axes/X", "Load:d", "2"), row("n", "Mill_1/Axes/X", "Load:d", "1"),
                      row("mean", "Mill_A/Axes/X", "Load:d", "8"), row("n", "Mill_A/Axes/X", "Load:d", "3")];
        const [m] = shape_means(rows,
            [{ device: DEVICE, metric: "Axes/X/Load", path: "Axes/X", name: "Load", type: null }], "5m", "uns");
        expect(m.points).toEqual([[T(t0), 6.5, 4]]);
    });

    test("the default store keeps the path as it is", () => {
        const rows = [row("mean", "Axes/X", "Load:d", "3"), row("n", "Axes/X", "Load:d", "2")];
        const [m] = shape_means(rows,
            [{ device: DEVICE, metric: "Axes/X/Load", path: "Axes/X", name: "Load", type: null }], "5m");
        expect(m.points).toEqual([[T(t0), 3, 2]]);
    });
});

describe("merge_runs", () => {
    test("adds counts, merges means by point count and keeps the newer last time", () => {
        const a = {
            counts: new Map([[DEVICE, [[0, 2], [10, 3]]]]),
            source: "raw", pending: [[0, 5]],
            metrics: [{ device: DEVICE, metric: "M", type: null, unit: null, points: [[0, 1, 1]] }],
            last: new Map([[DEVICE, "2026-01-01T00:00:00.000Z"]]),
        };
        const b = {
            counts: new Map([[DEVICE, [[10, 4]]], [OTHER_DEVICE, [[0, 1]]]]),
            source: "coverage", pending: [[3, 8]],
            metrics: [{ device: DEVICE, metric: "M", type: "d", unit: "mm", points: [[0, 4, 3], [10, 5, 1]] }],
            last: new Map([[DEVICE, "2026-01-02T00:00:00.000Z"]]),
        };
        const out = merge_runs([a, b]);

        expect(out.counts.get(DEVICE)).toEqual([[0, 2], [10, 7]]);
        expect(out.counts.get(OTHER_DEVICE)).toEqual([[0, 1]]);
        expect(out.source).toBe("mixed");
        expect(out.pending).toEqual([[0, 8]]);
        expect(out.metrics[0]).toMatchObject({ unit: "mm", type: "d",
            points: [[0, 13 / 4, 4], [10, 5, 1]] });
        expect(out.last.get(DEVICE)).toBe("2026-01-02T00:00:00.000Z");
    });

    test("one result passes through", () => {
        const r = { counts: null, source: "raw", pending: [], metrics: [], last: null };
        expect(merge_runs([r])).toBe(r);
    });
});

describe("series route with both stores", () => {
    const ROOT = "root@EXAMPLE.ORG";

    function fake_query_api (missing_uns = false) {
        const seen = [];
        return {
            seen,
            queryRows (query, consumer) {
                seen.push(query);
                const bucket = /from\(bucket: "([^"]+)"\)/.exec(query)[1];
                setImmediate(() => {
                    if (missing_uns && bucket == "uns")
                        return consumer.error(Object.assign(new Error("bucket not found"),
                            { name: "HttpError", statusCode: 404 }));
                    for (const d of [DEVICE, OTHER_DEVICE].filter(d => query.includes(`"${d}"`)))
                        consumer.next({ topLevelInstance: d, _time: FROM,
                            _value: bucket == "uns" ? "5" : "7" }, { toObject: v => v });
                    consumer.complete();
                });
            },
        };
    }

    function route ({ buckets = { sparkplug: "default", uns: "uns" }, missing_uns } = {}) {
        const { api } = make_api({ buckets });
        api.data = Object.create(DataFlow.prototype);
        api.data.datasets = rx.of(new Map(Object.entries(DATASETS)));
        api.auth.fetch_acl = async () => () => true;
        const query_api = fake_query_api(missing_uns);
        api.seriesReader = new SeriesReader({ debug, buckets, query_api });
        return { api, query_api };
    }

    function fake_res () {
        return {
            statusCode: null, body: null, headers: {}, writableEnded: false,
            status (s) { this.statusCode = s; return this; },
            json (b) { this.body = b; this.writableEnded = true; return this; },
            set (k, v) { this.headers[k] = v; return this; },
            on () {}, off () {},
        };
    }

    async function post (api, body) {
        const res = fake_res();
        await api.series({ auth: ROOT, body }, res);
        return res;
    }

    const bucket_of = q => /from\(bucket: "([^"]+)"\)/.exec(q)[1];

    test("a dataset of both kinds counts each device in its own bucket", async () => {
        const { api, query_api } = route();
        const res = await post(api, { dataset: MIXED, from: FROM, to: TO, count: true, every: "1h" });

        expect(res.statusCode).toBe(200);
        const by_bucket = Object.fromEntries(query_api.seen.map(q => [bucket_of(q), q]));
        expect(Object.keys(by_bucket).sort()).toEqual(["default", "uns"]);
        expect(by_bucket.default).toContain(DEVICE);
        expect(by_bucket.default).not.toContain(OTHER_DEVICE);
        expect(by_bucket.uns).toContain(OTHER_DEVICE);
        expect(by_bucket.uns).not.toContain(DEVICE);

        expect(res.body.devices[DEVICE].count).toEqual([[Date.parse(FROM), 7]]);
        expect(res.body.devices[OTHER_DEVICE].count).toEqual([[Date.parse(FROM), 5]]);
    });

    test("a device request with store uns reads the uns bucket", async () => {
        const { api, query_api } = route();
        const res = await post(api, { devices: [DEVICE], store: "uns",
            from: FROM, to: TO, count: true, every: "1h" });

        expect(res.statusCode).toBe(200);
        expect(query_api.seen.map(bucket_of)).toEqual(["uns"]);
    });

    test("a device request reads the default bucket by default", async () => {
        const { api, query_api } = route();
        await post(api, { devices: [DEVICE], from: FROM, to: TO, count: true, every: "1h" });
        expect(query_api.seen.map(bucket_of)).toEqual(["default"]);
    });

    test("a UNS dataset on a site with no UNS bucket answers uns_unavailable", async () => {
        const { api, query_api } = route({ buckets: { sparkplug: "default" } });
        const res = await post(api, { dataset: UNS_DS, from: FROM, to: TO, count: true, every: "1h" });

        expect(res.statusCode).toBe(503);
        expect(res.body.error).toBe("uns_unavailable");
        expect(query_api.seen).toEqual([]);
    });

    test("a device request for uns on such a site answers uns_unavailable", async () => {
        const { api } = route({ buckets: { sparkplug: "default" } });
        const res = await post(api, { devices: [DEVICE], store: "uns",
            from: FROM, to: TO, count: true, every: "1h" });
        expect(res.statusCode).toBe(503);
    });

    test("a missing UNS bucket reads as empty, not as a failure", async () => {
        const { api } = route({ missing_uns: true });
        const res = await post(api, { dataset: MIXED, from: FROM, to: TO, count: true, every: "1h" });

        expect(res.statusCode).toBe(200);
        expect(res.body.devices[DEVICE].count).toEqual([[Date.parse(FROM), 7]]);
        expect(res.body.devices[OTHER_DEVICE].count).toEqual([]);
    });
});

describe("series errors", () => {
    test("uns_unavailable is a SeriesError with a JSON body", () => {
        const err = new SeriesError(503, "uns_unavailable", "No UNS bucket.");
        expect(err.body()).toEqual({ error: "uns_unavailable", message: "No UNS bucket." });
    });
});

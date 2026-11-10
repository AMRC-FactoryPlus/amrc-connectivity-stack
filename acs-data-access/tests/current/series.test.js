/*
 * ACS Data Access Service
 * Unit tests for POST /v1/series.
 *
 * These run against fakes (Auth, ConfigDB dataset map and the InfluxDB
 * query API), so they need no cluster.
 */

import * as rx from "rxjs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { UUIDs } from "@amrc-factoryplus/rx-client";
import { APIv1 } from "../../lib/api-v1.js";
import { DataFlow } from "../../lib/dataflow.js";
import { DataAccess as Constants } from "../../lib/constants.js";
import { SeriesReader, SeriesAbort, SeriesQueryError } from "../../lib/series-reader.js";
import { body_errors } from "../../lib/utils.js";
import http from "node:http";
import { series_influx } from "../../lib/series-query.js";
import {
    LIMITS as SeriesLimits,
    SeriesError, parse_request, bucket_start, next_bucket, bucket_count,
    choose_every, merge_windows, group_by_windows, split_windows, split_metric,
    count_query, mean_query, last_query,
    shape_counts, shape_means, shape_last, cache_control,
} from "../../lib/series.js";

const D1 = "11111111-1111-1111-1111-111111111111";
const D2 = "22222222-2222-2222-2222-222222222222";
const D3 = "33333333-3333-3333-3333-333333333333";
const DS = "44444444-4444-4444-4444-444444444444";
const ROOT = "root@EXAMPLE.ORG";
const USER = "user@EXAMPLE.ORG";
const ADMIN = "admin@EXAMPLE.ORG";

const T = s => Date.parse(s);
const iso = t => new Date(t).toISOString();
const debug = { bound: () => () => {} };

const base = {
    devices: [D1],
    from: "2026-10-08T00:00:00.000Z",
    to: "2026-10-09T00:00:00.000Z",
};

function refused(body) {
    try {
        parse_request(body);
    }
    catch (err) {
        expect(err).toBeInstanceOf(SeriesError);
        return err;
    }
    throw new Error("request was accepted");
}


describe("request validation", () => {
    test("accepts a minimal device request and picks a step for 300 points", () => {
        const r = parse_request(base);
        expect(r.devices).toEqual([D1]);
        expect(r.every).toBe("5m");
        expect(r.count).toBe(false);
        expect(r.mean).toEqual([]);
        expect(r.last).toBe(null);
    });

    test("400 for a body that is not an object", () => {
        expect(refused(null).status).toBe(400);
        expect(refused([1]).status).toBe(400);
        expect(refused("x").status).toBe(400);
    });

    test("422 for both or neither of devices and dataset", () => {
        expect(refused({ ...base, dataset: DS }).status).toBe(422);
        const { devices, ...none } = base;
        expect(refused(none).status).toBe(422);
    });

    test("422 for a bad UUID", () => {
        expect(refused({ ...base, devices: ["not-a-uuid"] }).status).toBe(422);
        expect(refused({ ...base, devices: [`${D1}" or true`] }).status).toBe(422);
        const { devices, ...rest } = base;
        expect(refused({ ...rest, dataset: "nope" }).status).toBe(422);
        expect(refused({ ...base, mean: [{ device: "x", metric: "a" }] }).status).toBe(422);
    });

    test("422 for bad dates and from >= to", () => {
        expect(refused({ ...base, from: "yesterday" }).status).toBe(422);
        expect(refused({ ...base, from: "2026-02-30T00:00:00Z" }).status).toBe(422);
        expect(refused({ ...base, to: base.from }).status).toBe(422);
        expect(refused({ ...base, from: base.to, to: base.from }).status).toBe(422);
    });

    test("422 for every off the ladder", () => {
        for (const every of ["2m", "1mo", "15m)", 900, "1h |> drop()"])
            expect(refused({ ...base, every }).status).toBe(422);
    });

    test("422 with a suggested step when over 2000 buckets", () => {
        const err = refused({ ...base, every: "10s" });
        expect(err.status).toBe(422);
        expect(err.body().every).toBe("1m");
    });

    test("points chooses the smallest step at or under the target", () => {
        expect(parse_request({ ...base, points: 24 }).every).toBe("1h");
        expect(parse_request({ ...base, points: 25 }).every).toBe("1h");
        expect(parse_request({ ...base, points: 96 }).every).toBe("15m");
        expect(parse_request({ ...base, points: 2000 }).every).toBe("1m");
        expect(parse_request({ ...base, every: "6h", points: 2000 }).every).toBe("6h");
        expect(refused({ ...base, points: 0 }).status).toBe(422);
        expect(refused({ ...base, points: 2001 }).status).toBe(422);
        expect(refused({ ...base, points: 1.5 }).status).toBe(422);
    });

    test("413 over the device and metric limits, naming the limit", () => {
        const many = Array.from({ length: 501 },
            (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`);
        const err = refused({ ...base, devices: many });
        expect(err.status).toBe(413);
        expect(err.body()).toMatchObject({ error: "too_many_devices", limit: 500 });

        const mean = Array.from({ length: 51 }, () => ({ device: D1, metric: "a" }));
        expect(refused({ ...base, mean }).status).toBe(413);
    });

    test("422 for count over 14 days, and mean over 400 days", () => {
        const long = { ...base, to: "2026-10-23T00:00:00.000Z", every: "1h" };
        expect(parse_request(long).count).toBe(false);
        expect(refused({ ...long, count: true }).message).toMatch(/coverage summary/);

        const year = { ...base, from: "2025-09-01T00:00:00.000Z", every: "1d" };
        expect(refused({ ...year, mean: [{ device: D1, metric: "a" }] }).status).toBe(422);
    });

    test("last lookback defaults to 30 days and stops at 90", () => {
        expect(parse_request({ ...base, last: true }).last.lookback).toBe(30 * 86400000);
        expect(parse_request({ ...base, last: { lookback: "90d" } }).last.lookback)
            .toBe(90 * 86400000);
        expect(refused({ ...base, last: { lookback: "91d" } }).status).toBe(422);
        expect(refused({ ...base, last: { lookback: "-1d" } }).status).toBe(422);
        expect(refused({ ...base, last: { lookback: "30d) |> drop(" } }).status).toBe(422);
    });

    test("mean entries: types, and devices must be in the request", () => {
        const r = parse_request({ ...base, mean: [
            { device: D1, metric: "Axes/X/Load", type: "d" },
            { device: D1, metric: "Top" },
        ] });
        expect(r.mean[0]).toMatchObject({ path: "Axes/X", name: "Load", type: "d" });
        expect(r.mean[1]).toMatchObject({ path: "", name: "Top", type: null });
        expect(refused({ ...base, mean: [{ device: D1, metric: "a", type: "x" }] }).status).toBe(422);
        expect(refused({ ...base, mean: [{ device: D1, metric: "a/" }] }).status).toBe(422);
        expect(refused({ ...base, mean: [{ device: D2, metric: "a" }] }).status).toBe(422);
    });
});


describe("step selection and alignment", () => {
    test("sub-day steps align to the epoch", () => {
        expect(iso(bucket_start(T("2026-10-08T07:56:10.412Z"), "15m")))
            .toBe("2026-10-08T07:45:00.000Z");
        expect(iso(bucket_start(T("2026-10-08T07:56:10.412Z"), "6h")))
            .toBe("2026-10-08T06:00:00.000Z");
        expect(bucket_count(T(base.from), T(base.to), "15m")).toBe(96);
        expect(bucket_count(T("2026-10-08T00:07:00Z"), T("2026-10-08T00:16:00Z"), "15m")).toBe(2);
    });

    test("choose_every picks the smallest step under the target", () => {
        const from = T(base.from), to = T(base.to);
        expect(choose_every(from, to, 300)).toBe("5m");
        // A UTC day spans two London days in summer.
        expect(choose_every(from, to, 2)).toBe("1d");
        expect(choose_every(from, to, 1)).toBe("1w");
        expect(choose_every(from, from + 10 * 365 * 86400000, 1)).toBe("1w");
    });

    /* These cases were checked against InfluxDB 2.3 with
     * `option location = timezone.location(name: "Europe/London")`. */
    test("1d buckets start at London midnight around the October change", () => {
        expect(iso(bucket_start(T("2026-10-24T22:30:00Z"), "1d"))).toBe("2026-10-23T23:00:00.000Z");
        expect(iso(bucket_start(T("2026-10-24T23:30:00Z"), "1d"))).toBe("2026-10-24T23:00:00.000Z");
        expect(iso(bucket_start(T("2026-10-25T23:30:00Z"), "1d"))).toBe("2026-10-24T23:00:00.000Z");
        // 25 October is 25 hours long
        expect(iso(next_bucket(T("2026-10-24T23:00:00Z"), "1d"))).toBe("2026-10-26T00:00:00.000Z");
    });

    test("1d buckets start at London midnight around the March change", () => {
        expect(iso(bucket_start(T("2026-03-28T23:30:00Z"), "1d"))).toBe("2026-03-28T00:00:00.000Z");
        expect(iso(bucket_start(T("2026-03-29T00:30:00Z"), "1d"))).toBe("2026-03-29T00:00:00.000Z");
        expect(iso(bucket_start(T("2026-03-29T23:30:00Z"), "1d"))).toBe("2026-03-29T23:00:00.000Z");
        // 29 March is 23 hours long
        expect(iso(next_bucket(T("2026-03-29T00:00:00Z"), "1d"))).toBe("2026-03-29T23:00:00.000Z");
        expect(bucket_count(T("2026-03-28T00:00:00Z"), T("2026-03-31T00:00:00Z"), "1d")).toBe(4);
    });

    test("1w buckets start at London Monday midnight across both changes", () => {
        expect(iso(bucket_start(T("2026-03-22T23:30:00Z"), "1w"))).toBe("2026-03-16T00:00:00.000Z");
        expect(iso(bucket_start(T("2026-03-28T23:30:00Z"), "1w"))).toBe("2026-03-23T00:00:00.000Z");
        expect(iso(bucket_start(T("2026-03-29T23:30:00Z"), "1w"))).toBe("2026-03-29T23:00:00.000Z");
        expect(iso(bucket_start(T("2026-10-18T23:30:00Z"), "1w"))).toBe("2026-10-18T23:00:00.000Z");
        expect(iso(bucket_start(T("2026-10-25T23:30:00Z"), "1w"))).toBe("2026-10-18T23:00:00.000Z");
        expect(iso(next_bucket(T("2026-10-18T23:00:00Z"), "1w"))).toBe("2026-10-26T00:00:00.000Z");
        expect(iso(next_bucket(T("2026-03-23T00:00:00Z"), "1w"))).toBe("2026-03-29T23:00:00.000Z");
    });

    test("calendar queries set the London location and a Monday week offset", () => {
        const q = count_query({ bucket: "default", devices: [D1],
            windows: [[T(base.from), T(base.to)]], every: "1w" });
        expect(q).toMatch(/^import "timezone"\noption location = timezone.location\(name: "Europe\/London"\)/);
        expect(q).toContain("every: 1w, offset: 4d");
        const h = count_query({ bucket: "default", devices: [D1],
            windows: [[T(base.from), T(base.to)]], every: "1h" });
        expect(h).not.toContain("timezone");
    });
});


describe("window merging", () => {
    const from = T("2026-10-08T00:00:00Z"), to = T("2026-10-09T00:00:00Z");
    const w = (a, b) => ({ from: a, to: b });

    test("coalesces overlapping and touching windows, keeps disjoint ones", () => {
        expect(merge_windows([
            w("2026-10-08T06:00:00.000Z", "2026-10-08T08:00:00.000Z"),
            w("2026-10-08T01:00:00.000Z", "2026-10-08T02:00:00.000Z"),
            w("2026-10-08T07:00:00.000Z", "2026-10-08T09:00:00.000Z"),
            w("2026-10-08T09:00:00.000Z", "2026-10-08T10:00:00.000Z"),
        ], from, to).map(x => x.map(iso))).toEqual([
            ["2026-10-08T01:00:00.000Z", "2026-10-08T02:00:00.000Z"],
            ["2026-10-08T06:00:00.000Z", "2026-10-08T10:00:00.000Z"],
        ]);
    });

    test("clamps null ends and intersects with the request window", () => {
        expect(merge_windows([w(null, null)], from, to)).toEqual([[from, to]]);
        expect(merge_windows([w("2026-10-01T00:00:00.000Z", "2026-10-08T12:00:00.000Z")], from, to))
            .toEqual([[from, T("2026-10-08T12:00:00Z")]]);
        expect(merge_windows([w("2026-10-08T12:00:00.000Z", null)], from, to))
            .toEqual([[T("2026-10-08T12:00:00Z"), to]]);
        expect(merge_windows([w("2026-10-01T00:00:00.000Z", "2026-10-02T00:00:00.000Z")], from, to))
            .toEqual([]);
    });

    test("groups devices with identical window sets", () => {
        const groups = group_by_windows(new Map([
            [D1, [[1, 2]]], [D2, [[1, 2]]], [D3, [[1, 2], [3, 4]]], [DS, []],
        ]));
        expect(groups).toEqual([
            { devices: [D1, D2], windows: [[1, 2]] },
            { devices: [D3], windows: [[1, 2], [3, 4]] },
        ]);
    });
});


describe("Flux builders", () => {
    const windows = [[T(base.from), T(base.to)]];

    test("count query excludes birth metadata and counts before summing", () => {
        const q = count_query({ bucket: "default", devices: [D1, D2], windows, every: "15m" });
        expect(q).toMatchSnapshot();
        expect(q).toContain(`r._measurement != "Schema_UUID:s" and r._measurement != "Instance_UUID:s"`);
        expect(q.indexOf("aggregateWindow")).toBeLessThan(q.indexOf("group(columns"));
    });

    test("adds a _time filter only for more than one window", () => {
        const one = count_query({ bucket: "default", devices: [D1], windows, every: "1h" });
        expect(one).not.toContain("r._time");
        const two = count_query({ bucket: "default", devices: [D1], every: "1h", windows: [
            [T("2026-10-08T01:00:00Z"), T("2026-10-08T02:00:00Z")],
            [T("2026-10-08T05:00:00Z"), T("2026-10-08T06:00:00Z")],
        ] });
        expect(two).toContain("range(start: 2026-10-08T01:00:00.000Z, stop: 2026-10-08T06:00:00.000Z)");
        expect(two).toContain("(r._time >= 2026-10-08T01:00:00.000Z and r._time < 2026-10-08T02:00:00.000Z) or "
            + "(r._time >= 2026-10-08T05:00:00.000Z and r._time < 2026-10-08T06:00:00.000Z)");
    });

    test("mean query: numeric suffixes without type, one with type, empty path", () => {
        const q = mean_query({ bucket: "default", windows, every: "5m", metrics: [
            { device: D1, path: "Axes/X", name: "Load", type: null },
            { device: D2, path: "", name: "Top", type: "i" },
        ] });
        expect(q).toMatchSnapshot();
        expect(q).toContain(`r.path == "Axes/X" and (r._measurement == "Load:d" or r._measurement == "Load:i" or r._measurement == "Load:u")`);
        /* InfluxDB drops empty tags: a top-level metric has no path. */
        expect(q).toContain(`(not exists r.path) and (r._measurement == "Top:i")`);
        expect(q).not.toContain(":b");
        expect(q).not.toContain("toFloat");
        expect(q).toContain(`yield(name: "sum")`);
        expect(q).toContain(`yield(name: "n")`);
        expect(q).toContain(`yield(name: "unit")`);
    });

    test("booleans get their own branch only when asked for, with no toFloat", () => {
        const q = mean_query({ bucket: "default", windows, every: "5m", metrics: [
            { device: D1, path: "A", name: "Running", type: "b" },
        ] });
        expect(q).toMatchSnapshot();
        expect(q).toContain(`r._measurement == "Running:b"`);
        expect(q).not.toContain("toFloat");
        /* The sum of 0s and 1s is the count of true points. */
        expect(q).toMatch(
            /filter\(fn: \(r\) => r\._value == true\)\n {2}\|> aggregateWindow\(every: 5m, fn: count, .*\n.*yield\(name: "sum_b"\)/);
        expect(q).toContain(`yield(name: "n_b")`);
        expect(q).toContain(`yield(name: "unit_b")`);
        expect(q).not.toContain("fn: sum");
        expect(q).not.toMatch(/^data =/m);
    });

    test("string metrics are not queried", () => {
        expect(mean_query({ bucket: "default", windows, every: "5m", metrics: [
            { device: D1, path: "A", name: "Mode", type: "s" },
        ] })).toBe(null);
    });

    test("hostile metric names are escaped as Flux strings", () => {
        const metric = `A\\B"/Na"me ${"${x}"}") or r._measurement =~ ".*" or ("`;
        const { path, name } = split_metric(metric);
        const q = mean_query({ bucket: "default", windows, every: "5m",
            metrics: [{ device: D1, path, name, type: "d" }] });
        expect(q).toMatchSnapshot();
        expect(q).toContain(`r.path == "A\\\\B\\""`);
        expect(q).toContain(
            `r._measurement == "Na\\"me \\\${x}\\") or r._measurement =~ \\".*\\" or (\\":d"`);
        // Every quote inside the literal is escaped, so the literal never ends early.
        const literal = /r\._measurement == ("(?:[^"\\]|\\.)*")/.exec(q)[1];
        expect(literal.endsWith(`:d"`)).toBe(true);
    });

    test("hostile bucket names are escaped", () => {
        const q = last_query({ bucket: `x") |> drop() //`, devices: [D1], start: 0 });
        expect(q).toContain(`from(bucket: "x\\") |> drop() //")`);
    });

    test("last query drops _value before merging", () => {
        const q = last_query({ bucket: "default", devices: [D1, D2], start: T(base.from) });
        expect(q).toMatchSnapshot();
        expect(q.indexOf(`keep(columns: ["topLevelInstance", "_time"])`))
            .toBeLessThan(q.indexOf("max(column"));
    });
});


describe("result shaping", () => {
    test("counts are sparse, sorted and moved to bucket starts", () => {
        const counts = shape_counts([
            { topLevelInstance: D1, _time: "2026-10-08T00:15:00Z", _value: "5" },
            { topLevelInstance: D1, _time: "2026-10-08T00:07:00Z", _value: "3" },
            { topLevelInstance: D2, _time: "2026-10-08T00:00:00Z", _value: "1" },
        ], "15m");
        expect(counts.get(D1)).toEqual([[T("2026-10-08T00:00:00Z"), 3], [T("2026-10-08T00:15:00Z"), 5]]);
        expect(counts.get(D2)).toEqual([[T("2026-10-08T00:00:00Z"), 1]]);
    });

    test("merges :i and :d rows of one metric with n weights", () => {
        const t0 = "2026-10-08T00:00:00Z", t1 = "2026-10-08T00:05:00Z";
        const row = (result, m, _time, _value, extra = {}) =>
            ({ result, topLevelInstance: D1, path: "P", _measurement: m, _time, _value, ...extra });
        const rows = [
            row("sum", "Power:i", t0, "10"), row("n", "Power:i", t0, "1"),
            row("sum", "Power:d", t0, "60"), row("n", "Power:d", t0, "3"),
            row("sum", "Power:d", t1, "8"), row("n", "Power:d", t1, "2"),
            row("unit", "Power:i", "2026-10-08T00:01:00Z", undefined, { unit: "W" }),
            row("unit", "Power:d", "2026-10-08T00:06:00Z", undefined, { unit: "kW" }),
        ];
        const [m] = shape_means(rows, [{ device: D1, metric: "P/Power", path: "P", name: "Power", type: null }], "5m");
        expect(m).toEqual({
            device: D1, metric: "P/Power", type: "d", unit: "kW",
            points: [[T(t0), 17.5, 4], [T(t1), 4, 2]],
        });
    });

    test("a requested type keeps only its own suffix; strings are empty", () => {
        const rows = [
            { result: "sum", topLevelInstance: D1, path: "", _measurement: "X:i", _time: "2026-10-08T00:00:00Z", _value: "1" },
            { result: "n", topLevelInstance: D1, path: "", _measurement: "X:i", _time: "2026-10-08T00:00:00Z", _value: "1" },
        ];
        const [i, d, s] = shape_means(rows, [
            { device: D1, metric: "X", path: "", name: "X", type: "i" },
            { device: D1, metric: "X", path: "", name: "X", type: "d" },
            { device: D1, metric: "S", path: "", name: "S", type: "s" },
        ], "5m");
        expect(i.points).toEqual([[T("2026-10-08T00:00:00Z"), 1, 1]]);
        expect(d.points).toEqual([]);
        expect(s).toEqual({ device: D1, metric: "S", type: "s", unit: null, points: [] });
    });

    test("boolean yields map back to the metric", () => {
        const rows = [
            { result: "sum_b", topLevelInstance: D1, path: "A", _measurement: "On:b", _time: "2026-10-08T00:00:00Z", _value: "2" },
            { result: "n_b", topLevelInstance: D1, path: "A", _measurement: "On:b", _time: "2026-10-08T00:00:00Z", _value: "4" },
        ];
        const [m] = shape_means(rows, [{ device: D1, metric: "A/On", path: "A", name: "On", type: "b" }], "5m");
        expect(m.points).toEqual([[T("2026-10-08T00:00:00Z"), 0.5, 4]]);
        expect(m.type).toBe("b");
    });

    test("a boolean bucket with no true point has a mean of 0", () => {
        /* The sum is a count of true points, so it has no row here. */
        const rows = [
            { result: "n_b", topLevelInstance: D1, path: "A", _measurement: "On:b", _time: "2026-10-08T00:00:00Z", _value: "4" },
            { result: "n_b", topLevelInstance: D1, path: "A", _measurement: "On:b", _time: "2026-10-08T00:05:00Z", _value: "3" },
            { result: "sum_b", topLevelInstance: D1, path: "A", _measurement: "On:b", _time: "2026-10-08T00:05:00Z", _value: "3" },
        ];
        const [m] = shape_means(rows, [{ device: D1, metric: "A/On", path: "A", name: "On", type: "b" }], "5m");
        expect(m.points).toEqual([
            [T("2026-10-08T00:00:00Z"), 0, 4],
            [T("2026-10-08T00:05:00Z"), 1, 3],
        ]);
    });

    test("a device read by several last queries keeps its newest time", () => {
        const rows = [
            { topLevelInstance: D1, _time: "2026-10-08T05:30:00Z" },
            { topLevelInstance: D1, _time: "2026-10-08T01:30:00Z" },
            { topLevelInstance: D2, _time: "2026-10-08T01:00:00Z" },
            { topLevelInstance: D2, _time: "2026-10-08T02:00:00Z" },
        ];
        expect(shape_last(rows)).toEqual(new Map([
            [D1, "2026-10-08T05:30:00.000Z"], [D2, "2026-10-08T02:00:00.000Z"]]));
    });

    test("last rows become ISO strings", () => {
        expect(shape_last([{ topLevelInstance: D1, _time: "2026-10-08T07:55:54.302Z" }]))
            .toEqual(new Map([[D1, "2026-10-08T07:55:54.302Z"]]));
    });

    test("closed history may be cached; recent data may not", () => {
        const r = { every: "15m", to: T("2026-10-08T00:00:00Z") };
        expect(cache_control(r, T("2026-10-08T00:31:00Z"))).toBe("private, max-age=300");
        expect(cache_control(r, T("2026-10-08T00:29:00Z"))).toBe("no-store");
    });
});


/*
 * ---------------------------------------------------------------
 * Route tests: permissions and the response shape
 * ---------------------------------------------------------------
 */

/* A fake InfluxDB query API. It answers by the kind of query, and
 * records each query it saw. */
function fake_query_api(rows = {}) {
    const seen = [];
    return {
        seen,
        queryRows(query, consumer) {
            seen.push(query);
            const kind = query.includes("yield(name") ? "mean"
                : query.includes("max(column") ? "last" : "count";
            setImmediate(() => {
                for (const r of rows[kind]?.(query) ?? [])
                    consumer.next(r, { toObject: v => v });
                consumer.complete();
            });
        },
    };
}

/* grants: principal -> targets for UseDevice. A principal named in
 * `refused` gets that status from Auth; `acl` replaces fetch_acl. `cdb`
 * answers ConfigDB reads, such as a sub-device's origin map. */
function make_api({ grants = {}, read = [], datasets = {}, rows, query_api,
        refused = {}, acl, cdb = { get_config: async () => undefined } } = {}) {
    const flow = Object.create(DataFlow.prototype);
    flow.datasets = rx.of(new Map(Object.entries(datasets)));

    const fetch_acl = acl ?? (async principal => {
        if (principal == ROOT) return () => true;
        if (refused[principal] != null)
            throw Object.assign(new Error("Failed to read ACL"), { status: refused[principal] });
        const targets = grants[principal] ?? [];
        return (perm, target, wild) => perm == Constants.Perm.UseDevice
            && (targets.includes(target) || (wild && targets.includes(UUIDs.Special.Null)));
    });

    const api = new APIv1({
        data: flow,
        debug,
        auth: {
            fetch_acl,
            check_acl: async (principal, perm, target) =>
                principal == ROOT || (perm == Constants.Perm.ReadDataset && read.includes(target)),
        },
        cdb,
    });
    const qa = query_api ?? fake_query_api(rows);
    api.seriesReader = new SeriesReader({ debug, influx_bucket: "default", query_api: qa });
    return { api, query_api: qa };
}

function fake_res() {
    const res = {
        statusCode: null, body: null, headers: {}, writableEnded: false,
        listeners: {},
        status(s) { this.statusCode = s; return this; },
        json(b) { this.body = b; this.writableEnded = true; return this; },
        set(k, v) { this.headers[k] = v; return this; },
        on(e, f) { this.listeners[e] = f; },
        off(e) { delete this.listeners[e]; },
    };
    return res;
}

async function call(api, auth, body) {
    const res = fake_res();
    try {
        await api.series({ auth, body }, res);
    }
    catch (err) {
        if (err.status) return { statusCode: err.status, error: err };
        throw err;
    }
    return res;
}

const count_rows = query => [D1, D2, D3]
    .filter(d => query.includes(`"${d}"`))
    .map(d => ({ topLevelInstance: d, _time: "2026-10-08T00:00:00Z", _value: "7" }));

describe("series route permissions", () => {
    const req = { ...base, devices: [D1, D2], count: true, every: "1h" };

    test("root sees every device without grants", async () => {
        const { api } = make_api({ rows: { count: count_rows } });
        const res = await call(api, ROOT, req);
        expect(res.statusCode).toBe(200);
        expect(Object.keys(res.body.devices)).toEqual([D1, D2]);
        expect(res.body.denied).toEqual([]);
    });

    test("a wildcard grant allows every device", async () => {
        const { api } = make_api({ grants: { [ADMIN]: [UUIDs.Special.Null] }, rows: { count: count_rows } });
        const res = await call(api, ADMIN, req);
        expect(res.statusCode).toBe(200);
        expect(res.body.denied).toEqual([]);
    });

    test("partial denial lists denied devices and leaves them out of the queries", async () => {
        const { api, query_api } = make_api({ grants: { [USER]: [D1] }, rows: { count: count_rows } });
        const res = await call(api, USER, { ...req, last: true,
            mean: [{ device: D2, metric: "A/B" }] });
        expect(res.statusCode).toBe(200);
        expect(res.body.denied).toEqual([D2]);
        expect(Object.keys(res.body.devices)).toEqual([D1]);
        expect(res.body.metrics).toEqual([]);
        expect(query_api.seen.join("\n")).not.toContain(D2);
    });

    test("403 when every device is denied", async () => {
        const { api, query_api } = make_api({ grants: { [USER]: [D3] } });
        expect((await call(api, USER, req)).statusCode).toBe(403);
        expect(query_api.seen).toEqual([]);
    });

    test("403 without ReadDataset on a dataset", async () => {
        const { api } = make_api({ datasets: {} });
        const { devices, ...rest } = req;
        expect((await call(api, USER, { ...rest, dataset: DS })).statusCode).toBe(403);
    });

    test("404 for an unknown dataset", async () => {
        const { api } = make_api({ read: [DS] });
        const { devices, ...rest } = req;
        expect((await call(api, USER, { ...rest, dataset: DS })).statusCode).toBe(404);
    });

    const session_dataset = {
        [DS]: { structure: Constants.App.SessionLimits, config: {
            source: D3, from: "2026-10-08T06:00:00.000Z", to: "2026-10-08T12:00:00.000Z" } },
        [D3]: { structure: Constants.App.SparkplugSrc, config: { source: D1 } },
    };

    test("a dataset request returns windows and needs no device grant", async () => {
        const { api, query_api } = make_api({ read: [DS], datasets: session_dataset,
            rows: { count: count_rows } });
        const { devices, ...rest } = req;
        const res = await call(api, USER, { ...rest, dataset: DS });
        expect(res.statusCode).toBe(200);
        expect(res.body.devices[D1].windows).toEqual([
            ["2026-10-08T06:00:00.000Z", "2026-10-08T12:00:00.000Z"]]);
        expect(query_api.seen[0]).toContain(
            "range(start: 2026-10-08T06:00:00.000Z, stop: 2026-10-08T12:00:00.000Z)");
    });

    test("422 for a mean device outside the dataset", async () => {
        const { api } = make_api({ read: [DS], datasets: session_dataset });
        const { devices, ...rest } = req;
        const res = await call(api, USER, { ...rest, dataset: DS,
            mean: [{ device: D2, metric: "A" }] });
        expect(res.statusCode).toBe(422);
        expect(res.body.error).toBe("invalid_request");
    });

    /* D3 is a sub-device of D1 holding Axes/X/Load and the root metric
     * Switch, but not Axes/X/Temp. */
    const AXIS = "a1a1a1a1-0000-4000-8000-000000000001";
    const DS2 = "55555555-5555-5555-5555-555555555555";
    const origin_map = {
        Instance_UUID: D1,
        Switch: { Sparkplug_Type: "Boolean", Record_To_Historian: true },
        Axes: { X: {
            Instance_UUID: AXIS,
            Load: { Sparkplug_Type: "Double", Record_To_Historian: true },
            Temp: { Sparkplug_Type: "Double", Record_To_Historian: true },
        } },
    };
    const sub_device = { structure: Constants.App.SparkplugSubset, config: {
        source: D1,
        metrics: [{ instance: AXIS, metric: "Load" }, { instance: D1, metric: "Switch" }],
    } };
    const cdb = {
        get_config: async (app, obj) => app == UUIDs.App.DeviceInformation && obj == D1
            ? { originMap: origin_map } : undefined,
    };
    const sub_request = mean => {
        const { devices, ...rest } = req;
        return { ...rest, dataset: DS, mean };
    };

    test("a sub-device dataset allows means of its own metrics", async () => {
        const { api } = make_api({ read: [DS], cdb, datasets: { [DS]: sub_device },
            rows: { count: count_rows } });
        const res = await call(api, USER, sub_request([
            { device: D1, metric: "Axes/X/Load" },
            { device: D1, metric: "Switch", type: "b" },
        ]));
        expect(res.statusCode).toBe(200);
        expect(res.body.metrics.map(m => m.metric)).toEqual(["Axes/X/Load", "Switch"]);
    });

    test("422 for a mean metric outside a sub-device", async () => {
        const { api, query_api } = make_api({ read: [DS], cdb, datasets: { [DS]: sub_device } });
        const res = await call(api, USER, sub_request([{ device: D1, metric: "Axes/X/Temp" }]));
        expect(res.statusCode).toBe(422);
        expect(res.body.error).toBe("invalid_request");
        expect(query_api.seen).toEqual([]);
    });

    test("the whole device in the same windows grants every metric", async () => {
        const datasets = {
            [DS]: { structure: Constants.App.UnionComponents, config: [D2, D3] },
            [D2]: { structure: Constants.App.SparkplugSrc, config: { source: D1 } },
            [D3]: sub_device,
        };
        const { api } = make_api({ read: [DS], cdb, datasets, rows: { count: count_rows } });
        expect((await call(api, USER, sub_request([{ device: D1, metric: "Axes/X/Temp" }])))
            .statusCode).toBe(200);
    });

    test("a metric must be granted across all of its device's windows", async () => {
        /* The whole device for six hours, the sub-device for the day. */
        const datasets = {
            [DS]: { structure: Constants.App.UnionComponents, config: [DS2, D3] },
            [DS2]: { structure: Constants.App.SessionLimits, config: {
                source: D2, from: "2026-10-08T06:00:00.000Z", to: "2026-10-08T12:00:00.000Z" } },
            [D2]: { structure: Constants.App.SparkplugSrc, config: { source: D1 } },
            [D3]: sub_device,
        };
        const { api } = make_api({ read: [DS], cdb, datasets, rows: { count: count_rows } });
        expect((await call(api, USER, sub_request([{ device: D1, metric: "Axes/X/Temp" }])))
            .statusCode).toBe(422);
        expect((await call(api, USER, sub_request([{ device: D1, metric: "Axes/X/Load" }])))
            .statusCode).toBe(200);
    });
});

describe("series route principals", () => {
    const PU = "55555555-5555-4555-8555-555555555555";
    const req = { ...base, devices: [D1, D2], count: true, every: "1h" };

    test("a JWT caller's principal UUID is checked through fetch_acl", async () => {
        const asked = [];
        const { api } = make_api({ rows: { count: count_rows },
            acl: async p => { asked.push(p);
                return (perm, target) => perm == Constants.Perm.UseDevice && target == D1; } });
        const res = await call(api, PU, req);
        expect(res.statusCode).toBe(200);
        expect(asked).toEqual([PU]);
        expect(res.body.denied).toEqual([D2]);
    });

    test("a principal Auth has no ACL for is denied, not left waiting", async () => {
        const { api, query_api } = make_api({ refused: { [PU]: 404 } });
        expect((await call(api, PU, req)).statusCode).toBe(403);
        expect(query_api.seen).toEqual([]);
    });

    test("503 when Auth cannot be reached", async () => {
        const { api } = make_api({ refused: { [PU]: 0 } });
        expect((await call(api, PU, req)).statusCode).toBe(503);
    });

    test("the request time limit covers the permission lookup", async () => {
        const { api, query_api } = make_api({ acl: () => new Promise(() => {}) });
        api.seriesReader.timeout_ms = 20;
        expect((await call(api, PU, req)).statusCode).toBe(504);
        expect(query_api.seen).toEqual([]);
    });
});

describe("series fan-out limits", () => {
    test("422 when a dataset has more distinct window sets than the limit", async () => {
        const n = SeriesLimits.groups + 1;
        const dev = i => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
        const parts = Array.from({ length: n }, (_, i) => `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
        const datasets = {
            [DS]: { structure: Constants.App.UnionComponents, config: parts },
        };
        const src = i => `20000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
        parts.forEach((p, i) => {
            const day = String(1 + (i % 28)).padStart(2, "0");
            const hour = String(Math.floor(i / 28)).padStart(2, "0");
            datasets[p] = { structure: Constants.App.SessionLimits, config: {
                source: src(i), from: `2026-09-${day}T${hour}:00:00.000Z`,
                to: `2026-09-${day}T${hour}:30:00.000Z` } };
            datasets[src(i)] = { structure: Constants.App.SparkplugSrc, config: { source: dev(i) } };
        });
        const { api, query_api } = make_api({ read: [DS], datasets });
        const res = await call(api, USER, { dataset: DS, last: true, every: "1d",
            from: "2026-09-01T00:00:00.000Z", to: "2026-09-30T00:00:00.000Z" });
        expect(res.statusCode).toBe(422);
        expect(res.body).toMatchObject({ error: "invalid_request", limit: SeriesLimits.groups });
        expect(query_api.seen).toEqual([]);
    });

    test("503 with Retry-After when too many queries are waiting", async () => {
        const hang = { queryRows: (q, consumer) => consumer.useCancellable({ cancel() {} }) };
        const { api } = make_api({ query_api: hang });
        const reader = api.seriesReader;
        reader.max_queue = 1;
        reader.limit.concurrency = 1;
        const ctl = new AbortController();
        const first = reader.query_rows("a", ctl.signal).catch(() => {});
        const second = reader.query_rows("b", ctl.signal).catch(() => {});
        const res = fake_res();
        await expect(api.series({ auth: ROOT, body: { ...base, count: true, every: "1h" } }, res))
            .rejects.toMatchObject({ status: 503 });
        expect(res.headers["Retry-After"]).toBe("5");
        ctl.abort(new SeriesAbort("test"));
        await Promise.all([first, second]);
    });

    test("a query's own timeout starts when it gets a slot", async () => {
        let release;
        const seen = [];
        const qa = { queryRows: (q, consumer) => {
            seen.push(q);
            if (q == "slow") { release = () => consumer.complete(); return; }
            consumer.useCancellable({ cancel() {} });
        } };
        const reader = new SeriesReader({ debug, influx_bucket: "default", query_api: qa,
            concurrency: 1, query_timeout_ms: 30 });
        const ctl = new AbortController();
        const slow = reader.query_rows("slow", ctl.signal);
        const waiting = reader.query_rows("hang", ctl.signal);
        /* The first query holds the slot past the second's own limit. */
        await new Promise(r => setTimeout(r, 20));
        release();
        await slow;
        const t0 = Date.now();
        await expect(waiting).rejects.toMatchObject({ reason: "timeout" });
        expect(Date.now() - t0).toBeGreaterThanOrEqual(20);
        expect(seen).toEqual(["slow", "hang"]);
    });
});

describe("dataset last follows the dataset windows", () => {
    const req = { ...base, last: true, every: "1h" };
    const { devices, ...rest } = req;
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(T("2026-10-09T00:00:00Z"));
    });
    afterEach(() => vi.useRealTimers());

    test("last is clipped to the device's windows", async () => {
        const datasets = {
            [DS]: { structure: Constants.App.SessionLimits, config: {
                source: D3, from: "2026-10-08T06:00:00.000Z", to: "2026-10-08T12:00:00.000Z" } },
            [D3]: { structure: Constants.App.SparkplugSrc, config: { source: D1 } },
        };
        const { api, query_api } = make_api({ read: [DS], datasets,
            rows: { last: () => [{ topLevelInstance: D1, _time: "2026-10-08T11:59:00Z" }] } });
        const res = await call(api, USER, { ...rest, dataset: DS, last: { lookback: "90d" } });
        expect(res.statusCode).toBe(200);
        expect(res.body.devices[D1].last).toBe("2026-10-08T11:59:00.000Z");
        const q = query_api.seen.find(q => q.includes("max(column"));
        expect(q).toContain("range(start: 2026-10-08T06:00:00.000Z, stop: 2026-10-08T12:00:00.000Z)");
    });

    test("last is not clipped to the request, so a live device shows its newest data", async () => {
        /* A Sparkplug source dataset: open at both ends. */
        const datasets = {
            [DS]: { structure: Constants.App.SparkplugSrc, config: { source: D1 } },
        };
        const { api, query_api } = make_api({ read: [DS], datasets,
            rows: { last: () => [{ topLevelInstance: D1, _time: "2026-10-08T23:59:00Z" }] } });
        const res = await call(api, USER, { dataset: DS, last: true, count: true, every: "1h",
            from: "2026-10-02T00:00:00.000Z", to: "2026-10-03T00:00:00.000Z" });
        expect(res.statusCode).toBe(200);
        expect(res.body.devices[D1].last).toBe("2026-10-08T23:59:00.000Z");
        expect(res.body.devices[D1].windows).toEqual([
            ["2026-10-02T00:00:00.000Z", "2026-10-03T00:00:00.000Z"]]);
        /* The last query runs over the lookback up to now... */
        const q = query_api.seen.find(q => q.includes("max(column"));
        expect(q).toContain("range(start: 2026-09-09T00:00:00.000Z, stop: 2026-10-09T00:00:00.000Z)");
        /* ...while the counts keep to the request. */
        const c = query_api.seen.find(q => q.includes("fn: count"));
        expect(c).toContain("range(start: 2026-10-02T00:00:00.000Z, stop: 2026-10-03T00:00:00.000Z)");
    });

    test("last stays inside a closed source window that ends after the request", async () => {
        const datasets = {
            [DS]: { structure: Constants.App.SessionLimits, config: {
                source: D3, from: "2026-10-01T00:00:00.000Z", to: "2026-10-05T00:00:00.000Z" } },
            [D3]: { structure: Constants.App.SparkplugSrc, config: { source: D1 } },
        };
        const { api, query_api } = make_api({ read: [DS], datasets, rows: { last: () => [] } });
        await call(api, USER, { dataset: DS, last: true, every: "1h",
            from: "2026-10-02T00:00:00.000Z", to: "2026-10-03T00:00:00.000Z" });
        const q = query_api.seen.find(q => q.includes("max(column"));
        expect(q).toContain("range(start: 2026-10-01T00:00:00.000Z, stop: 2026-10-05T00:00:00.000Z)");
    });

    test("a device whose windows are outside the lookback gets null and no query", async () => {
        const datasets = {
            [DS]: { structure: Constants.App.SessionLimits, config: {
                source: D3, from: "2020-01-01T00:00:00.000Z", to: "2020-01-02T00:00:00.000Z" } },
            [D3]: { structure: Constants.App.SparkplugSrc, config: { source: D1 } },
        };
        const { api, query_api } = make_api({ read: [DS], datasets });
        const res = await call(api, USER, { dataset: DS, last: true, every: "1h",
            from: "2020-01-01T00:00:00.000Z", to: "2020-01-02T00:00:00.000Z" });
        expect(res.statusCode).toBe(200);
        expect(res.body.devices[D1].last).toBe(null);
        expect(query_api.seen.filter(q => q.includes("max(column"))).toEqual([]);
    });

    test("a device request is not clipped to the request window", async () => {
        const { api, query_api } = make_api({ rows: { last: () => [] } });
        await call(api, ROOT, req);
        const q = query_api.seen.find(q => q.includes("max(column"));
        expect(q).not.toContain("stop:");
    });
});

describe("choosing a step for long counts", () => {
    test("counts over 14 days choose only from the coverage steps", () => {
        const body = { devices: [D1], from: "2026-09-10T00:00:00.000Z",
            to: "2026-09-30T00:00:00.000Z", points: 2000 };
        expect(parse_request(body).every).toBe("15m");
        expect(parse_request({ ...body, count: true }, Date.now(), { coverage: true }).every).toBe("1h");
        expect(choose_every(T(body.from), T(body.to), 2000,
            new Set(["1h", "6h", "1d", "1w"]))).toBe("1h");
    });
});

describe("request body errors", () => {
    const res_for = () => ({
        headersSent: false, statusCode: null, body: null,
        status(s) { this.statusCode = s; return this; },
        json(b) { this.body = b; return this; },
    });

    test("malformed JSON is a 400 JSON body", () => {
        const res = res_for();
        body_errors(Object.assign(new Error("Unexpected token"), { type: "entity.parse.failed", status: 400 }),
            {}, res, () => { throw new Error("passed on"); });
        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ error: "bad_request" });
    });

    test("an oversized body is a 413 JSON body", () => {
        const res = res_for();
        body_errors({ type: "entity.too.large", limit: 102400 }, {}, res, () => {});
        expect(res.statusCode).toBe(413);
        expect(res.body).toMatchObject({ error: "too_large", limit: 102400 });
    });

    test("other errors pass on", () => {
        let passed = null;
        const err = new Error("x");
        body_errors(err, {}, res_for(), e => { passed = e; });
        expect(passed).toBe(err);
    });
});

describe("series route response", () => {
    test("has the documented shape", async () => {
        const rows = {
            count: count_rows,
            last: () => [{ topLevelInstance: D1, _time: "2026-10-08T07:55:54.302Z" }],
            mean: () => [
                { result: "sum", topLevelInstance: D1, path: "A", _measurement: "B:d", _time: "2026-10-08T00:00:00Z", _value: "17" },
                { result: "n", topLevelInstance: D1, path: "A", _measurement: "B:d", _time: "2026-10-08T00:00:00Z", _value: "2" },
                { result: "unit", topLevelInstance: D1, path: "A", _measurement: "B:d", _time: "2026-10-08T00:00:01Z", unit: "kW" },
            ],
        };
        const { api } = make_api({ rows });
        const res = await call(api, ROOT, { ...base, devices: [D1, D2], every: "1h",
            count: true, last: true, mean: [{ device: D1, metric: "A/B" }] });

        expect(res.statusCode).toBe(200);
        expect(res.headers["Cache-Control"]).toBeDefined();
        const { asOf, ...body } = res.body;
        expect(Date.parse(asOf)).not.toBeNaN();
        expect(body).toEqual({
            from: "2026-10-08T00:00:00.000Z",
            to: "2026-10-09T00:00:00.000Z",
            every: "1h",
            source: "raw",
            devices: {
                [D1]: { count: [[T("2026-10-08T00:00:00Z"), 7]], last: "2026-10-08T07:55:54.302Z" },
                [D2]: { count: [[T("2026-10-08T00:00:00Z"), 7]], last: null },
            },
            metrics: [{ device: D1, metric: "A/B", type: "d", unit: "kW",
                points: [[T("2026-10-08T00:00:00Z"), 8.5, 2]] }],
            denied: [],
        });
    });

    test("a JSON error body for 422", async () => {
        const { api } = make_api();
        const res = await call(api, ROOT, { ...base, every: "2m" });
        expect(res.statusCode).toBe(422);
        expect(res.body).toMatchObject({ error: "invalid_request" });
        expect(res.body.message).toMatch(/every/);
    });

    test("504 when the queries run past the timeout", async () => {
        const hang = { queryRows: (q, consumer) => consumer.useCancellable({ cancel() {} }) };
        const { api } = make_api({ query_api: hang });
        api.seriesReader.timeout_ms = 20;
        const res = await call(api, ROOT, { ...base, count: true, every: "1h" });
        expect(res.statusCode).toBe(504);
    });

    test("503 when InfluxDB is unreachable", async () => {
        const down = { queryRows: (q, consumer) => setImmediate(() =>
            consumer.error(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }))) };
        const { api } = make_api({ query_api: down });
        const res = await call(api, ROOT, { ...base, count: true, every: "1h" });
        expect(res.statusCode).toBe(503);
    });

    test("504, not 503, when the InfluxDB client times out", async () => {
        /* The client's own timeout means a slow query, not a down
         * historian. The Data tab words the two differently. */
        const slow = { queryRows: (q, consumer) => setImmediate(() =>
            consumer.error(Object.assign(new Error("Request timed out"), { name: "RequestTimedOutError" }))) };
        const { api } = make_api({ query_api: slow });
        const res = await call(api, ROOT, { ...base, count: true, every: "1h" });
        expect(res.statusCode).toBe(504);
    });

    test("aborts the queries when the client goes away", async () => {
        let cancelled = false;
        const hang = { queryRows: (q, consumer) =>
            consumer.useCancellable({ cancel() { cancelled = true; } }) };
        const { api } = make_api({ query_api: hang });
        const res = fake_res();
        const done = api.series({ auth: ROOT, body: { ...base, count: true, every: "1h" } }, res);
        await new Promise(r => setImmediate(r));
        res.listeners.close();
        await done;
        expect(cancelled).toBe(true);
        expect(res.statusCode).toBe(null);
    });
});

describe("SeriesReader", () => {
    test("rejects with the abort reason", async () => {
        const reader = new SeriesReader({ debug, influx_bucket: "default",
            query_api: { queryRows: () => {} } });
        const ctl = new AbortController();
        const p = reader.query_rows("x", ctl.signal);
        ctl.abort(new SeriesAbort("timeout"));
        await expect(p).rejects.toMatchObject({ reason: "timeout" });
    });
});


/*
 * ---------------------------------------------------------------
 * Means that InfluxDB can work out in storage
 *
 * InfluxDB runs a windowed aggregate in storage only when the filter
 * before it runs in storage too. Its planner (PushDownFilterRule in
 * query/stdlib/influxdata/influxdb/rules.go) splits a filter at its
 * top-level `and`s and sends on the parts made only of:
 *   r.<tag> == or != a literal, but not == "";
 *   r.<tag> =~ or !~ a regex;
 *   exists r.<tag>, and not exists r.<tag>;
 *   r._value compared (== != < <= > >=) with a boolean or a number;
 *   those joined with `and` and `or`.
 * A part with anything else stays in Flux, and the aggregate with it.
 * A filter that is one big `or` is a single part: one bad test in it
 * keeps the whole filter in Flux, and the query reads the whole bucket.
 * A time literal is not a literal that storage takes, so no test of
 * `_time` runs there: only range() limits time in storage.
 *
 * Storage then runs the aggregate only if nothing but range and filter
 * comes before it, and for booleans it has count but no sum.
 * ---------------------------------------------------------------
 */

/* Whether storage can run a whole filter body. */
function storage_can_run(body) {
    let s = body
        .replace(/"(?:[^"\\]|\\.)+"/g, "S")
        .replace(/""/g, "E")
        .replace(/\/(?:[^\/\\]|\\.)+\//g, "R")
        .replace(/not exists r\.\w+/g, "T")
        .replace(/exists r\.\w+/g, "T")
        .replace(/r\.\w+ (?:==|!=) S/g, "T")
        .replace(/r\.\w+ != E/g, "T")
        .replace(/r\.\w+ (?:=~|!~) R/g, "T")
        .replace(/r\._value (?:==|!=|<=?|>=?) (?:true|false|-?\d+(?:\.\d+)?)(?![\w.:-])/g, "T");
    for (let prev = null; prev != s;) {
        prev = s;
        s = s.replace(/\(T\)/g, "T").replace(/T (?:and|or) T/g, "T");
    }
    return s == "T";
}

/* The bodies of every filter() in a script, and the lines between each
 * from() and its aggregate. */
const filter_bodies = q =>
    [...q.matchAll(/^ {2}\|> filter\(fn: \(r\) => (.*)\)$/gm)].map(m => m[1]);

function expect_storage_means(q) {
    const bodies = filter_bodies(q);
    expect(bodies.length).toBeGreaterThan(0);
    for (const b of bodies)
        expect(storage_can_run(b), b).toBe(true);
    /* Nothing but range and filter between a from() and its aggregate. */
    for (const part of q.split(/^from\(/m).slice(1)) {
        const steps = part.split("\n").slice(1)
            .filter(l => l.startsWith("  |> "))
            .map(l => /^ {2}\|> (\w+)/.exec(l)[1]);
        const agg = steps.findIndex(s => s == "aggregateWindow" || s == "last");
        expect(agg).toBeGreaterThan(0);
        expect(steps.slice(0, agg).every(s => s == "range" || s == "filter"), part).toBe(true);
    }
}

describe("mean queries run in storage", () => {
    const windows = [[T(base.from), T(base.to)]];
    const root = (device, name) => ({ device, path: "", name, type: "d" });

    test("the checker refuses what InfluxDB refuses", () => {
        expect(storage_can_run(`r._field == "value"`)).toBe(true);
        expect(storage_can_run(`(r.a == "x" and (not exists r.path) and (r._measurement == "M:d"))`)).toBe(true);
        expect(storage_can_run(`r.path =~ /^[^\\/]+\\/Axes$/`)).toBe(true);
        /* The path test this service sent before. */
        expect(storage_can_run(`(not exists r.path or r.path == "")`)).toBe(false);
        expect(storage_can_run(`r.path == ""`)).toBe(false);
        expect(storage_can_run(`r._time >= 2026-10-08T01:00:00.000Z`)).toBe(false);
        expect(storage_can_run(`contains(value: r._measurement, set: ["a"])`)).toBe(false);
        /* A field value against a literal runs in storage. */
        expect(storage_can_run(`r._value == true`)).toBe(true);
        expect(storage_can_run(`r._value > 0.5`)).toBe(true);
        expect(storage_can_run(`r._value == r.other`)).toBe(false);
        expect(storage_can_run(`float(v: r._value) > 0.5`)).toBe(false);
        expect(storage_can_run(`r._value >= 2026-10-08T01:00:00.000Z`)).toBe(false);
    });

    test("the checker refuses a conversion before the aggregate", () => {
        const q = mean_query({ bucket: "default", windows, every: "5m",
            metrics: [root(D1, "Float")] });
        expect_storage_means(q);
        const converted = q.replace(/^ {2}\|> aggregateWindow/m, "  |> toFloat()\n  |> aggregateWindow");
        expect(converted).not.toBe(q);
        expect(() => expect_storage_means(converted)).toThrow();
    });

    test("boolean metrics, root and nested, in both stores", () => {
        const metrics = [
            { device: D1, path: "", name: "Running", type: "b" },
            { device: D2, path: "Axes/X", name: "Homed", type: "b" },
        ];
        for (const store of [null, "uns"]) {
            const q = mean_query({ bucket: "b", store, windows, every: "5m", metrics });
            expect_storage_means(q);
            expect(q.match(/^from\(/gm).length).toBe(3);
        }
    });

    test("numeric and boolean metrics in one request", () => {
        const q = mean_query({ bucket: "default", windows, every: "1h", metrics: [
            root(D1, "Float"), { device: D1, path: "A", name: "Running", type: "b" },
        ] });
        expect_storage_means(q);
        expect(q.match(/^from\(/gm).length).toBe(6);
    });

    test("a query over two windows cannot run in storage, so the reader never sends one that fits the budget", () => {
        const two = [
            [T("2026-10-08T01:00:00Z"), T("2026-10-08T02:00:00Z")],
            [T("2026-10-08T05:00:00Z"), T("2026-10-08T06:00:00Z")],
        ];
        const metrics = [root(D1, "Float")];
        expect(() => expect_storage_means(
            mean_query({ bucket: "default", windows: two, every: "5m", metrics }))).toThrow();
        expect(() => expect_storage_means(
            count_query({ bucket: "default", windows: two, every: "5m", devices: [D1] }))).toThrow();
        expect(() => expect_storage_means(
            last_query({ bucket: "default", windows: two, start: 0, devices: [D1] }))).toThrow();
        for (const g of split_windows([{ devices: [D1], windows: two }])) {
            expect_storage_means(mean_query({ bucket: "default", every: "5m", metrics, ...g }));
            expect_storage_means(count_query({ bucket: "default", every: "5m", ...g }));
            expect_storage_means(last_query({ bucket: "default", start: 0, ...g }));
        }
    });

    test("one root metric of a sparkplug device", () => {
        const q = mean_query({ bucket: "default", windows, every: "5m",
            metrics: [root(D1, "Float")] });
        expect(q).not.toContain(`== ""`);
        expect_storage_means(q);
    });

    test("two root metrics of one sparkplug device", () => {
        const q = mean_query({ bucket: "default", windows, every: "5m",
            metrics: [root(D1, "Float"), root(D1, "Double")] });
        expect(q).toContain(
            `(r.topLevelInstance == "${D1}" and (not exists r.path) and (r._measurement == "Float:d"))`
            + ` or (r.topLevelInstance == "${D1}" and (not exists r.path) and (r._measurement == "Double:d"))`);
        expect_storage_means(q);
    });

    test("root and nested metrics of two devices, typed and untyped", () => {
        const q = mean_query({ bucket: "default", windows, every: "5m", metrics: [
            root(D1, "Float"), root(D2, "Double"),
            { device: D1, path: "Axes/X", name: "Load", type: null },
            { device: D2, path: "Axes/Y", name: "Load", type: "i" },
        ] });
        expect_storage_means(q);
    });

    test("the uns store, root and nested", () => {
        const q = mean_query({ bucket: "uns", store: "uns", windows, every: "5m", metrics: [
            root(D1, "Float"),
            { device: D2, path: "Axes/X", name: "Load", type: null },
        ] });
        expect_storage_means(q);
    });

    test("the metric filter of N metrics is N clauses joined with or", () => {
        const names = ["A", "B", "C", "D", "E"];
        const q = mean_query({ bucket: "default", windows, every: "5m",
            metrics: names.map(n => root(D1, n)) });
        const metric_filter = filter_bodies(q)[1];
        expect(metric_filter.split(" or ").length).toBe(names.length);
        /* Three reads, whatever the number of metrics. */
        expect(q.match(/^from\(/gm).length).toBe(3);
    });
});

/*
 * ---------------------------------------------------------------
 * One window per query
 *
 * A device of a dataset can have several separate time windows. One
 * query over all of them needs a `_time` filter, which storage cannot
 * run. The reader sends one query per window instead, up to a budget.
 * ---------------------------------------------------------------
 */

/* A dataset of sessions on one device: one window per session. */
function sessions_dataset(spans, device = D1) {
    const id = (p, i) => `${p}0000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const datasets = {
        [DS]: { structure: Constants.App.UnionComponents, config: spans.map((_, i) => id(1, i)) },
    };
    spans.forEach(([from, to], i) => {
        datasets[id(1, i)] = { structure: Constants.App.SessionLimits,
            config: { source: id(2, i), from, to } };
        datasets[id(2, i)] = { structure: Constants.App.SparkplugSrc, config: { source: device } };
    });
    return datasets;
}

describe("splitting window sets into single windows", () => {
    const w = n => Array.from({ length: n }, (_, i) => [i * 10, i * 10 + 5]);
    const sizes = out => out.map(g => g.windows.length);

    test("every window is its own entry when they fit", () => {
        const out = split_windows([
            { devices: [D1], windows: w(3) }, { devices: [D2], windows: w(1) }], 10);
        expect(out).toEqual([
            { devices: [D2], windows: [[0, 5]] },
            { devices: [D1], windows: [[0, 5]] },
            { devices: [D1], windows: [[10, 15]] },
            { devices: [D1], windows: [[20, 25]] },
        ]);
    });

    test("other fields of a group go with each window", () => {
        const out = split_windows([{ devices: [D1], metrics: ["m"], windows: w(2) }], 10);
        expect(out.every(g => g.metrics[0] == "m" && g.devices[0] == D1)).toBe(true);
    });

    test("never more entries than the budget; the rest of a set stays together", () => {
        const out = split_windows([{ devices: [D1], windows: w(150) }], 100);
        expect(out.length).toBe(100);
        expect(sizes(out).slice(0, 99).every(n => n == 1)).toBe(true);
        expect(out[99].windows).toEqual(w(150).slice(99));
        /* No window is lost or read twice. */
        expect(out.flatMap(g => g.windows)).toEqual(w(150));
    });

    test("the smallest sets split first", () => {
        const out = split_windows([
            { devices: [D1], windows: w(8) },
            { devices: [D2], windows: w(2) },
            { devices: [D3], windows: w(3) },
        ], 6);
        /* D2 and D3 split in full (5 entries); D1 has no budget left. */
        expect(out.map(g => [g.devices[0], g.windows.length])).toEqual([
            [D2, 1], [D2, 1], [D3, 1], [D3, 1], [D3, 1], [D1, 8]]);
    });

    test("more sets than the budget: one entry each, unchanged", () => {
        const groups = [
            { devices: [D1], windows: w(2) }, { devices: [D2], windows: w(2) },
            { devices: [D3], windows: w(2) }];
        expect(split_windows(groups, 2)).toEqual(groups);
        expect(split_windows([], 100)).toEqual([]);
    });
});

describe("a dataset device with several windows", () => {
    const spans = [
        ["2026-10-08T01:00:00.000Z", "2026-10-08T02:00:00.000Z"],
        ["2026-10-08T05:00:00.000Z", "2026-10-08T06:00:00.000Z"],
    ];
    const range = ([a, b]) => `range(start: ${a}, stop: ${b})`;
    const body = { dataset: DS, from: base.from, to: base.to, every: "1h" };
    const kinds = seen => ({
        mean: seen.filter(q => q.includes("yield(name")),
        last: seen.filter(q => q.includes("max(column")),
        count: seen.filter(q => !q.includes("yield(name") && !q.includes("max(column")),
    });

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(T("2026-10-09T00:00:00Z"));
    });
    afterEach(() => vi.useRealTimers());

    test("counts, means and last times read one window per query, with no _time filter", async () => {
        const { api, query_api } = make_api({ read: [DS], datasets: sessions_dataset(spans) });
        const res = await call(api, USER, { ...body, count: true, last: true,
            mean: [{ device: D1, metric: "Float", type: "d" }, { device: D1, metric: "On", type: "b" }] });
        expect(res.statusCode).toBe(200);

        const { count, mean, last } = kinds(query_api.seen);
        for (const queries of [count, mean, last]) {
            expect(queries.length).toBe(2);
            for (const q of queries) {
                expect(q).not.toContain("r._time");
                expect_storage_means(q);
            }
            expect(queries.filter(q => q.includes(range(spans[0]))).length).toBe(1);
            expect(queries.filter(q => q.includes(range(spans[1]))).length).toBe(1);
        }
        expect(res.body.devices[D1].windows).toEqual(spans);
    });

    test("the windows' rows add up into one answer", async () => {
        const first = q => q.includes(range(spans[0]));
        const at = q => first(q) ? "2026-10-08T01:00:00Z" : "2026-10-08T05:00:00Z";
        const row = { topLevelInstance: D1, _measurement: "Float:d" };
        const { api } = make_api({ read: [DS], datasets: sessions_dataset(spans), rows: {
            /* Both windows report into the day's one bucket. */
            count: () => [{ topLevelInstance: D1, _time: "2026-10-08T00:00:00Z", _value: "7" }],
            mean: q => [
                { ...row, result: "sum", _time: at(q), _value: first(q) ? "10" : "30" },
                { ...row, result: "n", _time: at(q), _value: "2" },
                { ...row, result: "unit", _time: at(q), unit: first(q) ? "old" : "new" },
            ],
            /* The older window answers last, and must not win. */
            last: q => [{ topLevelInstance: D1,
                _time: first(q) ? "2026-10-08T01:30:00Z" : "2026-10-08T05:30:00Z" }],
        } });
        const res = await call(api, USER, { ...body, every: "1d", count: true, last: true,
            mean: [{ device: D1, metric: "Float", type: "d" }] });
        expect(res.statusCode).toBe(200);
        expect(res.body.devices[D1].count).toEqual([[bucket_start(T(base.from), "1d"), 14]]);
        expect(res.body.devices[D1].last).toBe("2026-10-08T05:30:00.000Z");
        expect(res.body.metrics[0].points).toEqual([[bucket_start(T(base.from), "1d"), 10, 4]]);
        expect(res.body.metrics[0].unit).toBe("new");
    });

    test("a device with no mean metric gets no mean query", async () => {
        const datasets = sessions_dataset(spans);
        const { api, query_api } = make_api({ read: [DS], datasets });
        await call(api, USER, { ...body, count: true });
        expect(kinds(query_api.seen).mean).toEqual([]);
    });

    test("more windows than the budget: the queries stop at the budget, and no window is dropped", async () => {
        const n = SeriesLimits.ranges + 50;
        const minute = i => new Date(T(base.from) + i * 2 * 60000).toISOString();
        const many = Array.from({ length: n }, (_, i) =>
            [minute(i), new Date(Date.parse(minute(i)) + 60000).toISOString()]);
        const { api, query_api } = make_api({ read: [DS], datasets: sessions_dataset(many) });
        const res = await call(api, USER, { ...body, count: true,
            mean: [{ device: D1, metric: "Float", type: "d" }] });
        expect(res.statusCode).toBe(200);

        const { count, mean } = kinds(query_api.seen);
        for (const queries of [count, mean]) {
            expect(queries.length).toBe(SeriesLimits.ranges);
            const filtered = queries.filter(q => q.includes("r._time"));
            expect(filtered.length).toBe(1);
            /* The one filtered query holds every window that did not fit. */
            const rest = many.slice(SeriesLimits.ranges - 1);
            for (const [a, b] of rest)
                expect(filtered[0]).toContain(`(r._time >= ${a} and r._time < ${b})`);
            expect(filtered[0]).toContain(
                `range(start: ${rest[0][0]}, stop: ${rest[rest.length - 1][1]})`);
            for (const [a, b] of many.slice(0, SeriesLimits.ranges - 1))
                expect(queries.filter(q => q.includes(`range(start: ${a}, stop: ${b})`)).length).toBe(1);
        }
    });

    test("two stores share the budget", async () => {
        const seen = [];
        const reader = new SeriesReader({ debug, buckets: { sparkplug: "default", uns: "uns" },
            query_api: fake_query_api() });
        reader.run = async (...args) => {
            seen.push(args[7]);
            return { counts: null, source: "raw", pending: [], metrics: [], last: null };
        };
        const scope = { windows: new Map(), last_windows: new Map() };
        await reader.run_stores({ mean: [] }, new Map([["sparkplug", scope], ["uns", scope]]),
            0, new AbortController().signal, {});
        expect(seen).toEqual([SeriesLimits.ranges / 2, SeriesLimits.ranges / 2]);
    });
});

/*
 * ---------------------------------------------------------------
 * A query that InfluxDB gives up on
 *
 * Once InfluxDB has started a 200 response it reports a failure as a
 * table with the columns `error` and `reference`. The client hands
 * that table on as a row, and then completes.
 * ---------------------------------------------------------------
 */

const data_meta = { columns: [], toObject: v => v };
const error_meta = {
    columns: [{ label: "error" }, { label: "reference" }],
    toObject: ([error, reference]) => ({ error, reference }),
};

/* A query API whose queries end with an error table, after `rows`. */
function failing_query_api(message, rows = []) {
    const api = {
        cancelled: 0,
        queryRows(query, consumer) {
            consumer.useCancellable({ cancel() { api.cancelled++; } });
            setImmediate(() => {
                for (const r of rows) consumer.next(r, data_meta);
                consumer.next([message, ""], error_meta);
                consumer.complete();
            });
        },
    };
    return api;
}

describe("a query InfluxDB gives up on", () => {
    const two_means = { ...base, every: "5m", mean: [
        { device: D1, metric: "Float", type: "d" },
        { device: D1, metric: "Double", type: "d" },
    ] };
    const reader_for = query_api =>
        new SeriesReader({ debug, influx_bucket: "default", query_api });

    test("the reader rejects on an error table with no rows", async () => {
        const qa = failing_query_api("context deadline exceeded");
        const p = reader_for(qa).query_rows("x", new AbortController().signal);
        await expect(p).rejects.toBeInstanceOf(SeriesQueryError);
        await expect(p).rejects.toMatchObject({ timeout: true });
        expect(qa.cancelled).toBe(1);
    });

    test("the reader rejects on an error table after some rows", async () => {
        const row = { result: "n", topLevelInstance: D1, _measurement: "Float:d",
            _time: base.from, _value: "5" };
        const qa = failing_query_api("memory allocation limit reached", [row]);
        const p = reader_for(qa).query_rows("x", new AbortController().signal);
        await expect(p).rejects.toBeInstanceOf(SeriesQueryError);
        await expect(p).rejects.toMatchObject({ timeout: false });
    });

    test("a cancelled query counts as a timeout", () => {
        expect(new SeriesQueryError("context canceled").timeout).toBe(true);
        expect(new SeriesQueryError("query timed out").timeout).toBe(true);
        expect(new SeriesQueryError("schema collision").timeout).toBe(false);
    });

    test("data columns named error and reference among others are rows", async () => {
        const meta = {
            columns: [{ label: "error" }, { label: "reference" }, { label: "_value" }],
            toObject: v => v,
        };
        const qa = { queryRows: (q, consumer) => setImmediate(() => {
            consumer.next({ error: "e", reference: "r", _value: "1" }, meta);
            consumer.complete();
        }) };
        const rows = await reader_for(qa).query_rows("x", new AbortController().signal);
        expect(rows.length).toBe(1);
    });

    test("the reader rejects with a timeout when a query outlives its limit", async () => {
        let cancelled = false;
        const hang = { queryRows: (q, consumer) =>
            consumer.useCancellable({ cancel() { cancelled = true; } }) };
        const reader = reader_for(hang);
        reader.query_timeout_ms = 20;
        await expect(reader.query_rows("x", new AbortController().signal))
            .rejects.toMatchObject({ reason: "timeout" });
        expect(cancelled).toBe(true);
    });

    test("504, never an empty 200, when InfluxDB runs out of time on means", async () => {
        const { api } = make_api({
            query_api: failing_query_api("context deadline exceeded") });
        const res = await call(api, ROOT, two_means);
        expect(res.statusCode).toBe(504);
        expect(res.body).toBeUndefined();
    });

    test("504 when one mean query outlives its limit", async () => {
        const hang = { queryRows: (q, consumer) => consumer.useCancellable({ cancel() {} }) };
        const { api } = make_api({ query_api: hang });
        api.seriesReader.query_timeout_ms = 20;
        const res = await call(api, ROOT, two_means);
        expect(res.statusCode).toBe(504);
    });

    test("500 when InfluxDB fails a query for another reason", async () => {
        const { api } = make_api({
            query_api: failing_query_api("schema collision detected") });
        const res = await call(api, ROOT, two_means);
        expect(res.statusCode).toBe(500);
    });

    test("an error table fails a count request too", async () => {
        const { api } = make_api({ query_api: failing_query_api("context canceled") });
        const res = await call(api, ROOT, { ...base, count: true, every: "1h" });
        expect(res.statusCode).toBe(504);
    });

    test("a query with no rows and no error is still an empty 200", async () => {
        const { api } = make_api({ rows: {} });
        const res = await call(api, ROOT, two_means);
        expect(res.statusCode).toBe(200);
        expect(res.body.metrics.map(m => m.points)).toEqual([[], []]);
    });

    test("two means of one device make one query", async () => {
        const { api, query_api } = make_api({ rows: {} });
        await call(api, ROOT, two_means);
        expect(query_api.seen.length).toBe(1);
        expect_storage_means(query_api.seen[0]);
    });
});


/*
 * ---------------------------------------------------------------
 * Stopping a query in InfluxDB
 *
 * These run the reader against a local HTTP server, through the real
 * InfluxDB client transport. InfluxDB cancels a query when its client
 * closes the connection, so the tests watch for that close.
 * ---------------------------------------------------------------
 */

/* A stand-in for InfluxDB. `answer(res)` replies, or does nothing to
 * leave the query running. `closed` resolves when a client closes a
 * request that has had no reply. */
async function fake_influx(answer = () => {}) {
    let abandoned;
    const closed = new Promise(r => { abandoned = r; });
    const requests = [];
    const server = http.createServer((req, res) => {
        let body = "";
        req.on("data", d => { body += d; });
        req.on("end", () => {
            requests.push({ url: req.url, body: JSON.parse(body) });
            res.on("close", () => { if (!res.writableEnded) abandoned(); });
            answer(res);
        });
    });
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    const reader = new SeriesReader({
        debug, influx_bucket: "default", influx_org: "the org",
        influx_client: series_influx({
            url: `http://127.0.0.1:${server.address().port}`, token: "t" }),
    });
    const stop = () => new Promise(r => { server.closeAllConnections(); server.close(r); });
    return { reader, requests, closed, stop };
}

const csv = lines => res => {
    res.writeHead(200, { "content-type": "text/csv; charset=utf-8" });
    res.end(lines.join("\r\n") + "\r\n");
};

describe("stopping a query in InfluxDB", () => {
    test("reads rows through the client transport", async () => {
        const influx = await fake_influx(csv([
            "#datatype,string,long,string,string,dateTime:RFC3339,double",
            "#group,false,false,true,true,false,false",
            "#default,sum,,,,,",
            ",result,table,topLevelInstance,_measurement,_time,_value",
            `,,0,${D1},Float:d,2026-10-08T00:00:00Z,12.5`,
        ]));
        try {
            const rows = await influx.reader.query_rows("from(x)", new AbortController().signal);
            expect(rows).toEqual([{ result: "sum", table: 0, topLevelInstance: D1,
                _measurement: "Float:d", _time: "2026-10-08T00:00:00Z", _value: 12.5 }]);
            expect(influx.requests[0].url).toBe("/api/v2/query?org=the%20org");
            expect(influx.requests[0].body).toMatchObject({ query: "from(x)", type: "flux" });
        }
        finally { await influx.stop(); }
    });

    test("the error table InfluxDB really sends rejects the query", async () => {
        const influx = await fake_influx(csv([
            "",
            "#datatype,string,string",
            "#group,true,true",
            "#default,,",
            ",error,reference",
            ",context deadline exceeded,",
        ]));
        try {
            await expect(influx.reader.query_rows("x", new AbortController().signal))
                .rejects.toMatchObject({ timeout: true });
        }
        finally { await influx.stop(); }
    });

    test("an empty 200 from InfluxDB is no rows", async () => {
        const influx = await fake_influx(csv([""]));
        try {
            expect(await influx.reader.query_rows("x", new AbortController().signal))
                .toEqual([]);
        }
        finally { await influx.stop(); }
    });

    test("a query that outlives its limit is closed", async () => {
        const influx = await fake_influx();
        influx.reader.query_timeout_ms = 30;
        try {
            await expect(influx.reader.query_rows("x", new AbortController().signal))
                .rejects.toMatchObject({ reason: "timeout" });
            await influx.closed;
        }
        finally { await influx.stop(); }
    });

    test("a query is closed when its request is aborted", async () => {
        const influx = await fake_influx();
        const ctl = new AbortController();
        try {
            const p = influx.reader.query_rows("x", ctl.signal);
            p.catch(() => {});
            while (!influx.requests.length) await new Promise(r => setTimeout(r, 5));
            ctl.abort(new SeriesAbort("client closed"));
            await expect(p).rejects.toMatchObject({ reason: "client closed" });
            await influx.closed;
        }
        finally { await influx.stop(); }
    });

    test("stopping after the whole response has arrived raises nothing", async () => {
        /* The error table is the whole body, so the reader stops a
         * request whose connection is already idle. */
        const influx = await fake_influx(csv(["", ",error,reference", ",context canceled,"]));
        const uncaught = [];
        const on_uncaught = err => uncaught.push(err);
        process.on("uncaughtException", on_uncaught);
        try {
            for (let i = 0; i < 10; i++)
                await expect(influx.reader.query_rows("x", new AbortController().signal))
                    .rejects.toBeInstanceOf(SeriesQueryError);
            await new Promise(r => setTimeout(r, 30));
            expect(uncaught).toEqual([]);
        }
        finally {
            process.off("uncaughtException", on_uncaught);
            await influx.stop();
        }
    });

    test("a waiting query of an aborted request is never sent", async () => {
        const influx = await fake_influx();
        const ctl = new AbortController();
        try {
            /* The default limit runs 4 queries at once. */
            const ps = [1, 2, 3, 4, 5].map(i => influx.reader.query_rows(`q${i}`, ctl.signal));
            ps.forEach(p => p.catch(() => {}));
            while (influx.requests.length < 4) await new Promise(r => setTimeout(r, 5));
            ctl.abort(new SeriesAbort("failed"));
            await Promise.allSettled(ps);
            await new Promise(r => setTimeout(r, 30));
            expect(influx.requests.map(r => r.body.query).sort()).toEqual(["q1", "q2", "q3", "q4"]);
        }
        finally { await influx.stop(); }
    });
});

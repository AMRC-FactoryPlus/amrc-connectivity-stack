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
import { SeriesReader, SeriesAbort } from "../../lib/series-reader.js";
import { body_errors } from "../../lib/utils.js";
import {
    LIMITS as SeriesLimits,
    SeriesError, parse_request, bucket_start, next_bucket, bucket_count,
    choose_every, merge_windows, group_by_windows, split_metric,
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
        expect(q).toContain(`(not exists r.path or r.path == "") and (r._measurement == "Top:i")`);
        expect(q).not.toContain(":b");
        expect(q).not.toContain("toFloat");
        expect(q).toContain(`yield(name: "mean")`);
        expect(q).toContain(`yield(name: "n")`);
        expect(q).toContain(`yield(name: "unit")`);
    });

    test("booleans get their own toFloat branch only when asked for", () => {
        const q = mean_query({ bucket: "default", windows, every: "5m", metrics: [
            { device: D1, path: "A", name: "Running", type: "b" },
        ] });
        expect(q).toContain(`r._measurement == "Running:b"`);
        expect(q).toContain("|> toFloat()");
        expect(q).toContain(`yield(name: "mean_b")`);
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
            row("mean", "Power:i", t0, "10"), row("n", "Power:i", t0, "1"),
            row("mean", "Power:d", t0, "20"), row("n", "Power:d", t0, "3"),
            row("mean", "Power:d", t1, "4"), row("n", "Power:d", t1, "2"),
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
            { result: "mean", topLevelInstance: D1, path: "", _measurement: "X:i", _time: "2026-10-08T00:00:00Z", _value: "1" },
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
            { result: "mean_b", topLevelInstance: D1, path: "A", _measurement: "On:b", _time: "2026-10-08T00:00:00Z", _value: "0.5" },
            { result: "n_b", topLevelInstance: D1, path: "A", _measurement: "On:b", _time: "2026-10-08T00:00:00Z", _value: "4" },
        ];
        const [m] = shape_means(rows, [{ device: D1, metric: "A/On", path: "A", name: "On", type: "b" }], "5m");
        expect(m.points).toEqual([[T("2026-10-08T00:00:00Z"), 0.5, 4]]);
        expect(m.type).toBe("b");
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

/* grants: principal -> targets for UseSparkplug. A principal named in
 * `refused` gets that status from Auth; `acl` replaces fetch_acl. */
function make_api({ grants = {}, read = [], datasets = {}, rows, query_api,
        refused = {}, acl } = {}) {
    const flow = Object.create(DataFlow.prototype);
    flow.datasets = rx.of(new Map(Object.entries(datasets)));

    const fetch_acl = acl ?? (async principal => {
        if (principal == ROOT) return () => true;
        if (refused[principal] != null)
            throw Object.assign(new Error("Failed to read ACL"), { status: refused[principal] });
        const targets = grants[principal] ?? [];
        return (perm, target, wild) => perm == Constants.Perm.UseSparkplug
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
        cdb: {},
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
});

describe("series route principals", () => {
    const PU = "55555555-5555-4555-8555-555555555555";
    const req = { ...base, devices: [D1, D2], count: true, every: "1h" };

    test("a JWT caller's principal UUID is checked through fetch_acl", async () => {
        const asked = [];
        const { api } = make_api({ rows: { count: count_rows },
            acl: async p => { asked.push(p);
                return (perm, target) => perm == Constants.Perm.UseSparkplug && target == D1; } });
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
                { result: "mean", topLevelInstance: D1, path: "A", _measurement: "B:d", _time: "2026-10-08T00:00:00Z", _value: "8.5" },
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

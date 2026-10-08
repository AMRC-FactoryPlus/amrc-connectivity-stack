/*
 * ACS Data Access Service
 * Unit tests for the coverage summary: provisioning, backfill, repair
 * and the read path of POST /v1/series.
 *
 * These run against fakes (the InfluxDB HTTP API and query API), so
 * they need no cluster.
 */

import * as rx from "rxjs";
import { describe, expect, test } from "vitest";

import { APIv1 } from "../../lib/api-v1.js";
import { DataFlow } from "../../lib/dataflow.js";
import { SeriesReader } from "../../lib/series-reader.js";
import { parse_request, LIMITS } from "../../lib/series.js";
import { Coverage, InfluxAdmin } from "../../lib/coverage-service.js";
import {
    RULE_VERSION, MEASUREMENT,
    task_script, chunk_script, coverage_query,
    plan_count, plan_source, split_coverage, intersect,
    fresh_state, needs_rebuild, next_chunk, repair_chunks, parse_state,
    floor_day, ceil_day, prev_day, next_local_hour,
} from "../../lib/coverage.js";

const D1 = "11111111-1111-1111-1111-111111111111";
const D2 = "22222222-2222-2222-2222-222222222222";
const ROOT = "root@EXAMPLE.ORG";
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

const T = s => Date.parse(s);
const iso = t => new Date(t).toISOString();
const debug = { bound: () => () => {} };


/*
 * ---------------------------------------------------------------
 * Fakes
 * ---------------------------------------------------------------
 */

/* A fake InfluxDB management API with an in-memory org, buckets, tasks
 * and backfill marker. */
function fake_admin({ bucket = false, task = null } = {}) {
    const calls = [];
    const fields = new Map();
    const admin = {
        calls,
        fields,
        buckets: bucket ? [{ id: "b1", name: "acs_coverage" }] : [],
        tasks: task ? [{ id: "t1", name: "acs-coverage", status: "active", ...task }] : [],
        runs: [],
        async org_id(name) { calls.push(["org_id", name]); return "o1"; },
        async find_bucket(org, name) {
            calls.push(["find_bucket", org, name]);
            return this.buckets.find(b => b.name == name) ?? null;
        },
        async create_bucket(org, name, shard) {
            calls.push(["create_bucket", org, name, shard]);
            const b = { id: "b1", name };
            this.buckets.push(b);
            return b;
        },
        async find_task(org, name) {
            calls.push(["find_task", org, name]);
            return this.tasks.find(t => t.name == name) ?? null;
        },
        async create_task(org, flux) {
            calls.push(["create_task", org]);
            const t = { id: "t1", name: "acs-coverage", status: "active", flux };
            this.tasks.push(t);
            return t;
        },
        async update_task(id, flux) {
            calls.push(["update_task", id]);
            const t = this.tasks.find(t => t.id == id);
            t.flux = flux;
            return t;
        },
        async task_runs() { return this.runs; },
        async write(org, bucket, lines) {
            calls.push(["write", bucket]);
            /* Parse the marker line back into fields. */
            const [, body] = lines.split(" ");
            for (const kv of body.match(/\w+=("(?:[^"\\]|\\.)*"|[^,]+)/g)) {
                const [k, v] = [kv.slice(0, kv.indexOf("=")), kv.slice(kv.indexOf("=") + 1)];
                fields.set(k,
                    v.startsWith('"') ? v.slice(1, -1)
                    : v.endsWith("i") ? Number(v.slice(0, -1))
                    : v == "true");
            }
            return {};
        },
    };
    return admin;
}

/* A fake query API. It answers the marker, earliest-point and newest-
 * hour queries, records chunk scripts, and can fail chosen chunks. */
function fake_query_api(admin, { earliest = null, newest = null, fail_on = () => false } = {}) {
    const chunks = [];
    return {
        chunks,
        queryRows(query, consumer) {
            setImmediate(() => {
                let rows = [];
                if (query.includes(MEASUREMENT.state))
                    rows = [...admin.fields].map(([_field, _value]) => ({ _field, _value }));
                else if (query.includes("limit(n: 1)"))
                    rows = earliest == null ? [] : [{ _time: iso(earliest) }];
                else if (query.includes("max(column"))
                    rows = newest == null ? [] : [{ _time: iso(newest) }];
                else if (query.includes("to(bucket")) {
                    const m = /range\(start: (\S+), stop: (\S+)\)/.exec(query);
                    const chunk = { start: T(m[1].replace(/,$/, "")), stop: T(m[2].replace(/\)$/, "")) };
                    if (fail_on(chunk))
                        return consumer.error(new Error("chunk failed"));
                    chunks.push(chunk);
                }
                for (const r of rows) consumer.next(r, { toObject: v => v });
                consumer.complete();
            });
        },
    };
}

function make_coverage({ admin = fake_admin(), env = {}, now = T("2026-10-08T10:30:00Z"), ...q } = {}) {
    const query_api = fake_query_api(admin, q);
    const cov = new Coverage({
        debug, admin, query_api, org: "default", raw_bucket: "default",
        env, now: () => now, sleep: async () => {},
    });
    return { cov, admin, query_api };
}


/*
 * ---------------------------------------------------------------
 * Provisioning
 * ---------------------------------------------------------------
 */

describe("provisioning", () => {
    test("creates a missing bucket and task", async () => {
        const { cov, admin } = make_coverage();
        const ids = await cov.ensure();
        expect(ids).toEqual({ org_id: "o1", bucket_id: "b1", task_id: "t1" });
        expect(admin.calls.map(c => c[0])).toContain("create_bucket");
        expect(admin.calls.map(c => c[0])).toContain("create_task");
        expect(admin.calls.find(c => c[0] == "create_bucket")[3]).toBe(30 * 24 * 3600);
        expect(admin.tasks[0].flux).toBe(cov.task_flux());
    });

    test("is idempotent: a second start changes nothing", async () => {
        const { cov, admin } = make_coverage();
        await cov.ensure();
        admin.calls.length = 0;
        await cov.ensure();
        const writes = admin.calls.filter(c => /create|update/.test(c[0]));
        expect(writes).toEqual([]);
    });

    test("updates a task whose Flux differs from this version", async () => {
        const admin = fake_admin({ bucket: true, task: { flux: "old" } });
        const { cov } = make_coverage({ admin });
        await cov.ensure();
        expect(admin.calls.map(c => c[0])).toEqual(
            ["org_id", "find_bucket", "find_task", "update_task"]);
        expect(admin.tasks[0].flux).toBe(cov.task_flux());
    });

    test("leaves an inactive task inactive", async () => {
        const { cov: probe } = make_coverage();
        const admin = fake_admin({ bucket: true, task: { flux: probe.task_flux(), status: "inactive" } });
        const { cov } = make_coverage({ admin });
        await cov.ensure();
        expect(admin.calls.filter(c => /create|update/.test(c[0]))).toEqual([]);
        expect(cov.status().task.status).toBe("inactive");
    });

    test("settings come from the environment", () => {
        const { cov } = make_coverage({ env: {
            COVERAGE_BUCKET: "cov2", COVERAGE_TASK: "cov2-task",
            COVERAGE_RECOUNT_HOURS: "3", COVERAGE_ENABLED: "false",
        } });
        expect(cov.enabled).toBe(false);
        expect(cov.task_flux()).toContain(`to(bucket: "cov2", org: "default")`);
        expect(cov.task_flux()).toContain(`name: "cov2-task"`);
        expect(cov.task_flux()).toContain("date.sub(d: 3h, from: stop)");
    });

    test("run retries provisioning until it works", async () => {
        const admin = fake_admin();
        let fails = 2;
        const org_id = admin.org_id.bind(admin);
        admin.org_id = async n => { if (fails-- > 0) throw new Error("down"); return org_id(n); };
        const { cov } = make_coverage({ admin, env: { COVERAGE_BACKFILL: "false" } });
        cov.repair_days = 0;
        await cov.run();
        cov.stop();
        expect(cov.ids?.task_id).toBe("t1");
        expect(cov.last_error).toBe(null);
    });
});

describe("InfluxAdmin", () => {
    function fetcher(answers) {
        const seen = [];
        const fetch = async (url, init) => {
            seen.push({ url, ...init });
            const [status, body] = answers.shift();
            return {
                status, ok: status < 300,
                json: async () => body, text: async () => JSON.stringify(body),
            };
        };
        return { fetch, seen };
    }

    test("a missing bucket is null, not an error", async () => {
        const { fetch, seen } = fetcher([[404, { code: "not found" }]]);
        const admin = new InfluxAdmin({ url: "http://influx/", token: "secret", fetch });
        expect(await admin.find_bucket("o1", "acs_coverage")).toBe(null);
        expect(seen[0].url).toBe("http://influx/api/v2/buckets?orgID=o1&name=acs_coverage");
        expect(seen[0].headers.Authorization).toBe("Token secret");
    });

    test("creates a bucket that never expires with a 30 day shard group", async () => {
        const { fetch, seen } = fetcher([[201, { id: "b1" }]]);
        const admin = new InfluxAdmin({ url: "http://influx", token: "t", fetch });
        await admin.create_bucket("o1", "acs_coverage", 2592000, "d");
        expect(JSON.parse(seen[0].body)).toEqual({
            orgID: "o1", name: "acs_coverage", description: "d",
            retentionRules: [{ type: "expire", everySeconds: 0, shardGroupDurationSeconds: 2592000 }],
        });
    });

    test("errors carry the status but not the token", async () => {
        const { fetch } = fetcher([[401, { message: "unauthorized" }]]);
        const admin = new InfluxAdmin({ url: "http://influx", token: "secret", fetch });
        const err = await admin.create_task("o1", "x").catch(e => e);
        expect(err.statusCode).toBe(401);
        expect(err.message).not.toContain("secret");
    });
});


/*
 * ---------------------------------------------------------------
 * Backfill and repair
 * ---------------------------------------------------------------
 */

describe("backfill", () => {
    const now = T("2026-10-08T10:30:00Z");
    const earliest = T("2026-10-05T13:00:00Z");

    test("starts with today and works back to the oldest point", async () => {
        const { cov, admin, query_api } = make_coverage({ now, earliest });
        await cov.ensure();
        const state = await cov.backfill();

        /* London days: midnight is 23:00 UTC in October. Today stops at
         * the last closed hour. */
        expect(query_api.chunks.map(c => [iso(c.start), iso(c.stop)])).toEqual([
            ["2026-10-07T23:00:00.000Z", "2026-10-08T10:00:00.000Z"],
            ["2026-10-06T23:00:00.000Z", "2026-10-07T23:00:00.000Z"],
            ["2026-10-05T23:00:00.000Z", "2026-10-06T23:00:00.000Z"],
            ["2026-10-04T23:00:00.000Z", "2026-10-05T23:00:00.000Z"],
        ]);
        expect(state.complete).toBe(true);
        expect(admin.fields.get("complete")).toBe(true);
        expect(admin.fields.get("backfilled_to")).toBe(T("2026-10-04T23:00:00Z"));
        expect(admin.fields.get("rule")).toBe(RULE_VERSION);
    });

    test("resumes from the marker after a restart and repeats a failed chunk", async () => {
        const admin = fake_admin();
        const bad = T("2026-10-05T23:00:00Z");
        let failing = true;
        const first = make_coverage({ admin, now, earliest,
            fail_on: c => failing && c.start == bad });
        await first.cov.ensure();
        await expect(first.cov.backfill()).rejects.toThrow("chunk failed");
        expect(first.query_api.chunks).toHaveLength(2);
        expect(admin.fields.get("backfilled_to")).toBe(T("2026-10-06T23:00:00Z"));
        expect(admin.fields.get("complete")).toBe(false);

        /* A new process reads the marker and carries on. */
        failing = false;
        const second = make_coverage({ admin, now: now + 3 * HOUR, earliest });
        await second.cov.ensure();
        await second.cov.backfill();
        expect(second.query_api.chunks.map(c => iso(c.start))).toEqual([
            "2026-10-05T23:00:00.000Z", "2026-10-04T23:00:00.000Z"]);
        expect(admin.fields.get("complete")).toBe(true);
    });

    test("a complete backfill does nothing on restart", async () => {
        const { cov, admin } = make_coverage({ now, earliest });
        await cov.ensure();
        await cov.backfill();
        const again = make_coverage({ admin, now, earliest });
        await again.cov.ensure();
        await again.cov.backfill();
        expect(again.query_api.chunks).toEqual([]);
    });

    test("stops at COVERAGE_BACKFILL_FROM", async () => {
        const { cov, query_api } = make_coverage({ now, earliest,
            env: { COVERAGE_BACKFILL_FROM: "2026-10-07T12:00:00Z" } });
        await cov.ensure();
        await cov.backfill();
        expect(query_api.chunks.map(c => iso(c.start))).toEqual([
            "2026-10-07T23:00:00.000Z", "2026-10-06T23:00:00.000Z"]);
    });

    test("an empty raw bucket completes at once", async () => {
        const { cov, query_api } = make_coverage({ now, earliest: null });
        await cov.ensure();
        expect((await cov.backfill()).complete).toBe(true);
        expect(query_api.chunks).toEqual([]);
    });

    test("a new rebuild request or count rule starts again", () => {
        const s = fresh_state(now, "a");
        expect(needs_rebuild(null)).toBe(true);
        expect(needs_rebuild(s, "")).toBe(false);
        expect(needs_rebuild(s, "a")).toBe(false);
        expect(needs_rebuild(s, "b")).toBe(true);
        expect(needs_rebuild({ ...s, rule: RULE_VERSION + 1 }, "")).toBe(true);
    });

    test("a rebuild request rewrites the marker", async () => {
        const { cov, admin } = make_coverage({ now, earliest });
        await cov.ensure();
        await cov.backfill();
        const again = make_coverage({ admin, now: now + DAY, earliest,
            env: { COVERAGE_REBUILD: "2026-10-09" } });
        await again.cov.ensure();
        await again.cov.backfill();
        expect(again.query_api.chunks).toHaveLength(5);
        expect(admin.fields.get("rebuild")).toBe("2026-10-09");
    });

    test("next_chunk and parse_state", () => {
        const s = { upper: T("2026-10-08T23:00:00Z"), backfilled_to: T("2026-10-07T23:00:00Z"),
            complete: false, rule: 1, rebuild: "" };
        expect(next_chunk(s, earliest)).toEqual({
            start: T("2026-10-06T23:00:00Z"), stop: T("2026-10-07T23:00:00Z") });
        expect(next_chunk(s, T("2026-10-08T00:00:00Z"))).toBe(null);
        expect(next_chunk({ ...s, complete: true }, earliest)).toBe(null);
        expect(parse_state([])).toBe(null);
        expect(parse_state([{ _field: "upper", _value: 5 }, { _field: "backfilled_to", _value: "4" },
            { _field: "complete", _value: "true" }])).toMatchObject({
            upper: 5, backfilled_to: 4, complete: true });
    });

    test("repair covers the last 7 full London days, newest first", async () => {
        const { cov, query_api } = make_coverage({ now });
        await cov.ensure();
        await cov.repair();
        expect(query_api.chunks).toHaveLength(7);
        expect(iso(query_api.chunks[0].stop)).toBe("2026-10-07T23:00:00.000Z");
        expect(iso(query_api.chunks[6].start)).toBe("2026-09-30T23:00:00.000Z");
    });

    test("repair days are 23 and 25 hours long across the clock changes", () => {
        const autumn = repair_chunks(T("2026-10-26T12:00:00Z"), 1)[0];
        expect(autumn.stop - autumn.start).toBe(25 * HOUR);
        const spring = repair_chunks(T("2026-03-30T12:00:00Z"), 1)[0];
        expect(spring.stop - spring.start).toBe(23 * HOUR);
    });

    test("the repair runs at 03:00 London time", () => {
        expect(iso(next_local_hour(T("2026-10-08T10:30:00Z"), 3))).toBe("2026-10-09T02:00:00.000Z");
        expect(iso(next_local_hour(T("2026-10-08T01:00:00Z"), 3))).toBe("2026-10-08T02:00:00.000Z");
        expect(iso(next_local_hour(T("2026-12-08T10:30:00Z"), 3))).toBe("2026-12-09T03:00:00.000Z");
        expect(iso(next_local_hour(T("2026-03-28T12:00:00Z"), 3))).toBe("2026-03-29T02:00:00.000Z");
    });
});


/*
 * ---------------------------------------------------------------
 * Flux
 * ---------------------------------------------------------------
 */

describe("Flux for the summary", () => {
    const opts = { raw_bucket: "default", bucket: "acs_coverage", org: "default" };

    test("the task recounts closed hours, excludes birth metadata and writes both measurements", () => {
        const f = task_script(opts);
        expect(f).toMatch(/^import "date"\nimport "timezone"\n/);
        expect(f).toContain(`option task = {name: "acs-coverage", every: 1h, offset: 5m}`);
        expect(f).toContain(`option location = timezone.location(name: "Europe/London")`);
        expect(f).toContain("stop = date.truncate(t: now(), unit: 1h)");
        expect(f).toContain("date.sub(d: 6h, from: stop)");
        expect(f).toContain(`r._measurement != "Schema_UUID:s" and r._measurement != "Instance_UUID:s"`);
        /* Count each series, then sum per device: no schema collision. */
        expect(f.indexOf("fn: count")).toBeLessThan(f.indexOf(`group(columns: ["topLevelInstance", "_time"])`));
        expect(f).toContain(`_measurement: "coverage"`);
        expect(f).toContain(`_measurement: "coverage_daily"`);
        expect(f.match(/to\(bucket: "acs_coverage", org: "default"\)/g)).toHaveLength(2);
        expect(() => task_script({ ...opts, recount_hours: 0 })).toThrow(RangeError);
        expect(() => task_script({ ...opts, recount_hours: "6h); drop()" })).toThrow(RangeError);
    });

    test("a chunk covers one day and writes hours and the day from one stream", () => {
        const f = chunk_script({ ...opts,
            start: T("2026-10-06T23:00:00Z"), stop: T("2026-10-07T23:00:00Z") });
        expect(f).toContain("range(start: 2026-10-06T23:00:00.000Z, stop: 2026-10-07T23:00:00.000Z)");
        expect(f).not.toContain(`from(bucket: "acs_coverage")`);
        expect(f.match(/to\(bucket/g)).toHaveLength(2);
    });

    test("hostile bucket and org names are escaped", () => {
        const f = task_script({ ...opts, bucket: `x") |> drop() //`, org: `"` });
        expect(f).toContain(`to(bucket: "x\\") |> drop() //", org: "\\"")`);
    });

    test("coverage reads: hourly at 1h has no windowing; 6h and 1w sum", () => {
        const spans = [[T("2026-10-01T00:00:00Z"), T("2026-10-02T00:00:00Z")]];
        const h = coverage_query({ bucket: "acs_coverage", measurement: "coverage", devices: [D1], spans, every: "1h" });
        expect(h).not.toContain("aggregateWindow");
        expect(h).toContain(`r._measurement == "coverage" and r._field == "count"`);
        const six = coverage_query({ bucket: "acs_coverage", measurement: "coverage", devices: [D1], spans, every: "6h" });
        expect(six).toContain("aggregateWindow(every: 6h, fn: sum");
        expect(six).not.toContain("timezone");
        const w = coverage_query({ bucket: "acs_coverage", measurement: "coverage_daily", devices: [D1, D2], spans, every: "1w" });
        expect(w).toContain(`option location = timezone.location(name: "Europe/London")`);
        expect(w).toContain("aggregateWindow(every: 1w, offset: 4d, fn: sum");
        expect(w).toContain(`r.topLevelInstance == "${D1}" or r.topLevelInstance == "${D2}"`);
        const d = coverage_query({ bucket: "acs_coverage", measurement: "coverage_daily", devices: [D1], spans, every: "1d" });
        expect(d).not.toContain("aggregateWindow");
        expect(coverage_query({ bucket: "b", measurement: "coverage", devices: [D1], spans: [], every: "1h" })).toBe(null);
    });
});


/*
 * ---------------------------------------------------------------
 * Read planning and alignment
 * ---------------------------------------------------------------
 */

describe("read planning", () => {
    const now = T("2026-10-08T10:30:00Z");
    const complete = { covered_from: -Infinity, summary_to: T("2026-10-08T10:00:00Z") };

    test("history inside the summary is coverage only", () => {
        const plan = plan_count({ from: T("2026-01-01T00:00:00Z"), to: T("2026-10-01T00:00:00Z"), state: complete });
        expect(plan).toEqual({
            coverage: [T("2026-01-01T00:00:00Z"), T("2026-10-01T00:00:00Z")], raw: [], pending: [] });
        expect(plan_source(plan)).toBe("coverage");
    });

    test("the newest hours come from raw data: mixed", () => {
        const plan = plan_count({ from: T("2026-10-01T00:00:00Z"), to: T("2026-10-09T00:00:00Z"), state: complete });
        expect(plan.coverage).toEqual([T("2026-10-01T00:00:00Z"), complete.summary_to]);
        expect(plan.raw).toEqual([[complete.summary_to, T("2026-10-09T00:00:00Z")]]);
        expect(plan_source(plan)).toBe("mixed");
    });

    test("a window after the summary is raw only", () => {
        const plan = plan_count({ from: T("2026-10-08T10:00:00Z"), to: T("2026-10-08T12:00:00Z"), state: complete });
        expect(plan.coverage).toBe(null);
        expect(plan_source(plan)).toBe("raw");
    });

    test("hours older than the backfill marker are raw if they fit, pending if not", () => {
        const state = { covered_from: T("2026-10-01T23:00:00Z"), summary_to: T("2026-10-08T10:00:00Z") };
        const short = plan_count({ from: T("2026-09-28T00:00:00Z"), to: T("2026-10-08T00:00:00Z"), state });
        expect(short.raw).toEqual([[T("2026-09-28T00:00:00Z"), T("2026-10-01T23:00:00Z")]]);
        expect(short.pending).toEqual([]);

        const long = plan_count({ from: T("2025-10-01T00:00:00Z"), to: T("2026-10-08T00:00:00Z"), state });
        expect(long.raw).toEqual([]);
        expect(long.pending).toEqual([[T("2025-10-01T00:00:00Z"), T("2026-10-01T23:00:00Z")]]);
        expect(long.coverage).toEqual([T("2026-10-01T23:00:00Z"), T("2026-10-08T00:00:00Z")]);
    });

    test("a stalled summary splices at most 14 days of raw data", () => {
        const state = { covered_from: -Infinity, summary_to: T("2026-08-01T00:00:00Z") };
        const plan = plan_count({ from: T("2026-01-01T00:00:00Z"), to: now, state });
        expect(plan.raw).toEqual([[now - LIMITS.count_span, now]]);
        expect(plan.pending).toEqual([[T("2026-08-01T00:00:00Z"), now - LIMITS.count_span]]);
    });

    test("no gap when the marker is newer than the summary", () => {
        const state = { covered_from: T("2026-10-08T23:00:00Z"), summary_to: T("2026-10-08T10:00:00Z") };
        const plan = plan_count({ from: T("2026-10-07T00:00:00Z"), to: T("2026-10-09T00:00:00Z"), state });
        expect(plan.coverage).toBe(null);
        expect(plan.raw).toEqual([
            [T("2026-10-07T00:00:00Z"), T("2026-10-08T23:00:00Z")],
            [T("2026-10-08T23:00:00Z"), T("2026-10-09T00:00:00Z")]]);
    });

    test("daily steps read whole London days from coverage_daily and edges from hourly", () => {
        const { hourly, daily } = split_coverage(
            [[T("2026-10-05T10:20:00Z"), T("2026-10-08T10:00:00Z")]], "1d");
        expect(daily).toEqual([[T("2026-10-05T23:00:00Z"), T("2026-10-07T23:00:00Z")]]);
        expect(hourly).toEqual([
            [T("2026-10-05T10:00:00Z"), T("2026-10-05T23:00:00Z")],
            [T("2026-10-07T23:00:00Z"), T("2026-10-08T10:00:00Z")]]);
    });

    test("hourly steps widen windows to whole hours", () => {
        const { hourly, daily } = split_coverage(
            [[T("2026-10-05T10:20:00Z"), T("2026-10-05T12:10:00Z")]], "6h");
        expect(daily).toEqual([]);
        expect(hourly).toEqual([[T("2026-10-05T10:00:00Z"), T("2026-10-05T13:00:00Z")]]);
    });

    test("London day helpers across the October change", () => {
        expect(iso(floor_day(T("2026-10-25T12:00:00Z")))).toBe("2026-10-24T23:00:00.000Z");
        expect(iso(ceil_day(T("2026-10-25T12:00:00Z")))).toBe("2026-10-26T00:00:00.000Z");
        expect(iso(prev_day(T("2026-10-26T00:00:00Z")))).toBe("2026-10-24T23:00:00.000Z");
        expect(ceil_day(T("2026-10-26T00:00:00Z"))).toBe(T("2026-10-26T00:00:00Z"));
    });

    test("intersect clips spans to windows", () => {
        expect(intersect([[0, 10], [20, 30]], [[5, 25]])).toEqual([[5, 10], [20, 25]]);
    });
});


/*
 * ---------------------------------------------------------------
 * The series route with the summary
 * ---------------------------------------------------------------
 */

/* A coverage stand-in for the reader: only read_state and bucket. */
const ready = state => ({ bucket: "acs_coverage", read_state: () => state, status: () => ({ ready: true }) });

function route({ state, rows }) {
    const seen = [];
    const query_api = {
        queryRows(query, consumer) {
            seen.push(query);
            setImmediate(() => {
                for (const r of rows(query)) consumer.next(r, { toObject: v => v });
                consumer.complete();
            });
        },
    };
    const flow = Object.create(DataFlow.prototype);
    flow.auth = { root_principal: ROOT, watch_acl_with_perm: () => rx.of(new Set()) };
    flow.datasets = rx.of(new Map());
    const api = new APIv1({ data: flow, debug, auth: { check_acl: async () => true }, cdb: {} });
    api.seriesReader = new SeriesReader({ debug, influx_bucket: "default", query_api,
        coverage: state === undefined ? null : ready(state) });
    return { api, seen };
}

function res_stub() {
    return {
        statusCode: null, body: null, headers: {}, writableEnded: false,
        status(s) { this.statusCode = s; return this; },
        json(b) { this.body = b; this.writableEnded = true; return this; },
        set(k, v) { this.headers[k] = v; return this; },
        on() {}, off() {},
    };
}

async function post(api, body) {
    const res = res_stub();
    await api.series({ auth: ROOT, body }, res);
    return res;
}

describe("series route with the coverage summary", () => {
    const now_hour = Math.floor(Date.now() / HOUR) * HOUR;
    const state = { covered_from: -Infinity, summary_to: now_hour - 2 * HOUR };

    test("the 14 day limit lifts for 1h and coarser only when the summary is ready", () => {
        const body = { devices: [D1], count: true, every: "1d",
            from: "2025-10-01T00:00:00Z", to: "2026-10-01T00:00:00Z" };
        expect(() => parse_request(body)).toThrow(/coverage summary/);
        expect(parse_request(body, Date.now(), { coverage: true }).every).toBe("1d");
        expect(() => parse_request({ ...body, every: "30m", from: "2026-09-10T00:00:00Z" },
            Date.now(), { coverage: true })).toThrow(/1h or more/);
        expect(() => parse_request({ ...body, from: "2010-01-01T00:00:00Z", every: "1w" },
            Date.now(), { coverage: true })).toThrow(/10 years/);
    });

    test("a year at 1d reads only the summary", async () => {
        const { api, seen } = route({ state, rows: q => q.includes("coverage_daily")
            ? [{ topLevelInstance: D1, _time: "2026-01-01T00:00:00Z", _value: "100" }] : [] });
        const res = await post(api, { devices: [D1], count: true, every: "1d",
            from: "2025-10-01T00:00:00Z", to: "2026-10-01T00:00:00Z" });
        expect(res.statusCode).toBe(200);
        expect(res.body.source).toBe("coverage");
        expect(res.body.pending).toBeUndefined();
        expect(seen.every(q => q.includes(`from(bucket: "acs_coverage")`))).toBe(true);
        expect(res.body.devices[D1].count).toEqual([[T("2026-01-01T00:00:00Z"), 100]]);
    });

    test("up to now is mixed: raw hours sum into the same bucket as the summary", async () => {
        const today = floor_day(Date.now());
        const st = { covered_from: -Infinity, summary_to: today + HOUR };
        const { api, seen } = route({ state: st, rows: q => {
            if (q.includes(`from(bucket: "default")`))
                return [{ topLevelInstance: D1, _time: iso(st.summary_to), _value: "5" }];
            if (q.includes(`"coverage_daily"`)) return [];
            return [{ topLevelInstance: D1, _time: iso(today), _value: "10" }];
        } });
        const res = await post(api, { devices: [D1], count: true, every: "1d",
            from: iso(today - 3 * DAY), to: iso(today + DAY) });
        expect(res.statusCode).toBe(200);
        expect(res.body.source).toBe("mixed");
        expect(seen.some(q => q.includes(`from(bucket: "default")`))).toBe(true);
        expect(res.body.devices[D1].count).toContainEqual([today, 15]);
        expect(res.headers["Cache-Control"]).toBe("no-store");
    });

    test("pending ranges while the backfill runs; never cached", async () => {
        const partial = { covered_from: now_hour - 30 * DAY, summary_to: state.summary_to };
        const { api } = route({ state: partial, rows: () => [] });
        const from = new Date(now_hour - 365 * DAY);
        const res = await post(api, { devices: [D1], count: true, every: "1w",
            from: from.toISOString(), to: new Date(now_hour - 10 * DAY).toISOString() });
        expect(res.statusCode).toBe(200);
        expect(res.body.pending).toEqual([[from.toISOString(), iso(partial.covered_from)]]);
        expect(res.body.source).toBe("coverage");
        expect(res.headers["Cache-Control"]).toBe("no-store");
    });

    test("sub-hour steps and a missing summary stay raw", async () => {
        const { api, seen } = route({ state, rows: () => [] });
        const res = await post(api, { devices: [D1], count: true, every: "15m",
            from: iso(now_hour - DAY), to: iso(now_hour) });
        expect(res.body.source).toBe("raw");
        expect(seen.every(q => !q.includes("acs_coverage"))).toBe(true);

        const off = route({ state: null, rows: () => [] });
        const res2 = await post(off.api, { devices: [D1], count: true, every: "1h",
            from: iso(now_hour - DAY), to: iso(now_hour) });
        expect(res2.body.source).toBe("raw");
    });

    test("the status route reports the summary", async () => {
        const { api } = route({ state });
        const res = res_stub();
        await api.coverage_status({ auth: ROOT }, res);
        expect(res.body).toEqual({ ready: true });

        const none = route({ state: undefined, rows: () => [] });
        const res2 = res_stub();
        await none.api.coverage_status({ auth: ROOT }, res2);
        expect(res2.body).toEqual({ enabled: false });
    });
});


describe("read state", () => {
    test("needs the marker and a summarised hour; summary_to never passes now", async () => {
        const now = T("2026-10-08T10:30:00Z");
        const admin = fake_admin();
        const { cov } = make_coverage({ admin, now, earliest: T("2026-10-08T01:00:00Z"),
            newest: T("2026-10-08T09:00:00Z") });
        expect(cov.read_state()).toBe(null);
        await cov.ensure();
        await cov.backfill();
        await cov.refresh();
        expect(cov.read_state()).toEqual({ covered_from: -Infinity, summary_to: T("2026-10-08T10:00:00Z") });

        admin.runs = [{ status: "success", scheduledFor: "2026-10-08T11:00:00Z" },
            { status: "failed", scheduledFor: "2026-10-08T12:00:00Z" }];
        await cov.refresh();
        expect(cov.read_state().summary_to).toBe(T("2026-10-08T10:00:00Z"));
        expect(cov.status().task.last_run.status).toBe("failed");
        expect(cov.stale()).toBe(false);
    });
});

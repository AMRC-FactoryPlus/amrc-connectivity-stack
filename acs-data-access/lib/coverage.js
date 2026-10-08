/*
 * ACS Data Access Service
 * Coverage: the pure parts of the hourly coverage summary.
 *
 * The coverage summary is a small InfluxDB bucket that holds, for each
 * device, the number of data points that arrived in each hour
 * (measurement `coverage`) and each local calendar day (measurement
 * `coverage_daily`). Timelines read it for counts at 1h or coarser,
 * so long spans do not have to count the raw bucket.
 *
 * This module builds the Flux for the InfluxDB task, the backfill
 * chunks and the reads, and plans which parts of a request come from
 * the summary and which from raw data. It does no I/O.
 */

import { flux, fluxExpression } from "@influxdata/influxdb-client";

import {
    BIRTH_METADATA, TIME_ZONE, LIMITS, COVERAGE_STEPS,
    bucket_start, next_bucket,
} from "./series.js";

const HOUR = 3600 * 1000;

/** Change this when the count rule changes. The backfill marker records
 * it, and a mismatch starts a rebuild. */
export const RULE_VERSION = 1;

export const COVERAGE_DEFAULTS = {
    bucket: "acs_coverage",
    task: "acs-coverage",
    recount_hours: 6,
    shard_group_seconds: 30 * 24 * 3600,
    pause_ms: 1000,
    repair_days: 7,
    /* The daily repair runs at this local hour. */
    repair_hour: 3,
};

export const MEASUREMENT = {
    hourly: "coverage",
    daily: "coverage_daily",
    state: "coverage_state",
};

const DAILY_STEPS = new Set(["1d", "1w"]);


/*
 * ---------------------------------------------------------------
 * Time helpers
 * ---------------------------------------------------------------
 */

export const floor_hour = t => Math.floor(t / HOUR) * HOUR;
export const ceil_hour = t => Math.ceil(t / HOUR) * HOUR;
/** Local midnight at the start of the day that contains t. */
export const floor_day = t => bucket_start(t, "1d");
/** Local midnight at or after t. */
export const ceil_day = t => {
    const d = floor_day(t);
    return d == t ? t : next_bucket(d, "1d");
};
/** Local midnight at the start of the day before the one containing t. */
export const prev_day = t => floor_day(floor_day(t) - 1);

/** The next instant after `now` that is `hour`:00 local time. */
export function next_local_hour(now, hour) {
    for (let d = floor_day(now); ; d = next_bucket(d, "1d")) {
        /* Clock changes happen at 01:00 UTC, so add the hours as wall
         * time by asking for the bucket start of a guess. */
        const t = floor_hour(d + hour * HOUR);
        const fixed = local_hour_of(t) == hour ? t
            : floor_hour(t + (hour - local_hour_of(t)) * HOUR);
        if (fixed > now) return fixed;
    }
}

const hour_format = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE, hourCycle: "h23", hour: "numeric",
});
function local_hour_of(t) {
    return Number(hour_format.format(new Date(t)));
}


/*
 * ---------------------------------------------------------------
 * Flux for writing the summary
 *
 * Each series is counted on its own, then the counts are summed per
 * device. A device has metrics of several types, and merging them
 * before counting fails with "schema collision". This is the same
 * count rule as the raw count in series.js, so strips do not jump
 * when the user changes zoom.
 * ---------------------------------------------------------------
 */

const zone_header = () => String(flux`import "date"
import "timezone"
`);

const location = () => String(flux`option location = timezone.location(name: ${TIME_ZONE})
`);

function birth_filter() {
    return fluxExpression(BIRTH_METADATA
        .map(m => String(flux`r._measurement != ${m}`))
        .join(" and "));
}

/* Hourly counts per device from the raw bucket, shaped for to(). The
 * range bounds are Flux expressions or Dates. */
function hourly_counts({ raw_bucket, start, stop }) {
    return flux`from(bucket: ${raw_bucket})
  |> range(start: ${start}, stop: ${stop})
  |> filter(fn: (r) => r._field == "value")
  |> filter(fn: (r) => exists r.topLevelInstance and r.topLevelInstance != "")
  |> filter(fn: (r) => ${birth_filter()})
  |> aggregateWindow(every: 1h, fn: count, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["topLevelInstance", "_time"])
  |> sum()
  |> map(fn: (r) => ({_time: r._time, _measurement: ${MEASUREMENT.hourly}, _field: "count",
                      _value: int(v: r._value), topLevelInstance: r.topLevelInstance}))
  |> group(columns: ["_measurement", "_field", "topLevelInstance"])`;
}

/* Daily sums per device from a stream of hourly rows. Days are local
 * calendar days (the script sets the location). */
function daily_sums(stream) {
    return flux`${stream}
  |> keep(columns: ["_time", "_value", "topLevelInstance"])
  |> map(fn: (r) => ({r with _time: date.truncate(t: r._time, unit: 1d)}))
  |> group(columns: ["topLevelInstance", "_time"])
  |> sum()
  |> map(fn: (r) => ({_time: r._time, _measurement: ${MEASUREMENT.daily}, _field: "count",
                      _value: r._value, topLevelInstance: r.topLevelInstance}))
  |> group(columns: ["_measurement", "_field", "topLevelInstance"])`;
}

function to_bucket(bucket, org) {
    return flux`to(bucket: ${bucket}, org: ${org})`;
}

/** The Flux of the hourly InfluxDB task. Each run recounts the last
 * `recount_hours` closed hours and overwrites them, which absorbs late
 * data. It then rewrites the daily sums for every day those hours
 * touch, reading the older hours of those days from the summary. */
export function task_script(opts) {
    const {
        raw_bucket, bucket, org,
        task = COVERAGE_DEFAULTS.task,
        recount_hours = COVERAGE_DEFAULTS.recount_hours,
    } = opts;
    const hours = Number(recount_hours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 48)
        throw new RangeError("recount_hours must be an integer from 1 to 48");
    const recount = fluxExpression(`${hours}h`);
    const to = to_bucket(bucket, org);

    return zone_header() + String(flux`
option task = {name: ${task}, every: 1h, offset: 5m}
`) + location() + String(flux`
stop = date.truncate(t: now(), unit: 1h)
start = date.sub(d: ${recount}, from: stop)
day_start = date.truncate(t: start, unit: 1d)

hourly = ${hourly_counts({ raw_bucket, start: fluxExpression("start"), stop: fluxExpression("stop") })}

hourly |> ${to}

older = from(bucket: ${bucket})
  |> range(start: day_start, stop: stop)
  |> filter(fn: (r) => r._measurement == ${MEASUREMENT.hourly} and r._field == "count")
  |> filter(fn: (r) => r._time < start)
  |> keep(columns: ["_time", "_value", "topLevelInstance"])

${daily_sums(flux`union(tables: [older, hourly |> keep(columns: ["_time", "_value", "topLevelInstance"])])`)}
  |> ${to}
`);
}

/** The Flux for one backfill or repair chunk: one local day [start,
 * stop). It writes the hourly counts and the day's sum, both computed
 * from the same raw stream, so nothing depends on the order of writes.
 * Repeating a chunk overwrites its own points. */
export function chunk_script({ raw_bucket, bucket, org, start, stop }) {
    const to = to_bucket(bucket, org);
    return zone_header() + location() + String(flux`
hourly = ${hourly_counts({ raw_bucket, start: new Date(start), stop: new Date(stop) })}

hourly |> ${to}

${daily_sums(fluxExpression("hourly"))}
  |> ${to}
`);
}

/** The time of the oldest point in the raw bucket. One row, or none. */
export function earliest_query({ raw_bucket }) {
    return String(flux`from(bucket: ${raw_bucket})
  |> range(start: 0)
  |> filter(fn: (r) => r._field == "value")
  |> limit(n: 1)
  |> keep(columns: ["_time"])
  |> group()
  |> min(column: "_time")`);
}

/** The newest hour in the summary, within the last `days`. One row, or
 * none. */
export function newest_query({ bucket, days = 30 }) {
    return String(flux`from(bucket: ${bucket})
  |> range(start: ${fluxExpression(`-${Number(days)}d`)})
  |> filter(fn: (r) => r._measurement == ${MEASUREMENT.hourly} and r._field == "count")
  |> last()
  |> keep(columns: ["_time"])
  |> group()
  |> max(column: "_time")`);
}

/** The backfill marker. One row per field. */
export function state_query({ bucket }) {
    return String(flux`from(bucket: ${bucket})
  |> range(start: 0)
  |> filter(fn: (r) => r._measurement == ${MEASUREMENT.state})
  |> last()
  |> keep(columns: ["_field", "_value"])`);
}


/*
 * ---------------------------------------------------------------
 * The backfill marker
 *
 * One point per field at time 0, so each write replaces the last.
 *   upper          The local midnight the backfill started below. The
 *                  task covers everything after it.
 *   backfilled_to  Everything in [backfilled_to, upper) is summarised.
 *   complete       The backfill reached the oldest raw point.
 *   rule           RULE_VERSION when the backfill started.
 *   rebuild        The rebuild request that started it ("" if none).
 * ---------------------------------------------------------------
 */

/** Turns marker rows into a state object, or null if there is none. */
export function parse_state(rows) {
    if (!rows.length) return null;
    const f = Object.fromEntries(rows.map(r => [r._field, r._value]));
    const num = v => v == null || v === "" ? null : Number(v);
    const state = {
        upper: num(f.upper),
        backfilled_to: num(f.backfilled_to),
        complete: f.complete === true || f.complete === "true",
        rule: num(f.rule),
        rebuild: f.rebuild == null ? "" : String(f.rebuild),
    };
    if (state.upper == null || state.backfilled_to == null) return null;
    return state;
}

/** A fresh marker for a backfill that starts now. The first chunk is
 * the current local day, which the task only partly covers. */
export function fresh_state(now, rebuild = "") {
    const upper = next_bucket(floor_day(now), "1d");
    return { upper, backfilled_to: upper, complete: false, rule: RULE_VERSION, rebuild };
}

/** Whether a stored marker must be thrown away and the backfill run
 * again: no marker, a new count rule, or a new rebuild request. */
export function needs_rebuild(state, rebuild = "") {
    if (!state) return true;
    if (state.rule != RULE_VERSION) return true;
    return rebuild != "" && rebuild != state.rebuild;
}

/** The next chunk below the marker, or null when the backfill is done.
 * @param floor The oldest raw point time, or null if the bucket is empty. */
export function next_chunk(state, floor) {
    if (state.complete) return null;
    if (floor == null || state.backfilled_to <= floor) return null;
    const stop = state.backfilled_to;
    return { start: prev_day(stop), stop };
}

/** The days a repair covers: the `days` full local days before today,
 * newest first. */
export function repair_chunks(now, days) {
    const out = [];
    let stop = floor_day(now);
    for (let i = 0; i < days; i++) {
        const start = prev_day(stop);
        out.push({ start, stop });
        stop = start;
    }
    return out;
}


/*
 * ---------------------------------------------------------------
 * Read planning
 * ---------------------------------------------------------------
 */

/** Whether a count request at this step can use the summary. */
export function coverage_step(every) {
    return COVERAGE_STEPS.has(every);
}

const span = ([a, b]) => Math.max(0, b - a);
const clip = (a, b) => (a < b ? [a, b] : null);

/** Splits a count request into the parts that come from the summary,
 * from raw data, or that are still pending.
 *
 * The summary holds [covered_from, summary_to). Newer hours come from
 * raw data. Older hours come from raw data only if all the raw parts
 * together fit within the raw count limit; otherwise they are pending
 * (the backfill has not reached them yet).
 *
 * @param from,to The request window, ms.
 * @param state {covered_from, summary_to} in ms. covered_from is -Infinity
 *   once the backfill is complete.
 * @returns {coverage: [a,b]|null, raw: [[a,b]], pending: [[a,b]]}
 */
export function plan_count({ from, to, state }) {
    const limit = LIMITS.count_span;
    const { covered_from, summary_to } = state;
    const lo = Math.min(Math.max(covered_from, from), to);
    const hi = Math.max(Math.min(summary_to, to), lo);

    const coverage = clip(lo, hi);
    const pending = [];
    const raw = [];

    /* Newest part: the hours after the summary. */
    let newer = clip(Math.max(hi, from), to);
    if (newer && span(newer) > limit) {
        pending.push([newer[0], newer[1] - limit]);
        newer = [newer[1] - limit, newer[1]];
    }

    /* Oldest part: before the backfill marker. */
    const older = clip(from, Math.min(lo, to));
    if (older) {
        if (span(older) + (newer ? span(newer) : 0) <= limit)
            raw.push(older);
        else
            pending.unshift(older);
    }
    if (newer) raw.push(newer);

    return { coverage, raw, pending };
}

/** The `source` value for a plan. */
export function plan_source(plan) {
    const cov = plan.coverage != null;
    const raw = plan.raw.length > 0;
    if (cov && raw) return "mixed";
    if (raw) return "raw";
    return "coverage";
}

/** Intersects a device group's windows with a list of spans. */
export function intersect(windows, spans) {
    const out = [];
    for (const [a, b] of windows)
        for (const [c, d] of spans) {
            const s = clip(Math.max(a, c), Math.min(b, d));
            if (s) out.push(s);
        }
    return out.sort((x, y) => x[0] - y[0]);
}

/** Splits summary windows into the spans read from `coverage_daily`
 * (whole local days) and from hourly `coverage`. Hourly spans are
 * widened to whole hours, since the summary has nothing finer.
 * @returns {hourly: [[a,b]], daily: [[a,b]]} */
export function split_coverage(windows, every) {
    const hourly = [], daily = [];
    const push = (list, a, b) => {
        if (a >= b) return;
        const prev = list[list.length - 1];
        if (prev && a <= prev[1]) prev[1] = Math.max(prev[1], b);
        else list.push([a, b]);
    };

    for (const [a0, b0] of windows) {
        const a = floor_hour(a0), b = ceil_hour(b0);
        if (!DAILY_STEPS.has(every)) {
            push(hourly, a, b);
            continue;
        }
        const d0 = ceil_day(a), d1 = floor_day(b);
        if (d0 < d1) {
            push(hourly, a, d0);
            push(daily, d0, d1);
            push(hourly, d1, b);
        }
        else
            push(hourly, a, b);
    }
    return { hourly, daily };
}


/*
 * ---------------------------------------------------------------
 * Flux for reading the summary
 * ---------------------------------------------------------------
 */

function read_zone_header(every) {
    return DAILY_STEPS.has(every)
        ? String(flux`import "timezone"
option location = timezone.location(name: ${TIME_ZONE})
`)
        : "";
}

/* Calendar weeks: Flux windows count from the Unix epoch, a Thursday.
 * The offset moves the week start to Monday. */
function window_args(every) {
    const offset = every == "1w" ? ", offset: 4d" : "";
    return fluxExpression(`every: ${every}${offset}`);
}

const join = (parts, op) => fluxExpression(parts.map(String).join(` ${op} `));

/** Reads summary counts per device per bucket, in the same row shape as
 * the raw count query: topLevelInstance, _time, _value.
 * @param measurement "coverage" or "coverage_daily".
 * @param spans Disjoint, sorted [[a, b]] in ms.
 */
export function coverage_query({ bucket, measurement, devices, spans, every }) {
    if (!spans.length || !devices.length) return null;
    const start = new Date(spans[0][0]);
    const stop = new Date(spans[spans.length - 1][1]);

    const dev = join(devices.map(d => flux`r.topLevelInstance == ${d}`), "or");
    const times = spans.length > 1
        ? flux`\n  |> filter(fn: (r) => ${join(spans.map(([a, b]) =>
            flux`(r._time >= ${new Date(a)} and r._time < ${new Date(b)})`), "or")})`
        : fluxExpression("");

    /* The summary's own step needs no windowing. */
    const native = measurement == MEASUREMENT.daily ? "1d" : "1h";
    const agg = every == native
        ? fluxExpression("")
        : flux`\n  |> aggregateWindow(${window_args(every)}, fn: sum, createEmpty: false, timeSrc: "_start")`;

    return read_zone_header(every) + String(flux`from(bucket: ${bucket})
  |> range(start: ${start}, stop: ${stop})
  |> filter(fn: (r) => r._measurement == ${measurement} and r._field == "count")
  |> filter(fn: (r) => ${dev})${times}${agg}
  |> group()
  |> keep(columns: ["topLevelInstance", "_time", "_value"])`);
}

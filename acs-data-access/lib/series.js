/*
 * ACS Data Access Service
 * Series: bucketed counts, means and last-data times for devices.
 *
 * This module holds the pure parts of POST /v1/series: request
 * validation, the step ladder, bucket alignment, window merging, the Flux
 * builders and the shaping of query results. It does no I/O, so the unit
 * tests can run it without a cluster.
 */

import { flux, fluxExpression } from "@influxdata/influxdb-client";

import { valid_uuid } from "./validate.js";
import { uns_path_test } from "./flux.js";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The bucket sizes the route accepts, smallest first. The string is
 * also the Flux duration literal, so only these values reach Flux. */
export const LADDER = [
    ["10s", 10 * SECOND],
    ["30s", 30 * SECOND],
    ["1m", MINUTE],
    ["5m", 5 * MINUTE],
    ["15m", 15 * MINUTE],
    ["30m", 30 * MINUTE],
    ["1h", HOUR],
    ["6h", 6 * HOUR],
    ["1d", DAY],
    ["1w", 7 * DAY],
];
const STEP_MS = new Map(LADDER);

/** Steps that align to local midnight (and Monday) in TIME_ZONE. Shorter
 * steps align to the Unix epoch, which is the same as UTC. */
const CALENDAR_STEPS = new Set(["1d", "1w"]);
export const TIME_ZONE = "Europe/London";

export const LIMITS = {
    devices: 500,
    groups: 100,
    mean: 50,
    buckets: 2000,
    default_points: 300,
    count_span: 14 * DAY,
    coverage_span: 3653 * DAY,
    mean_span: 400 * DAY,
    last_lookback: 90 * DAY,
    default_lookback: "30d",
    metric_length: 1024,
};

/** Steps whose counts the coverage summary can answer. */
export const COVERAGE_STEPS = new Set(["1h", "6h", "1d", "1w"]);

/** The stores a device request may read. See Constants.Store. */
export const STORES = ["sparkplug", "uns"];
const UNS = "uns";

/* Birth metadata the historian writes on every rebirth. These are not
 * data, so they never count as data arriving. */
export const BIRTH_METADATA = ["Schema_UUID:s", "Instance_UUID:s"];

const NUMERIC_TYPES = ["d", "i", "u"];
const MEAN_TYPES = new Set(["d", "i", "u", "b", "s"]);

const ISO_rx = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const LOOKBACK_rx = /^([1-9]\d{0,4})(m|h|d|w)$/;
const LOOKBACK_UNIT = { m: MINUTE, h: HOUR, d: DAY, w: 7 * DAY };


/** An error that the route sends as a JSON body `{error, message, ...}`. */
export class SeriesError extends Error {
    constructor(status, error, message, extra = {}) {
        super(message);
        this.status = status;
        this.error = error;
        this.extra = extra;
    }

    body() {
        return { error: this.error, message: this.message, ...this.extra };
    }
}

const invalid = (message, extra) =>
    new SeriesError(422, "invalid_request", message, extra);


/*
 * ---------------------------------------------------------------
 * Bucket alignment
 * ---------------------------------------------------------------
 */

const zone_format = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hourCycle: "h23",
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric",
    weekday: "short",
});
const WEEKDAY = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

function zone_parts(t) {
    const p = {};
    for (const { type, value } of zone_format.formatToParts(new Date(t)))
        p[type] = value;
    return {
        y: +p.year, m: +p.month, d: +p.day,
        H: +p.hour, M: +p.minute, S: +p.second,
        wd: WEEKDAY[p.weekday],
    };
}

/* The zone's offset from UTC at instant t, in ms. */
function zone_offset(t) {
    const p = zone_parts(t);
    const wall = Date.UTC(p.y, p.m - 1, p.d, p.H, p.M, p.S);
    return wall - Math.floor(t / SECOND) * SECOND;
}

/* The instant of local midnight at the start of a local calendar date.
 * Date.UTC normalises an out-of-range day, so d may run past the month.
 * Clock changes in the zone happen at 01:00 UTC, never at midnight, so
 * local midnight always exists and is unique. */
function zone_midnight(y, m, d) {
    const guess = Date.UTC(y, m - 1, d);
    const first = guess - zone_offset(guess);
    return guess - zone_offset(first);
}

/** The start of the bucket that contains instant t. */
export function bucket_start(t, every) {
    if (every == "1d") {
        const p = zone_parts(t);
        return zone_midnight(p.y, p.m, p.d);
    }
    if (every == "1w") {
        const p = zone_parts(t);
        return zone_midnight(p.y, p.m, p.d - p.wd);
    }
    const step = STEP_MS.get(every);
    return Math.floor(t / step) * step;
}

/** The start of the bucket after the one that starts at `start`. */
export function next_bucket(start, every) {
    if (CALENDAR_STEPS.has(every)) {
        const p = zone_parts(start);
        return zone_midnight(p.y, p.m, p.d + (every == "1w" ? 7 : 1));
    }
    return start + STEP_MS.get(every);
}

/** How many buckets overlap [from, to). Stops counting above `cap`. */
export function bucket_count(from, to, every, cap = Infinity) {
    if (to <= from) return 0;
    const first = bucket_start(from, every);

    if (!CALENDAR_STEPS.has(every)) {
        const step = STEP_MS.get(every);
        return Math.floor((to - 1 - first) / step) + 1;
    }

    let n = 0;
    for (let s = first; s < to && n <= cap; s = next_bucket(s, every))
        n++;
    return n;
}

/** The smallest ladder step that gives at most `points` buckets, or the
 * largest step if none does.
 * @param only Optional set of steps to choose from. */
export function choose_every(from, to, points, only = null) {
    const steps = LADDER.map(l => l[0]).filter(e => !only || only.has(e));
    for (const every of steps) {
        if (bucket_count(from, to, every, points) <= points)
            return every;
    }
    return steps[steps.length - 1];
}


/*
 * ---------------------------------------------------------------
 * Request validation
 * ---------------------------------------------------------------
 */

function parse_time(value, name) {
    if (typeof value != "string" || !ISO_rx.test(value))
        throw invalid(`"${name}" must be an ISO 8601 date-time.`);
    /* Date.parse rolls 30 February over to March; refuse that. */
    const [y, mo, d, H, M, S] = value.split(/[-T:.Z+]/).map(Number);
    const wall = new Date(Date.UTC(y, mo - 1, d, H, M, S));
    const t = Date.parse(value);
    if (isNaN(t) || wall.getUTCDate() != d || wall.getUTCHours() != H
        || wall.getUTCMinutes() != M || wall.getUTCSeconds() != S)
        throw invalid(`"${name}" is not a valid date-time.`);
    return t;
}

function parse_lookback(last) {
    const text = last === true ? LIMITS.default_lookback : last.lookback ?? LIMITS.default_lookback;
    const m = typeof text == "string" ? LOOKBACK_rx.exec(text) : null;
    if (!m)
        throw invalid(`"last.lookback" must be a duration such as "30d".`);
    const ms = Number(m[1]) * LOOKBACK_UNIT[m[2]];
    if (ms > LIMITS.last_lookback)
        throw invalid(`"last.lookback" may be at most 90d.`);
    return ms;
}

/** Splits a full Sparkplug metric name into the Influx `path` tag and
 * the measurement name without its type suffix. */
export function split_metric(metric) {
    const i = metric.lastIndexOf("/");
    return i < 0
        ? { path: "", name: metric }
        : { path: metric.slice(0, i), name: metric.slice(i + 1) };
}

function parse_mean(list) {
    if (!Array.isArray(list))
        throw invalid(`"mean" must be a list.`);
    if (list.length > LIMITS.mean)
        throw new SeriesError(413, "too_many_metrics",
            `At most ${LIMITS.mean} "mean" metrics are allowed.`,
            { limit: LIMITS.mean });

    return list.map((m, i) => {
        if (m == null || typeof m != "object")
            throw invalid(`"mean[${i}]" must be an object.`);
        if (!valid_uuid(m.device))
            throw invalid(`"mean[${i}].device" is not a valid UUID.`);
        if (typeof m.metric != "string" || m.metric == ""
            || m.metric.length > LIMITS.metric_length)
            throw invalid(`"mean[${i}].metric" must be a non-empty metric name.`);
        const { path, name } = split_metric(m.metric);
        if (name == "")
            throw invalid(`"mean[${i}].metric" must not end with "/".`);
        if (m.type != null && !MEAN_TYPES.has(m.type))
            throw invalid(`"mean[${i}].type" must be one of d, i, u, b or s.`);
        return { device: m.device, metric: m.metric, path, name, type: m.type ?? null };
    });
}

/** Checks a request body. Returns a normalised request, or throws a
 * SeriesError. Times are epoch milliseconds.
 * @param opts.coverage Whether the coverage summary is ready. Counts at
 *   1h or coarser may then span up to 10 years instead of 14 days. */
export function parse_request(body, now = Date.now(), opts = {}) {
    if (body == null || typeof body != "object" || Array.isArray(body))
        throw new SeriesError(400, "bad_request", "The body must be a JSON object.");

    const has_devices = body.devices != null;
    const has_dataset = body.dataset != null;
    if (has_devices == has_dataset)
        throw invalid(`Give exactly one of "devices" and "dataset".`);

    /* Which bucket a device request reads. A dataset's sources each
     * carry their own. */
    let store = null;
    if (body.store != null) {
        if (has_dataset)
            throw invalid(`"store" applies only to "devices": a dataset's sources say where they are stored.`);
        if (!STORES.includes(body.store))
            throw invalid(`"store" must be one of ${STORES.join(", ")}.`);
    }
    if (has_devices)
        store = body.store ?? STORES[0];

    let devices = null, dataset = null;
    if (has_devices) {
        if (!Array.isArray(body.devices) || body.devices.length == 0)
            throw invalid(`"devices" must be a non-empty list.`);
        if (body.devices.length > LIMITS.devices)
            throw new SeriesError(413, "too_many_devices",
                `At most ${LIMITS.devices} devices are allowed.`,
                { limit: LIMITS.devices });
        const bad = body.devices.find(d => !valid_uuid(d));
        if (bad !== undefined)
            throw invalid(`"devices" contains an invalid UUID.`);
        devices = [...new Set(body.devices)];
    }
    else {
        if (!valid_uuid(body.dataset))
            throw invalid(`"dataset" is not a valid UUID.`);
        dataset = body.dataset;
    }

    const from = parse_time(body.from, "from");
    const to = parse_time(body.to, "to");
    if (from >= to)
        throw invalid(`"from" must be before "to".`);

    let every = body.every ?? null;
    if (every != null && !STEP_MS.has(every))
        throw invalid(`"every" must be one of ${LADDER.map(l => l[0]).join(", ")}.`);

    let points = LIMITS.default_points;
    if (body.points != null) {
        if (!Number.isInteger(body.points) || body.points < 1 || body.points > LIMITS.buckets)
            throw invalid(`"points" must be an integer from 1 to ${LIMITS.buckets}.`);
        points = body.points;
    }
    /* Counts over more than 14 days need the coverage summary, which
     * has nothing finer than an hour: choose only from its steps. */
    if (every == null)
        every = choose_every(from, to, points,
            body.count === true && to - from > LIMITS.count_span ? COVERAGE_STEPS : null);

    if (bucket_count(from, to, every, LIMITS.buckets) > LIMITS.buckets) {
        const suggest = choose_every(from, to, LIMITS.buckets);
        throw invalid(
            `Over ${LIMITS.buckets} buckets at "${every}". Use "every": "${suggest}" or larger.`,
            { limit: LIMITS.buckets, every: suggest });
    }

    if (body.count != null && typeof body.count != "boolean")
        throw invalid(`"count" must be true or false.`);
    const count = body.count === true;

    const mean = body.mean == null ? [] : parse_mean(body.mean);

    let last = null;
    if (body.last != null && body.last !== false) {
        if (body.last !== true && typeof body.last != "object")
            throw invalid(`"last" must be true or {"lookback": ...}.`);
        last = { lookback: parse_lookback(body.last) };
    }

    if (count && to - from > LIMITS.count_span) {
        if (!COVERAGE_STEPS.has(every))
            throw invalid(
                `"count" over more than 14 days needs "every" of 1h or more.`,
                { limit: "14d" });
        if (!opts.coverage)
            throw no_coverage();
        if (to - from > LIMITS.coverage_span)
            throw invalid(`"count" spans may be at most 10 years.`, { limit: "3653d" });
    }
    if (mean.length && to - from > LIMITS.mean_span)
        throw invalid(`"mean" spans may be at most 400 days.`, { limit: "400d" });

    if (devices) {
        const known = new Set(devices);
        const stray = mean.find(m => !known.has(m.device));
        if (stray)
            throw invalid(`"mean" device ${stray.device} is not in "devices".`);
    }

    return { devices, dataset, store, from, to, every, count, mean, last };
}

const no_coverage = () => invalid(
    `"count" over more than 14 days needs the coverage summary, which is not available yet.`,
    { limit: "14d" });

/** Checks that the coverage summary of every store a request reads is
 * ready, when its counts need one. parse_request checks this for a
 * device request; a dataset's stores are only known once it resolves.
 * @param req The output of parse_request.
 * @param ready Whether each store's summary is ready: store => boolean.
 * @param stores The stores the request reads. */
export function check_coverage(req, ready, stores) {
    if (!req.count || req.to - req.from <= LIMITS.count_span) return;
    if (stores.some(s => !ready(s)))
        throw no_coverage();
}


/*
 * ---------------------------------------------------------------
 * Windows
 * ---------------------------------------------------------------
 */

/** Merges a device's dataset source windows into sorted, disjoint
 * intervals within [from, to). A null start or end means unbounded.
 * @param sources [{from, to}] with ISO strings or null.
 * @returns [[start_ms, end_ms], ...]
 */
export function merge_windows(sources, from, to) {
    const spans = sources
        .map(s => [
            Math.max(s.from == null ? from : Date.parse(s.from), from),
            Math.min(s.to == null ? to : Date.parse(s.to), to),
        ])
        .filter(([a, b]) => a < b)
        .sort((x, y) => x[0] - y[0]);

    const out = [];
    for (const [a, b] of spans) {
        const prev = out[out.length - 1];
        if (prev && a <= prev[1])
            prev[1] = Math.max(prev[1], b);
        else
            out.push([a, b]);
    }
    return out;
}

/** Groups devices that share an identical window set, so each group
 * runs as one query.
 * @param windows Map of device UUID to [[start, end], ...].
 * @returns [{devices: [uuid], windows: [[start, end]]}], empty sets left out.
 */
export function group_by_windows(windows) {
    const groups = new Map();
    for (const [device, ws] of windows) {
        if (!ws.length) continue;
        const key = JSON.stringify(ws);
        if (!groups.has(key)) groups.set(key, { devices: [], windows: ws });
        groups.get(key).devices.push(device);
    }
    return [...groups.values()];
}


/*
 * ---------------------------------------------------------------
 * Flux builders
 *
 * Every value goes through the `flux` tagged template, which writes
 * strings as escaped Flux string literals and Dates as time literals.
 * Durations come only from the validated LADDER. Never paste a value
 * into a query any other way.
 *
 * Each series is aggregated on its own before anything merges series
 * of one device. A device has metrics of several types, and merging
 * them first fails with "schema collision". Keep it that way.
 * ---------------------------------------------------------------
 */

const join = (parts, op) => fluxExpression(parts.map(String).join(` ${op} `));
const paren = q => flux`(${q})`;

function zone_header(every, imports = []) {
    const calendar = CALENDAR_STEPS.has(every);
    const all = calendar ? [...imports, "timezone"] : imports;
    /* Flux needs every import before the first option. */
    return all.map(i => `import "${i}"\n`).join("")
        + (calendar
            ? `option location = timezone.location(name: ${String(flux`${TIME_ZONE}`)})\n`
            : "");
}

/* Calendar weeks: Flux windows count from the Unix epoch, a Thursday.
 * The offset moves the week start to Monday. */
function window_args(every) {
    const offset = every == "1w" ? ", offset: 4d" : "";
    return fluxExpression(`every: ${every}${offset}`);
}

function envelope(windows) {
    return {
        start: new Date(windows[0][0]),
        stop: new Date(windows[windows.length - 1][1]),
    };
}

/* A _time filter, only when the envelope covers gaps. */
function time_filter(windows) {
    if (windows.length < 2) return fluxExpression("");
    const parts = windows.map(([a, b]) =>
        flux`(r._time >= ${new Date(a)} and r._time < ${new Date(b)})`);
    return flux`\n  |> filter(fn: (r) => ${join(parts, "or")})`;
}

function device_filter(devices) {
    return join(devices.map(d => flux`r.topLevelInstance == ${d}`), "or");
}

function birth_filter() {
    return join(BIRTH_METADATA.map(m => flux`r._measurement != ${m}`), "and");
}

/** Count of data points per device per bucket. */
export function count_query({ bucket, devices, windows, every }) {
    const { start, stop } = envelope(windows);
    const wa = window_args(every);
    return zone_header(every) + String(flux`from(bucket: ${bucket})
  |> range(start: ${start}, stop: ${stop})
  |> filter(fn: (r) => ${device_filter(devices)})
  |> filter(fn: (r) => r._field == "value")
  |> filter(fn: (r) => ${birth_filter()})${time_filter(windows)}
  |> aggregateWindow(${wa}, fn: count, createEmpty: false, timeSrc: "_start")
  |> group(columns: ["topLevelInstance", "_time"])
  |> sum()
  |> group()
  |> keep(columns: ["topLevelInstance", "_time", "_value"])`);
}

/* InfluxDB stores no empty tags, so a top-level metric (empty path)
 * has no path column at all, and `r.path == ""` never matches it.
 * The UNS bucket's path starts with the Sparkplug device ID; see
 * uns_path_test, which escapes the folder for a regex literal. */
function path_clause(path, store) {
    if (store == UNS) return fluxExpression(uns_path_test(path));
    return path == ""
        ? fluxExpression(`(not exists r.path or r.path == "")`)
        : flux`r.path == ${path}`;
}

function metric_clause(m, types, store) {
    const names = join(types.map(t => flux`r._measurement == ${`${m.name}:${t}`}`), "or");
    return flux`(r.topLevelInstance == ${m.device} and ${path_clause(m.path, store)} and (${names}))`;
}

/* The UNS bucket's path is `<device ID>/<folder>`. Series key on the
 * folder alone, as in the default bucket, so a device ID change does
 * not split a series. A root metric's path becomes "". */
const STRIP_DEVICE = fluxExpression(
    `\n  |> map(fn: (r) => ({r with path: regexp.replaceAllString(r: /^[^\\/]+\\/?/, v: r.path, t: "")}))`);

const KEEP = `["topLevelInstance", "path", "_measurement", "_time", "_value"]`;
const KEEP_UNIT = `["topLevelInstance", "path", "_measurement", "_time", "unit"]`;

function mean_branch({ bucket, name, metrics, types, windows, every, to_float, suffix, store }) {
    const { start, stop } = envelope(windows);
    const clauses = paren(join(metrics.map(m => metric_clause(m, types(m), store)), "or"));
    const wa = window_args(every);
    const conv = fluxExpression(to_float ? "\n  |> toFloat()" : "");
    const strip = store == UNS ? STRIP_DEVICE : fluxExpression("");
    const id = fluxExpression(name);
    const y = n => flux`${n + suffix}`;

    return String(flux`${id} = from(bucket: ${bucket})
  |> range(start: ${start}, stop: ${stop})
  |> filter(fn: (r) => r._field == "value")
  |> filter(fn: (r) => ${clauses})${time_filter(windows)}${strip}
  |> group(columns: ["topLevelInstance", "path", "_measurement"])${conv}

${id} |> aggregateWindow(${wa}, fn: mean, createEmpty: false, timeSrc: "_start")
  |> keep(columns: ${fluxExpression(KEEP)}) |> yield(name: ${y("mean")})
${id} |> aggregateWindow(${wa}, fn: count, createEmpty: false, timeSrc: "_start")
  |> keep(columns: ${fluxExpression(KEEP)}) |> yield(name: ${y("n")})
${id} |> last()
  |> keep(columns: ${fluxExpression(KEEP_UNIT)}) |> yield(name: ${y("unit")})
`);
}

/** Mean and point count per metric per bucket, plus the newest unit.
 * Booleans need toFloat(), which stops the aggregate pushing down to
 * storage, so they run in their own branch only when asked for.
 * String metrics have no mean and are not queried.
 * @param store The store the bucket holds; `uns` reads the UNS form of
 *   `path` and strips its device segment before grouping.
 * @returns The Flux script, or null if nothing needs querying. */
export function mean_query({ bucket, metrics, windows, every, store = null }) {
    const numeric = metrics.filter(m => m.type == null || NUMERIC_TYPES.includes(m.type));
    const bools = metrics.filter(m => m.type == "b");
    if (!numeric.length && !bools.length) return null;

    let script = zone_header(every, store == UNS ? ["regexp"] : []);
    if (numeric.length)
        script += mean_branch({
            bucket, name: "data", metrics: numeric, windows, every,
            types: m => m.type ? [m.type] : NUMERIC_TYPES,
            to_float: false, suffix: "", store,
        });
    if (bools.length)
        script += mean_branch({
            bucket, name: "bools", metrics: bools, windows, every,
            types: () => ["b"],
            to_float: true, suffix: "_b", store,
        });
    return script;
}

/** The newest data time per device within the lookback. _value is
 * dropped before the merge so mixed types do not collide.
 * @param windows Optional [[a, b]]: only data inside them counts (a
 *   dataset's windows). Without them, the range runs to now. */
export function last_query({ bucket, devices, start, windows = null }) {
    const range = windows
        ? flux`range(start: ${new Date(windows[0][0])}, stop: ${new Date(windows[windows.length - 1][1])})${time_filter(windows)}`
        : flux`range(start: ${new Date(start)})`;
    return String(flux`from(bucket: ${bucket})
  |> ${range}
  |> filter(fn: (r) => ${device_filter(devices)})
  |> filter(fn: (r) => r._field == "value")
  |> filter(fn: (r) => ${birth_filter()})
  |> last()
  |> keep(columns: ["topLevelInstance", "_time"])
  |> group(columns: ["topLevelInstance"])
  |> max(column: "_time")
  |> group()`);
}


/*
 * ---------------------------------------------------------------
 * Result shaping
 * ---------------------------------------------------------------
 */

const suffix_of = measurement => /:([iudbs])$/.exec(measurement)?.[1] ?? null;
const base_of = measurement => measurement.replace(/:[iudbs]$/, "");

/** Turns count rows into sparse [[bucket_start_ms, count], ...] per
 * device. Window starts that Flux clipped to the range start are moved
 * back to the bucket start. */
export function shape_counts(rows, every) {
    const out = new Map();
    for (const r of rows) {
        const t = bucket_start(Date.parse(r._time), every);
        const per = out.get(r.topLevelInstance) ?? new Map();
        per.set(t, (per.get(t) ?? 0) + Number(r._value));
        out.set(r.topLevelInstance, per);
    }
    return new Map([...out].map(([d, per]) =>
        [d, [...per].sort((a, b) => a[0] - b[0])]));
}

/** Turns mean, n and unit rows into one series per requested metric.
 * Rows of one device, path and name with different numeric suffixes
 * merge into one series, weighted by n.
 * @param rows Rows with a `result` column naming the yield.
 * @param metrics The parsed `mean` entries, in request order.
 */
export function shape_means(rows, metrics, every) {
    const series = new Map();
    const key = (device, path, name) => JSON.stringify([device, path ?? "", name]);
    const get = k => {
        if (!series.has(k)) series.set(k, { buckets: new Map(), unit: null });
        return series.get(k);
    };

    for (const r of rows) {
        const kind = String(r.result).replace(/_b$/, "");
        const s = get(key(r.topLevelInstance, r.path, base_of(r._measurement)));
        const type = suffix_of(r._measurement);
        const t = Date.parse(r._time);

        if (kind == "unit") {
            if (!s.unit || t > s.unit.t) s.unit = { t, unit: r.unit ?? null, type };
            continue;
        }
        const b = bucket_start(t, every);
        const by_type = s.buckets.get(b) ?? new Map();
        const cell = by_type.get(type) ?? { mean: null, n: null };
        cell[kind] = Number(r._value);
        by_type.set(type, cell);
        s.buckets.set(b, by_type);
    }

    return metrics.map(m => {
        const out = { device: m.device, metric: m.metric, type: m.type, unit: null, points: [] };
        if (m.type == "s") return out;

        const s = series.get(key(m.device, m.path, m.name));
        if (!s) return out;
        if (s.unit) {
            out.unit = s.unit.unit || null;
            out.type = m.type ?? s.unit.type;
        }
        out.points = [...s.buckets]
            .sort((a, b) => a[0] - b[0])
            .map(([t, by_type]) => merge_cells(t, [...by_type]
                .filter(([type]) => m.type ? type == m.type : NUMERIC_TYPES.includes(type))
                .map(([, cell]) => cell)))
            .filter(p => p);
        return out;
    });
}

function merge_cells(t, cells) {
    let n = 0, sum = 0;
    for (const c of cells) {
        if (c.mean == null) continue;
        const w = c.n ?? 1;
        n += w;
        sum += c.mean * w;
    }
    return n ? [t, sum / n, n] : null;
}

/** Merges the results of one request run against several stores.
 * A device a dataset reaches through both stores gets both stores'
 * data: counts add up, means merge weighted by point count, and `last`
 * is the newer time. This is the same as reading a device twice
 * through one store's sources would give for a download.
 * @param results The SeriesReader#run results, one per store.
 * @returns One result in the same shape. */
export function merge_runs(results) {
    if (results.length == 1) return results[0];

    const sum_counts = maps => {
        const out = new Map();
        for (const m of maps) for (const [d, pts] of m ?? []) {
            const per = out.get(d) ?? new Map();
            for (const [t, n] of pts) per.set(t, (per.get(t) ?? 0) + n);
            out.set(d, per);
        }
        return new Map([...out].map(([d, per]) =>
            [d, [...per].sort((a, b) => a[0] - b[0])]));
    };

    const merge_series = list => {
        const first = list[0];
        const out = { ...first, points: [] };
        const by_t = new Map();
        for (const s of list) {
            out.unit ??= s.unit;
            out.type ??= s.type;
            for (const [t, mean, n] of s.points) {
                const cell = by_t.get(t) ?? { sum: 0, n: 0 };
                cell.sum += mean * n;
                cell.n += n;
                by_t.set(t, cell);
            }
        }
        out.points = [...by_t]
            .sort((a, b) => a[0] - b[0])
            .map(([t, c]) => [t, c.sum / c.n, c.n]);
        return out;
    };

    const last = results.some(r => r.last)
        ? new Map(results.flatMap(r => [...r.last ?? []])
            .sort((a, b) => a[1].localeCompare(b[1])))
        : null;

    const sources = new Set(results.map(r => r.source));
    const pending = results.flatMap(r => r.pending)
        .sort((a, b) => a[0] - b[0])
        .reduce((out, [a, b]) => {
            const prev = out[out.length - 1];
            if (prev && a <= prev[1]) prev[1] = Math.max(prev[1], b);
            else out.push([a, b]);
            return out;
        }, []);

    return {
        counts: results.some(r => r.counts) ? sum_counts(results.map(r => r.counts)) : null,
        source: sources.size == 1 ? [...sources][0] : "mixed",
        pending,
        metrics: results[0].metrics.map((_, i) =>
            merge_series(results.map(r => r.metrics[i]))),
        last,
    };
}

/** Turns last rows into a map of device UUID to ISO time. */
export function shape_last(rows) {
    return new Map(rows.map(r =>
        [r.topLevelInstance, new Date(Date.parse(r._time)).toISOString()]));
}

/** The Cache-Control value: closed history may be cached briefly. */
export function cache_control(req, as_of) {
    const step = STEP_MS.get(req.every);
    return req.to < as_of - 2 * step
        ? "private, max-age=300"
        : "no-store";
}

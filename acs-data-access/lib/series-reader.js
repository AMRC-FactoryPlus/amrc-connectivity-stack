/*
 * ACS Data Access Service
 * Runs the Flux queries for POST /v1/series.
 *
 * The series route has its own concurrency limiter, separate from the
 * CSV export one, so a long download does not stall the timeline.
 */

import pLimit from "p-limit";

import {
    count_query, mean_query, last_query,
    shape_counts, shape_means, shape_last, merge_runs,
    group_by_windows, COVERAGE_STEPS,
} from "./series.js";
import {
    MEASUREMENT, plan_count, plan_source, intersect, split_coverage,
    coverage_query,
} from "./coverage.js";
import { is_missing_bucket } from "./influx-reader.js";

/* The store a source reads when it names none. See Constants.Store. */
const DEFAULT_STORE = "sparkplug";
const UNS = "uns";

/* Sorts spans and merges those that overlap or touch. */
function merge_spans(spans) {
    const out = [];
    for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
        const prev = out[out.length - 1];
        if (prev && a <= prev[1]) prev[1] = Math.max(prev[1], b);
        else out.push([a, b]);
    }
    return out;
}

/** Why a series request stopped early. */
export class SeriesAbort extends Error {
    constructor(reason) {
        super(`Series query aborted: ${reason}`);
        this.reason = reason;
    }
}

export class SeriesReader {
    /**
     * @param opts.influx_client An InfluxDB client.
     * @param opts.influx_org The InfluxDB org.
     * @param opts.buckets The raw data bucket of each store,
     *   `{ sparkplug, uns }`. A store with no bucket cannot be read.
     * @param opts.influx_bucket The `sparkplug` bucket, when `buckets`
     *   is not given.
     * @param opts.concurrency Queries to run at once (default 4).
     * @param opts.query_timeout_ms Time allowed for one query, counted
     *   from when it starts running, not while it waits (default 30 s).
     * @param opts.timeout_ms Time allowed for one request, waiting
     *   included (default 60 s).
     * @param opts.max_queue Queries that may wait for a slot, across
     *   all requests (default 400). More fail with 503.
     * @param opts.coverage The `sparkplug` store's Coverage, or null to
     *   count raw data only.
     * @param opts.coverages The Coverage of each store, `{ sparkplug,
     *   uns }`, in place of `coverage`. A store without one counts raw
     *   data only.
     */
    constructor(opts) {
        this.log = opts.debug.bound("series");
        this.buckets = opts.buckets ?? { [DEFAULT_STORE]: opts.influx_bucket };
        this.query_api = opts.query_api
            ?? opts.influx_client.getQueryApi(opts.influx_org);
        this.limit = pLimit(Number(opts.concurrency) || 4);
        this.query_timeout_ms = Number(opts.query_timeout_ms) || 30000;
        this.timeout_ms = Number(opts.timeout_ms) || 60000;
        this.max_queue = Number(opts.max_queue) || 400;
        this.coverages = opts.coverages ?? { [DEFAULT_STORE]: opts.coverage ?? null };
        /* The UNS bucket may not exist yet when Data Access starts. */
        this.warned_missing = false;
    }

    /** The default store's summary, which GET /coverage/status reports
     * first. */
    get coverage() {
        return this.coverages[DEFAULT_STORE] ?? null;
    }

    /** Whether this reader has a bucket for the store. */
    has_store(store) {
        return !!this.buckets[store];
    }

    /** What a store's coverage summary holds, or null if it is not
     * ready. */
    coverage_state(store = DEFAULT_STORE) {
        return this.coverages[store]?.read_state() ?? null;
    }

    /** Every store's coverage state, read once for a request.
     * @returns {object} store => state or null. */
    coverage_states() {
        return Object.fromEntries(Object.keys(this.buckets)
            .map(s => [s, this.coverage_state(s)]));
    }

    /** Whether counts for this request can read the summary. */
    uses_coverage(req, state = this.coverage_state()) {
        return req.count && state != null && COVERAGE_STEPS.has(req.every);
    }

    /** Counts per device per bucket. At 1h or coarser, with the summary
     * ready, the summary answers the hours it holds and raw data answers
     * the rest (the newest hours, and old hours the backfill has not
     * reached, if they fit within the raw count limit).
     * @param state The coverage state read once for this request.
     * @param store The store to count.
     * @returns {counts: Map, source, pending: [[a, b]]} */
    async counts(req, groups, signal, state, store = DEFAULT_STORE) {
        const { every } = req;
        const bucket = this.buckets[store];

        if (!this.uses_coverage(req, state)) {
            const parts = await Promise.all(groups.map(g =>
                this.query_rows(count_query({ bucket, every, ...g }), signal, store)));
            return { counts: shape_counts(parts.flat(), every), source: "raw", pending: [] };
        }

        const plan = plan_count({ from: req.from, to: req.to, state });
        const cov_bucket = this.coverages[store].bucket;
        const queries = [];
        let edge_raw = false;
        for (const g of groups) {
            const { hourly, daily, raw: edges } = plan.coverage
                ? split_coverage(intersect(g.windows, [plan.coverage]), every)
                : { hourly: [], daily: [], raw: [] };

            /* Raw parts of the plan, plus the part-hours at window edges
             * that the summary cannot answer. */
            if (edges.length) edge_raw = true;
            const raw = merge_spans([...intersect(g.windows, plan.raw), ...edges]);
            if (raw.length)
                queries.push(count_query({ bucket, every, devices: g.devices, windows: raw }));

            for (const [measurement, spans] of [
                [MEASUREMENT.hourly, hourly], [MEASUREMENT.daily, daily],
            ]) {
                const q = coverage_query({
                    bucket: cov_bucket, measurement, devices: g.devices, spans, every,
                });
                if (q) queries.push(q);
            }
        }

        const parts = await Promise.all(queries.map(q => this.query_rows(q, signal, store)));
        return {
            counts: shape_counts(parts.flat(), every),
            source: edge_raw && plan.raw.length == 0 ? "mixed" : plan_source(plan),
            pending: plan.pending,
        };
    }

    /** Returns an AbortController that aborts after the timeout. */
    controller() {
        const ctl = new AbortController();
        const timer = setTimeout(
            () => ctl.abort(new SeriesAbort("timeout")), this.timeout_ms);
        ctl.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
        ctl.done = () => clearTimeout(timer);
        return ctl;
    }

    /** Runs one Flux query and collects its rows as objects. Rows carry
     * a `result` column naming their yield. The query's own timeout
     * starts when it gets a slot. If too many queries are waiting, it
     * fails with SeriesAbort("busy") without queueing.
     *
     * historian-uns creates the UNS bucket when it starts, which may be
     * after Data Access. Until then a `uns` query reads nothing, rather
     * than failing the request. */
    query_rows(query, signal, store = DEFAULT_STORE) {
        if (this.limit.pendingCount >= this.max_queue)
            return Promise.reject(new SeriesAbort("busy"));

        if (store == UNS)
            return this.#query_rows(query, signal).catch(err => {
                if (!is_missing_bucket(err)) throw err;
                if (!this.warned_missing)
                    this.log("The UNS bucket does not exist yet; reading it as empty");
                this.warned_missing = true;
                return [];
            });
        return this.#query_rows(query, signal);
    }

    #query_rows(query, signal) {
        return this.limit(() => new Promise((resolve, reject) => {
            if (signal.aborted) return reject(signal.reason);

            const rows = [];
            let cancellable;
            const finish = () => {
                clearTimeout(timer);
                signal.removeEventListener("abort", on_abort);
            };
            const stop = reason => {
                finish();
                cancellable?.cancel();
                reject(reason);
            };
            const on_abort = () => stop(signal.reason);
            const timer = setTimeout(
                () => stop(new SeriesAbort("timeout")), this.query_timeout_ms);
            signal.addEventListener("abort", on_abort, { once: true });

            this.query_api.queryRows(query, {
                next: (values, meta) => rows.push(meta.toObject(values)),
                error: err => { finish(); reject(err); },
                complete: () => { finish(); resolve(rows); },
                useCancellable: c => { cancellable = c; },
            });
        }));
    }

    /** The newest data time per device. For a dataset, only data
     * inside the device's source windows (and the lookback) counts, so
     * `last` never shows data outside what the dataset grants. These
     * windows are not clipped to the request, so a live device shows
     * its newest data even when the request ends earlier.
     * @param last_windows Map of device UUID to its unclipped windows.
     * @param store The store to read. */
    async last(req, last_windows, as_of, signal, store = DEFAULT_STORE) {
        const bucket = this.buckets[store];
        const start = as_of - req.last.lookback;

        if (!req.dataset) {
            const devices = [...last_windows.keys()];
            if (!devices.length) return new Map();
            return shape_last(await this.query_rows(
                last_query({ bucket, devices, start }), signal, store));
        }

        const parts = await Promise.all(group_by_windows(last_windows).map(g => {
            const ws = intersect(g.windows, [[start, Infinity]]);
            return ws.length
                ? this.query_rows(last_query({ bucket, devices: g.devices, start, windows: ws }), signal, store)
                : [];
        }));
        return shape_last(parts.flat());
    }

    /** Runs the queries a parsed request needs.
     * @param req The output of parse_request.
     * @param windows Map of permitted device UUID to its windows.
     * @param as_of The request time in ms.
     * @param signal An AbortSignal.
     * @param state The coverage state, read once for the request (by
     *   default, read now).
     * @param last_windows For a dataset, the device windows `last` may
     *   read, not clipped to the request (by default, `windows`).
     * @param store The store to read.
     * @returns {counts: Map|null, source, pending, metrics: Array, last: Map|null}
     */
    async run(req, windows, as_of, signal, state = this.coverage_state(),
            last_windows = windows, store = DEFAULT_STORE) {
        const { every } = req;
        const bucket = this.buckets[store];
        const groups = group_by_windows(windows);

        const counts = req.count ? this.counts(req, groups, signal, state, store) : null;

        const mean_rows = Promise.all(groups.map(g => {
            const in_group = new Set(g.devices);
            const metrics = req.mean.filter(m => in_group.has(m.device));
            const query = metrics.length
                ? mean_query({ bucket, metrics, windows: g.windows, every, store })
                : null;
            return query ? this.query_rows(query, signal, store) : [];
        }));

        const last = req.last ? this.last(req, last_windows, as_of, signal, store) : null;

        const [c, m, l] = await Promise.all([counts, mean_rows, last]);
        return {
            counts: c?.counts ?? null,
            source: c?.source ?? "raw",
            pending: c?.pending ?? [],
            metrics: shape_means(m.flat(), req.mean, every, store),
            last: l ?? (req.last ? new Map() : null),
        };
    }

    /** Runs a request against each store it reads, and merges the
     * results by device. See merge_runs.
     * @param by_store Map of store to `{ windows, last_windows }`.
     * @param states Each store's coverage state, read once for the
     *   request: store => state or null.
     * @returns As run(). */
    async run_stores(req, by_store, as_of, signal, states) {
        const results = await Promise.all([...by_store].map(
            ([store, { windows, last_windows }]) => this.run(
                req, windows, as_of, signal, states[store] ?? null,
                last_windows, store)));
        return merge_runs(results);
    }
}

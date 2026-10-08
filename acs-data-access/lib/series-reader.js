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
    shape_counts, shape_means, shape_last,
    group_by_windows, COVERAGE_STEPS,
} from "./series.js";
import {
    MEASUREMENT, plan_count, plan_source, intersect, split_coverage,
    coverage_query,
} from "./coverage.js";

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
     * @param opts.influx_bucket The raw data bucket.
     * @param opts.concurrency Queries to run at once (default 4).
     * @param opts.timeout_ms Time allowed for one request (default 30 s).
     * @param opts.coverage A Coverage, or null to count raw data only.
     */
    constructor(opts) {
        this.log = opts.debug.bound("series");
        this.bucket = opts.influx_bucket;
        this.query_api = opts.query_api
            ?? opts.influx_client.getQueryApi(opts.influx_org);
        this.limit = pLimit(Number(opts.concurrency) || 4);
        this.timeout_ms = Number(opts.timeout_ms) || 30000;
        this.coverage = opts.coverage ?? null;
    }

    /** What the coverage summary holds, or null if it is not ready. */
    coverage_state() {
        return this.coverage?.read_state() ?? null;
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
     * @returns {counts: Map, source, pending: [[a, b]]} */
    async counts(req, groups, signal, state) {
        const { every } = req;
        const bucket = this.bucket;

        if (!this.uses_coverage(req, state)) {
            const parts = await Promise.all(groups.map(g =>
                this.query_rows(count_query({ bucket, every, ...g }), signal)));
            return { counts: shape_counts(parts.flat(), every), source: "raw", pending: [] };
        }

        const plan = plan_count({ from: req.from, to: req.to, state });
        const cov_bucket = this.coverage.bucket;
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

        const parts = await Promise.all(queries.map(q => this.query_rows(q, signal)));
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
     * a `result` column naming their yield. */
    query_rows(query, signal) {
        return this.limit(() => new Promise((resolve, reject) => {
            if (signal.aborted) return reject(signal.reason);

            const rows = [];
            let cancellable;
            const on_abort = () => {
                cancellable?.cancel();
                reject(signal.reason);
            };
            signal.addEventListener("abort", on_abort, { once: true });
            const done = () => signal.removeEventListener("abort", on_abort);

            this.query_api.queryRows(query, {
                next: (values, meta) => rows.push(meta.toObject(values)),
                error: err => { done(); reject(err); },
                complete: () => { done(); resolve(rows); },
                useCancellable: c => { cancellable = c; },
            });
        }));
    }

    /** The newest data time per device. For a dataset, only data
     * inside the device's windows (and the lookback) counts, so `last`
     * never shows data outside what the dataset grants. */
    async last(req, windows, groups, as_of, signal) {
        const bucket = this.bucket;
        const start = as_of - req.last.lookback;

        if (!req.dataset) {
            const devices = [...windows.keys()];
            if (!devices.length) return new Map();
            return shape_last(await this.query_rows(
                last_query({ bucket, devices, start }), signal));
        }

        const parts = await Promise.all(groups.map(g => {
            const ws = intersect(g.windows, [[start, Infinity]]);
            return ws.length
                ? this.query_rows(last_query({ bucket, devices: g.devices, start, windows: ws }), signal)
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
     * @returns {counts: Map|null, source, pending, metrics: Array, last: Map|null}
     */
    async run(req, windows, as_of, signal, state = this.coverage_state()) {
        const { every } = req;
        const bucket = this.bucket;
        const groups = group_by_windows(windows);

        const counts = req.count ? this.counts(req, groups, signal, state) : null;

        const mean_rows = Promise.all(groups.map(g => {
            const in_group = new Set(g.devices);
            const metrics = req.mean.filter(m => in_group.has(m.device));
            const query = metrics.length
                ? mean_query({ bucket, metrics, windows: g.windows, every })
                : null;
            return query ? this.query_rows(query, signal) : [];
        }));

        const last = req.last ? this.last(req, windows, groups, as_of, signal) : null;

        const [c, m, l] = await Promise.all([counts, mean_rows, last]);
        return {
            counts: c?.counts ?? null,
            source: c?.source ?? "raw",
            pending: c?.pending ?? [],
            metrics: shape_means(m.flat(), req.mean, every),
            last: l ?? (req.last ? new Map() : null),
        };
    }
}

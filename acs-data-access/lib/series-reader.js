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
    group_by_windows,
} from "./series.js";

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
     */
    constructor(opts) {
        this.log = opts.debug.bound("series");
        this.bucket = opts.influx_bucket;
        this.query_api = opts.query_api
            ?? opts.influx_client.getQueryApi(opts.influx_org);
        this.limit = pLimit(Number(opts.concurrency) || 4);
        this.timeout_ms = Number(opts.timeout_ms) || 30000;
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

    /** Runs the queries a parsed request needs.
     * @param req The output of parse_request.
     * @param windows Map of permitted device UUID to its windows.
     * @param as_of The request time in ms.
     * @param signal An AbortSignal.
     * @returns {counts: Map|null, metrics: Array, last: Map|null}
     */
    async run(req, windows, as_of, signal) {
        const { every } = req;
        const bucket = this.bucket;
        const groups = group_by_windows(windows);

        const counts = req.count
            ? Promise.all(groups.map(g =>
                this.query_rows(count_query({ bucket, every, ...g }), signal)))
                .then(parts => shape_counts(parts.flat(), every))
            : null;

        const mean_rows = Promise.all(groups.map(g => {
            const in_group = new Set(g.devices);
            const metrics = req.mean.filter(m => in_group.has(m.device));
            const query = metrics.length
                ? mean_query({ bucket, metrics, windows: g.windows, every })
                : null;
            return query ? this.query_rows(query, signal) : [];
        }));

        const devices = [...windows.keys()];
        const last = req.last && devices.length
            ? this.query_rows(last_query({
                bucket, devices, start: as_of - req.last.lookback,
            }), signal).then(shape_last)
            : null;

        const [c, m, l] = await Promise.all([counts, mean_rows, last]);
        return {
            counts: c,
            metrics: shape_means(m.flat(), req.mean, every),
            last: l ?? (req.last ? new Map() : null),
        };
    }
}

/*
 * ACS Data Access Service
 * Coverage: provisioning, backfill and repair of the coverage summary.
 *
 * On every start, Data Access makes sure the coverage bucket and the
 * hourly InfluxDB task exist (and that the task runs the Flux this
 * image ships). It then backfills the summary day by day from today
 * backwards, until a long run of days with no raw data, and repairs the
 * last few days once a day. Everything runs in the background: the series route
 * keeps working from raw data until the summary is ready.
 *
 * Every query here is bounded: one local day, or a fixed window below
 * an empty day. None reads the whole raw bucket. Each one runs over
 * fetch() with an AbortController, so a timeout or stop() closes the
 * connection and InfluxDB drops the query.
 */

import {
    chunksToLinesIterable, linesToRowsIterable,
} from "@influxdata/influxdb-client";

import {
    COVERAGE_DEFAULTS, MEASUREMENT,
    task_script, chunk_script, hours_script, day_script,
    newest_query, state_query, previous_query,
    parse_state, fresh_state, needs_rebuild, next_chunk, repair_chunks,
    probe_window, after_probe, retry_delay,
    floor_hour, next_local_hour,
} from "./coverage.js";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* The annotated CSV the query rows are parsed from. */
const DIALECT = {
    header: true, delimiter: ",", quoteChar: '"', commentPrefix: "#",
    annotations: ["datatype", "group", "default"],
};

/** Labels an error with the backfill or repair step it came from, unless
 * a deeper step already did. */
async function step(name, fn) {
    try {
        return await fn();
    }
    catch (err) {
        err.step ??= name;
        throw err;
    }
}

const day_iso = t => new Date(t).toISOString();


/** An error from the InfluxDB HTTP API. */
export class InfluxApiError extends Error {
    constructor(method, path, status, body) {
        super(`InfluxDB ${method} ${path}: ${status} ${body}`);
        this.statusCode = status;
    }
}

/** The few InfluxDB management calls the summary needs, over the v2
 * HTTP API. */
export class InfluxAdmin {
    /**
     * @param opts.url The InfluxDB URL.
     * @param opts.token An API token. The token never appears in logs.
     * @param opts.fetch A fetch function (for tests).
     */
    constructor(opts) {
        this.url = String(opts.url).replace(/\/+$/, "");
        this.token = opts.token;
        this.fetch = opts.fetch ?? globalThis.fetch;
    }

    async call(method, path, { query, json, text } = {}) {
        const qs = query ? "?" + new URLSearchParams(query) : "";
        const headers = { Authorization: `Token ${this.token}` };
        let body;
        if (json !== undefined) {
            headers["Content-Type"] = "application/json";
            body = JSON.stringify(json);
        }
        else if (text !== undefined) {
            headers["Content-Type"] = "text/plain; charset=utf-8";
            body = text;
        }
        const res = await this.fetch(this.url + path + qs, { method, headers, body });
        if (res.status == 404 && method == "GET") return null;
        if (!res.ok)
            throw new InfluxApiError(method, path, res.status, await res.text());
        if (res.status == 204) return {};
        const text_out = await res.text();
        return text_out ? JSON.parse(text_out) : {};
    }

    async org_id(name) {
        const res = await this.call("GET", "/api/v2/orgs", { query: { org: name } });
        const org = res?.orgs?.find(o => o.name == name);
        if (!org) throw new Error(`InfluxDB org ${name} not found`);
        return org.id;
    }

    /* InfluxDB answers 404 for a bucket name that does not exist. */
    async find_bucket(org_id, name) {
        const res = await this.call("GET", "/api/v2/buckets", { query: { orgID: org_id, name } });
        return res?.buckets?.find(b => b.name == name) ?? null;
    }

    create_bucket(org_id, name, shard_group_seconds, description) {
        return this.call("POST", "/api/v2/buckets", { json: {
            orgID: org_id, name, description,
            retentionRules: [{
                type: "expire", everySeconds: 0,
                shardGroupDurationSeconds: shard_group_seconds,
            }],
        } });
    }

    /** Every task with this name, oldest first. */
    async find_tasks(org_id, name) {
        const res = await this.call("GET", "/api/v2/tasks", { query: { orgID: org_id, name } });
        return (res?.tasks ?? [])
            .filter(t => t.name == name)
            .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))
                || String(a.id).localeCompare(String(b.id)));
    }

    delete_task(id) {
        return this.call("DELETE", `/api/v2/tasks/${encodeURIComponent(id)}`);
    }

    create_task(org_id, flux, description) {
        return this.call("POST", "/api/v2/tasks", { json: {
            orgID: org_id, flux, description, status: "active",
        } });
    }

    update_task(id, flux) {
        return this.call("PATCH", `/api/v2/tasks/${encodeURIComponent(id)}`, { json: { flux } });
    }

    /** Runs scheduled after `after` (ms). */
    async task_runs(id, after, limit = 20) {
        const res = await this.call("GET", `/api/v2/tasks/${encodeURIComponent(id)}/runs`,
            { query: { limit, afterTime: new Date(after).toISOString() } });
        return res?.runs ?? [];
    }

    /** Runs a Flux query and returns its rows as objects. Aborting
     * `signal` closes the HTTP connection, which makes InfluxDB cancel
     * the query. (The client library's own timeout does not: it reports
     * the error but leaves the request open.) */
    async query(org, flux, { signal } = {}) {
        const res = await this.fetch(this.url + "/api/v2/query?" + new URLSearchParams({ org }), {
            method: "POST",
            signal,
            headers: {
                Authorization: `Token ${this.token}`,
                "Content-Type": "application/json",
                Accept: "application/csv",
            },
            body: JSON.stringify({ query: flux, type: "flux", dialect: DIALECT }),
        });
        if (!res.ok)
            throw new InfluxApiError("POST", "/api/v2/query", res.status, await res.text());
        const out = [];
        for await (const { values, tableMeta } of
                linesToRowsIterable(chunksToLinesIterable(res.body)))
            out.push(tableMeta.toObject(values));
        return out;
    }

    /** Writes line protocol with millisecond timestamps. */
    write(org_id, bucket, lines) {
        return this.call("POST", "/api/v2/write", {
            query: { orgID: org_id, bucket, precision: "ms" },
            text: lines,
        });
    }
}


/* Line protocol for the backfill marker. Each field is a point at time
 * 0, so a write replaces the previous marker. */
export function state_lines(state) {
    const esc = s => String(s).replace(/[\\"]/g, c => "\\" + c);
    const fields = [
        `upper=${Math.trunc(state.upper)}i`,
        `backfilled_to=${Math.trunc(state.backfilled_to)}i`,
        `complete=${state.complete ? "true" : "false"}`,
        `rule=${Math.trunc(state.rule)}i`,
        `rebuild="${esc(state.rebuild ?? "")}"`,
        `oldest_data=${Math.trunc(state.oldest_data ?? -1)}i`,
    ];
    return `${MEASUREMENT.state} ${fields.join(",")} 0`;
}


/** Reads a boolean from an environment value; unset gives the default. */
const env_bool = (v, dflt) =>
    v == null || v === "" ? dflt : !/^(false|0|no|off)$/i.test(String(v));
const env_num = (v, dflt) =>
    v == null || v === "" || isNaN(Number(v)) ? dflt : Number(v);


export class Coverage {
    /**
     * @param opts.debug The debug logger.
     * @param opts.admin An InfluxAdmin. Queries run through its query().
     * @param opts.org The InfluxDB org name.
     * @param opts.raw_bucket The raw data bucket.
     * @param opts.env Settings, usually process.env. See the docs for
     *   the COVERAGE_* variables.
     * @param opts.now A clock (for tests).
     * @param opts.sleep A sleep function (for tests).
     */
    constructor(opts) {
        const env = opts.env ?? {};
        this.log = opts.debug.bound("coverage");
        this.admin = opts.admin;
        this.org = opts.org;
        this.raw_bucket = opts.raw_bucket;
        this.now = opts.now ?? Date.now;
        this.sleep = opts.sleep ?? sleep;

        this.enabled = env_bool(env.COVERAGE_ENABLED, true);
        this.bucket = env.COVERAGE_BUCKET || COVERAGE_DEFAULTS.bucket;
        this.task_name = env.COVERAGE_TASK || COVERAGE_DEFAULTS.task;
        this.recount_hours = env_num(env.COVERAGE_RECOUNT_HOURS, COVERAGE_DEFAULTS.recount_hours);
        this.backfill_enabled = env_bool(env.COVERAGE_BACKFILL, true);
        this.backfill_from = env.COVERAGE_BACKFILL_FROM
            ? Date.parse(env.COVERAGE_BACKFILL_FROM) : null;
        if (Number.isNaN(this.backfill_from)) {
            this.log("Ignoring COVERAGE_BACKFILL_FROM: not a date");
            this.backfill_from = null;
        }
        this.empty_days = env_num(env.COVERAGE_BACKFILL_EMPTY_DAYS, COVERAGE_DEFAULTS.empty_days);
        if (!(this.empty_days >= 1)) {
            this.log("Ignoring COVERAGE_BACKFILL_EMPTY_DAYS: must be at least 1");
            this.empty_days = COVERAGE_DEFAULTS.empty_days;
        }
        this.timeout_ms = env_num(env.COVERAGE_TIMEOUT_MS, COVERAGE_DEFAULTS.timeout_ms);
        this.pause_ms = env_num(env.COVERAGE_PAUSE_MS, COVERAGE_DEFAULTS.pause_ms);
        this.repair_days = env_num(env.COVERAGE_REPAIR_DAYS, COVERAGE_DEFAULTS.repair_days);
        this.rebuild = env.COVERAGE_REBUILD ?? "";
        /* Raw points before this are ignored (bad device clocks). */
        this.min_time = env.COVERAGE_MIN_TIME
            ? Date.parse(env.COVERAGE_MIN_TIME) : COVERAGE_DEFAULTS.min_time;
        if (Number.isNaN(this.min_time)) {
            this.log("Ignoring COVERAGE_MIN_TIME: not a date");
            this.min_time = COVERAGE_DEFAULTS.min_time;
        }

        this.ids = null;
        this.marker = null;
        this.newest = null;
        this.task_stop = null;
        this.task_info = null;
        /* The detail stays in the log; status() reports only the code. */
        this.last_error = null;
        this.stopped = false;
        this.timers = new Set();
        /* AbortControllers of the queries in flight, for stop(). */
        this.inflight = new Set();
        this.failures = 0;
        /* Backfill and repair chunks run one at a time on this chain. */
        this.chain = Promise.resolve();
    }

    /** The Flux the task should run. */
    task_flux() {
        return task_script({
            raw_bucket: this.raw_bucket, bucket: this.bucket, org: this.org,
            task: this.task_name, recount_hours: this.recount_hours,
        });
    }

    /** Creates the bucket and the task if they are missing, and updates
     * the task's Flux if it differs from this version's. Safe to run on
     * every start. */
    async ensure() {
        const { admin } = this;
        const org_id = await admin.org_id(this.org);

        let bucket = await admin.find_bucket(org_id, this.bucket);
        if (!bucket) {
            this.log("Creating bucket %s", this.bucket);
            bucket = await admin.create_bucket(org_id, this.bucket,
                COVERAGE_DEFAULTS.shard_group_seconds,
                "Hourly and daily data-arrival counts per device (ACS Data Access).");
        }

        const flux = this.task_flux();
        let tasks = await admin.find_tasks(org_id, this.task_name);
        if (!tasks.length) {
            this.log("Creating task %s", this.task_name);
            await admin.create_task(org_id, flux,
                "ACS coverage summary. Managed by Data Access: edits are replaced on restart.");
            /* Another replica may have created one at the same time. */
            tasks = await admin.find_tasks(org_id, this.task_name);
        }
        /* Keep the oldest task and delete any duplicates. */
        let [task, ...extra] = tasks;
        if (!task) throw new Error(`Task ${this.task_name} was not created`);
        for (const t of extra) {
            this.log("Deleting duplicate task %s (%s)", this.task_name, t.id);
            await admin.delete_task(t.id);
        }
        if (task.flux != flux) {
            this.log("Updating the Flux of task %s", this.task_name);
            task = await admin.update_task(task.id, flux);
        }
        if (task.status && task.status != "active")
            this.log("Task %s is %s; leaving it as it is", this.task_name, task.status);

        this.ids = { org_id, bucket_id: bucket.id, task_id: task.id };
        this.task_info = { id: task.id, status: task.status ?? null };
        return this.ids;
    }

    /** Runs a query and collects its rows. After `timeout_ms`, or on
     * stop(), it aborts the request, so InfluxDB stops the query too. */
    async rows(query) {
        if (this.stopped) throw new Error("stopped");
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(
            new Error(`query timed out after ${Math.round(this.timeout_ms / 1000)} s`)),
            this.timeout_ms);
        timer.unref?.();
        this.inflight.add(ctl);
        try {
            return await this.admin.query(this.org, query, { signal: ctl.signal });
        }
        catch (err) {
            /* fetch rejects with its own AbortError; report why. */
            throw ctl.signal.aborted && ctl.signal.reason instanceof Error
                ? ctl.signal.reason : err;
        }
        finally {
            clearTimeout(timer);
            this.inflight.delete(ctl);
        }
    }

    async read_marker() {
        return parse_state(await this.rows(state_query({ bucket: this.bucket })));
    }

    async write_marker(state) {
        await this.admin.write(this.ids.org_id, this.bucket, state_lines(state));
        this.marker = { ...state };
    }

    /** The oldest time the backfill summarises. */
    floor() {
        return Math.max(this.min_time, this.backfill_from ?? -Infinity);
    }

    /** The run of empty time that ends the backfill. With
     * COVERAGE_BACKFILL_FROM set, the backfill walks all the way down
     * to it instead. */
    empty_ms() {
        return this.backfill_from != null ? Infinity : this.empty_days * DAY;
    }

    /** Summarises one local day. The current day stops at the last
     * closed hour: the task counts the hours after that, and a partial
     * hour in the summary would undercount. If the day is too large for
     * one query, it counts the day an hour at a time, then sums it.
     * @returns The number of hours with data. */
    async run_chunk({ start, stop: day_end }) {
        const stop = Math.min(day_end, floor_hour(this.now()));
        if (start >= stop) return 0;
        const opts = { raw_bucket: this.raw_bucket, bucket: this.bucket, org: this.org };
        const with_data = rows => rows.filter(r =>
            r._measurement == MEASUREMENT.hourly && Number(r._value) > 0).length;

        try {
            return with_data(await this.rows(chunk_script({ ...opts, start, stop })));
        }
        catch (err) {
            if (this.stopped) throw err;
            this.log("Coverage day %s failed (%s); counting it by the hour",
                new Date(start).toISOString(), err.message);
        }

        let hours = 0;
        for (let h = start; h < stop && !this.stopped; h += HOUR)
            hours += with_data(await this.rows(hours_script({
                ...opts, start: h, stop: Math.min(h + HOUR, stop) })));
        if (this.stopped) throw new Error("stopped");
        await this.rows(day_script({ ...opts, start, stop }));
        return hours;
    }

    /* Waits after a chunk, at least as long as the chunk took, so the
     * backfill uses at most half of one query slot. */
    async pause(elapsed) {
        if (this.stopped) return;
        await this.sleep(Math.max(this.pause_ms, elapsed));
    }

    /** Backfills from the marker downwards, one local day per query,
     * until it reaches the floor or a long enough run of days with no
     * raw data. It never looks up the oldest raw point: that query reads
     * every series over the whole history. Resumes where it stopped; a
     * chunk that fails is repeated on the next try. */
    async backfill() {
        let state = await step("reading the marker", () => this.read_marker());
        if (needs_rebuild(state, this.rebuild)) {
            state = fresh_state(this.now(), this.rebuild);
            this.log("Starting the coverage backfill below %s", day_iso(state.upper));
            await step("writing the marker", () => this.write_marker(state));
        }
        this.marker = state;
        if (state.complete) return state;

        const floor = this.floor();
        const empty_ms = this.empty_ms();
        const save = async (t0, changes) => {
            state = { ...state, ...changes };
            await step("writing the marker", () => this.write_marker(state));
            await this.pause(this.now() - t0);
        };

        for (let chunk; !this.stopped && (chunk = next_chunk(state, floor, empty_ms)); ) {
            const t0 = this.now();
            const hours = await step(`summarising the day from ${day_iso(chunk.start)}`,
                () => this.run_chunk(chunk));
            if (hours) {
                await save(t0, { backfilled_to: chunk.start, oldest_data: chunk.start });
                continue;
            }

            /* An empty day. Look for the newest data in a bounded window
             * below it, and jump to the end of that day. If the window
             * is empty, skip all of it and look in the next one down. */
            await save(t0, { backfilled_to: chunk.start });
            while (!this.stopped && next_chunk(state, floor, empty_ms)) {
                const t1 = this.now();
                const win = probe_window(state.backfilled_to, floor);
                const rows = await step(
                    `looking for data from ${day_iso(win.start)} to ${day_iso(win.stop)}`,
                    () => this.rows(previous_query({ raw_bucket: this.raw_bucket, ...win })));
                const t = rows.length ? Date.parse(rows[0]._time) : NaN;
                const found = Number.isNaN(t) ? null : t;
                await save(t1, { backfilled_to: after_probe(win, found) });
                if (found != null) break;
            }
        }
        if (this.stopped) return state;

        state = { ...state, complete: true };
        await step("writing the marker", () => this.write_marker(state));
        this.log("Coverage backfill complete: summarised down to %s; oldest data found %s",
            day_iso(state.backfilled_to),
            state.oldest_data == null ? "none" : day_iso(state.oldest_data));
        return state;
    }

    /** Re-summarises the last repair_days full days. This catches data
     * that arrived after the task's recount window. */
    async repair() {
        for (const chunk of repair_chunks(this.now(), this.repair_days)) {
            if (this.stopped) return;
            const t0 = this.now();
            await step(`repairing the day from ${day_iso(chunk.start)}`,
                () => this.run_chunk(chunk));
            await this.pause(this.now() - t0);
        }
        this.log("Coverage repair of %d days done", this.repair_days);
    }

    /** Queues work on the chain, so chunks never run in parallel. A
     * failure sets last_error; the caller logs it. */
    enqueue(name, fn) {
        const run = this.chain.then(() => this.stopped ? null : fn());
        this.chain = run.then(() => {}, () => { this.last_error = `${name}_failed`; });
        return run;
    }

    /** One log line for a failed backfill or repair. */
    log_failure(name, err, retry_ms) {
        const when = retry_ms == null ? "" : `; retrying in ${Math.round(retry_ms / MINUTE)} min`;
        this.log("Coverage %s failed while %s: %s%s",
            name, err.step ?? "starting", err.message, when);
    }

    /** Re-reads what the summary holds, for the read path. */
    async refresh() {
        const rows = await this.rows(newest_query({ bucket: this.bucket }));
        const t = rows.length ? Date.parse(rows[0]._time) : NaN;
        this.newest = Number.isNaN(t) ? null : t;

        if (this.ids?.task_id) {
            const runs = await this.admin.task_runs(this.ids.task_id, this.now() - 6 * HOUR);
            const ok = runs
                .filter(r => r.status == "success")
                .map(r => Date.parse(r.scheduledFor))
                .filter(t => !Number.isNaN(t));
            this.task_stop = ok.length ? floor_hour(Math.max(...ok)) : null;
            const latest = runs
                .slice()
                .sort((a, b) => Date.parse(b.scheduledFor) - Date.parse(a.scheduledFor))[0];
            this.task_info = {
                ...this.task_info,
                last_run: latest ? {
                    status: latest.status,
                    scheduledFor: latest.scheduledFor,
                    finishedAt: latest.finishedAt ?? null,
                } : null,
            };
        }
        if (!this.marker) this.marker = await this.read_marker();
    }

    /** What the read path may use, or null if the summary is not ready.
     * @returns {covered_from, summary_to} in ms. */
    read_state() {
        if (!this.enabled || !this.ids || !this.marker) return null;
        const now_hour = floor_hour(this.now());
        const candidates = [this.task_stop, this.newest == null ? null : this.newest + HOUR]
            .filter(t => t != null);
        if (!candidates.length) return null;
        return {
            covered_from: this.marker.complete ? -Infinity : this.marker.backfilled_to,
            summary_to: Math.min(Math.max(...candidates), now_hour),
        };
    }

    /** Whether the newest summarised hour is more than 3 hours old. */
    stale() {
        const s = this.read_state();
        return s == null || this.now() - s.summary_to > 3 * HOUR;
    }

    /** The state for GET /v1/coverage/status. `error` is a code such
     * as "backfill_failed"; the log has the detail.
     * @param detail Whether to include the bucket bounds and the task.
     *   They describe data across all devices, so the route shows them
     *   only to callers who may read every device. */
    status({ detail = true } = {}) {
        const s = this.read_state();
        const out = {
            enabled: this.enabled,
            ready: s != null,
            stale: this.enabled ? this.stale() : null,
            error: this.last_error,
        };
        if (!detail) return out;

        const iso = t => t == null || !Number.isFinite(t) ? null : new Date(t).toISOString();
        return {
            ...out,
            bucket: this.bucket,
            task: this.task_info ? { name: this.task_name, ...this.task_info } : null,
            newestHour: iso(this.newest),
            summarisedTo: iso(s?.summary_to),
            recountHours: this.recount_hours,
            repairDays: this.repair_days,
            backfillEmptyDays: this.empty_days,
            minTime: iso(this.min_time),
            backfill: this.marker ? {
                complete: this.marker.complete,
                backfilledTo: iso(this.marker.backfilled_to),
                upper: iso(this.marker.upper),
                oldestData: iso(this.marker.oldest_data),
            } : null,
        };
    }

    every(ms, fn) {
        const timer = setInterval(fn, ms);
        timer.unref?.();
        this.timers.add(timer);
    }

    at(ms, fn) {
        const timer = setTimeout(() => { this.timers.delete(timer); fn(); }, ms);
        timer.unref?.();
        this.timers.add(timer);
    }

    /** Provisions with retries, then starts the background work. Never
     * throws; the series route works without the summary. */
    async run() {
        if (!this.enabled) {
            this.log("Coverage summary disabled");
            return;
        }

        for (let wait = 5000; !this.stopped; wait = Math.min(wait * 2, 10 * MINUTE)) {
            try {
                await this.ensure();
                this.last_error = null;
                break;
            }
            catch (err) {
                this.last_error = "provisioning_failed";
                this.log("Coverage provisioning failed, retrying in %ds: %s",
                    wait / 1000, err.message);
                await this.sleep(wait);
            }
        }
        if (this.stopped) return;

        const refresh = () => this.refresh()
            .then(() => {
                if (this.read_state() && this.stale())
                    this.log("Coverage summary is stale: newest hour %s",
                        this.status().summarisedTo);
            })
            .catch(err => this.log("Coverage refresh failed: %s", err.message));
        await refresh();
        this.every(5 * MINUTE, refresh);

        if (this.backfill_enabled) {
            const backfill = () => this.enqueue("backfill", () => this.backfill())
                .then(() => { this.failures = 0; return refresh(); }, err => {
                    if (this.stopped) return;
                    /* Try again later, waiting longer after each failure
                     * in a row; the marker keeps the progress. */
                    const wait = retry_delay(this.failures++);
                    this.log_failure("backfill", err, wait);
                    this.at(wait, backfill);
                });
            backfill();
        }

        const schedule_repair = () => {
            const at = next_local_hour(this.now(), COVERAGE_DEFAULTS.repair_hour);
            this.at(at - this.now(), () => {
                this.enqueue("repair", () => this.repair()).then(refresh,
                    err => this.stopped || this.log_failure("repair", err));
                schedule_repair();
            });
        };
        if (this.repair_days > 0) schedule_repair();
    }

    /** Stops the background work and aborts any query in flight. */
    stop() {
        this.stopped = true;
        for (const t of this.timers) { clearTimeout(t); clearInterval(t); }
        this.timers.clear();
        for (const ctl of this.inflight) ctl.abort(new Error("stopped"));
        this.inflight.clear();
    }
}

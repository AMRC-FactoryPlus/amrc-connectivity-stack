/*
 * ACS Edge Agent driver library
 * Edge Scout: list a device's addresses for the Edge Agent
 * Copyright 2026 University of Sheffield
 *
 * The protocol is the "Scouting" section of acs-edge/docs/edge-split.md.
 * The library does everything in it except produce items: the hello,
 * seq, batching, the limits, pacing, the watchdog, cancel and errors.
 */

import fs from "node:fs";

/* The versions of features.scout this library speaks. */
export const SCOUT_VERSIONS = [1];

/* The limits the Edge Agent sends, with their defaults and ceilings.
 * The agent always sends all five, already clamped, but the library
 * clamps again so a faulty agent can't overload a device. */
export const ScoutLimits = {
    defaults:   { items: 20000, depth: 8, seconds: 120, pace_ms: 20, samples: false },
    ceilings:   { items: 50000, depth: 32, seconds: 600 },
};

/* The most items, and the most bytes as JSON, in one items message. */
const BATCH_ITEMS = 500;
const BATCH_BYTES = 256 * 1024;
/* Room left in a batch for {"seq":N,"type":"items","items":[...]}. */
const BATCH_OVERHEAD = 64;
/* The largest window the library keeps to. A bigger one from the Edge
 * Agent is cut to this. */
const MAX_WINDOW = 64;

/* The codes a driver may put in the error of an end message. */
const LIBRARY_CODES = new Set(
    ["UNSUPPORTED", "OPTIONS", "CONN", "AUTH", "CANCELLED", "ERR"]);
const TRUNCATION_REASONS = new Set(
    ["items", "depth", "seconds", "size", "partial_access"]);

const SCAN_ID = /^\w{1,64}$/;
const MAX_OPTIONS = 8 * 1024;
const MAX_MESSAGE = 512;
const MAX_NOTE = 256;
const MAX_EXCLUDED = 8;
const MAX_PREFIXES = 4;
const MAX_SCOPE_STRING = 256;

/* A handler throws this from scout to end the scan with a library
 * code: OPTIONS, CONN, AUTH or ERR. Any other code is sent as ERR. */
export class ScoutError extends Error {
    constructor (code, message) {
        super(message ?? code);
        this.name = "ScoutError";
        this.code = code;
    }
}

/* out.add rejects with this once the scan has stopped, at the item
 * cap, on cancel or at the time limit. `reason` says which. A handler
 * may let it escape from scout: the library ends the scan correctly
 * whatever the handler does after it. */
export class ScoutStopped extends Error {
    constructor (reason) {
        super(`The scan has stopped: ${reason}`);
        this.name = "ScoutStopped";
        this.reason = reason;
    }
}

function read_library_name () {
    try {
        const url = new URL("../package.json", import.meta.url);
        const pkg = JSON.parse(fs.readFileSync(url, "utf8"));
        return `js-edge-driver ${pkg.version}`;
    }
    catch (e) {
        return "js-edge-driver";
    }
}
export const LIBRARY_NAME = read_library_name();

function clip (str, len) {
    if (typeof str != "string") return str;
    return str.length > len ? str.slice(0, len) : str;
}

/* The window of a start request, cut to MAX_WINDOW, or null for
 * none. */
export function clamp_window (window) {
    if (!Number.isInteger(window) || window < 1) return null;
    return Math.min(window, MAX_WINDOW);
}

/* Fill in and clamp the limits of a start request. */
export function clamp_limits (limits) {
    const { defaults, ceilings } = ScoutLimits;
    const given = limits && typeof limits == "object" ? limits : {};
    const int = (key, min) => {
        const v = given[key];
        const n = Number.isInteger(v) && v >= min ? v : defaults[key];
        return key in ceilings ? Math.min(n, ceilings[key]) : n;
    };
    return {
        items:      int("items", 1),
        depth:      int("depth", 1),
        seconds:    int("seconds", 1),
        pace_ms:    int("pace_ms", 0),
        samples:    given.samples === true,
    };
}

/* Sleep for ms, waking early when the signal aborts. Never rejects. */
function sleep (ms, signal) {
    return new Promise(resolve => {
        if (signal?.aborted || ms <= 0) return resolve();
        const done = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", done);
            resolve();
        };
        const timer = setTimeout(done, ms);
        signal?.addEventListener("abort", done);
    });
}

const yield_loop = () => new Promise(resolve => setImmediate(resolve));

/* Check the excluded list a handler returned, cutting it to the
 * protocol's limits. */
function clean_excluded (excluded, log) {
    if (excluded == null) return [];
    if (!Array.isArray(excluded)) {
        log("Handler returned excluded that is not a list: %o", excluded);
        return [];
    }
    const good = excluded
        .filter(s => typeof s?.id == "string" && s.id.length
            && typeof s.reason == "string" && s.reason.length)
        .map(s => {
            const scope = {
                id:     clip(s.id, MAX_SCOPE_STRING),
                reason: clip(s.reason, 32),
            };
            if (Array.isArray(s.prefixes))
                scope.prefixes = s.prefixes
                    .filter(p => typeof p == "string" && p.length)
                    .slice(0, MAX_PREFIXES)
                    .map(p => clip(p, MAX_SCOPE_STRING));
            return scope;
        });
    if (good.length != excluded.length || good.length > MAX_EXCLUDED)
        log("Handler's excluded list cut from %s to %s scopes",
            excluded.length, Math.min(good.length, MAX_EXCLUDED));
    return good.slice(0, MAX_EXCLUDED);
}

/* One running scan. */
class Scan {
    constructor (opts) {
        this.scouter    = opts.scouter;
        this.log        = opts.scouter.log;
        this.id         = opts.id;
        this.session    = opts.session;
        this.handler    = opts.handler;
        this.request    = opts.request;
        this.limits     = opts.request.limits;

        this.seq        = 0;
        this.abort      = new AbortController();
        /* Why the library stopped the scan: items, depth, seconds or
         * cancel. Null while it runs. */
        this.stopped    = null;
        this.stop_note  = null;
        this.stopped_p  = new Promise(resolve => this.on_stop = resolve);
        this.ended      = false;

        this.count      = 0;
        this.visited    = null;
        this.note       = null;
        this.depths     = new Map();
        this.depth_cut  = false;

        this.pending        = [];
        this.pending_bytes  = 0;
        this.flush_timer    = null;
        this.chain          = Promise.resolve();

        /* The Edge Agent's window, and the seq of each items message
         * it has not acked yet. */
        this.window         = opts.window ?? null;
        this.unacked        = [];
        this.acked_seq      = -1;
        this.ack_waiters    = new Set();
        /* Batches go out one after another, each waiting for room. */
        this.batches        = Promise.resolve();
    }

    /* The agent has handled every message up to seq. */
    ack (seq) {
        this.acked_seq = Math.max(this.acked_seq, seq);
        while (this.unacked.length && this.unacked[0] <= seq)
            this.unacked.shift();
        for (const wake of this.ack_waiters) wake();
    }

    /* Wait until another items message fits in the window. Once the
     * scan has stopped it waits at most grace_ms, and returns false if
     * there is still no room. */
    async room () {
        const full = () => this.window != null && this.unacked.length >= this.window;
        let deadline = null;
        while (full()) {
            if (this.ended) return false;
            if (this.stopped) {
                deadline ??= Date.now() + this.scouter.grace_ms;
                if (Date.now() >= deadline) return false;
            }
            await new Promise(resolve => {
                const done = () => {
                    clearTimeout(timer);
                    this.abort.signal.removeEventListener("abort", done);
                    this.ack_waiters.delete(done);
                    resolve();
                };
                const ms = deadline == null ? 60_000 : Math.max(deadline - Date.now(), 0);
                const timer = setTimeout(done, ms);
                this.ack_waiters.add(done);
                if (!this.stopped)
                    this.abort.signal.addEventListener("abort", done);
            });
        }
        return true;
    }

    /* Publish a message on found/<id>, in order and with the next seq.
     * `build` turns the seq into the payload. */
    send (build) {
        const seq = this.seq++;
        const body = build(seq);
        const pr = this.chain.then(() =>
            this.scouter.publish(this.id, body, this.session));
        this.chain = pr;
        return pr;
    }

    send_msg (msg) {
        return this.send(seq => JSON.stringify({ seq, ...msg }));
    }

    stop (why, note) {
        if (this.stopped) return;
        this.stopped = why;
        this.stop_note = note;
        this.abort.abort();
        this.on_stop();
    }

    out () {
        const signal = this.abort.signal;
        return {
            add:        items => this.add(items),
            progress:   p => this.set_progress(p),
            pace:       () => sleep(this.limits.pace_ms, signal),
            signal,
            limits:     this.limits,
        };
    }

    set_progress (p) {
        if (!p || typeof p != "object") return;
        if (Number.isInteger(p.visited) && p.visited >= 0)
            this.visited = p.visited;
        if (typeof p.note == "string" || p.note === null)
            this.note = clip(p.note, MAX_NOTE);
    }

    send_progress () {
        if (this.stopped || this.ended) return;
        return this.send_msg({
            type:       "progress",
            visited:    Math.max(this.visited ?? 0, this.count),
            found:      this.count,
            note:       this.note,
        });
    }

    /* Prepare one item for sending, or return undefined to drop it. */
    prepare (raw) {
        if (!raw || typeof raw != "object" || Array.isArray(raw)
            || typeof raw.id != "string" || !raw.id.length)
        {
            this.log("Dropping an item with no id: %o", raw);
            return;
        }

        const item = { ...raw };
        if (!this.limits.samples)
            delete item.sample;

        /* The depth cap, as a safety net under the handler's own. A
         * branch scan's first item is its folder, at depth 0. */
        const { folder_id } = this.request;
        let depth;
        if (this.count == 0 && folder_id != null && item.id == folder_id)
            depth = 0;
        else {
            const parent = item.parent == null ? 0 : this.depths.get(item.parent);
            depth = parent == undefined ? 1 : parent + 1;
        }
        /* Remember the depth of a dropped item too, so its children
         * are dropped with it. */
        this.depths.set(item.id, depth);
        if (depth > this.limits.depth) {
            this.depth_cut = true;
            return;
        }

        const json = JSON.stringify(item);
        const bytes = Buffer.byteLength(json);
        if (bytes > BATCH_BYTES - BATCH_OVERHEAD) {
            this.log("Dropping item %s: %s bytes is too big for a message",
                item.id, bytes);
            return;
        }
        return { json, bytes };
    }

    async add (items) {
        if (this.stopped || this.ended)
            throw new ScoutStopped(this.stopped ?? "ended");
        if (!Array.isArray(items)) items = [items];

        for (const raw of items) {
            if (this.count >= this.limits.items) {
                this.stop("items");
                break;
            }
            const prepared = this.prepare(raw);
            if (!prepared) continue;

            if (this.pending.length >= BATCH_ITEMS
                || this.pending_bytes + prepared.bytes + 1 + BATCH_OVERHEAD > BATCH_BYTES)
                await this.flush();
            if (this.stopped) break;

            this.pending.push(prepared.json);
            this.pending_bytes += prepared.bytes + 1;
            this.count++;
        }

        if (this.pending.length >= BATCH_ITEMS)
            await this.flush();
        else if (this.pending.length && !this.flush_timer)
            this.flush_timer = setTimeout(() => this.flush(),
                this.scouter.flush_ms);

        if (this.stopped)
            throw new ScoutStopped(this.stopped);
    }

    /* Send the pending items as one items message. Waits for the
     * publish and then for a turn of the event loop, so the handler
     * slows to the speed of the broker and data goes out between
     * batches. */
    async flush () {
        clearTimeout(this.flush_timer);
        this.flush_timer = null;
        /* Nothing goes out after the end message. */
        if (this.ended) this.pending = [];
        if (!this.pending.length) return;

        const batch = this.pending;
        this.pending = [];
        this.pending_bytes = 0;
        const sent = this.batches.then(() => this.send_batch(batch));
        this.batches = sent;
        await sent;
        await yield_loop();
    }

    async send_batch (batch) {
        const room = await this.room();
        /* Nothing goes out after the end message. */
        if (this.ended) return;
        if (!room) {
            this.log("Dropping %s items: the Edge Agent's window stayed full after the scan stopped",
                batch.length);
            return;
        }
        await this.send(seq => {
            if (this.window != null && seq > this.acked_seq) this.unacked.push(seq);
            return `{"seq":${seq},"type":"items","items":[${batch.join(",")}]}`;
        });
    }

    async run () {
        const { scouter } = this;
        this.send_msg(this.window == null
            ? { type: "accept" }
            : { type: "accept", window: this.window });

        const watchdog = setTimeout(() => this.stop("seconds"),
            this.limits.seconds * 1000);
        const ticker = setInterval(() => this.send_progress(),
            scouter.progress_ms);

        /* An async wrapper, so a handler that throws before its first
         * await is caught too. */
        const outcome = (async () =>
            this.handler.scout(this.public_request(), this.out()))()
            .then(value => ({ value }), error => ({ error }));

        let result = await Promise.race([outcome, this.stopped_p.then(() => null)]);
        if (!result) {
            /* The library stopped the scan. Give the handler a moment
             * to return, so a scan never overlaps the next, and end
             * the scan anyway if it hangs. */
            const grace = new AbortController();
            result = await Promise.race([
                outcome,
                sleep(scouter.grace_ms, grace.signal).then(() => ({ hung: true })),
            ]);
            grace.abort();
        }
        clearTimeout(watchdog);
        clearInterval(ticker);

        /* Once stopped, out.add refuses more items. */
        if (!this.stopped) this.stop("done");

        const end = this.end_message(result);
        if (end.error?.code != "CANCELLED")
            await this.flush();
        clearTimeout(this.flush_timer);
        this.ended = true;
        this.log("Scan %s ended: %o", this.id, end);
        await this.send_msg(end);
    }

    public_request () {
        const { root, folder_id, options, limits } = this.request;
        return { root, folder_id, options, limits };
    }

    end_message (result) {
        const error = (code, message) => ({
            type: "end",
            error: { code, message: clip(message ?? code, MAX_MESSAGE) },
        });

        if (this.stopped == "cancel")
            return error("CANCELLED", this.stop_note);

        const value = result.value;
        const result_keys = (truncated, reason) => ({
            type:       "end",
            exhaustive: value?.exhaustive === true,
            truncated,
            reason:     truncated ? reason : null,
            excluded:   clean_excluded(value?.excluded, this.log),
        });

        /* A cap the library enforced decides the result, whatever the
         * handler did after it. */
        if (this.stopped == "items" || this.stopped == "seconds")
            return result_keys(true, this.stopped);

        if (result.error) {
            const e = result.error;
            if (e instanceof ScoutError || e?.name == "ScoutError") {
                const code = LIBRARY_CODES.has(e.code) && e.code != "CANCELLED"
                    ? e.code : "ERR";
                return error(code, e.message);
            }
            this.log("Scan handler failed: %o", e);
            return error("ERR", e?.message ?? String(e));
        }

        if (value != null && typeof value != "object")
            return error("ERR", "The handler's scout returned something that is not an object");

        const truncated = value?.truncated === true;
        if (truncated && !TRUNCATION_REASONS.has(value.reason))
            return error("ERR",
                `The handler returned a truncated scan with reason ${JSON.stringify(value.reason)}`);
        if (!truncated && this.depth_cut)
            return result_keys(true, "depth");
        return result_keys(truncated, value?.reason);
    }
}

/* Handles the scout topic for a Driver. The Driver subscribes to it and
 * routes its messages here. */
export class Scouter {
    constructor (opts) {
        this.driver = opts.driver;
        this.log = this.driver.debug.bound("scout");
        this.scan = null;

        /* Timings, which tests shorten. Progress goes out at least
         * every 5 s, a stopped handler gets grace_ms to return, and a
         * part-filled batch waits flush_ms for more items. */
        this.progress_ms = 4000;
        this.grace_ms = 2000;
        this.flush_ms = 100;
    }

    /* The hello comes from the handler class, not a live handler, so a
     * driver whose configuration failed still answers correctly. */
    get supported () {
        return this.driver.HandlerClass?.scouts === true;
    }

    /* Publish on found/<id>. Nothing goes out unless the driver has
     * subscribed to scout on the current MQTT session. */
    async publish (id, body, session) {
        const { driver } = this;
        if (!driver.scout_seen || !driver.mqtt.connected) return false;
        if (session != undefined && session != driver.scout_session) return false;
        try {
            await driver.mqtt.publishAsync(driver.topic("found", id), body);
            return true;
        }
        catch (e) {
            this.log("Can't publish on found/%s: %s", id, e);
            return false;
        }
    }

    handle (payload) {
        let msg;
        try {
            msg = JSON.parse(payload.toString());
        }
        catch (e) {
            this.log("Bad scout message: %s", e);
            return;
        }

        switch (msg?.op) {
        case "hello":   return this.hello();
        case "start":   return this.start(msg);
        case "cancel":  return this.cancel_id(msg.id);
        case "ack":     return this.ack(msg.id, msg.seq);
        default:
            this.log("Unknown scout message: %o", msg);
        }
    }

    hello () {
        return this.publish("hello", JSON.stringify({
            seq:        0,
            type:       "hello",
            versions:   SCOUT_VERSIONS,
            supported:  this.supported,
            library:    LIBRARY_NAME,
        }));
    }

    /* End a scan straight away, without accept. */
    refuse (id, code, message) {
        this.log("Refusing scan %s: %s %s", id, code, message);
        return this.publish(id, JSON.stringify({
            seq: 0, type: "end", error: { code, message: clip(message, MAX_MESSAGE) },
        }));
    }

    start (msg) {
        const { id } = msg;
        if (typeof id != "string" || !SCAN_ID.test(id) || id == "hello") {
            this.log("Ignoring a scan start with a bad id: %o", id);
            return;
        }

        if (this.scan)
            return this.refuse(id, "ERR", "A scan is already running");
        if (msg.version !== 1)
            return this.refuse(id, "ERR", `Unknown scan request version ${msg.version}`);
        if (!this.supported)
            return this.refuse(id, "UNSUPPORTED", "This driver can't list its addresses");

        const { root = null, folder_id = null, options = {} } = msg;
        if (root !== null && typeof root != "string")
            return this.refuse(id, "OPTIONS", "root must be a string or null");
        if (folder_id !== null && (typeof folder_id != "string" || !folder_id.length))
            return this.refuse(id, "OPTIONS", "folder_id must be a string or null");
        if (folder_id !== null && root === null)
            return this.refuse(id, "OPTIONS", "folder_id needs a root");
        if (!options || typeof options != "object" || Array.isArray(options))
            return this.refuse(id, "OPTIONS", "options must be an object");
        if (Buffer.byteLength(JSON.stringify(options)) > MAX_OPTIONS)
            return this.refuse(id, "OPTIONS", "options is over 8 KiB");

        const { handler } = this.driver;
        if (!handler)
            return this.refuse(id, "CONN", "The driver has no working configuration");
        if (typeof handler.scout != "function")
            return this.refuse(id, "ERR", "The handler sets scouts but has no scout method");

        const scan = new Scan({
            scouter:    this,
            id,
            session:    this.driver.scout_session,
            handler,
            request:    { root, folder_id, options, limits: clamp_limits(msg.limits) },
            window:     clamp_window(msg.window),
        });
        this.scan = scan;
        this.log("Starting scan %s: %o", id, scan.request);

        const done = scan.run()
            .catch(e => this.log("Scan %s failed in the library: %o", id, e))
            .finally(() => {
                if (this.scan === scan) this.scan = null;
            });
        scan.done = done;
        return done;
    }

    ack (id, seq) {
        if (this.scan?.id !== id || !Number.isInteger(seq) || seq < 0) return;
        this.scan.ack(seq);
    }

    cancel_id (id) {
        if (!this.scan || this.scan.id !== id) {
            this.log("Ignoring cancel for scan %s, which isn't running", id);
            return;
        }
        this.scan.stop("cancel", "Cancelled by the Edge Agent");
    }

    /* Cancel the running scan, if any. A new driver configuration does
     * this. */
    cancel (note) {
        this.scan?.stop("cancel", note);
    }

    /* The driver has connected to the broker again. A running scan
     * belongs to the old session, so stop it without a word: its
     * publishes are dropped, and the agent has already seen the
     * disconnect. The scan is forgotten at once, so the agent can
     * start a new one on the new session. */
    reset () {
        this.scan?.stop("cancel", "The driver reconnected");
        this.scan = null;
    }
}

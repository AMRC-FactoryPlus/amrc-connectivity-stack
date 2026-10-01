/*
 * Factory+ Service HTTP API
 * notify/v2: send updates to a client without queueing without limit.
 * Copyright 2026 University of Sheffield AMRC
 */

import { json_equal } from "./util.js";

/** The default send buffer limit, in bytes. */
export const DEFAULT_MAX_BUFFER = 8 * 1024 * 1024;

/* How long to wait before logging another 'holding' message. */
const LOG_INTERVAL = 30000;

/** Read a send buffer limit. Only a positive integer number of bytes
 * is accepted. Anything else falls back to the default, with a log
 * message, so a mistake can't stop every send (0) or set a tiny limit
 * ("8M" would parse as 8).
 * @arg opt The `max_buffer` option, if any.
 * @arg env The `NOTIFY_MAX_BUFFER` environment value, if any.
 * @arg log A logging function.
 * @returns The limit in bytes.
 */
export function max_buffer_from (opt, env, log = () => {}) {
    if (opt !== undefined) {
        if (Number.isSafeInteger(opt) && opt > 0) return opt;
        log("Ignoring max_buffer %o: it must be a positive integer number of bytes", opt);
    }
    else if (env !== undefined && env !== "") {
        if (/^[1-9][0-9]*$/.test(env) && Number.isSafeInteger(Number(env)))
            return Number(env);
        log("Ignoring NOTIFY_MAX_BUFFER=%s: it must be a positive integer number of bytes", env);
    }
    return DEFAULT_MAX_BUFFER;
}

/* Held SEARCH child updates, newest per child, oldest first. A child
 * that changes again moves to the end. The queue keeps replaced
 * updates until they reach the head, where they are skipped, so taking
 * from the head is O(1). It is compacted when replaced updates
 * outnumber live ones, so it stays within twice the live size. */
class KidQueue {
    constructor () {
        this.map = new Map();
        this.queue = [];
        this.head = 0;
    }

    get size () { return this.map.size; }
    has (child) { return this.map.has(child); }

    set (child, u) {
        this.map.set(child, u);
        this.queue.push(u);
        if (this.queue.length - this.head > 2 * this.map.size + 1024) {
            this.queue = this.queue.slice(this.head)
                .filter(k => this.map.get(k.child) === k);
            this.head = 0;
        }
    }

    shift () {
        while (this.head < this.queue.length) {
            const u = this.queue[this.head];
            this.queue[this.head++] = undefined;
            if (this.map.get(u.child) === u) {
                this.map.delete(u.child);
                if (!this.map.size) {
                    this.queue = [];
                    this.head = 0;
                }
                return u;
            }
        }
    }
}

/** Sends notify updates to one client WebSocket.
 *
 * Updates go straight to the WebSocket while its send buffer
 * (`ws.bufferedAmount`) is below `max_buffer`. When a client reads
 * more slowly than updates arrive, the buffer reaches the limit and
 * later updates are held here instead. Held updates are combined, so
 * what is held for a subscription never exceeds the current state:
 *
 * - An update without a `child` (a WATCH update, or a SEARCH snapshot,
 *   403 or 404) carries the full state. It replaces everything held
 *   for its subscription.
 * - A SEARCH child update replaces any held update for the same child.
 *   Updates for different children stay in the order they were held.
 * - An update with a status of 400 or more ends the subscription. It
 *   is always sent, after everything held before it.
 * - If the first update of a subscription (status 201) is replaced
 *   while held, the update sent in its place has status 201.
 *
 * Applying the held updates gives the client the same state as
 * applying every update would. The client may skip states in between.
 *
 * Held updates are sent, in order, when the buffer drops below the
 * limit. Subscriptions take turns, one update each, so a busy SEARCH
 * cannot hold back the others. A held update that is the same as the last update sent for
 * its subscription is not sent, so a client never receives the same
 * update twice in a row.
 *
 * Once anything is held, every new update is held too, so updates for
 * a subscription are never sent out of order.
 */
export class Outbox {
    /**
     * @arg opts.ws The WebSocket to send to.
     * @arg opts.max_buffer Hold updates while this many bytes are
     * buffered.
     * @arg opts.log A logging function.
     */
    constructor (opts) {
        this.ws = opts.ws;
        this.max_buffer = max_buffer_from(opts.max_buffer, undefined, opts.log);
        this.log = opts.log ?? (() => {});

        /* uuid -> the last update sent for that subscription */
        this.last = new Map();
        /* uuid -> held updates, in the order they were first held */
        this.held = new Map();
        /* Sends whose callback has not run yet */
        this.inflight = 0;
        this.closed = false;
        this.timer = null;

        /* Counters, for logs and tests */
        this.stats = { sent: 0, held: 0, replaced: 0, repeats: 0 };
        this.logged = 0;
    }

    full () {
        return this.ws.bufferedAmount >= this.max_buffer;
    }

    /** Send an update, or hold it if the client is behind.
     * @arg u An update, with its `uuid`.
     */
    push (u) {
        if (this.closed) return;
        if (!this.held.size && !this.full())
            return this.send(u);
        this.hold(u);
        this.flush();
    }

    /** A subscription has finished. Forget it once its held updates
     * are sent.
     * @arg uuid The subscription UUID.
     */
    end (uuid) {
        const entry = this.held.get(uuid);
        if (entry) entry.done = true;
        else this.last.delete(uuid);
    }

    /** The WebSocket has closed. Drop everything. */
    close () {
        this.closed = true;
        this.held.clear();
        this.last.clear();
        clearTimeout(this.timer);
    }

    /** The number of updates held. */
    get size () {
        let n = 0;
        for (const e of this.held.values())
            n += (e.base ? 1 : 0) + (e.kids?.size ?? 0) + (e.stop ? 1 : 0);
        return n;
    }

    hold (u) {
        const now = Date.now();
        if (!this.held.size && now - this.logged > LOG_INTERVAL) {
            this.logged = now;
            this.log("Client is reading slowly: holding updates (%d bytes buffered)",
                this.ws.bufferedAmount);
        }
        this.stats.held++;

        const { uuid } = u;
        let entry = this.held.get(uuid);
        if (!entry) {
            entry = { base: null, kids: null, stop: null, first: false, done: false };
            this.held.set(uuid, entry);
        }

        /* The client has not had the first update yet. Whatever is
         * sent first must carry its 201. */
        if (u.status == 201) entry.first = true;

        if (u.status >= 400)
            entry.stop = u;
        else if (!u.child) {
            /* Full state: replaces the snapshot and any child updates. */
            this.stats.replaced += (entry.base ? 1 : 0) + (entry.kids?.size ?? 0);
            entry.base = u;
            entry.kids = null;
        }
        else {
            entry.kids ??= new KidQueue();
            if (entry.kids.has(u.child)) this.stats.replaced++;
            entry.kids.set(u.child, u);
        }
    }

    /* Take the next held update for a subscription. */
    shift (entry) {
        const u = this.next(entry);
        if (u && entry.first) {
            entry.first = false;
            if (u.status < 400 && u.status != 201)
                return { ...u, status: 201 };
        }
        return u;
    }

    next (entry) {
        if (entry.base) {
            const u = entry.base;
            entry.base = null;
            return u;
        }
        if (entry.kids?.size)
            return entry.kids.shift();
        const u = entry.stop;
        entry.stop = null;
        return u;
    }

    /** Send held updates until the buffer is full again. */
    flush () {
        while (!this.closed && this.held.size && !this.full()) {
            const [uuid, entry] = this.held.entries().next().value;
            const u = this.shift(entry);

            const last = this.last.get(uuid);
            if (u && last && json_equal(last, u))
                this.stats.repeats++;
            else if (u)
                this.send(u);

            this.held.delete(uuid);
            if (entry.base || entry.kids?.size || entry.stop)
                /* More to send: go to the back, so others get a turn. */
                this.held.set(uuid, entry);
            else if (entry.done)
                this.last.delete(uuid);
        }

        /* Each send's callback calls flush again. If updates are held
         * with no sends outstanding, check again shortly. */
        if (!this.closed && this.held.size && !this.inflight && !this.timer) {
            this.timer = setTimeout(() => {
                this.timer = null;
                this.flush();
            }, 50);
            this.timer.unref?.();
        }
    }

    send (u) {
        const { ws } = this;
        if (this.closed || ws.readyState != ws.OPEN) return;

        if (u.status >= 400) this.last.delete(u.uuid);
        else this.last.set(u.uuid, u);

        const data = JSON.stringify(u, null, 2);
        this.stats.sent++;
        this.inflight++;
        ws.send(data, () => {
            this.inflight--;
            if (this.held.size) this.flush();
        });
    }
}

/*
 * ACS Data Access Service
 * Test support: a notify client that records what the service sends
 * Copyright 2026 University of Sheffield
 */

/* Not a test file itself: vitest only collects *.test.js.
 *
 * make_client builds the real DataAccessNotify over a DataFlow.
 * `open` asks it for a subscription the way a notify Session does and
 * records every message as the JSON a client receives. `reduce` folds
 * the messages into the state a client holds. `connect_ws` does the
 * same over a real WebSocket. */

import http from "node:http";

import * as rx from "rxjs";

import { json_equal } from "@amrc-factoryplus/service-api";

import { DataAccessNotify } from "../../lib/notify.js";

const quiet = { bound: () => () => {} };

/** The eight notify endpoints: a name, and a function that builds the
 * subscription request. The two single WATCHes take the dataset UUID. */
export const ENDPOINTS = {
    metadata_list:      () => watch("v2/metadata/"),
    metadata_uuid:      uuid => watch(`v2/metadata/${uuid}`),
    metadata_search:    () => search("v2/metadata/"),
    structure_list:     () => watch("v2/structure/"),
    structure_uuid:     uuid => watch(`v2/structure/${uuid}`),
    structure_search:   () => search("v2/structure/"),
    union_sources:      () => watch("v2/union-sources/"),
    session_sources:    () => watch("v2/session-sources/"),
};

/** A WATCH subscription request, without its UUID. */
export function watch (url, method) {
    return { method: "WATCH", request: method ? { url, method } : { url } };
}

/** A SEARCH subscription request, without its UUID. */
export function search (parent, filter) {
    return filter === undefined
        ? { method: "SEARCH", parent }
        : { method: "SEARCH", parent, filter };
}

const sorted = list => [...list].sort();

/* A response body with every order nobody specified sorted: a list of
 * UUIDs, and the `parts` of a metadata body. Key order is kept. */
function tidy_body (body) {
    if (Array.isArray(body)) return sorted(body);
    if (body && typeof body == "object" && Array.isArray(body.parts))
        return { ...body, parts: sorted(body.parts) };
    return body;
}

/** Fold the messages of one subscription into the state its client
 * holds, by the rules of the rx-client library.
 *
 * A SEARCH gives `{ children }`: the snapshot, then each child update
 * with a 2xx response sets that child and any other response removes
 * it. Children are in UUID order. A WATCH gives the last response,
 * `{ status, body }`; a list body replaces the one before. A
 * subscription that ended with a status of 400 or more gives
 * `{ error }`, and one that never answered gives null.
 */
export function reduce (messages, method) {
    if (!messages.length) return null;
    const last = messages[messages.length - 1];
    if (last.status >= 400) return { error: last.status };

    if (method != "SEARCH") {
        const { response } = last;
        if (!response) return { status: last.status };
        return "body" in response
            ? { status: response.status, body: tidy_body(response.body) }
            : { status: response.status };
    }

    let children = null;
    for (const m of messages) {
        if (m.child) {
            if (!children) continue;
            if (m.response.status < 300) children.set(m.child, m.response.body);
            else children.delete(m.child);
        }
        else if (m.children) {
            children = new Map();
            for (const [uuid, res] of Object.entries(m.children))
                if (res.status < 300) children.set(uuid, res.body);
        }
        else {
            children = null;
        }
    }
    if (!children) return { children: null };
    return { children: Object.fromEntries(
        sorted(children.keys()).map(k => [k, tidy_body(children.get(k))])) };
}

const body_type = res => !res || !("body" in res) ? "none"
    : Array.isArray(res.body) ? "array"
    : res.body === null ? "null"
    : typeof res.body;

/** The shape of one message: its keys and statuses, and the type of
 * each body, but no content. */
export function message_shape (message) {
    const parts = [`status=${message.status}`];
    if ("child" in message) parts.push("child");
    if ("children" in message) {
        const kids = new Set(Object.values(message.children)
            .map(c => `${c.status}/${body_type(c)}`));
        parts.push(`children{${sorted(kids).join(",")}}`);
    }
    if ("response" in message)
        parts.push(`response=${message.response.status}/${body_type(message.response)}`);
    const known = new Set(["status", "child", "children", "response"]);
    for (const k of Object.keys(message))
        if (!known.has(k)) parts.push(`+${k}`);
    return parts.join(" ");
}

/* The messages of one subscription. */
class Recording {
    constructor (site, sub) {
        this.site = site;
        this.sub = sub;
        this.method = sub.method;
        /* Each message as a client parses it from the wire. */
        this.messages = [];
        this.error = null;
        this.ended = false;
        this.subscription = null;
    }

    push (message) {
        const wire = JSON.parse(JSON.stringify(message));
        this.messages.push(wire);
        if (this.site) {
            const { counters } = this.site;
            this.site.activity++;
            counters.messages++;
            if (Array.isArray(wire.response?.body))
                counters.list_elements += wire.response.body.length;
        }
    }

    /** The state the client holds now. See `reduce`. */
    state () {
        return reduce(this.messages, this.method);
    }

    /** Forget the messages so far. The state starts again too, so use
     * this only to count the messages of one change. */
    clear () {
        this.messages = [];
    }

    close () {
        this.subscription?.unsubscribe();
        this.ended = true;
    }
}

/** Build a notify client over a DataFlow.
 * @arg opts.data The DataFlow.
 * @arg opts.site The FakeSite, so settle() sees the messages and the
 * counters count them. Optional.
 * @arg opts.tokens For connect_ws: an object from bearer token to the
 * principal it authenticates.
 */
export function make_client (opts) {
    const { data, site } = opts;
    const tokens = opts.tokens ?? {};

    const server = http.createServer();
    const api = {
        http: server,
        auth: {
            auth_bearer: async ({ creds }) => tokens[creds] ?? null,
        },
    };
    const dan = new DataAccessNotify({
        api, data, debug: quiet, auth: site?.auth,
    });

    const recordings = new Set();
    const sockets = new Set();
    let listening = null;

    /** Open one subscription as `principal` and record its messages.
     *
     * This is what a notify Session does with a request: find the
     * handler, drop a message equal to the one before, turn an error
     * into a 500, and stop after a status of 400 or more. A handler
     * that throws (a malformed UUID) throws from here.
     */
    function open (principal, sub) {
        const rec = new Recording(site, sub);
        recordings.add(rec);

        const valid = sub.method == "WATCH" ? !!sub.request
            : sub.method == "SEARCH" ? !!sub.parent?.endsWith("/")
            : false;
        if (!valid) {
            rec.push({ status: 400 });
            rec.ended = true;
            return rec;
        }

        const seq = dan.notify.find_handler({ principal }, sub);
        if (!seq) {
            rec.push({ status: 404 });
            rec.ended = true;
            return rec;
        }

        rec.subscription = seq.pipe(
            rx.distinctUntilChanged(json_equal),
            rx.catchError(e => {
                rec.error = e;
                return rx.of({ status: 500 });
            }),
            rx.takeWhile(res => res.status < 400, true),
        ).subscribe({
            next:       m => rec.push(m),
            complete:   () => { rec.ended = true; },
        });
        return rec;
    }

    /** Connect a real WebSocket to the notify server and authenticate
     * with a bearer token from `opts.tokens`. Needs a global WebSocket
     * (Node 22 or later). */
    async function connect_ws (token) {
        if (!listening) {
            dan.run();
            listening = new Promise((resolve, reject) => {
                server.once("error", reject);
                server.listen(0, "127.0.0.1", resolve);
            });
        }
        await listening;

        const { port } = server.address();
        const ws = new WebSocket(`ws://127.0.0.1:${port}/notify/v2`);
        const conn = new Connection(ws);
        sockets.add(conn);
        await conn.opened;
        ws.send(`Bearer ${token}`);
        const [auth] = await conn.wait_for(1);
        if (auth != "200") throw new Error(`Notify auth failed: ${auth}`);
        conn.frames.length = 0;
        return conn;
    }

    /** Close every subscription, socket and server this client opened. */
    async function stop () {
        for (const rec of recordings) rec.close();
        recordings.clear();
        for (const conn of sockets) await conn.close();
        sockets.clear();
        if (listening) {
            await listening.catch(() => {});
            dan.notify.wss?.close();
            server.closeAllConnections?.();
            await new Promise(resolve => server.close(resolve));
            listening = null;
        }
    }

    return { dan, api, open, connect_ws, stop, recordings };
}

/* One WebSocket to the notify server. `frames` holds each frame the
 * server sent: the auth reply as text, then parsed JSON updates. */
class Connection {
    constructor (ws) {
        this.ws = ws;
        this.frames = [];
        this.waiters = new Set();
        this.closed = false;
        this.next_uuid = 0;

        this.opened = new Promise((resolve, reject) => {
            ws.addEventListener("open", resolve, { once: true });
            ws.addEventListener("error",
                () => reject(new Error("WebSocket failed to open")), { once: true });
        });
        ws.addEventListener("message", ev => {
            const text = String(ev.data);
            this.frames.push(/^[[{]/.test(text) ? JSON.parse(text) : text);
            this._wake();
        });
        ws.addEventListener("close", () => {
            this.closed = true;
            this._wake();
        });
    }

    _wake () {
        for (const w of [...this.waiters]) w();
    }

    /** Send a subscription request. Returns its UUID. */
    request (sub) {
        const n = (++this.next_uuid).toString(16).padStart(12, "0");
        const uuid = `5e550000-0000-4000-8000-${n}`;
        this.ws.send(JSON.stringify({ ...sub, uuid }));
        return uuid;
    }

    /** Send a CLOSE for a subscription. */
    close_sub (uuid) {
        this.ws.send(JSON.stringify({ method: "CLOSE", uuid }));
    }

    /** The updates received for one subscription, without the UUID. */
    updates (uuid) {
        return this.frames
            .filter(f => f?.uuid == uuid)
            .map(({ uuid: _, ...rest }) => rest);
    }

    /** Wait until `done()` is true, for at most `timeout` ms. */
    wait_until (done, timeout = 2000) {
        return new Promise((resolve, reject) => {
            const finish = fn => {
                clearTimeout(timer);
                this.waiters.delete(check);
                fn();
            };
            const check = () => {
                if (done()) finish(resolve);
            };
            const timer = setTimeout(() => finish(() => reject(new Error(
                `Timed out after ${timeout} ms waiting on the WebSocket`))), timeout);
            this.waiters.add(check);
            check();
        });
    }

    /** Wait for at least `count` frames and return them all. */
    async wait_for (count, timeout) {
        await this.wait_until(() => this.frames.length >= count, timeout);
        return this.frames;
    }

    /** Wait for at least `count` updates on one subscription. */
    async wait_for_updates (uuid, count, timeout) {
        await this.wait_until(() => this.updates(uuid).length >= count, timeout);
        return this.updates(uuid);
    }

    /** Wait for the server to close the socket. */
    wait_closed (timeout) {
        return this.wait_until(() => this.closed, timeout);
    }

    async close () {
        if (this.closed) return;
        this.ws.close();
        await this.wait_closed().catch(() => {});
    }
}

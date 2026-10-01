/*
 * ACS ConfigDB
 * Minimal notify/v2 and HTTP client for the benchmark and tests
 * Copyright 2026 University of Sheffield AMRC
 *
 * This deliberately does not use @amrc-factoryplus/rx-client, so that
 * it records exactly what the server sends on the wire.
 */

import crypto           from "node:crypto";

import WebSocket        from "ws";

export class NotifyClient {
    constructor (opts) {
        this.url = opts.url;
        this.token = opts.token;
        /* Keep every update per sub, for the equivalence tests. */
        this.record = opts.record ?? false;

        this.subs = new Map();
        this.messages = 0;
        this.bytes = 0;
        this.last_msg = 0;
    }

    connect () {
        const ws = this.ws = new WebSocket(this.url);
        return new Promise((resolve, reject) => {
            ws.once("error", reject);
            ws.once("open", () => ws.send(`Bearer ${this.token}`));
            ws.once("message", data => {
                const st = data.toString();
                if (st != "200")
                    return reject(new Error(`WS auth failed: ${st}`));
                ws.on("message", this.on_message.bind(this));
                resolve(this);
            });
        });
    }

    close () {
        this.ws?.close();
    }

    on_message (data) {
        this.messages++;
        this.bytes += data.length;
        this.last_msg = performance.now();

        const u = JSON.parse(data.toString());
        const sub = this.subs.get(u.uuid);
        if (!sub) return;
        sub.count++;
        sub.last = u;
        if (this.record)
            sub.updates.push(u);
        if (sub.kind == "SEARCH")
            apply_search(sub, u);
        sub.on_update?.(u);
        for (const w of sub.waiters.splice(0))
            w(u);
    }

    open (kind, req, on_update) {
        const uuid = crypto.randomUUID();
        const sub = {
            uuid, kind, req, on_update,
            count: 0, last: undefined, updates: [], waiters: [],
            children: kind == "SEARCH" ? new Map() : undefined,
        };
        this.subs.set(uuid, sub);
        this.ws.send(JSON.stringify(kind == "WATCH"
            ? { method: "WATCH", uuid, request: { url: req } }
            : { method: "SEARCH", uuid, parent: req }));
        return sub;
    }

    watch (url, on_update) { return this.open("WATCH", url, on_update); }
    search (parent, on_update) { return this.open("SEARCH", parent, on_update); }

    cancel (sub) {
        this.ws.send(JSON.stringify({ method: "CLOSE", uuid: sub.uuid }));
    }

    /* Resolve with the next update to `sub`. */
    next (sub) {
        return new Promise(r => sub.waiters.push(r));
    }

    /* Resolve once every sub has had at least one update. */
    async initialised () {
        for (;;) {
            const pending = [...this.subs.values()].filter(s => !s.count);
            if (!pending.length) return;
            await new Promise(r => setTimeout(r, 50));
        }
    }

    /* The client-visible final state of every sub, keyed by request. */
    final_state () {
        const state = {};
        for (const s of this.subs.values()) {
            const key = `${s.kind} ${s.req}`;
            state[key] = s.kind == "SEARCH"
                ? Object.fromEntries([...s.children].sort())
                : normalise(s.last);
        }
        return state;
    }
}

/* Track the state a SEARCH client would hold. */
function apply_search (sub, u) {
    if (u.children) {
        sub.children = new Map(Object.entries(u.children)
            .filter(([k, v]) => v.status == 200)
            .map(([k, v]) => [k, v.body]));
    }
    else if (u.child) {
        if (u.response?.status == 200)
            sub.children.set(u.child, u.response.body);
        else
            sub.children.delete(u.child);
    }
    else if (u.response?.status >= 300 || u.status >= 400)
        sub.children = new Map();
}

/* Strip per-connection and per-run fields (sub UUID, ETag) and sort
 * list bodies, so states from different runs compare. */
export function normalise (u) {
    if (!u) return u;
    const { uuid, ...rest } = u;
    if (!rest.response) return rest;
    const { headers, ...response } = rest.response;
    const body = response.body;
    if (Array.isArray(body) && body.every(e => typeof e == "string"))
        response.body = [...body].sort();
    return { ...rest, response };
}

export class HttpClient {
    constructor (base, token) {
        this.base = base;
        this.token = token;
    }

    async req (method, path, body) {
        const t0 = performance.now();
        const res = await fetch(new URL(path, this.base), {
            method,
            headers: {
                authorization: `Bearer ${this.token}`,
                ...(body === undefined ? {} : { "content-type": "application/json" }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await res.text();
        return {
            status: res.status,
            body: text && res.headers.get("content-type")?.includes("json")
                ? JSON.parse(text) : text,
            ms: performance.now() - t0,
        };
    }

    get (p) { return this.req("GET", p); }
    put (p, b) { return this.req("PUT", p, b); }
    post (p, b) { return this.req("POST", p, b); }
    delete (p) { return this.req("DELETE", p); }
}

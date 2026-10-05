/*
 * Factory+ Rx interface
 * Tests for NotifyV2 request routing
 * Copyright 2026 University of Sheffield AMRC
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import * as rx from "rxjs";

import { NotifyV2 } from "../lib/notify-v2.js";
import { ConfigDB } from "../lib/configdb.js";

const quiet = () => () => {};

/* A WebSocket the test drives by hand. Requests the client sends are
 * kept in `sent`; `reply` delivers a message to the client. */
class FakeWS extends EventTarget {
    static OPEN = 1;
    readyState = 1;
    sent = [];
    listeners = 0;

    addEventListener (type, ...rest) {
        if (type == "message") this.listeners++;
        super.addEventListener(type, ...rest);
    }

    removeEventListener (type, ...rest) {
        if (type == "message") this.listeners--;
        super.removeEventListener(type, ...rest);
    }

    send (s) { this.sent.push(JSON.parse(s)); }
    close () { this.readyState = 3; }

    reply (msg) {
        const ev = new Event("message");
        Object.defineProperty(ev, "data", { value: JSON.stringify(msg) });
        this.dispatchEvent(ev);
    }

    drop () { this.dispatchEvent(new Event("close")); }
}

function harness () {
    const sockets = [];
    const service = {
        log:        quiet(),
        debug:      { bound: quiet },
        websocket:  async () => {
            const ws = new FakeWS();
            sockets.push(ws);
            return ws;
        },
    };
    const notify = new NotifyV2(service);
    return { notify, sockets, ws: () => sockets.at(-1) };
}

const tick = () => new Promise(r => setImmediate(r));

/* The UUID the client gave a request it sent. */
const uuid_of = (ws, pred) => ws.sent.find(pred)?.uuid;

test("each request sees only its own updates, in order", async () => {
    const { notify, ws } = harness();
    const a = [], b = [];
    const sa = notify.watch("a").subscribe(v => a.push(v));
    const sb = notify.watch("b").subscribe(v => b.push(v));
    await tick();

    const ua = uuid_of(ws(), r => r.request?.url == "a");
    const ub = uuid_of(ws(), r => r.request?.url == "b");
    assert.ok(ua && ub && ua != ub);

    ws().reply({ uuid: ua, status: 201, response: { status: 200, body: 1 } });
    ws().reply({ uuid: ub, status: 201, response: { status: 200, body: 10 } });
    ws().reply({ uuid: "unknown", status: 200, response: { status: 200, body: 99 } });
    ws().reply({ uuid: ua, status: 200, response: { status: 200, body: 2 } });
    ws().reply({ uuid: ua, status: 200, response: { status: 404 } });

    assert.deepEqual(a, [1, 2, undefined]);
    assert.deepEqual(b, [10]);

    sa.unsubscribe();
    sb.unsubscribe();
});

test("unsubscribing sends a CLOSE and stops delivery", async () => {
    const { notify, ws } = harness();
    const a = [], b = [];
    const sa = notify.watch("a").subscribe(v => a.push(v));
    const sb = notify.watch("b").subscribe(v => b.push(v));
    await tick();
    const ua = uuid_of(ws(), r => r.request?.url == "a");
    const ub = uuid_of(ws(), r => r.request?.url == "b");

    sa.unsubscribe();
    assert.deepEqual(ws().sent.at(-1), { method: "CLOSE", uuid: ua });

    ws().reply({ uuid: ua, status: 201, response: { status: 200, body: 1 } });
    ws().reply({ uuid: ub, status: 201, response: { status: 200, body: 2 } });
    assert.deepEqual(a, []);
    assert.deepEqual(b, [2]);
    sb.unsubscribe();
});

test("a 410 ends the request and an error status errors it", async () => {
    const { notify, ws } = harness();
    let done = false, err;
    notify.watch_full("a").subscribe({ complete: () => done = true });
    notify.watch_full("b").subscribe({ error: e => err = e });
    await tick();
    const ua = uuid_of(ws(), r => r.request?.url == "a");
    const ub = uuid_of(ws(), r => r.request?.url == "b");

    ws().reply({ uuid: ua, status: 410 });
    ws().reply({ uuid: ub, status: 403 });
    assert.equal(done, true);
    assert.equal(err?.status, 403);
});

test("routing a message does not visit every open request", async () => {
    const { notify, ws } = harness();
    const N = 2000;
    const got = new Array(N).fill(0);
    const subs = Array.from({ length: N }, (_, i) =>
        notify.watch(`r/${i}`).subscribe(() => got[i]++));
    await tick();

    /* Count how often the client reads the `uuid` of an incoming
     * message. A filter per open request reads it N times. */
    let reads = 0;
    const parse = JSON.parse;
    JSON.parse = (...args) => {
        const v = parse(...args);
        if (v && typeof v == "object" && "uuid" in v) {
            const { uuid } = v;
            Object.defineProperty(v, "uuid",
                { get: () => (reads++, uuid), enumerable: true });
        }
        return v;
    };
    try {
        const uuids = new Map(ws().sent.map(r => [r.request.url, r.uuid]));
        for (let i = 0; i < N; i++)
            ws().reply({ uuid: uuids.get(`r/${i}`), status: 201,
                response: { status: 200, body: i } });
    }
    finally {
        JSON.parse = parse;
    }
    assert.ok(got.every(n => n == 1));
    assert.ok(reads <= 2 * N, `${reads} uuid reads for ${N} messages`);

    subs.forEach(s => s.unsubscribe());
    /* With no request open, nothing listens to the socket. */
    assert.equal(ws().listeners, 0);
});

test("requests are sent again, with new UUIDs, after a reconnect", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const { notify, sockets } = harness();
    const a = [];
    const sa = notify.watch("a").subscribe(v => a.push(v));
    await tick();
    const first = sockets[0];
    const u1 = uuid_of(first, r => r.request?.url == "a");
    first.reply({ uuid: u1, status: 201, response: { status: 200, body: 1 } });

    first.drop();
    t.mock.timers.tick(8000);
    await tick();
    await tick();
    assert.equal(sockets.length, 2);
    const second = sockets[1];
    const u2 = uuid_of(second, r => r.request?.url == "a");
    assert.ok(u2 && u2 != u1);

    /* A late message for the old UUID on the new socket is ignored. */
    second.reply({ uuid: u1, status: 200, response: { status: 200, body: 9 } });
    second.reply({ uuid: u2, status: 201, response: { status: 200, body: 2 } });
    assert.deepEqual(a, [1, 2]);
    sa.unsubscribe();
});

test("search_app_etags searches the etag endpoint of an app", () => {
    const calls = [];
    const fake = { search_changes: (...args) => { calls.push(args); return rx.EMPTY; } };
    ConfigDB.prototype.search_app_etags.call({ notify: fake }, "app-uuid");
    assert.deepEqual(calls, [["v2/app/app-uuid/etag/"]]);
});

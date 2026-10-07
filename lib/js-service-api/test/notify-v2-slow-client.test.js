/*
 * Factory+ Service HTTP API
 * notify/v2 wire tests with a client that stops reading.
 * Copyright 2026 University of Sheffield AMRC
 *
 * Each test runs a real Notify server and a real WebSocket client. The
 * client pauses its socket, so it stops reading, as a busy client does.
 * The server must then stop queueing updates for it without limit, and
 * the client must still end with the server's latest state once it
 * reads again.
 */

import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";

import * as rx from "rxjs";
import WebSocket from "ws";

import { Notify } from "../lib/notify-v2.js";

const tick = () => new Promise(r => setImmediate(r));
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until (cond, what, ms = 10000) {
    const end = Date.now() + ms;
    while (!cond()) {
        if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
        await sleep(5);
    }
}

const MAX_BUFFER = 1024 * 1024;
/* About 100 kB of JSON, so a burst is far bigger than the limit. */
const big = v => ({ v, pad: "x".repeat(100 * 1024) });

async function server (opts = {}) {
    const watches = new Map();
    const searches = new Map();
    const srv = http.createServer();
    const api = { http: srv, auth: { auth_bearer: async () => "tester" } };
    const notify = new Notify({ api, log: () => {}, ...opts });
    notify.watch("w/:name", (session, name) => watches.get(name));
    notify.search("s/:name/", (session, name) => searches.get(name));
    notify.run();
    await new Promise(r => srv.listen(0, "127.0.0.1", r));
    const port = srv.address().port;

    return {
        watches, searches,
        /* The server side of the one client connection. */
        get peer () { return [...notify.wss.clients][0]; },
        async client () {
            const ws = new WebSocket(`ws://127.0.0.1:${port}/notify/v2`);
            await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
            ws.send("Bearer good");
            await new Promise(r => ws.once("message", r));
            const got = new Map();
            ws.on("message", m => {
                const { uuid, ...rest } = JSON.parse(m);
                got.get(uuid).push(rest);
            });
            let n = 0;
            return {
                ws, got,
                sub (req) {
                    const uuid = `sub-${++n}`;
                    got.set(uuid, []);
                    ws.send(JSON.stringify({ ...req, uuid }));
                    return got.get(uuid);
                },
                close (msgs) {
                    const uuid = [...got].find(([, v]) => v === msgs)[0];
                    ws.send(JSON.stringify({ method: "CLOSE", uuid }));
                },
                pause () { ws._socket.pause(); },
                resume () { ws._socket.resume(); },
            };
        },
        close () {
            notify.wss.clients.forEach(c => c.terminate());
            notify.wss.close();
            srv.close();
        },
    };
}

/* A SEARCH source like the ConfigDB one, with the state in a Map. */
function search_source (initial = {}) {
    const store = new Map(Object.entries(initial));
    const updates = new rx.Subject();
    let allow = true;
    const self = {
        store,
        put (child, body) {
            store.set(child, body);
            updates.next({ status: 200, child, response: { status: 200, body } });
        },
        del (child) {
            store.delete(child);
            updates.next({ status: 200, child, response: { status: 404 } });
        },
        set allow (v) { allow = v; },
        handler: {
            updates,
            full: async () => ({
                children: Object.fromEntries([...store]
                    .map(([k, body]) => [k, { status: 200, body }])),
                response: { status: 204 },
            }),
            acl: rx.map(u => allow ? u
                : { status: u.status, response: { status: 403 } }),
        },
    };
    return self;
}

/* Apply a SEARCH stream the way rx-client does and return the map. */
function client_state (msgs) {
    let map = null;
    for (const u of msgs) {
        if (u.children) map = new Map(Object.entries(u.children));
        else if (u.child) {
            if (u.response.status < 300) map.set(u.child, u.response);
            else map.delete(u.child);
        }
        else map = null;
    }
    return map && Object.fromEntries([...map].map(([k, r]) => [k, r.body]));
}

/* Compare states regardless of key order. */
const same_state = (a, b) => {
    const sorted = o => o && JSON.stringify(Object.entries(o).sort(([x], [y]) => x < y ? -1 : 1));
    return sorted(a) == sorted(b);
};

function assert_no_repeats (msgs) {
    for (let i = 1; i < msgs.length; i++)
        assert.notDeepEqual(msgs[i], msgs[i - 1], `repeat at ${i}`);
}

test("A paused WATCH client: the send buffer stays bounded and the client ends with the latest state", async t => {
    const s = await server({ max_buffer: MAX_BUFFER });
    t.after(() => s.close());
    const seq = new rx.Subject();
    s.watches.set("obj", rx.concat(
        rx.of({ status: 201, response: { status: 200, body: big(0) } }), seq));
    const c = await s.client();

    const msgs = c.sub({ method: "WATCH", request: { url: "w/obj" } });
    await until(() => msgs.length == 1, "initial");
    c.pause();

    /* 400 updates of 100 kB: 40 MB if every one is queued. */
    let peak = 0;
    for (let i = 1; i <= 400; i++) {
        seq.next({ status: 200, response: { status: 200, body: big(i) } });
        peak = Math.max(peak, s.peer.bufferedAmount);
        if (i % 20 == 0) await sleep(1);
    }
    await sleep(50);
    peak = Math.max(peak, s.peer.bufferedAmount);

    /* The limit plus one message that may take it over. On main the
     * whole burst, less what the kernel takes, waits here. */
    assert.ok(peak < MAX_BUFFER + 200 * 1024,
        `peak send buffer ${(peak / 1048576).toFixed(1)} MB`);

    c.resume();
    await until(() => msgs.at(-1)?.response.body.v == 400, "latest state");
    await sleep(50);

    assert.equal(msgs[0].status, 201);
    assert.ok(msgs.slice(1).every(m => m.status == 200));
    const vs = msgs.map(m => m.response.body.v);
    assert.deepEqual(vs, [...vs].sort((a, b) => a - b), "updates in order");
    assert.ok(msgs.length < 401, `skipped held states (${msgs.length} sent)`);
    assert_no_repeats(msgs);
});

test("A paused SEARCH client: child updates are combined, none lost, state matches", async t => {
    const s = await server({ max_buffer: MAX_BUFFER });
    t.after(() => s.close());
    const src = search_source({ a: big(0) });
    s.searches.set("app", src.handler);
    const c = await s.client();

    const msgs = c.sub({ method: "SEARCH", parent: "s/app/" });
    await until(() => msgs.length == 1, "full");
    c.pause();

    let peak = 0;
    /* 30 children, each changed 10 times, some deleted and added back. */
    for (let round = 1; round <= 10; round++) {
        for (let k = 0; k < 30; k++) {
            if ((k + round) % 7 == 0) src.del(`c${k}`);
            else src.put(`c${k}`, big(round));
            peak = Math.max(peak, s.peer.bufferedAmount);
        }
        await sleep(1);
    }
    src.del("a");
    await sleep(50);
    peak = Math.max(peak, s.peer.bufferedAmount);
    assert.ok(peak < MAX_BUFFER + 200 * 1024,
        `peak send buffer ${(peak / 1048576).toFixed(1)} MB`);

    c.resume();
    const want = Object.fromEntries(src.store);
    await until(() => same_state(client_state(msgs), want),
        "client state to match");
    await sleep(50);

    assert.deepEqual(client_state(msgs), want);
    assert.equal(msgs[0].status, 201);
    /* Each child's versions arrive in order. */
    const seen = new Map();
    for (const m of msgs.slice(1)) {
        assert.ok(m.child, "only child updates after the snapshot");
        const v = m.response.body?.v ?? Infinity;
        const prev = seen.get(m.child) ?? -1;
        if (v != Infinity) assert.ok(v > prev || prev == Infinity,
            `${m.child} went from ${prev} to ${v}`);
        seen.set(m.child, v);
    }
    assert.ok(msgs.length < 302, `combined held updates (${msgs.length} sent)`);
    assert_no_repeats(msgs);
});

test("A paused SEARCH client: a 403 and a new snapshot while held give the right state", async t => {
    const s = await server({ max_buffer: MAX_BUFFER });
    t.after(() => s.close());
    const src = search_source({ a: big(0) });
    s.searches.set("app", src.handler);
    const c = await s.client();

    const msgs = c.sub({ method: "SEARCH", parent: "s/app/" });
    await until(() => msgs.length == 1, "full");
    c.pause();
    for (let i = 1; i <= 40; i++) src.put(`c${i}`, big(i));
    src.allow = false;
    src.put("c1", big(99));             /* 403 */
    src.allow = true;
    src.put("c2", big(99));             /* new snapshot */
    src.put("c3", big(100));
    await sleep(50);

    c.resume();
    const want = Object.fromEntries(src.store);
    await until(() => same_state(client_state(msgs), want),
        "client state to match");
    await sleep(50);
    assert.deepEqual(client_state(msgs), want);
    assert_no_repeats(msgs);
});

test("A paused client: the first update keeps 201 and CLOSE still ends with 410", async t => {
    const s = await server({ max_buffer: MAX_BUFFER });
    t.after(() => s.close());
    const fill = new rx.Subject();
    const obj = new rx.Subject();
    s.watches.set("fill", rx.concat(rx.of({ status: 201, response: { status: 200, body: 0 } }), fill));
    s.watches.set("obj", rx.concat(rx.of({ status: 201, response: { status: 200, body: big(1) } }), obj));
    const c = await s.client();

    const f = c.sub({ method: "WATCH", request: { url: "w/fill" } });
    await until(() => f.length == 1, "fill initial");
    c.pause();
    for (let i = 1; i <= 100; i++)
        fill.next({ status: 200, response: { status: 200, body: big(i) } });
    await sleep(20);

    const msgs = c.sub({ method: "WATCH", request: { url: "w/obj" } });
    await sleep(50);
    obj.next({ status: 200, response: { status: 200, body: big(2) } });
    obj.next({ status: 200, response: { status: 200, body: big(3) } });
    c.close(msgs);
    await sleep(50);

    c.resume();
    await until(() => msgs.at(-1)?.status == 410, "410");
    await sleep(50);
    assert.deepEqual(msgs.map(m => [m.status, m.response?.body.v]),
        [[201, 3], [410, undefined]]);
    assert.equal(f.at(-1).response.body.v, 100);
});

test("A client that keeps up gets every update, exactly as sent", async t => {
    const s = await server();
    t.after(() => s.close());
    const seq = new rx.Subject();
    s.watches.set("obj", rx.concat(rx.of({ status: 201, response: { status: 200, body: 0 } }), seq));
    const src = search_source({ a: 0 });
    s.searches.set("app", src.handler);
    const c = await s.client();

    const watch = c.sub({ method: "WATCH", request: { url: "w/obj" } });
    const search = c.sub({ method: "SEARCH", parent: "s/app/" });
    await until(() => watch.length == 1 && search.length == 1, "initial");
    for (let i = 1; i <= 500; i++) {
        seq.next({ status: 200, response: { status: 200, body: i } });
        src.put(`c${i % 10}`, i);
        if (i % 50 == 0) await tick();
    }
    await until(() => watch.length == 501 && search.length == 501, "all updates");
    await sleep(50);

    assert.deepEqual(watch.map(m => m.response.body), [...Array(501).keys()]);
    assert.deepEqual(search.slice(1).map(m => [m.child, m.response.body]),
        [...Array(500).keys()].map(i => [`c${(i + 1) % 10}`, i + 1]));
});

test("Closing the socket while updates are held frees them", async t => {
    const s = await server({ max_buffer: MAX_BUFFER });
    t.after(() => s.close());
    const seq = new rx.Subject();
    s.watches.set("obj", rx.concat(rx.of({ status: 201, response: { status: 200, body: 0 } }), seq));
    const c = await s.client();

    const msgs = c.sub({ method: "WATCH", request: { url: "w/obj" } });
    await until(() => msgs.length == 1, "initial");
    c.pause();
    for (let i = 1; i <= 100; i++)
        seq.next({ status: 200, response: { status: 200, body: big(i) } });
    await sleep(20);
    c.ws.terminate();
    await until(() => seq.observed === false, "server to unsubscribe");
});

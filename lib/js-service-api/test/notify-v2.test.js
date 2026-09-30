/*
 * Factory+ Service HTTP API
 * notify/v2 wire tests.
 * Copyright 2026 University of Sheffield AMRC
 *
 * Run with `node --test test/`.
 *
 * These run a real Notify server (WebSocketServer on a local HTTP
 * server) and talk to it with a real WebSocket client, so they check
 * the exact messages a client receives. The SEARCH and WATCH sources
 * are in-memory stand-ins shaped like the ConfigDB ones: an `updates`
 * Subject of child updates, a `full()` that snapshots the store when it
 * is called, and an async concatMap ACL check.
 */

import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";

import * as rx from "rxjs";
import WebSocket from "ws";

import { Notify } from "../lib/notify-v2.js";

const tick = () => new Promise(r => setImmediate(r));
async function until (cond, what, ms = 2000) {
    const end = Date.now() + ms;
    while (!cond()) {
        if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
        await tick();
    }
}
/* Let the server run until nothing more arrives for a short while. */
const quiet = () => new Promise(r => setTimeout(r, 50));

/* An in-memory SEARCH source. `manual` leaves full() calls pending
 * until the test resolves them. */
function search_source (initial = {}, opts = {}) {
    const store = new Map(Object.entries(initial));
    const updates = new rx.Subject();
    const fulls = [];
    const self = {
        store, updates, fulls,
        allow:      true,
        exists:     true,
        fail:       false,
        manual:     !!opts.manual,

        put (child, body) {
            store.set(child, body);
            updates.next({ status: 200, child, response: { status: 200, body } });
        },
        del (child) {
            store.delete(child);
            updates.next({ status: 200, child, response: { status: 404 } });
        },
        snapshot () {
            if (!self.exists)
                return { response: { status: 404 } };
            return {
                children: Object.fromEntries([...store]
                    .map(([k, body]) => [k, { status: 200, body }])),
                response: { status: 204 },
            };
        },
        /* Resolve the pending full() calls, oldest first. */
        release () {
            for (const f of fulls.splice(0)) f();
        },
        handler () {
            return {
                updates,
                full: () => new Promise((resolve, reject) => {
                    const snap = self.snapshot();
                    const done = () => self.fail
                        ? reject(new Error("full failed"))
                        : resolve(snap);
                    self.full_calls = (self.full_calls ?? 0) + 1;
                    if (self.manual) fulls.push(done);
                    else setImmediate(done);
                }),
                acl: rx.concatMap(async u => {
                    await tick();
                    return self.allow ? u
                        : { status: u.status, response: { status: 403 } };
                }),
            };
        },
    };
    return self;
}

async function server () {
    const sources = new Map();
    const watches = new Map();
    const srv = http.createServer();
    const api = {
        http: srv,
        auth: { auth_bearer: async ({ creds }) => creds == "good" ? "tester" : null },
    };
    const notify = new Notify({ api, log: () => {} });
    notify.search("s/:name/", (session, name) => sources.get(name).handler());
    notify.watch("w/:name", (session, name) => watches.get(name));
    notify.run();
    await new Promise(r => srv.listen(0, "127.0.0.1", r));
    const port = srv.address().port;

    return {
        sources, watches,
        async client () {
            const ws = new WebSocket(`ws://127.0.0.1:${port}/notify/v2`);
            await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
            ws.send("Bearer good");
            const st = await new Promise(r => ws.once("message", m => r(m.toString())));
            assert.equal(st, "200");
            const got = new Map();
            ws.on("message", m => {
                const u = JSON.parse(m);
                const { uuid, ...rest } = u;
                if (!got.has(uuid)) got.set(uuid, []);
                got.get(uuid).push(rest);
            });
            let n = 0;
            return {
                ws, got,
                sub (req) {
                    const uuid = `sub-${++n}`;
                    ws.send(JSON.stringify({ ...req, uuid }));
                    got.set(uuid, []);
                    return got.get(uuid);
                },
                close (msgs) {
                    const uuid = [...got].find(([, v]) => v === msgs)[0];
                    ws.send(JSON.stringify({ method: "CLOSE", uuid }));
                },
            };
        },
        close () {
            notify.wss.clients.forEach(c => c.terminate());
            notify.wss.close();
            srv.close();
        },
    };
}

const ok = body => ({ status: 200, body });
const child = (c, body) => ({ status: 200, child: c, response: ok(body) });

/* Apply a SEARCH stream the way rx-client does and return the map. */
function client_state (msgs) {
    let map = null;
    for (const u of msgs) {
        if (u.children) map = new Map(Object.entries(u.children));
        else if (u.child) {
            if (u.response.status < 300) map.set(u.child, u.response);
            else map.delete(u.child);
        }
        else if (!u.child) map = null;
    }
    return map && Object.fromEntries([...map].map(([k, r]) => [k, r.body]));
}

test("SEARCH sends a 201 full, then child add, change and delete in order", async t => {
    const s = await server();
    t.after(() => s.close());
    const src = search_source({ a: { v: 1 } });
    s.sources.set("app", src);
    const c = await s.client();

    const msgs = c.sub({ method: "SEARCH", parent: "s/app/" });
    await until(() => msgs.length == 1, "full");
    src.put("b", { v: 2 });
    src.put("a", { v: 3 });
    src.del("b");
    await until(() => msgs.length == 4, "updates");
    await quiet();

    assert.deepEqual(msgs, [
        { status: 201, children: { a: ok({ v: 1 }) }, response: { status: 204 } },
        child("b", { v: 2 }),
        child("a", { v: 3 }),
        { status: 200, child: "b", response: { status: 404 } },
    ]);
    assert.equal(src.full_calls, 1);
});

test("SEARCH with a filter sends matching children, 412 when a child stops matching", async t => {
    const s = await server();
    t.after(() => s.close());
    const src = search_source({ a: { kind: "x" }, b: { kind: "y" } });
    s.sources.set("app", src);
    const c = await s.client();

    const msgs = c.sub({ method: "SEARCH", parent: "s/app/", filter: { kind: "x" } });
    await until(() => msgs.length == 1, "full");
    src.put("c", { kind: "x" });        /* new match: sent */
    src.put("d", { kind: "y" });        /* never matched: not sent */
    src.put("b", { kind: "x" });        /* starts matching: sent */
    src.put("a", { kind: "y" });        /* stops matching: 412 */
    src.del("c");                       /* deleted match: 412 */
    await until(() => msgs.length == 5, "updates");
    await quiet();

    assert.deepEqual(msgs, [
        { status: 201, children: { a: ok({ kind: "x" }) }, response: { status: 204 } },
        child("c", { kind: "x" }),
        child("b", { kind: "x" }),
        { status: 200, child: "a", response: { status: 412 } },
        { status: 200, child: "c", response: { status: 412 } },
    ]);
});

test("SEARCH: after a burst during a pending full, the client state matches the source", async t => {
    const s = await server();
    t.after(() => s.close());
    const src = search_source({ a: { v: 0 } }, { manual: true });
    s.sources.set("app", src);
    const c = await s.client();

    const msgs = c.sub({ method: "SEARCH", parent: "s/app/" });
    await until(() => src.fulls.length == 1, "first full() call");
    for (let i = 1; i <= 5; i++) src.put(`x${i}`, { v: i });
    await quiet();
    src.release();
    await quiet();
    src.release();
    await quiet();

    assert.deepEqual(client_state(msgs), Object.fromEntries(src.store));
});

test("SEARCH: a burst during a pending full makes one full() call, then the updates in order", async t => {
    const s = await server();
    t.after(() => s.close());
    const src = search_source({ a: { v: 0 } }, { manual: true });
    s.sources.set("app", src);
    const c = await s.client();

    const msgs = c.sub({ method: "SEARCH", parent: "s/app/" });
    await until(() => src.fulls.length == 1, "first full() call");
    for (let i = 1; i <= 5; i++) src.put(`x${i}`, { v: i });
    await quiet();

    /* main calls full() once per update here: 6 calls. */
    assert.equal(src.full_calls, 1, "full() calls while the first is pending");

    src.release();
    await until(() => msgs.length == 6, "full and updates");
    await quiet();
    assert.deepEqual(msgs, [
        { status: 201, children: { a: ok({ v: 0 }) }, response: { status: 204 } },
        ...[1, 2, 3, 4, 5].map(i => child(`x${i}`, { v: i })),
    ]);
});

test("SEARCH: an update after the first full is not overwritten by a stale full", async t => {
    const s = await server();
    t.after(() => s.close());
    const src = search_source({ a: { v: 0 } }, { manual: true });
    s.sources.set("app", src);
    const c = await s.client();

    const msgs = c.sub({ method: "SEARCH", parent: "s/app/" });
    await until(() => src.fulls.length == 1, "first full() call");
    src.put("x", { v: 1 });
    await quiet();
    /* Resolve only the first full, then send another update. */
    src.fulls.shift()();
    await quiet();
    src.put("y", { v: 2 });
    await quiet();
    src.release();
    await quiet();

    /* On main the second full (snapshot taken before y was written)
     * arrives after y and removes it from the client's state. */
    assert.deepEqual(client_state(msgs), Object.fromEntries(src.store));
});

test("SEARCH: ACL change to 403 and back", async t => {
    const s = await server();
    t.after(() => s.close());
    const src = search_source({ a: { v: 0 } });
    s.sources.set("app", src);
    const c = await s.client();

    const msgs = c.sub({ method: "SEARCH", parent: "s/app/" });
    await until(() => msgs.length == 1, "full");
    src.allow = false;
    src.put("b", { v: 1 });
    src.put("c", { v: 2 });                     /* repeated 403: dropped */
    await until(() => msgs.length == 2, "403");
    await quiet();
    src.allow = true;
    src.put("d", { v: 3 });                     /* access back: new full */
    await until(() => msgs.length == 3, "new full");
    src.put("e", { v: 4 });
    await until(() => msgs.length == 4, "update");
    await quiet();

    assert.deepEqual(msgs, [
        { status: 201, children: { a: ok({ v: 0 }) }, response: { status: 204 } },
        { status: 200, response: { status: 403 } },
        { status: 200, response: { status: 204 }, children: {
            a: ok({ v: 0 }), b: ok({ v: 1 }), c: ok({ v: 2 }), d: ok({ v: 3 }),
        } },
        child("e", { v: 4 }),
    ]);
    assert.equal(src.full_calls, 2);
});

test("SEARCH: no access at the start", async t => {
    const s = await server();
    t.after(() => s.close());
    const src = search_source({ a: { v: 0 } });
    src.allow = false;
    s.sources.set("app", src);
    const c = await s.client();

    const msgs = c.sub({ method: "SEARCH", parent: "s/app/" });
    await until(() => msgs.length == 1, "403");
    src.put("b", { v: 1 });
    src.put("c", { v: 2 });
    await until(() => msgs.length == 2, "second 403");
    await quiet();
    src.allow = true;
    src.put("d", { v: 3 });
    await until(() => msgs.length == 3, "full");
    await quiet();

    assert.deepEqual(msgs, [
        { status: 201, response: { status: 403 } },
        { status: 200, response: { status: 403 } },
        { status: 200, response: { status: 204 }, children: {
            a: ok({ v: 0 }), b: ok({ v: 1 }), c: ok({ v: 2 }), d: ok({ v: 3 }),
        } },
    ]);
});

test("SEARCH: a missing parent gives 404 until it exists", async t => {
    const s = await server();
    t.after(() => s.close());
    const src = search_source({});
    src.exists = false;
    s.sources.set("app", src);
    const c = await s.client();

    const msgs = c.sub({ method: "SEARCH", parent: "s/app/" });
    await until(() => msgs.length == 1, "404");
    src.put("a", { v: 1 });
    await until(() => msgs.length == 2, "second 404");
    src.put("a", { v: 2 });                     /* repeated 404: dropped */
    await quiet();
    src.exists = true;
    src.put("b", { v: 3 });
    await until(() => msgs.length == 3, "full");
    await quiet();

    assert.deepEqual(msgs, [
        { status: 201, response: { status: 404 } },
        { status: 200, response: { status: 404 } },
        { status: 200, response: { status: 204 }, children: {
            a: ok({ v: 2 }), b: ok({ v: 3 }),
        } },
    ]);
    assert.equal(src.full_calls, 4);
});

test("SEARCH: two subscriptions keep separate state", async t => {
    const s = await server();
    t.after(() => s.close());
    const src = search_source({ a: { v: 0 } });
    s.sources.set("app", src);
    const c = await s.client();

    const one = c.sub({ method: "SEARCH", parent: "s/app/" });
    await until(() => one.length == 1, "first full");
    src.put("b", { v: 1 });
    const two = c.sub({ method: "SEARCH", parent: "s/app/" });
    await until(() => two.length == 1, "second full");
    src.put("c", { v: 2 });
    await until(() => one.length == 3 && two.length == 2, "updates");
    await quiet();

    assert.deepEqual(one, [
        { status: 201, children: { a: ok({ v: 0 }) }, response: { status: 204 } },
        child("b", { v: 1 }),
        child("c", { v: 2 }),
    ]);
    assert.deepEqual(two, [
        { status: 201, children: { a: ok({ v: 0 }), b: ok({ v: 1 }) },
            response: { status: 204 } },
        child("c", { v: 2 }),
    ]);
});

test("WATCH sends each change and drops exact repeats", async t => {
    const s = await server();
    t.after(() => s.close());
    const seq = new rx.Subject();
    s.watches.set("obj", rx.concat(
        rx.of({ status: 201, response: ok({ a: 1, b: [1, 2] }) }), seq));
    const c = await s.client();

    const msgs = c.sub({ method: "WATCH", request: { url: "w/obj" } });
    await until(() => msgs.length == 1, "initial");
    seq.next({ status: 200, response: ok({ a: 2, b: [1, 2] }) });
    seq.next({ status: 200, response: ok({ a: 2, b: [1, 2] }) });      /* repeat */
    seq.next({ status: 200, response: ok({ b: [1, 2], a: 2 }) });      /* same, other key order */
    seq.next({ status: 200, response: ok({ a: 2, b: [2, 1] }) });      /* array order matters */
    seq.next({ status: 200, response: { status: 403 } });
    seq.next({ status: 200, response: { status: 403 } });              /* repeat 403 */
    seq.next({ status: 200, response: { status: 404 } });
    seq.next({ status: 200, response: ok({ a: null }) });
    seq.next({ status: 200, response: ok({}) });                       /* null is not missing */
    await until(() => msgs.length == 7, "updates");
    await quiet();

    assert.deepEqual(msgs, [
        { status: 201, response: ok({ a: 1, b: [1, 2] }) },
        { status: 200, response: ok({ a: 2, b: [1, 2] }) },
        { status: 200, response: ok({ a: 2, b: [2, 1] }) },
        { status: 200, response: { status: 403 } },
        { status: 200, response: { status: 404 } },
        { status: 200, response: ok({ a: null }) },
        { status: 200, response: ok({}) },
    ]);
});

test("WATCH sends a change of JSON type", async t => {
    const s = await server();
    t.after(() => s.close());
    const seq = new rx.Subject();
    s.watches.set("obj", rx.concat(rx.of({ status: 201, response: ok({ v: 1 }) }), seq));
    const c = await s.client();

    const msgs = c.sub({ method: "WATCH", request: { url: "w/obj" } });
    await until(() => msgs.length == 1, "initial");
    /* main's loose deep-equal treats 1 and "1" as equal and drops this. */
    seq.next({ status: 200, response: ok({ v: "1" }) });
    seq.next({ status: 200, response: ok({ v: true }) });
    await until(() => msgs.length == 3, "type changes", 500);

    assert.deepEqual(msgs.slice(1), [
        { status: 200, response: ok({ v: "1" }) },
        { status: 200, response: ok({ v: true }) },
    ]);
});

test("WATCH with HEAD strips bodies", async t => {
    const s = await server();
    t.after(() => s.close());
    s.watches.set("obj", rx.of(
        { status: 201, response: { ...ok({ a: 1 }), headers: { etag: "e" } } }));
    const c = await s.client();

    const msgs = c.sub({ method: "WATCH", request: { url: "w/obj", method: "HEAD" } });
    await until(() => msgs.length == 1, "initial");
    assert.deepEqual(msgs, [
        { status: 201, response: { status: 200, headers: { etag: "e" } } },
    ]);
});

test("CLOSE ends a subscription with 410", async t => {
    const s = await server();
    t.after(() => s.close());
    const seq = new rx.Subject();
    s.watches.set("obj", rx.concat(rx.of({ status: 201, response: ok(1) }), seq));
    const c = await s.client();

    const msgs = c.sub({ method: "WATCH", request: { url: "w/obj" } });
    await until(() => msgs.length == 1, "initial");
    c.close(msgs);
    await until(() => msgs.length == 2, "410");
    seq.next({ status: 200, response: ok(2) });
    await quiet();
    assert.deepEqual(msgs, [{ status: 201, response: ok(1) }, { status: 410 }]);
});

test("Bad requests: 404 for no handler, 400 for an invalid request", async t => {
    const s = await server();
    t.after(() => s.close());
    const c = await s.client();

    const nf = c.sub({ method: "WATCH", request: { url: "nothing/here" } });
    const bad = c.sub({ method: "SEARCH", parent: "s/app" });
    const bad2 = c.sub({ method: "WATCH" });
    await until(() => nf.length && bad.length && bad2.length, "errors");
    assert.deepEqual(nf, [{ status: 404 }]);
    assert.deepEqual(bad, [{ status: 400 }]);
    assert.deepEqual(bad2, [{ status: 400 }]);
});

test("A failing source gives 500 and ends the subscription", async t => {
    const s = await server();
    t.after(() => s.close());
    s.watches.set("obj", rx.concat(
        rx.of({ status: 201, response: ok(1) }),
        rx.throwError(() => new Error("boom"))));
    const c = await s.client();

    const msgs = c.sub({ method: "WATCH", request: { url: "w/obj" } });
    await until(() => msgs.length == 2, "500");
    assert.deepEqual(msgs, [{ status: 201, response: ok(1) }, { status: 500 }]);
});

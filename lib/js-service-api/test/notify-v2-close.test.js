/*
 * Factory+ Service HTTP API
 * notify/v2: CLOSE requests.
 * Copyright 2026 University of Sheffield AMRC
 *
 * Run with `node --test test/`.
 *
 * These run a real Notify server and a real WebSocket client, and check
 * the whole sequence of messages the client receives, in order.
 */

import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";

import * as rx from "rxjs";
import WebSocket from "ws";

import { Notify } from "../lib/notify-v2.js";

const tick = () => new Promise(r => setImmediate(r));
async function until (cond, what, ms = 5000) {
    const end = Date.now() + ms;
    while (!cond()) {
        if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
        await tick();
    }
}

const ok = body => ({ status: 200, body });

/* Sources a test can drive. `w/src/NAME` sends a 201 with the current
 * value and then every update. `w/idle` sends one 201 and then
 * nothing. `w/ping` sends one 201 and ends. */
class Sources {
    constructor () { this.map = new Map(); }

    get (name) {
        if (!this.map.has(name))
            this.map.set(name, { value: 0, seq: new rx.Subject() });
        return this.map.get(name);
    }

    watch (name) {
        const s = this.get(name);
        return rx.concat(
            rx.of({ status: 201, response: ok(s.value) }),
            s.seq);
    }

    update (name) {
        const s = this.get(name);
        s.seq.next({ status: 200, response: ok(++s.value) });
        return s.value;
    }

    fail (name) {
        const s = this.get(name);
        const old = s.seq;
        s.seq = new rx.Subject();
        old.error(new Error("source failed"));
    }
}

async function server () {
    const src = new Sources();
    const srv = http.createServer();
    const api = {
        http: srv,
        auth: { auth_bearer: async ({ creds }) => creds == "good" ? "tester" : null },
    };
    const notify = new Notify({ api, log: () => {} });
    notify.watch("w/src/:name", (session, name) => src.watch(name));
    notify.watch("w/idle", () => rx.concat(rx.of({ status: 201 }), rx.NEVER));
    notify.watch("w/ping", () => rx.of({ status: 201 }));
    notify.run();
    await new Promise(r => srv.listen(0, "127.0.0.1", r));
    const port = srv.address().port;

    return {
        src,
        async client () {
            const ws = new WebSocket(`ws://127.0.0.1:${port}/notify/v2`);
            await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
            ws.send("Bearer good");
            const st = await new Promise(r => ws.once("message", m => r(m.toString())));
            assert.equal(st, "200");

            /* Every message, in the order received. */
            const log = [];
            ws.on("message", m => log.push(JSON.parse(m)));
            let pings = 0;
            return {
                ws, log,
                send (req) { ws.send(JSON.stringify(req)); },
                watch (uuid, url) {
                    this.send({ method: "WATCH", uuid, request: { url } });
                },
                close (uuid) { this.send({ method: "CLOSE", uuid }); },
                /* Wait until the server has handled every request sent
                 * so far. Requests are handled in order, so the ping's
                 * reply comes after the replies to all of them. The
                 * ping's reply is removed from the log. */
                async barrier () {
                    const uuid = `ping-${++pings}`;
                    this.watch(uuid, "w/ping");
                    await until(() => log.some(m => m.uuid === uuid), uuid);
                    log.splice(log.findIndex(m => m.uuid === uuid), 1);
                },
                take () { return log.splice(0); },
            };
        },
        close () {
            notify.wss.clients.forEach(c => c.terminate());
            notify.wss.close();
            srv.close();
        },
    };
}

test("CLOSE for one of many subs ends only that sub", async t => {
    const s = await server();
    t.after(() => s.close());
    const c = await s.client();

    for (const u of ["a", "b", "c"]) c.watch(u, "w/src/x");
    await c.barrier();
    c.close("b");
    await c.barrier();
    const v = s.src.update("x");
    await c.barrier();

    assert.deepEqual(c.take(), [
        { uuid: "a", status: 201, response: ok(0) },
        { uuid: "b", status: 201, response: ok(0) },
        { uuid: "c", status: 201, response: ok(0) },
        { uuid: "b", status: 410 },
        { uuid: "a", status: 200, response: ok(v) },
        { uuid: "c", status: 200, response: ok(v) },
    ]);
});

test("CLOSE for an unknown or ended sub sends nothing", async t => {
    const s = await server();
    t.after(() => s.close());
    const c = await s.client();

    c.watch("a", "w/src/x");
    c.watch("gone", "w/nothing");       /* 404, then ended */
    c.close("never-opened");
    c.close("gone");
    await c.barrier();
    c.close("a");
    c.close("a");                       /* already closed */
    await c.barrier();
    s.src.update("x");
    await c.barrier();

    assert.deepEqual(c.take(), [
        { uuid: "a", status: 201, response: ok(0) },
        { uuid: "gone", status: 404 },
        { uuid: "a", status: 410 },
    ]);
});

test("CLOSE before the open, or straight after it, as on main", async t => {
    const s = await server();
    t.after(() => s.close());
    const c = await s.client();

    /* A CLOSE that arrives before its open does nothing. */
    c.close("early");
    c.watch("early", "w/src/x");
    /* An open and its CLOSE back to back: 201 then 410. */
    c.watch("quick", "w/src/x");
    c.close("quick");
    await c.barrier();
    const v = s.src.update("x");
    await c.barrier();

    assert.deepEqual(c.take(), [
        { uuid: "early", status: 201, response: ok(0) },
        { uuid: "quick", status: 201, response: ok(0) },
        { uuid: "quick", status: 410 },
        { uuid: "early", status: 200, response: ok(v) },
    ]);
});

test("A UUID can be opened again after a CLOSE", async t => {
    const s = await server();
    t.after(() => s.close());
    const c = await s.client();

    c.watch("a", "w/src/x");
    c.close("a");
    c.watch("a", "w/src/x");
    await c.barrier();
    const v = s.src.update("x");
    await c.barrier();
    c.close("a");
    await c.barrier();
    s.src.update("x");
    await c.barrier();

    assert.deepEqual(c.take(), [
        { uuid: "a", status: 201, response: ok(0) },
        { uuid: "a", status: 410 },
        { uuid: "a", status: 201, response: ok(0) },
        { uuid: "a", status: 200, response: ok(v) },
        { uuid: "a", status: 410 },
    ]);
});

test("CLOSE ends every open sub with that UUID, in the order they opened", async t => {
    const s = await server();
    t.after(() => s.close());
    const c = await s.client();

    c.watch("d", "w/src/x");
    c.watch("e", "w/src/x");
    c.watch("d", "w/src/y");
    await c.barrier();
    c.close("d");
    await c.barrier();

    assert.deepEqual(c.take(), [
        { uuid: "d", status: 201, response: ok(0) },
        { uuid: "e", status: 201, response: ok(0) },
        { uuid: "d", status: 201, response: ok(0) },
        { uuid: "d", status: 410 },
        { uuid: "d", status: 410 },
    ]);
});

test("Non-string UUIDs keep the loose compare", async t => {
    const s = await server();
    t.after(() => s.close());
    const c = await s.client();

    /* The protocol uses string UUIDs. Main compared with `==`, so keep
     * that for anything else. */
    c.send({ method: "WATCH", uuid: 5, request: { url: "w/src/x" } });
    c.watch("5", "w/src/x");
    c.send({ method: "WATCH", uuid: 6, request: { url: "w/src/x" } });
    c.watch("7", "w/src/x");
    await c.barrier();
    c.close("5");                       /* ends 5 and "5" */
    c.send({ method: "CLOSE", uuid: 7 });   /* ends "7" */
    c.send({ method: "CLOSE", uuid: [6] }); /* [6] == 6 */
    await c.barrier();

    assert.deepEqual(c.take(), [
        { uuid: 5, status: 201, response: ok(0) },
        { uuid: "5", status: 201, response: ok(0) },
        { uuid: 6, status: 201, response: ok(0) },
        { uuid: "7", status: 201, response: ok(0) },
        { uuid: 5, status: 410 },
        { uuid: "5", status: 410 },
        { uuid: "7", status: 410 },
        { uuid: 6, status: 410 },
    ]);
});

test("A bad request closes the session, and the server keeps serving", async t => {
    const s = await server();
    t.after(() => s.close());
    const c = await s.client();

    c.watch("a", "w/src/x");
    await c.barrier();
    const closed = new Promise(r => c.ws.once("close", r));
    c.ws.send("not json");
    await closed;
    await until(() => !s.src.get("x").seq.observed, "subs torn down");

    /* An error the session doesn't handle would crash the process
     * before this. */
    const d = await s.client();
    d.watch("b", "w/src/x");
    await d.barrier();
    assert.deepEqual(c.take(), [{ uuid: "a", status: 201, response: ok(0) }]);
    assert.deepEqual(d.take(), [{ uuid: "b", status: 201, response: ok(0) }]);
});

test("Closing the socket ends every sub", async t => {
    const s = await server();
    t.after(() => s.close());
    const c = await s.client();

    for (const u of ["a", "b", "a"]) c.watch(u, "w/src/x");
    await c.barrier();
    assert.ok(s.src.get("x").seq.observed);
    c.ws.close();
    await until(() => !s.src.get("x").seq.observed, "subs torn down");
});

/* A small LCG so a failure can be replayed from its seed. */
function rng (seed) {
    let s = seed >>> 0;
    return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

test("Random opens, closes, updates and errors match a model", async t => {
    const s = await server();
    t.after(() => s.close());

    for (let seed = 1; seed <= 20; seed++) {
        const c = await s.client();
        const rnd = rng(seed);
        const pick = a => a[Math.floor(rnd() * a.length)];
        const names = ["p", "q", "r"].map(n => `${n}${seed}`);
        const uuids = ["u1", "u2", "u3", "u4", "u5", "u6"];

        /* The model: open subs in the order they opened. */
        let subs = [];
        const want = [];
        const end = (match, status) => {
            for (const sub of subs.filter(match))
                want.push({ uuid: sub.uuid, status });
            subs = subs.filter(sub => !match(sub));
        };

        for (let step = 0; step < 40; step++) {
            /* A batch of requests sent back to back. */
            const n = 1 + Math.floor(rnd() * 6);
            for (let i = 0; i < n; i++) {
                const uuid = pick(uuids);
                const r = rnd();
                if (r < 0.5) {
                    const name = pick(names);
                    c.watch(uuid, `w/src/${name}`);
                    want.push({ uuid, status: 201,
                        response: ok(s.src.get(name).value) });
                    subs.push({ uuid, name });
                }
                else if (r < 0.55) {
                    c.watch(uuid, "w/nothing");
                    want.push({ uuid, status: 404 });
                }
                else {
                    c.close(uuid);
                    end(sub => sub.uuid == uuid, 410);
                }
            }
            await c.barrier();

            /* Then the sources change. */
            const name = pick(names);
            if (rnd() < 0.85) {
                const v = s.src.update(name);
                for (const sub of subs.filter(sub => sub.name == name))
                    want.push({ uuid: sub.uuid, status: 200, response: ok(v) });
            }
            else {
                s.src.fail(name);
                end(sub => sub.name == name, 500);
            }
            await c.barrier();
        }

        assert.deepEqual(c.take(), want, `seed ${seed}`);
        c.ws.close();
    }
});

/* Open `n` subs that send one message each and then stay open. */
async function open_idle (c, n) {
    for (let i = 0; i < n; i += 1000) {
        for (let j = i; j < Math.min(n, i + 1000); j++)
            c.watch(`idle-${j}`, "w/idle");
        await c.barrier();
        c.take();
    }
}

/* The best time of 3 for 200 new WATCH requests to be answered. */
async function time_requests (c) {
    let best = Infinity;
    for (let run = 0; run < 3; run++) {
        const t0 = performance.now();
        for (let i = 0; i < 200; i++)
            c.watch(`timed-${run}-${i}`, "w/idle");
        await until(() => c.log.length >= 200, "timed replies", 60000);
        best = Math.min(best, performance.now() - t0);
        c.take();
    }
    return best;
}

test("A request costs the same with 1,000 or 20,000 open subs", { timeout: 120000 }, async t => {
    const s = await server();
    t.after(() => s.close());

    const small = await s.client();
    await open_idle(small, 1000);
    const big = await s.client();
    await open_idle(big, 20000);

    /* Warm up, then measure. */
    await time_requests(small);
    const t_small = await time_requests(small);
    const t_big = await time_requests(big);
    t.diagnostic(`200 requests: ${t_small.toFixed(1)} ms with 1,000 subs, `
        + `${t_big.toFixed(1)} ms with 20,000 subs`);

    /* On main each request is filtered once per open sub, so 20,000
     * subs take about 20 times as long. */
    assert.ok(t_big < 3 * t_small + 50,
        `${t_big.toFixed(1)} ms with 20,000 subs against ${t_small.toFixed(1)} ms with 1,000`);
});

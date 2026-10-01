/*
 * Factory+ Service HTTP API
 * notify/v2 Outbox unit tests.
 * Copyright 2026 University of Sheffield AMRC
 *
 * These use a fake WebSocket whose send buffer fills as messages are
 * sent and empties when the test calls drain().
 */

import test from "node:test";
import assert from "node:assert/strict";

import { Outbox } from "../lib/notify-outbox.js";

function fake_ws () {
    const ws = {
        OPEN: 1, readyState: 1,
        bufferedAmount: 0,
        sent: [], cbs: [],
        send (data, cb) {
            ws.sent.push(JSON.parse(data));
            ws.bufferedAmount += data.length;
            ws.cbs.push(cb);
        },
        /* The client reads everything. Callbacks run asynchronously,
         * as they do for a real socket. */
        async drain () {
            while (ws.cbs.length) {
                ws.bufferedAmount = 0;
                for (const cb of ws.cbs.splice(0)) cb();
                await new Promise(r => setImmediate(r));
            }
        },
    };
    return ws;
}

/* One message fills the buffer. */
function outbox () {
    const ws = fake_ws();
    const ob = new Outbox({ ws, max_buffer: 1 });
    return [ws, ob];
}

const w = (uuid, v, status = 200) => ({ uuid, status, response: { status: 200, body: v } });
const kid = (uuid, child, v) => ({ uuid, status: 200, child, response: { status: 200, body: v } });
const snap = (uuid, kids, status = 200) => ({
    uuid, status, response: { status: 204 },
    children: Object.fromEntries(Object.entries(kids)
        .map(([k, v]) => [k, { status: 200, body: v }])),
});

test("Outbox sends straight through while the buffer has room", () => {
    const ws = fake_ws();
    const ob = new Outbox({ ws, max_buffer: 1e9 });
    const msgs = [w("a", 1, 201), w("a", 2), w("a", 1), kid("b", "x", 1)];
    msgs.forEach(m => ob.push(m));
    assert.deepEqual(ws.sent, msgs);
    assert.equal(ob.size, 0);
});

test("Outbox keeps only the latest held WATCH update", async () => {
    const [ws, ob] = outbox();
    ob.push(w("a", 0, 201));
    for (let i = 1; i <= 100; i++) ob.push(w("a", i));
    assert.equal(ws.sent.length, 1);
    assert.equal(ob.size, 1);
    await ws.drain();
    assert.deepEqual(ws.sent, [w("a", 0, 201), w("a", 100)]);
});

test("Outbox sends a replaced first update with status 201", async () => {
    const [ws, ob] = outbox();
    ob.push(w("fill", 0, 201));
    ob.push(w("a", 1, 201));
    ob.push(w("a", 2));
    await ws.drain();
    assert.deepEqual(ws.sent, [w("fill", 0, 201), w("a", 2, 201)]);
});

test("Outbox keeps the latest held update per SEARCH child, in order", async () => {
    const [ws, ob] = outbox();
    ob.push(snap("s", { x: 0 }, 201));
    ob.push(kid("s", "x", 1));
    ob.push(kid("s", "y", 1));
    ob.push(kid("s", "x", 2));
    ob.push({ uuid: "s", status: 200, child: "y", response: { status: 404 } });
    ob.push(kid("s", "z", 1));
    assert.equal(ob.size, 3);
    await ws.drain();
    /* A child moves to the end of the held updates when it changes. */
    assert.deepEqual(ws.sent, [
        snap("s", { x: 0 }, 201),
        kid("s", "x", 2),
        { uuid: "s", status: 200, child: "y", response: { status: 404 } },
        kid("s", "z", 1),
    ]);
});

test("Outbox: a held SEARCH snapshot or 403 replaces held child updates", async () => {
    const [ws, ob] = outbox();
    ob.push(snap("s", { x: 0 }, 201));
    ob.push(kid("s", "x", 1));
    ob.push(kid("s", "y", 1));
    ob.push({ uuid: "s", status: 200, response: { status: 403 } });
    ob.push(kid("s", "q", 1));          /* not possible after a 403, but kept */
    assert.equal(ob.size, 2);
    ob.push(snap("s", { x: 3, y: 3 }));
    ob.push(kid("s", "y", 4));
    await ws.drain();
    assert.deepEqual(ws.sent, [
        snap("s", { x: 0 }, 201),
        snap("s", { x: 3, y: 3 }),
        kid("s", "y", 4),
    ]);
});

test("Outbox sends a held end status last and keeps what came before it", async () => {
    const [ws, ob] = outbox();
    ob.push(w("fill", 0, 201));
    ob.push(snap("s", { x: 0 }, 201));
    ob.push(kid("s", "x", 1));
    ob.push({ uuid: "s", status: 410 });
    ob.push(w("a", 1, 201));
    ob.push({ uuid: "a", status: 500 });
    await ws.drain();
    /* Subscriptions take turns, one update each. */
    assert.deepEqual(ws.sent, [
        w("fill", 0, 201),
        snap("s", { x: 0 }, 201),
        w("a", 1, 201),
        kid("s", "x", 1),
        { uuid: "a", status: 500 },
        { uuid: "s", status: 410 },
    ]);
});

test("Outbox does not send a held update equal to the last one sent", async () => {
    const [ws, ob] = outbox();
    ob.push(w("a", 1, 201));
    await ws.drain();
    ob.push(w("a", 2));
    ob.push(w("a", 3));                 /* held */
    ob.push(w("a", 2));                 /* back to what the client has */
    ob.push(kid("s", "x", 1));
    await ws.drain();
    assert.deepEqual(ws.sent, [w("a", 1, 201), w("a", 2), kid("s", "x", 1)]);
    assert.equal(ob.stats.repeats, 1);
    /* Once the client has caught up, updates go straight through. */
    ob.push(w("a", 2));
    assert.deepEqual(ws.sent.at(-1), w("a", 2));
});

/* The whole message is compared, as the per-subscription
 * distinctUntilChanged does, so a 200 after a 201 with the same body
 * is still sent. */
test("Outbox compares the whole message, status included", async () => {
    const [ws, ob] = outbox();
    ob.push(w("a", 1, 201));
    ob.push(w("a", 2));
    ob.push(w("a", 1));
    await ws.drain();
    assert.deepEqual(ws.sent, [w("a", 1, 201), w("a", 1)]);
});

test("Outbox: once anything is held, later updates wait behind it", async () => {
    const [ws, ob] = outbox();
    ob.push(w("a", 1, 201));
    ob.push(w("b", 1, 201));            /* held */
    ws.bufferedAmount = 0;              /* room, but b is still held */
    ob.push(w("b", 2));
    assert.deepEqual(ws.sent.map(m => m.uuid), ["a", "b"]);
    assert.deepEqual(ws.sent[1], w("b", 2, 201));
    await ws.drain();
});

test("Outbox forgets a subscription when it ends, after its held updates", async () => {
    const [ws, ob] = outbox();
    ob.push(w("a", 1, 201));
    ob.end("a");
    assert.equal(ob.last.size, 0);
    ob.push(w("b", 1, 201));
    ob.push(w("b", 2));
    ob.end("b");
    assert.ok(ob.held.has("b"));
    await ws.drain();
    assert.equal(ob.held.size, 0);
    assert.equal(ob.last.size, 0);
});

test("Outbox drops everything when the socket closes", async () => {
    const [ws, ob] = outbox();
    ob.push(w("a", 1, 201));
    ob.push(w("a", 2));
    ob.close();
    ob.push(w("a", 3));
    await ws.drain();
    assert.deepEqual(ws.sent, [w("a", 1, 201)]);
    assert.equal(ob.held.size, 0);
});

test("Outbox retries held updates if no send is outstanding", async () => {
    const ws = fake_ws();
    const ob = new Outbox({ ws, max_buffer: 10 });
    ws.bufferedAmount = 100;            /* someone else's data */
    ob.push(w("a", 1, 201));
    assert.equal(ws.sent.length, 0);
    ws.bufferedAmount = 0;
    await new Promise(r => setTimeout(r, 120));
    assert.deepEqual(ws.sent, [w("a", 1, 201)]);
});

/* Count the sends until a message for `uuid` goes out, releasing one
 * send callback at a time. */
async function sends_until (ws, uuid, max) {
    for (let n = 0; n < max; n++) {
        const i = ws.sent.findIndex(m => m.uuid == uuid);
        if (i >= 0) return i;
        ws.bufferedAmount = 0;
        ws.cbs.shift()?.();
        await new Promise(r => setImmediate(r));
    }
    return Infinity;
}

test("Outbox: a busy SEARCH does not hold back other subscriptions", async () => {
    const [ws, ob] = outbox();
    ob.push(w("fill", 0, 201));
    for (let i = 0; i < 1000; i++) ob.push(kid("s", `c${i}`, i));
    ob.push(w("a", 1, 201));
    /* Subscriptions take turns: fill, then s, then a. */
    const at = await sends_until(ws, "a", 2000);
    assert.ok(at <= 3, `WATCH sent after ${at} sends`);
    await ws.drain();
    assert.equal(ws.sent.filter(m => m.uuid == "s").length, 1000);
});

test("Outbox: a burst on one subscription can't delay a new one's 201", async () => {
    const [ws, ob] = outbox();
    ob.push(w("fill", 0, 201));
    for (let i = 0; i < 500; i++) ob.push(kid("s", `c${i}`, i));
    await sends_until(ws, "s", 10);
    for (let i = 500; i < 1000; i++) ob.push(kid("s", `c${i}`, i));
    ob.push(w("new", 1, 201));
    const before = ws.sent.length;
    const at = await sends_until(ws, "new", 2000);
    assert.ok(at - before <= 2, `201 sent after ${at - before} more sends`);
    await ws.drain();
});

test("Outbox sends 100,000 held child updates in linear time", () => {
    /* A socket that only counts, so the time is the Outbox's. */
    const ws = { OPEN: 1, readyState: 1, bufferedAmount: 1, n: 0,
        send (data, cb) { ws.n++; } };
    const ob = new Outbox({ ws, max_buffer: 1 });
    const N = 100000;
    for (let i = 0; i < N; i++) ob.push(kid("s", `c${i}`, i));
    /* Replace every tenth, so the queue has replaced entries to skip. */
    for (let i = 0; i < N; i += 10) ob.push(kid("s", `c${i}`, -i));
    assert.equal(ob.size, N);

    ws.bufferedAmount = 0;
    ob.max_buffer = Infinity;
    const t0 = performance.now();
    ob.flush();
    const ms = performance.now() - t0;
    assert.equal(ws.n, N);
    assert.equal(ob.held.size, 0);
    assert.ok(ms < 300, `drain took ${ms.toFixed(0)} ms`);
});

test("Outbox: a replaced child still moves to the end after many replacements", async () => {
    const [ws, ob] = outbox();
    ob.push(w("fill", 0, 201));
    for (let r = 0; r < 3000; r++)
        ob.push(kid("s", r % 2 ? "x" : "y", r));
    ob.push(kid("s", "z", 0));
    ob.push(kid("s", "y", "last"));
    assert.equal(ob.size, 3);
    await ws.drain();
    assert.deepEqual(ws.sent.slice(1).map(m => [m.child, m.response.body]),
        [["x", 2999], ["z", 0], ["y", "last"]]);
});

test("Outbox ignores a max_buffer that is not a positive integer", () => {
    for (const bad of [0, -1, 1.5, NaN, "8M"]) {
        const ws = fake_ws();
        const logs = [];
        const ob = new Outbox({ ws, max_buffer: bad, log: (...a) => logs.push(a) });
        ob.push(w("a", 1, 201));
        assert.equal(ws.sent.length, 1, `max_buffer ${bad}`);
        assert.equal(logs.length, 1);
    }
});

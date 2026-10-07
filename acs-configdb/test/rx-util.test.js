/*
 * ACS ConfigDB
 * Tests for the Rx helpers used by the notify interface
 * Copyright 2026 University of Sheffield AMRC
 *
 * These need no database: node --test test/rx-util.test.js
 */

import assert       from "node:assert/strict";
import { test }     from "node:test";

import * as rx      from "rxjs";

import { coalesce, keyed } from "../lib/rx-util.js";

const tick = () => new Promise(r => setImmediate(r));

/* An async function we can complete by hand. */
function manual () {
    const calls = [];
    const fn = () => new Promise(resolve => {
        const n = calls.length + 1;
        calls.push(() => resolve(n));
    });
    return { fn, calls };
}

test("coalesce runs one call per value when values are spaced out", async () => {
    const src = new rx.Subject();
    const { fn, calls } = manual();
    const out = [];
    src.pipe(coalesce(fn)).subscribe(v => out.push(v));

    for (let i = 1; i <= 3; i++) {
        src.next();
        await tick();
        assert.equal(calls.length, i);
        calls[i - 1]();
        await tick();
    }
    assert.deepEqual(out, [1, 2, 3]);
});

test("coalesce has one call in flight and one more for a burst", async () => {
    const src = new rx.Subject();
    const { fn, calls } = manual();
    const out = [];
    src.pipe(coalesce(fn)).subscribe(v => out.push(v));

    src.next();
    await tick();
    assert.equal(calls.length, 1);

    /* A burst while the first call runs */
    for (let i = 0; i < 10; i++) src.next();
    await tick();
    assert.equal(calls.length, 1, "no second call while one is running");

    calls[0]();
    await tick();
    assert.equal(calls.length, 2, "one trailing call for the whole burst");
    calls[1]();
    await tick();
    await tick();

    assert.equal(calls.length, 2);
    assert.deepEqual(out, [1, 2]);
});

test("coalesce starts a call after the last value of a burst", async () => {
    const src = new rx.Subject();
    let state = 0;
    const seen = [];
    const fn = async () => {
        const at_start = state;
        await tick();
        return at_start;
    };
    src.pipe(coalesce(fn)).subscribe(v => seen.push(v));

    for (let i = 1; i <= 50; i++) {
        state = i;
        src.next();
        if (i % 7 == 0) await tick();
    }
    for (let i = 0; i < 10; i++) await tick();

    /* The last result reflects the state after the last value. */
    assert.equal(seen.at(-1), 50);
    /* Results never go backwards. */
    assert.deepEqual(seen, [...seen].sort((a, b) => a - b));
});

test("coalesce completes after the running call", async () => {
    const src = new rx.Subject();
    const { fn, calls } = manual();
    const out = [];
    let done = false;
    src.pipe(coalesce(fn)).subscribe({
        next: v => out.push(v),
        complete: () => done = true,
    });

    src.next();
    src.complete();
    await tick();
    assert.equal(done, false);
    calls[0]();
    await tick();
    await tick();
    assert.deepEqual(out, [1]);
    assert.equal(done, true);
});

test("coalesce passes on errors and stops", async () => {
    const src = new rx.Subject();
    let n = 0;
    const fn = async () => { n++; throw new Error("boom"); };
    let err;
    src.pipe(coalesce(fn)).subscribe({ error: e => err = e });

    src.next();
    src.next();
    for (let i = 0; i < 5; i++) await tick();
    assert.equal(err?.message, "boom");
    assert.equal(n, 1);
});

test("coalesce stops calling after unsubscribe", async () => {
    const src = new rx.Subject();
    const { fn, calls } = manual();
    const out = [];
    const sub = src.pipe(coalesce(fn)).subscribe(v => out.push(v));

    src.next();
    src.next();
    await tick();
    sub.unsubscribe();
    calls[0]();
    for (let i = 0; i < 5; i++) await tick();
    assert.equal(calls.length, 1);
    assert.deepEqual(out, []);
});

test("keyed delivers each value only to its own key", () => {
    const src = new rx.Subject();
    const by = keyed(src, v => v.k);
    const a = [], b = [], a2 = [];

    by("a").subscribe(v => a.push(v.n));
    by("b").subscribe(v => b.push(v.n));
    by("a").subscribe(v => a2.push(v.n));

    src.next({ k: "a", n: 1 });
    src.next({ k: "b", n: 2 });
    src.next({ k: "c", n: 3 });
    src.next({ k: "a", n: 4 });

    assert.deepEqual(a, [1, 4]);
    assert.deepEqual(a2, [1, 4]);
    assert.deepEqual(b, [2]);
});

test("keyed matches filter for the same subscribers", () => {
    const src = new rx.Subject();
    const by = keyed(src, v => v.k);
    const keys = ["x", "y", "z", "x"];
    const via_key = keys.map(() => []);
    const via_filter = keys.map(() => []);

    keys.forEach((k, i) => {
        by(k).subscribe(v => via_key[i].push(v));
        src.pipe(rx.filter(v => v.k == k)).subscribe(v => via_filter[i].push(v));
    });
    for (let n = 0; n < 100; n++)
        src.next({ k: "wxyz"[n % 4], n });

    assert.deepEqual(via_key, via_filter);
});

test("keyed drops a key once nobody watches it, and can restart it", () => {
    const src = new rx.Subject();
    const by = keyed(src, v => v.k);
    const out = [];

    const s1 = by("a").subscribe(v => out.push(["s1", v.n]));
    const s2 = by("a").subscribe(v => out.push(["s2", v.n]));
    src.next({ k: "a", n: 1 });
    s1.unsubscribe();
    src.next({ k: "a", n: 2 });
    s2.unsubscribe();
    src.next({ k: "a", n: 3 });
    const s3 = by("a").subscribe(v => out.push(["s3", v.n]));
    src.next({ k: "a", n: 4 });
    s3.unsubscribe();

    assert.deepEqual(out, [["s1", 1], ["s2", 1], ["s2", 2], ["s3", 4]]);
});

test("keyed allows unsubscribing while a value is delivered", () => {
    const src = new rx.Subject();
    const by = keyed(src, v => v.k);
    const out = [];

    /* This is what takeWhile does after an error status. */
    const s1 = by("a").pipe(rx.takeWhile(v => v.n < 2, true))
        .subscribe(v => out.push(["s1", v.n]));
    by("a").subscribe(v => out.push(["s2", v.n]));

    src.next({ k: "a", n: 1 });
    src.next({ k: "a", n: 2 });
    src.next({ k: "a", n: 3 });

    assert.equal(s1.closed, true);
    assert.deepEqual(out,
        [["s1", 1], ["s2", 1], ["s1", 2], ["s2", 2], ["s2", 3]]);
});

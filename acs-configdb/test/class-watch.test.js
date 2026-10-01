/*
 * ACS ConfigDB
 * Tests for CDBNotify.class_watch against a fake model
 * Copyright 2026 University of Sheffield AMRC
 *
 * These need no database: node --test test/class-watch.test.js
 */

import assert       from "node:assert/strict";
import { test }     from "node:test";

import * as rx      from "rxjs";

import { CDBNotify } from "../lib/notify.js";

const tick = () => new Promise(r => setImmediate(r));
const ticks = async n => { for (let i = 0; i < n; i++) await tick(); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const K = "0c0c0c0c-0000-4000-8000-000000000000";

/* A model whose class lookups we complete by hand. Each lookup takes
 * a snapshot of `members` when it starts, as a database transaction
 * would. With `auto` set, lookups complete at once instead. `started`
 * records the relation and start time of every lookup. */
function fake_model (auto = false) {
    const updates = new rx.Subject();
    const model = {
        updates,
        members:    [],
        lookups:    [],
        started:    [],
        class_lookup (klass, rel) {
            const snapshot = [...model.members];
            model.started.push({ rel, at: performance.now() });
            if (auto) return Promise.resolve(snapshot);
            return new Promise(resolve => {
                model.lookups.push(() => resolve(snapshot));
            });
        },
        class_update () { updates.next({ type: "class" }); },
    };
    return model;
}

/* The lookup throttle is off unless a test asks for it. */
function cdb_notify (model, lookup_interval = 0) {
    return new CDBNotify({
        model,
        lookup_interval,
        auth:   { check_acl: async () => true },
        debug:  { bound: () => () => {} },
        api:    {},
    });
}

function watch (notify, rel = "member") {
    const out = [];
    const sub = notify.class_watch(rel, "perm", { principal: "p" }, K)
        .subscribe(u => out.push({ status: u.status, body: u.response.body }));
    return { out, sub };
}

test("shared lookups stop when the last watcher leaves", async () => {
    const model = fake_model();
    const notify = cdb_notify(model);

    const w = watch(notify);
    await ticks(2);
    model.lookups[0]();
    await ticks(2);

    model.class_update();
    await ticks(2);
    assert.equal(model.lookups.length, 2, "a class update runs a lookup");
    model.lookups[1]();
    await ticks(2);

    /* cacheSeq resets through rx.timer(timeout), so with a timeout of
     * 0 the shared lookup stops on the next timer turn. */
    w.sub.unsubscribe();
    await new Promise(r => setTimeout(r, 0));
    for (let i = 0; i < 5; i++) {
        model.class_update();
        await ticks(2);
        model.lookups.at(-1)();
    }
    await ticks(2);
    assert.equal(model.lookups.length, 2,
        "no lookups for the relation after the last watcher leaves");
});

test("a new watcher's first message is not older than its WATCH", async () => {
    const model = fake_model();
    const notify = cdb_notify(model);

    model.members = ["a"];
    const a = watch(notify);
    await ticks(2);
    model.lookups[0]();
    await ticks(2);

    /* A class update starts a shared lookup, which sees only "a". */
    model.class_update();
    await ticks(2);
    assert.equal(model.lookups.length, 2);

    /* "z" is committed, then b subscribes while the shared lookup is
     * still running. b's own initial lookup sees "z". */
    model.members = ["a", "z"];
    model.class_update();
    const b = watch(notify);
    await ticks(2);
    assert.equal(model.lookups.length, 3);

    /* The older shared lookup finishes first. */
    model.lookups[1]();
    await ticks(2);
    model.lookups[2]();
    await ticks(2);
    /* The trailing shared lookup for the second update. */
    model.lookups[3]?.();
    await ticks(2);

    assert.deepEqual(b.out[0], { status: 201, body: ["a", "z"] },
        `first message ${JSON.stringify(b.out[0])}`);
    assert.ok(b.out.slice(1).every(u => u.status == 200));
    assert.deepEqual(b.out.at(-1).body, ["a", "z"]);
    assert.deepEqual(a.out.at(-1).body, ["a", "z"]);

    a.sub.unsubscribe();
    b.sub.unsubscribe();
});

/* Lookups that class updates started, after each watcher's initial
 * lookup. */
const shared = (model, initial) => model.started.slice(initial);

test("a burst of class updates ends with one lookup of the last state", async () => {
    const model = fake_model(true);
    const notify = cdb_notify(model, 100);

    const w = watch(notify);
    await ticks(2);
    assert.deepEqual(w.out, [{ status: 201, body: [] }]);

    /* The first update looks up at once. The rest fall inside its
     * interval. Without a trailing lookup the last state, "u9", would
     * never be sent. */
    for (let i = 0; i < 10; i++) {
        model.members = [...model.members, `u${i}`];
        model.class_update();
        await ticks(2);
    }
    assert.equal(shared(model, 1).length, 1, "one lookup during the burst");

    await sleep(250);
    assert.equal(shared(model, 1).length, 2, "one trailing lookup after it");
    assert.deepEqual(w.out.at(-1).body, model.members);

    w.sub.unsubscribe();
});

test("a class update after a quiet period looks up at once", async () => {
    const model = fake_model(true);
    const notify = cdb_notify(model, 10000);

    const w = watch(notify);
    await ticks(2);

    model.members = ["a"];
    model.class_update();
    await ticks(2);
    assert.equal(shared(model, 1).length, 1);
    assert.deepEqual(w.out.at(-1), { status: 200, body: ["a"] });

    w.sub.unsubscribe();
});

test("a sustained burst looks up at most once per interval per relation", async () => {
    const model = fake_model(true);
    const notify = cdb_notify(model, 100);

    const m = watch(notify, "member");
    const s = watch(notify, "subclass");
    await ticks(2);

    const start = performance.now();
    let n = 0;
    while (performance.now() - start < 550) {
        model.members = [`u${n++}`];
        model.class_update();
        await sleep(5);
    }
    await sleep(250);

    for (const rel of ["member", "subclass"]) {
        const at = shared(model, 2)
            .filter(l => l.rel == rel)
            .map(l => l.at);
        /* 550 ms of updates: a leading lookup, about one per 100 ms,
         * and a trailing lookup. Without the throttle this is one per
         * update. */
        assert.ok(n > 50, `${n} updates`);
        assert.ok(at.length >= 5 && at.length <= 8,
            `${rel}: ${at.length} lookups for ${n} updates`);
        for (let i = 1; i < at.length; i++)
            assert.ok(at[i] - at[i - 1] >= 95,
                `${rel}: lookups ${Math.round(at[i] - at[i - 1])} ms apart`);
    }
    assert.deepEqual(m.out.at(-1).body, model.members);
    assert.deepEqual(s.out.at(-1).body, model.members);

    m.sub.unsubscribe();
    s.sub.unsubscribe();
});

test("a new watcher during an interval gets the current state at once", async () => {
    const model = fake_model(true);
    const notify = cdb_notify(model, 10000);

    model.members = ["a"];
    const a = watch(notify);
    await ticks(2);

    /* The first update looks up at once and starts the interval. The
     * second waits for the end of it. */
    model.class_update();
    await ticks(2);
    model.members = ["a", "z"];
    model.class_update();
    await ticks(2);
    assert.deepEqual(a.out.at(-1).body, ["a"]);

    /* b's initial lookup is not throttled. */
    const b = watch(notify);
    await ticks(2);
    assert.deepEqual(b.out, [{ status: 201, body: ["a", "z"] }]);

    a.sub.unsubscribe();
    b.sub.unsubscribe();
});

test("throttled shared lookups never replace a newer result", async () => {
    const model = fake_model();
    const notify = cdb_notify(model, 100);

    model.members = ["a"];
    const a = watch(notify);
    await ticks(2);
    model.lookups[0]();
    await ticks(2);

    /* A shared lookup starts and sees only "a". */
    model.class_update();
    await ticks(2);
    assert.equal(model.lookups.length, 2);

    /* "z" is committed. Its update waits for the end of the interval.
     * b's initial lookup sees "z" and finishes first. */
    model.members = ["a", "z"];
    model.class_update();
    const b = watch(notify);
    await ticks(2);
    assert.equal(model.lookups.length, 3);
    model.lookups[2]();
    await ticks(2);
    model.lookups[1]();
    await ticks(2);

    assert.deepEqual(b.out, [{ status: 201, body: ["a", "z"] }]);

    /* The trailing lookup for "z". */
    await sleep(150);
    assert.equal(model.lookups.length, 4);
    model.lookups[3]();
    await ticks(2);

    assert.deepEqual(b.out, [{ status: 201, body: ["a", "z"] }]);
    assert.deepEqual(a.out.map(u => u.body), [["a"], ["a", "z"]]);

    a.sub.unsubscribe();
    b.sub.unsubscribe();
});

test("the class lookup interval falls back to 1000 ms for bad values", async () => {
    const { lookup_interval } = await import("../lib/notify.js");
    const logged = [];
    const log = (...a) => logged.push(a);
    assert.equal(lookup_interval(undefined, log), 1000);
    assert.equal(lookup_interval(null, log), 1000);
    assert.equal(lookup_interval(0, log), 0);
    assert.equal(lookup_interval("0", log), 0);
    assert.equal(lookup_interval("250", log), 250);
    assert.equal(lookup_interval(250, log), 250);
    assert.equal(logged.length, 0);
    for (const bad of ["", "abc", "-5", "1.5", "1e3", "8s", -1, 1.5, NaN, 2 ** 31])
        assert.equal(lookup_interval(bad, log), 1000, `value ${bad}`);
    assert.equal(logged.length, 10);
});

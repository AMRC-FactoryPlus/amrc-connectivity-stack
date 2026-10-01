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

const K = "0c0c0c0c-0000-4000-8000-000000000000";

/* A model whose class lookups we complete by hand. Each lookup takes
 * a snapshot of `members` when it starts, as a database transaction
 * would. */
function fake_model () {
    const updates = new rx.Subject();
    const model = {
        updates,
        members:    [],
        lookups:    [],
        class_lookup (klass, rel) {
            const snapshot = [...model.members];
            return new Promise(resolve => {
                model.lookups.push(() => resolve(snapshot));
            });
        },
        class_update () { updates.next({ type: "class" }); },
    };
    return model;
}

function cdb_notify (model) {
    return new CDBNotify({
        model,
        auth:   { check_acl: async () => true },
        debug:  { bound: () => () => {} },
        api:    {},
    });
}

function watch (notify) {
    const out = [];
    const sub = notify.class_watch("member", "perm", { principal: "p" }, K)
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

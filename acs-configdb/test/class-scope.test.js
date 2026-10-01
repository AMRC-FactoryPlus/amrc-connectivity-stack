/*
 * ACS ConfigDB
 * Differential test of targeted class updates
 * Copyright 2026 University of Sheffield AMRC
 *
 * Class updates list the classes whose lookups they can change, and
 * each shared class lookup re-runs only for the updates that list its
 * class. This checks that class watchers receive exactly what they
 * received when every class update re-ran every lookup.
 *
 * One real Model drives two CDBNotify instances. The reference one sees
 * class updates with their class list removed, so it re-runs every
 * lookup on every update, as main did. Both watch every relation of
 * every class in a random class tree, while random writes run against
 * the database. After each write both are left to go quiet, and every
 * watcher must have received the same messages from both.
 *
 * This needs a migrated ConfigDB database (see bench/README.md). It
 * creates new objects on every run. SEEDS and OPS set the size.
 */

import assert           from "node:assert/strict";
import crypto           from "node:crypto";
import { describe, test } from "node:test";

import * as rx          from "rxjs";

import { App, Class, SpecialObj } from "../lib/constants.js";
import Model            from "../lib/model.js";
import { CDBNotify }    from "../lib/notify.js";
import { Relations }    from "../lib/relations.js";

const skip = !process.env.PGHOST && "set PGHOST etc. to a migrated ConfigDB database";

const SEEDS = Number(process.env.SEEDS ?? 6);
const OPS = Number(process.env.OPS ?? 120);
const SEED0 = Number(process.env.SEED0 ?? 1);

const debug = { bound: () => () => {}, log: () => {} };

/* Writes that succeeded and failed, by kind, to show what ran. */
const tally = new Map();
function count (name, rv) {
    const st = Array.isArray(rv) ? rv[0] : rv;
    const t = tally.get(name) ?? { ok: 0, failed: 0 };
    st === undefined || st < 300 ? t.ok++ : t.failed++;
    tally.set(name, t);
}
const tick = () => new Promise(r => setImmediate(r));

/* A small seeded PRNG, so a failing seed can be re-run. */
function prng (seed) {
    let a = seed >>> 0;
    const next = () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const int = n => Math.floor(next() * n);
    const pick = list => list[int(list.length)];
    return { next, int, pick };
}

/* A CDBNotify on `model`. If `all` is set it sees class updates
 * without their class list. */
function notifier (model, all) {
    const n = { pending: 0, lookups: 0 };
    const m = Object.create(model);
    if (all)
        m.updates = model.updates.pipe(
            rx.map(u => u.type == "class" ? { type: "class" } : u));
    m.class_lookup = (...args) => {
        n.lookups++;
        n.pending++;
        return model.class_lookup(...args)
            .finally(() => n.pending--);
    };
    n.notify = new CDBNotify({
        model:  m,
        auth:   { check_acl: async () => true },
        debug,
        api:    {},
    });
    return n;
}

/* Wait until neither notifier has a lookup running, and the results
 * have passed through to the watchers. */
async function settle (...ns) {
    for (let idle = 0; idle < 8;) {
        await tick();
        idle = ns.every(n => n.pending == 0) ? idle + 1 : 0;
    }
}

function watch (n, rel, klass) {
    const out = [];
    const sub = n.notify.class_watch(rel.table, rel.cperm, { principal: "p" }, klass)
        .subscribe(u => {
            const r = u.response;
            out.push(JSON.stringify({
                status: u.status,
                rs:     r.status,
                body:   r.body && [...r.body].sort(),
            }));
        });
    return { out, sub };
}

/* Build a random class tree and return the state the writes use. */
async function seed_tree (model, r) {
    const st = { r1: [], r2: [], ind: [], pool: [], fresh: [] };
    const mk = async (klass, uuid) => {
        const [code, info] = await model.object_create({
            class: klass, owner: SpecialObj.Unowned, uuid });
        assert.ok(code < 300, `create ${code}`);
        return info.uuid;
    };

    for (let i = 0; i < 7; i++)
        st.r1.push(await mk(Class.Class));
    for (let i = 0; i < 3; i++)
        st.r2.push(await mk(Class.R2Class));

    /* A DAG with multiple inheritance: each class may have several
     * superclasses among the ones made before it. */
    for (let i = 1; i < st.r1.length; i++)
        for (let j = 0; j < i; j++)
            if (r.next() < 0.3)
                await model.class_add_subclass(st.r1[j], st.r1[i]);
    await model.class_add_subclass(st.r2[0], st.r2[1]);

    /* Rank 1 classes as members of rank 2 classes */
    for (const k of st.r1)
        if (r.next() < 0.4)
            await model.class_add_member(r.pick(st.r2), k);

    /* Some classes stay empty. */
    for (let i = 0; i < 10; i++)
        st.ind.push(await mk(r.pick(st.r1.slice(0, 5))));

    /* UUIDs that do not exist yet, but some writes will create. */
    for (let i = 0; i < 4; i++)
        st.pool.push(crypto.randomUUID());

    return st;
}

/* Every class-affecting write the model supports, chosen at random.
 * Many of these fail (rank mismatches, deleting a class with members,
 * removing a primary class...). Failures must send nothing on either
 * side. */
function writes (model, st, r) {
    const any_obj = () => r.pick([...st.r1, ...st.r2, ...st.ind, ...st.pool]);
    const reg = (obj, patch) => model.config_merge_patch(
        { app: App.Registration, object: obj }, patch);

    return [
        ["create individual", async () => {
            const rv = await model.object_create({
                class: r.pick(st.r1), owner: SpecialObj.Unowned });
            rv[1] && st.ind.push(rv[1].uuid);
            return rv;
        }],
        ["create with known uuid", () => model.object_create({
            class: r.pick([...st.r1, Class.Class]),
            owner: SpecialObj.Unowned, uuid: r.pick(st.pool),
        })],
        ["re-create existing", () => model.object_create({
            class: r.pick(st.r1), owner: SpecialObj.Unowned,
            uuid: r.pick(st.ind),
        })],
        ["create rank 1 class", async () => {
            const rv = await model.object_create({
                class: Class.Class, owner: SpecialObj.Unowned });
            rv[1] && st.r1.push(rv[1].uuid);
            rv[1] && st.fresh.push(rv[1].uuid);
            return rv;
        }],
        ["create rank 2 class", async () => {
            const rv = await model.object_create({
                class: Class.R2Class, owner: SpecialObj.Unowned });
            rv[1] && st.r2.push(rv[1].uuid);
            return rv;
        }],
        ["delete", () => model.object_delete(any_obj())],
        ["delete individual", () => model.object_delete(r.pick(st.ind))],
        ["add member", () => model.class_add_member(r.pick(st.r1), r.pick(st.ind))],
        ["add class member", () => model.class_add_member(r.pick(st.r2), r.pick(st.r1))],
        ["remove member", () => model.class_remove_member(r.pick(st.r1), r.pick(st.ind))],
        ["remove class member", () => model.class_remove_member(r.pick(st.r2), r.pick(st.r1))],
        ["add subclass", () => model.class_add_subclass(r.pick(st.r1), r.pick(st.r1))],
        ["add rank 2 subclass", () => model.class_add_subclass(r.pick(st.r2), r.pick(st.r2))],
        ["remove subclass", () => model.class_remove_subclass(r.pick(st.r1), r.pick(st.r1))],
        ["individual to class", () => {
            const obj = r.pick(st.ind);
            st.fresh.push(obj);
            return reg(obj, { rank: 1, class: Class.Class });
        }],
        /* This fails for a class with members or subclasses, so mostly
         * pick classes made since the seed. */
        ["class to individual", () => reg(
            r.pick(st.fresh.length && r.next() < 0.8 ? st.fresh : st.r1),
            { rank: 0, class: r.pick(st.r1) })],
        ["change primary class", () => reg(r.pick(st.ind), { class: r.pick(st.r1) })],
        ["mark deleted", () => reg(any_obj(), { deleted: r.next() < 0.5 })],
    ];
}

/* Run one seed. Returns null if every watcher saw the same messages,
 * or a description of the first difference. With `conc` set, writes run
 * in concurrent batches of that size and only the final states are
 * compared, as timing then decides the intermediate messages. */
async function run_seed (model, seed, opts = {}) {
    const r = prng(seed);
    const st = await seed_tree(model, r);

    const ref = notifier(model, true);
    const tgt = notifier(model, false);

    const klasses = [
        ...st.r1, ...st.r2, ...st.ind.slice(0, 3), ...st.pool,
        Class.Class, Class.R2Class, Class.Individual, Class.Device,
        crypto.randomUUID(),
        /* Postgres accepts other spellings of a UUID. */
        st.r1[0].toUpperCase(),
        `{${st.r1[1].replaceAll("-", "")}}`,
    ];
    const watchers = [];
    for (const k of klasses)
        for (const rel of Relations)
            watchers.push({
                key: `${rel.path} ${k}`,
                ref: watch(ref, rel, k),
                tgt: watch(tgt, rel, k),
            });
    await settle(ref, tgt);

    const ws = writes(model, st, r);
    const done = [];
    let diff = null;
    const ops = opts.ops ?? OPS;
    const conc = opts.conc ?? 1;

    for (let i = 0; i < ops && !diff; i += conc) {
        const batch = Array.from({ length: Math.min(conc, ops - i) },
            () => r.pick(ws));
        done.push(batch.map(w => w[0]).join(" | "));
        await Promise.all(batch.map(w => w[1]()
            .then(rv => count(w[0], rv), () => count(w[0], 500))));
        await settle(ref, tgt);

        if (conc > 1) continue;
        for (const w of watchers) {
            if (w.ref.out.length == w.tgt.out.length
                && w.ref.out.every((m, j) => m == w.tgt.out[j]))
                continue;
            diff = { seed, after: done.slice(-3), watcher: w.key,
                ref: w.ref.out.slice(-2), tgt: w.tgt.out.slice(-2) };
            break;
        }
    }

    /* Every watcher must end on the true state of the database. */
    if (!diff) {
        for (const w of watchers) {
            const [path, k] = w.key.split(" ");
            const rel = Relations.find(r => r.path == path);
            const now = await model.class_lookup(k, rel.table);
            const want = now ? [...now].sort() : undefined;
            const got = JSON.parse(w.tgt.out.at(-1)).body;
            const ref_got = JSON.parse(w.ref.out.at(-1)).body;
            if (JSON.stringify(got) == JSON.stringify(want)
                && JSON.stringify(ref_got) == JSON.stringify(want))
                continue;
            diff = { seed, final: true, watcher: w.key, want, got, ref: ref_got };
            break;
        }
    }

    for (const w of watchers) {
        w.ref.sub.unsubscribe();
        w.tgt.sub.unsubscribe();
    }
    return { diff, lookups: { ref: ref.lookups, tgt: tgt.lookups } };
}

describe("targeted class updates", { skip }, () => {
    let model;

    test("set up", async () => {
        model = await new Model({ auth: {}, debug }).init();
    });

    test(`${SEEDS} seeds of ${OPS} writes match re-running every lookup`, async () => {
        let ref = 0, tgt = 0;
        for (let s = SEED0; s < SEED0 + SEEDS; s++) {
            const { diff, lookups } = await run_seed(model, s);
            assert.equal(diff, null, JSON.stringify(diff, null, 2));
            ref += lookups.ref;
            tgt += lookups.tgt;
        }
        process.stderr.write(`# class lookups: every update ${ref}, targeted ${tgt}\n`);
        for (const [name, t] of tally)
            process.stderr.write(`# ${name}: ${t.ok} ok, ${t.failed} failed\n`);
        assert.ok(tgt < ref);
    });

    test("concurrent writes end on the true state", async () => {
        for (let s = SEED0; s < SEED0 + Math.ceil(SEEDS / 2); s++) {
            const { diff } = await run_seed(model, 1000 + s, { conc: 6 });
            assert.equal(diff, null, JSON.stringify(diff, null, 2));
        }
    });

    /* The test must be able to fail. These break the class list in two
     * ways and check that the comparison catches each. */
    async function catches (broken) {
        const real = model._class_scope;
        model._class_scope = broken;
        try {
            for (let s = SEED0; s < SEED0 + 20; s++) {
                const { diff } = await run_seed(model, 2000 + s, { ops: 60 });
                if (!diff) continue;
                process.stderr.write(`# caught: ${JSON.stringify(diff)}\n`);
                return diff;
            }
        }
        finally {
            model._class_scope = real;
        }
        return null;
    }

    test("catches a class list without superclasses", async () => {
        const diff = await catches(async function (ids, objs) {
            if (!ids) return { type: "class" };
            const own = await this.db.query(
                `select uuid from object where id = any($1::integer[])`, [ids]);
            return { type: "class",
                classes: new Set([...own.rows.map(r => r.uuid), ...objs]) };
        });
        assert.ok(diff, "a missing superclass was not detected");
    });

    test("catches a class list without the created or deleted object", async () => {
        const real = model._class_scope;
        const diff = await catches(async function (ids) {
            return real.call(this, ids, []);
        });
        assert.ok(diff, "a missing object was not detected");
    });

    test("tear down", async () => {
        await model.db.pool.end();
    });
});

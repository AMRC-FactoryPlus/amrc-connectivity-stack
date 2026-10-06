/*
 * ACS Auth service
 * Differential test: incremental Registration index against main
 *
 * Feeds long random sequences of notify SEARCH updates to two
 * pipelines at once:
 *  - the reference: NotifyV2#search plus the `_build_owned` from main,
 *    which rebuild everything on every update;
 *  - the new code: NotifyV2#search_changes plus `owned_apply`.
 * After every update it checks that both emitted the same number of
 * values and that every emitted Registration map, owned index and ACL
 * is the same.
 *
 * Set DIFF_SEED to replay one seed, DIFF_RUNS / DIFF_STEPS to scale.
 *
 * Copyright 2026 University of Sheffield AMRC
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import imm from "immutable";
import * as rx from "rxjs";

import { DataFlow } from "../lib/dataflow.js";
import { Special } from "../lib/uuids.js";

import {
    scripted_notify, fake_cdb, make_dataflow, ReferenceDataFlow,
    RegPath, upd,
} from "./fixtures.js";

/* Small seeded PRNG, so a failing seed can be replayed. */
function mulberry32 (seed) {
    return () => {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

const P = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const principals = [P(1), P(2), P(3), P(4), P(5)];
const outsider = P(99);         /* Not a member of Class.Principal */
const group = P(10);            /* Principal group of P1 and P2 */
const permA = P(20), permB = P(21), permC = P(22);
const permGrp = P(23);          /* Permission group of permB, permC */

const classes = {
    principals,
    permissions:        [permA, permB, permC],
    principal_groups:   { [group]: [P(1), P(2)] },
    permission_groups:  { [permGrp]: [permB, permC] },
};

/* Grants that exercise every expansion path in `_acl_for`. */
const grants = [
    ...principals.map(p => ({
        principal: p, permission: permA, target: Special.Mine, plural: true })),
    { principal: group, permission: permGrp,
        target: Special.Mine, plural: true },
    { principal: P(3), permission: permB, target: Special.Self, plural: false },
    { principal: P(4), permission: permC, target: P(50), plural: false },
    { principal: P(5), permission: permGrp,
        target: Special.Wildcard, plural: false },
];

const owners = [...principals, Special.Unowned, Special.Unowned, P(60)];

function generator (rand, nkeys) {
    const pick = xs => xs[Math.floor(rand() * xs.length)];
    const keys = Array.from({ length: nkeys }, (_, i) => P(1000 + i));
    const body = () => {
        const r = rand();
        /* A few entries with no owner field, to check the `undefined`
         * owner key behaves the same. */
        if (r < 0.03) return { deleted: false };
        return { owner: pick(owners), deleted: rand() < 0.5,
            n: Math.floor(rand() * 4) };
    };
    const kid_status = () => {
        const r = rand();
        return r < 0.85 ? 200 : r < 0.95 ? 403 : 404;
    };
    const full = () => {
        const kids = {};
        const fill = rand();
        for (const k of keys)
            if (rand() < fill) kids[k] = [kid_status(), body()];
        return upd.full(kids);
    };

    return () => {
        const r = rand();
        if (r < 0.45) return upd.child(pick(keys), 200, body());
        if (r < 0.65) return upd.child(pick(keys), 404);
        if (r < 0.72) return upd.child(pick(keys), 403);
        if (r < 0.75) return upd.child(pick(keys), 500);
        if (r < 0.80) return upd.child(pick(keys), 201, body());
        if (r < 0.85) return full();
        if (r < 0.87) return upd.full(undefined, 200);
        if (r < 0.89) return upd.full(undefined, 403);
        if (r < 0.91) return upd.full(undefined, 404);
        if (r < 0.92) return upd.full({}, 200);
        /* Repeat an existing body under the same owner: a change that
         * leaves the owned index alone. */
        return upd.child(pick(keys), 200, body());
    };
}

/* ACLs are arrays. Their order comes from Immutable Set iteration,
 * which main never defined, so compare them as multisets. */
const canon = acl => acl === undefined ? "undefined"
    : JSON.stringify(acl.map(e => JSON.stringify(e)).sort());

function collect (seq) {
    const out = [];
    const sub = seq.subscribe({
        next: v => out.push(v),
        error: e => out.push({ error: e }),
    });
    return { out, sub };
}

async function run_one (seed, steps, nkeys) {
    const rand = mulberry32(seed);
    const next = generator(rand, nkeys);

    const { notify, updates } = scripted_notify();
    const cdb = fake_cdb(notify, classes);
    const ref = await make_dataflow(ReferenceDataFlow, cdb, grants);
    const neu = await make_dataflow(DataFlow, cdb, grants);

    const subs = [];
    const watch = seq => { const c = collect(seq); subs.push(c.sub); return c.out; };

    const ref_maps = watch(notify.search(RegPath));
    const new_maps = watch(rx.pipe(rx.map(c => c.map))(
        notify.search_changes(RegPath)));
    const ref_owned = watch(ref.owned);
    const new_owned = watch(neu.owned);
    const acls = [...principals, outsider].map(p => ({
        p,
        ref: watch(ref._acl_for(p)),
        neu: watch(neu._acl_for(p)),
    }));

    let order_diffs = 0;
    const check = (step, u) => {
        const where = () => `seed ${seed} step ${step} update ${JSON.stringify(u)}`;

        assert.equal(new_maps.length, ref_maps.length, `map count, ${where()}`);
        assert.ok(imm.is(new_maps.at(-1), ref_maps.at(-1)),
            `Registration map, ${where()}`);

        assert.equal(new_owned.length, ref_owned.length, `owned count, ${where()}`);
        assert.ok(imm.is(new_owned.at(-1), ref_owned.at(-1)),
            `owned index, ${where()}`);

        for (const a of acls) {
            assert.equal(a.neu.length, a.ref.length,
                `ACL count for ${a.p}, ${where()}`);
            const [rv, nv] = [a.ref.at(-1), a.neu.at(-1)];
            assert.equal(canon(nv), canon(rv), `ACL for ${a.p}, ${where()}`);
            if (rv && JSON.stringify(rv) != JSON.stringify(nv)) order_diffs++;
        }
    };

    /* Sometimes start with child updates before any snapshot: both
     * sides must ignore them. */
    const first = rand() < 0.2 ? 3 : 0;
    for (let i = 0; i < first; i++) {
        const u = upd.child(P(1000), 200, { owner: P(1) });
        updates.next(u);
        check(-1, u);
    }
    const initial = generator(rand, nkeys);
    let u;
    do { u = initial(); } while (u.child);
    updates.next(u);
    check(0, u);

    for (let step = 1; step <= steps; step++) {
        const u = next();
        updates.next(u);
        check(step, u);
    }

    subs.forEach(s => s.unsubscribe());
    return {
        emissions: ref_maps.length,
        acl_emissions: acls.reduce((n, a) => n + a.ref.length, 0),
        order_diffs,
    };
}

const RUNS = Number(process.env.DIFF_RUNS ?? 200);
const STEPS = Number(process.env.DIFF_STEPS ?? 400);

test("incremental Registration index matches main (small key space)", async () => {
    const seeds = process.env.DIFF_SEED
        ? [Number(process.env.DIFF_SEED)]
        : Array.from({ length: RUNS }, (_, i) => i + 1);
    let total = { emissions: 0, acl_emissions: 0, order_diffs: 0 };
    for (const seed of seeds) {
        const r = await run_one(seed, STEPS, 12);
        for (const k in total) total[k] += r[k];
    }
    console.log("small key space: %d runs x %d steps, %o",
        seeds.length, STEPS, total);
    /* Guard against a generator that never reaches a usable state. */
    assert.ok(total.emissions > seeds.length * STEPS / 4);
});

test("incremental Registration index matches main (large key space)", async () => {
    /* More keys than Immutable's 8-entry array maps hold, so the
     * maps use the hashed trie layout. */
    const runs = Math.max(1, Math.floor(RUNS / 10));
    let total = { emissions: 0, acl_emissions: 0, order_diffs: 0 };
    for (let seed = 10001; seed <= 10000 + runs; seed++) {
        const r = await run_one(seed, STEPS * 5, 300);
        for (const k in total) total[k] += r[k];
    }
    console.log("large key space: %d runs x %d steps, %o",
        runs, STEPS * 5, total);
    assert.ok(total.emissions > 0);
});

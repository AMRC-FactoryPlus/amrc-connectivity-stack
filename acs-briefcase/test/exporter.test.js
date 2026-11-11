/*
 * ACS Briefcase exporter
 * Tests for building, recording and withdrawing briefcases
 * Copyright 2026 University of Sheffield
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import * as imm from "immutable";
import * as rx  from "rxjs";

import { App, Class } from "../lib/constants.js";
import { Exporter, plan } from "../lib/exporter.js";

const A = "a0000000-0000-4000-8000-000000000000";
const B = "b0000000-0000-4000-8000-000000000000";
const C = "c0000000-0000-4000-8000-000000000000";

const OLD = "0b5e3a52-7f41-4c2e-a8d6-6a9f3e2d1c40";
const briefcase = { uuid: OLD, file: OLD, sha256: "a".repeat(64), size: 1,
    built: "2026-10-29T12:00:00Z", exporter: "test" };
const live = { briefcases: [briefcase] };
const gone = { briefcases: [{ ...briefcase, withdrawn: "2026-10-29T13:00:00Z" }] };

/* A plan as plain arrays, for comparing. */
const plain = p => ({
    build:      p.get("build").toArray().sort(),
    withdraw:   p.get("withdraw").toArray().sort(),
});

const work = ({ build = [], withdraw = [], push = [], notify = [] }) =>
    imm.Map({
        build: imm.Set(build), withdraw: imm.Set(withdraw),
        push: imm.Set(push), notify: imm.Set(notify),
    });

/* The delivery work in a plan, as plain arrays. */
const delivery_work = p => ({
    push:       p.get("push").toArray().sort(),
    notify:     p.get("notify").toArray().sort(),
});
const deliver = { deliver: true };

/* Class member responses, as ConfigDB's notify WATCH gives them. */
const members = list => ({ status: 200, isOK: true, body: list });
const refused = { status: 403, isOK: false };

test("builds Published datasets with no live briefcase", () => {
    const p = plan(imm.Set([A, B]), imm.Map({ [A]: live }));
    assert.deepEqual(plain(p), { build: [B], withdraw: [] });
});

test("builds a dataset Published again after a withdrawal", () => {
    const p = plan(imm.Set([A]), imm.Map({ [A]: gone }));
    assert.deepEqual(plain(p), { build: [A], withdraw: [] });
});

test("withdraws a live briefcase whose dataset is not Published", () => {
    const p = plan(imm.Set(), imm.Map({ [A]: live, [B]: gone }));
    assert.deepEqual(plain(p), { build: [], withdraw: [A] });
});

test("does nothing when every Published dataset is released", () => {
    const p = plan(imm.Set([A]), imm.Map({ [A]: live }));
    assert.deepEqual(plain(p), { build: [], withdraw: [] });
});

test("plans no delivery unless it is on", () => {
    const releases = imm.Map({ [A]: live, [B]: {
        briefcases: [{ ...briefcase, withdrawn: "t", pushed: "t" }] } });
    assert.deepEqual(delivery_work(plan(imm.Set([A]), releases)),
        { push: [], notify: [] });
    assert.deepEqual(delivery_work(plan(imm.Set([A]), releases, deliver)),
        { push: [A], notify: [B] });
});

test("pushes live briefcases that have not been pushed", () => {
    const tiered = tier => ({ briefcases: [{ ...briefcase, tier }] });
    const p = plan(imm.Set([A, B, C]), imm.Map({
        [A]: tiered("registered"),
        [B]: { briefcases: [{ ...briefcase, tier: "open", pushed: "t" }] },
        [C]: gone,
    }), deliver);
    assert.deepEqual(delivery_work(p), { push: [A], notify: [] });
});

test("holds back enclave-only briefcases", () => {
    const p = plan(imm.Set([A, B]), imm.Map({
        [A]: { briefcases: [{ ...briefcase, tier: "enclave-only" }] },
        /* No tier recorded: found out when it is pushed. */
        [B]: live,
    }), deliver);
    assert.deepEqual(delivery_work(p), { push: [B], notify: [] });
});

test("doesn't push a briefcase that is about to be withdrawn", () => {
    const p = plan(imm.Set(), imm.Map({ [A]: live }), deliver);
    assert.deepEqual(plain(p), { build: [], withdraw: [A] });
    assert.deepEqual(delivery_work(p), { push: [], notify: [] });
});

test("sends a withdrawal only for a briefcase that was pushed", () => {
    const withdrawn = "2026-10-29T13:00:00Z";
    const p = plan(imm.Set(), imm.Map({
        [A]: gone,
        [B]: { briefcases: [{ ...briefcase, withdrawn, pushed: "t" }] },
        [C]: { briefcases: [{ ...briefcase, withdrawn, pushed: "t",
            withdrawal_pushed: "t" }] },
    }), deliver);
    assert.deepEqual(delivery_work(p), { push: [], notify: [B] });
});

test("emits a plan only when the work changes", () => {
    const published = new rx.Subject();
    const releases = new rx.Subject();
    const fplus = {
        debug: { bound: () => () => {} },
        ConfigDB: {
            notify: { watch_full: url => {
                assert.equal(url, `v2/class/${Class.Published}/member/`);
                return published;
            } },
            search_app: app => {
                assert.equal(app, App.BriefcaseRelease);
                return releases;
            },
        },
    };
    const seen = [];
    new Exporter({ fplus }).plans().subscribe(p => seen.push(plain(p)));

    published.next(members([A]));
    assert.equal(seen.length, 0, "waits for the release entries");

    releases.next(imm.Map());
    /* An unrelated release entry changes nothing. */
    releases.next(imm.Map({ [C]: gone }));
    published.next(members([A, B]));
    releases.next(imm.Map({ [A]: live, [C]: gone }));

    assert.deepEqual(seen, [
        { build: [A], withdraw: [] },
        { build: [A, B], withdraw: [] },
        { build: [B], withdraw: [] },
    ]);
});

test("withdraws nothing when the Published class can't be read", async () => {
    const published = new rx.Subject();
    const releases = new rx.Subject();
    const logged = [];
    let watches = 0;
    const fplus = {
        debug: { bound: () => (...args) => logged.push(args) },
        ConfigDB: {
            notify: { watch_full: () => { watches++; return published; } },
            search_app: () => releases,
        },
    };
    const seen = [];
    new Exporter({ fplus, retry: 0 }).plans()
        .subscribe(p => seen.push(plain(p)));
    const tick = () => new Promise(r => setTimeout(r, 5));

    releases.next(imm.Map({ [A]: live }));
    published.next(refused);
    assert.equal(seen.length, 0, "a refusal is not an empty class");

    await tick();
    published.next(members([A]));
    published.next(refused);
    await tick();
    published.next(members([A]));

    assert.deepEqual(seen, [{ build: [], withdraw: [] }]);
    assert.equal(watches, 3, "watches again after each refusal");
    assert.equal(logged.length, 2);
});

/* An Exporter with an in-memory store, a fake builder and a fake
 * delivery. Builds and deliveries of the datasets in `fail` throw until
 * they are taken out of it. `tiers` gives the tier found inside the zip
 * of a briefcase, by UUID. */
function make_exporter ({ entries = {}, fail = new Set(), tiers = {} } = {}) {
    const records = new Map(Object.entries(structuredClone(entries)));
    const calls = { builds: [], uploads: [], withdrawals: [],
        releases: [], notices: [], tiers: [] };
    const scheduled = [];
    let now = 1_000_000;

    const store = {
        release: async ds => structuredClone(records.get(ds)),
        upload: async file => {
            calls.uploads.push(file);
            return `file-of-${file}`;
        },
        record: async (ds, b) => {
            const briefcases = [...records.get(ds)?.briefcases ?? [], b];
            records.set(ds, { briefcases });
        },
        withdraw: async (ds, at) => {
            calls.withdrawals.push(ds);
            const last = records.get(ds)?.briefcases?.at(-1);
            if (!last || last.withdrawn) return null;
            last.withdrawn = at;
            return last.uuid;
        },
        mark: async (ds, uuid, fields) => {
            Object.assign(records.get(ds).briefcases.find(b => b.uuid === uuid),
                fields);
        },
    };
    const delivery = {
        tier: async b => {
            calls.tiers.push(b.uuid);
            return tiers[b.uuid];
        },
        release: async (ds, b) => {
            if (fail.has(ds)) throw new Error("no route");
            calls.releases.push({ ds, uuid: b.uuid });
        },
        withdraw: async (ds, b) => {
            if (fail.has(ds)) throw new Error("no route");
            calls.notices.push({ ds, uuid: b.uuid });
        },
    };
    const builder = {
        build: async (ds, opts) => {
            calls.builds.push({ ds, ...opts });
            if (fail.has(ds)) throw new Error("no data");
            return { file: `${opts.briefcase}.zip`, sha256: "b".repeat(64),
                size: 10, built: "2026-10-30T09:00:00.000Z",
                tier: "registered" };
        },
    };
    const exporter = new Exporter({
        fplus: { debug: { bound: () => () => {} }, ConfigDB: {} },
        builder, store, delivery,
        exporter:   "test",
        retry:      300_000,
        now:        () => now,
        schedule:   (fn, ms) => scheduled.push(ms),
    });

    return {
        exporter, records, calls, scheduled, fail,
        advance: ms => { now += ms; },
    };
}

test("builds, uploads and records a briefcase", async () => {
    const { exporter, records, calls } = make_exporter();
    exporter.update(work({ build: [A] }));
    await exporter.pass();

    const [b] = calls.builds;
    assert.equal(b.ds, A);
    assert.equal(b.replaces, undefined);
    assert.deepEqual(calls.uploads, [`${b.briefcase}.zip`]);
    assert.deepEqual(records.get(A), { briefcases: [{
        uuid: b.briefcase, file: `file-of-${b.briefcase}.zip`,
        sha256: "b".repeat(64), size: 10,
        built: "2026-10-30T09:00:00.000Z", tier: "registered",
        exporter: "test",
    }] });
});

test("doesn't build again before ConfigDB reports the record", async () => {
    const { exporter, calls } = make_exporter();
    exporter.update(work({ build: [A] }));
    await exporter.pass();

    /* The plan still lists A until the new record comes back. */
    await exporter.pass();
    exporter.update(work({ build: [A, B] }));
    await exporter.pass();
    assert.deepEqual(calls.builds.map(b => b.ds), [A, B]);
});

test("skips a dataset whose briefcase is already live", async () => {
    const { exporter, calls } = make_exporter({ entries: { [A]: live } });
    exporter.update(work({ build: [A] }));
    await exporter.pass();
    assert.deepEqual(calls.builds, []);
});

test("a new briefcase replaces the withdrawn one", async () => {
    const { exporter, records, calls } = make_exporter({ entries: { [A]: gone } });
    exporter.update(work({ build: [A] }));
    await exporter.pass();

    const [b] = calls.builds;
    assert.notEqual(b.briefcase, OLD, "a recorded UUID is never reused");
    assert.equal(b.replaces, OLD);

    const [old, now] = records.get(A).briefcases;
    assert.equal(old.withdrawn, gone.briefcases[0].withdrawn);
    assert.equal(now.uuid, b.briefcase);
    assert.equal(now.replaces, OLD);
    assert.equal(now.withdrawn, undefined);
});

test("retries a failed build under the same UUID", async () => {
    const { exporter, records, calls, scheduled, fail, advance } =
        make_exporter({ fail: new Set([A]) });
    exporter.update(work({ build: [A, B] }));
    await exporter.pass();

    assert.equal(records.has(A), false);
    assert.equal(records.has(B), true, "a failure doesn't stop the others");
    assert.deepEqual(scheduled, [300_000]);

    /* Too soon to try again. */
    advance(299_999);
    await exporter.pass();
    assert.equal(calls.builds.filter(b => b.ds == A).length, 1);

    fail.clear();
    advance(1);
    await exporter.pass();
    const [first, second] = calls.builds.filter(b => b.ds == A);
    assert.equal(second.briefcase, first.briefcase);
    assert.equal(records.get(A).briefcases[0].uuid, first.briefcase);
});

test("withdraws a live briefcase once", async () => {
    const { exporter, records, calls } = make_exporter({ entries: { [A]: live } });
    exporter.update(work({ withdraw: [A] }));
    await exporter.pass();
    await exporter.pass();

    assert.deepEqual(calls.withdrawals, [A]);
    assert.equal(records.get(A).briefcases[0].withdrawn,
        new Date(1_000_000).toISOString());
});

test("retries a failed withdrawal", async () => {
    const { exporter, records, scheduled } = make_exporter({ entries: { [A]: live } });
    const withdraw = exporter.store.withdraw;
    exporter.store.withdraw = async () => { throw new Error("ConfigDB down"); };
    exporter.update(work({ withdraw: [A] }));
    await exporter.pass();
    assert.deepEqual(scheduled, [300_000]);

    exporter.store.withdraw = withdraw;
    await exporter.pass();
    assert.ok(records.get(A).briefcases[0].withdrawn);
});

const NOW = new Date(1_000_000).toISOString();
const tiered = { briefcases: [{ ...briefcase, tier: "registered" }] };

test("delivers a live briefcase and records when", async () => {
    const { exporter, records, calls } = make_exporter({ entries: { [A]: tiered } });
    exporter.update(work({ push: [A] }));
    await exporter.pass();
    /* The plan still lists A until the record comes back. */
    await exporter.pass();

    assert.deepEqual(calls.releases, [{ ds: A, uuid: OLD }]);
    assert.deepEqual(calls.tiers, [], "the tier was recorded already");
    assert.equal(records.get(A).briefcases[0].pushed, NOW);
});

test("finds the tier of a briefcase built before it was recorded", async () => {
    const { exporter, records, calls } = make_exporter({
        entries: { [A]: live }, tiers: { [OLD]: "approved-project" } });
    exporter.update(work({ push: [A] }));
    await exporter.pass();

    assert.deepEqual(calls.tiers, [OLD]);
    assert.deepEqual(calls.releases, [{ ds: A, uuid: OLD }]);
    const [b] = records.get(A).briefcases;
    assert.equal(b.tier, "approved-project");
    assert.equal(b.pushed, NOW);
});

test("records an enclave-only tier and delivers nothing", async () => {
    const { exporter, records, calls } = make_exporter({
        entries: { [A]: live }, tiers: { [OLD]: "enclave-only" } });
    exporter.update(work({ push: [A] }));
    await exporter.pass();
    await exporter.pass();

    assert.deepEqual(calls.tiers, [OLD], "looks inside the zip once");
    assert.deepEqual(calls.releases, []);
    const [b] = records.get(A).briefcases;
    assert.equal(b.tier, "enclave-only");
    assert.equal(b.pushed, undefined);
});

test("retries a failed delivery", async () => {
    const { exporter, records, calls, scheduled, fail, advance } =
        make_exporter({
            /* Separate objects: a clone keeps shared references. */
            entries: { [A]: tiered, [B]: structuredClone(tiered) },
            fail: new Set([A]) });
    exporter.update(work({ push: [A, B] }));
    await exporter.pass();

    assert.equal(records.get(A).briefcases[0].pushed, undefined);
    assert.equal(records.get(B).briefcases[0].pushed, NOW,
        "a failure doesn't stop the others");
    assert.deepEqual(scheduled, [300_000]);

    /* Too soon to try again. */
    fail.clear();
    advance(299_999);
    await exporter.pass();
    assert.deepEqual(calls.releases, [{ ds: B, uuid: OLD }]);

    advance(1);
    await exporter.pass();
    assert.ok(records.get(A).briefcases[0].pushed);
});

test("sends a withdrawal for each briefcase the platform holds", async () => {
    const withdrawn = "2026-10-29T13:00:00Z";
    const NEW = "1c6f4b63-8052-4d3f-b9e7-7ba0f4e3e2d1";
    const { exporter, records, calls } = make_exporter({ entries: { [A]: {
        briefcases: [
            /* Never delivered, so there is nothing to withdraw. */
            { ...briefcase, uuid: "2d705c74-9163-4e40-8af8-8cb105f4f3e2", withdrawn },
            { ...briefcase, withdrawn, pushed: "t" },
            { ...briefcase, uuid: NEW, replaces: OLD, pushed: "t" },
        ] } } });
    exporter.update(work({ notify: [A] }));
    await exporter.pass();
    await exporter.pass();

    assert.deepEqual(calls.notices, [{ ds: A, uuid: OLD }]);
    const [never, old, now] = records.get(A).briefcases;
    assert.equal(never.withdrawal_pushed, undefined);
    assert.equal(old.withdrawal_pushed, NOW);
    assert.equal(now.withdrawal_pushed, undefined);
});

test("retries a failed withdrawal notice", async () => {
    const withdrawn = "2026-10-29T13:00:00Z";
    const { exporter, records, scheduled, fail, advance } = make_exporter({
        entries: { [A]: { briefcases: [{ ...briefcase, withdrawn, pushed: "t" }] } },
        fail: new Set([A]) });
    exporter.update(work({ notify: [A] }));
    await exporter.pass();
    assert.deepEqual(scheduled, [300_000]);
    assert.equal(records.get(A).briefcases[0].withdrawal_pushed, undefined);

    fail.clear();
    advance(300_000);
    await exporter.pass();
    assert.ok(records.get(A).briefcases[0].withdrawal_pushed);
});

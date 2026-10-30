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

const work = ({ build = [], withdraw = [] }) =>
    imm.Map({ build: imm.Set(build), withdraw: imm.Set(withdraw) });

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

test("emits a plan only when the work changes", () => {
    const published = new rx.Subject();
    const releases = new rx.Subject();
    const fplus = {
        debug: { bound: () => () => {} },
        ConfigDB: {
            watch_members: klass => {
                assert.equal(klass, Class.Published);
                return published;
            },
            search_app: app => {
                assert.equal(app, App.BriefcaseRelease);
                return releases;
            },
        },
    };
    const seen = [];
    new Exporter({ fplus }).plans().subscribe(p => seen.push(plain(p)));

    published.next(imm.Set([A]));
    assert.equal(seen.length, 0, "waits for the release entries");

    releases.next(imm.Map());
    /* An unrelated release entry changes nothing. */
    releases.next(imm.Map({ [C]: gone }));
    published.next(imm.Set([A, B]));
    releases.next(imm.Map({ [A]: live, [C]: gone }));

    assert.deepEqual(seen, [
        { build: [A], withdraw: [] },
        { build: [A, B], withdraw: [] },
        { build: [B], withdraw: [] },
    ]);
});

/* An Exporter with an in-memory store and a fake builder. Builds of the
 * datasets in `fail` throw until they are taken out of it. */
function make_exporter ({ entries = {}, fail = new Set() } = {}) {
    const records = new Map(Object.entries(structuredClone(entries)));
    const calls = { builds: [], uploads: [], withdrawals: [] };
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
    };
    const builder = {
        build: async (ds, opts) => {
            calls.builds.push({ ds, ...opts });
            if (fail.has(ds)) throw new Error("no data");
            return { file: `${opts.briefcase}.zip`, sha256: "b".repeat(64),
                size: 10, built: "2026-10-30T09:00:00.000Z" };
        },
    };
    const exporter = new Exporter({
        fplus: { debug: { bound: () => () => {} }, ConfigDB: {} },
        builder, store,
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
        built: "2026-10-30T09:00:00.000Z", exporter: "test",
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

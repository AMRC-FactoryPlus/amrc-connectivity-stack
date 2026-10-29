/*
 * ACS Briefcase exporter
 * Tests for working out what to build and withdraw
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

const live = { briefcase: A, versions: [] };
const gone = { ...live, withdrawn: "2026-10-29T12:00:00Z" };

/* A plan as plain arrays, for comparing. */
const plain = p => ({
    build:      p.get("build").toArray().sort(),
    withdraw:   p.get("withdraw").toArray().sort(),
});

test("builds Published datasets with no release", () => {
    const p = plan(imm.Set([A, B]), imm.Map({ [A]: live }));
    assert.deepEqual(plain(p), { build: [B], withdraw: [] });
});

test("builds a dataset Published again after a withdrawal", () => {
    const p = plan(imm.Set([A]), imm.Map({ [A]: gone }));
    assert.deepEqual(plain(p), { build: [A], withdraw: [] });
});

test("withdraws a live release whose dataset is not Published", () => {
    const p = plan(imm.Set(), imm.Map({ [A]: live, [B]: gone }));
    assert.deepEqual(plain(p), { build: [], withdraw: [A] });
});

test("does nothing when every Published dataset is released", () => {
    const p = plan(imm.Set([A]), imm.Map({ [A]: live }));
    assert.deepEqual(plain(p), { build: [], withdraw: [] });
});

/* An Exporter reading from Subjects in place of ConfigDB. */
function make_exporter () {
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
    return { exporter: new Exporter({ fplus }), published, releases };
}

test("emits a plan only when the work changes", () => {
    const { exporter, published, releases } = make_exporter();
    const seen = [];
    exporter.plans().subscribe(p => seen.push(plain(p)));

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

/* An Exporter whose builder records the datasets it is asked for. A
 * build of `fail` throws. */
function make_builder_exporter (fail) {
    const calls = [];
    let running = 0;
    const builder = {
        build: async ds => {
            assert.equal(running++, 0, "builds run one at a time");
            calls.push(ds);
            await new Promise(r => setTimeout(r, 5));
            running--;
            if (ds == fail) throw new Error("no data");
            return { file: `${ds}.zip`, sha256: "x" };
        },
    };
    const fplus = { debug: { bound: () => () => {} }, ConfigDB: {} };
    return { exporter: new Exporter({ fplus, builder }), calls };
}

const work = (...build) => imm.Map({ build: imm.Set(build), withdraw: imm.Set() });

test("builds each dataset once, one at a time", async () => {
    const { exporter, calls } = make_builder_exporter();
    const results = await rx.firstValueFrom(exporter.builds(rx.of(
        work(A, B),
        work(A, B, C),
        work(C),
    )).pipe(rx.toArray()));

    assert.deepEqual(calls, [A, B, C]);
    assert.equal(results.length, 3);
});

test("a failed build does not stop the others", async () => {
    const { exporter, calls } = make_builder_exporter(A);
    const results = await rx.firstValueFrom(
        exporter.builds(rx.of(work(A, B))).pipe(rx.toArray()));

    assert.deepEqual(calls, [A, B]);
    assert.deepEqual(results.map(r => r?.file ?? null), [null, `${B}.zip`]);
});

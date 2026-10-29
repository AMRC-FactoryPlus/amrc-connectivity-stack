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

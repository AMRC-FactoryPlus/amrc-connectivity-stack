/*
 * ACS Data Access Service
 * Unit tests: the parts of each dataset, one change at a time
 * Copyright 2026 University of Sheffield
 */

/* A dataset's parts are its subclasses that are Dataset members. The
 * old code worked the whole map out again on every change, and held
 * one ConfigDB WATCH per dataset to answer for one. These tests hold
 * PartsIndex and DataFlow's parts streams to the old formula
 * (reference_parts, a copy of it), and count what each change costs.
 * They run against fakes, so they need no cluster. */

import { Map as IMap, Set as ISet, is as imm_is } from "immutable";
import * as rx from "rxjs";
import { afterEach, describe, expect, test } from "vitest";

import { DataAccess as Constants } from "../../lib/constants.js";
import { DataFlow } from "../../lib/dataflow.js";
import { PartsIndex } from "../../lib/parts-index.js";
import { ROOT, make_site } from "../support/fake-site.js";
import { reference_parts } from "../support/reference-datasets.js";
import { PRINCIPALS, build_site, prng } from "../support/site-builder.js";

const { Class, Perm } = Constants;

const debug = { bound: () => () => {} };

const uuid = n => `9a570000-0aaa-4000-8000-${n.toString(16).padStart(12, "0")}`;
const sorted = list => [...list].sort();

const cleanup = [];

afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn();
});

/* A PartsIndex and the state it should mirror. The drivers send the
 * index the events watch_each sends: the member Set first, then the
 * subclass Set of each member that joined. */
function model () {
    const index = new PartsIndex();
    const members = new Set();
    /* UUID -> array of subclasses, for members and for others. */
    const subclasses = new Map();
    let started = false;

    const subs_of = id => ISet(subclasses.get(id) ?? []);
    const set_event = (added, removed) =>
        index.apply({ set: new Set(members), added, removed });

    return {
        index, members, subclasses,

        /* The first Set, then every member's answer. Returns the
         * result of each call. */
        start (ids = []) {
            started = true;
            for (const id of ids) members.add(id);
            return [
                set_event([...members], []),
                ...[...members].map(id =>
                    index.apply({ key: id, value: subs_of(id) })),
            ];
        },

        /* A member joins. Returns the result of the Set and of the
         * member's answer. */
        add (id) {
            members.add(id);
            return [
                set_event([id], []),
                index.apply({ key: id, value: subs_of(id) }),
            ];
        },

        /* A member joins and has not answered yet. */
        add_unanswered (id) {
            members.add(id);
            return set_event([id], []);
        },

        answer (id) {
            return index.apply({ key: id, value: subs_of(id) });
        },

        remove (id) {
            members.delete(id);
            return set_event([], [id]);
        },

        /* A new subclass list. ConfigDB tells only the watchers of a
         * member. */
        set_subclasses (id, list) {
            subclasses.set(id, list);
            if (!started || !members.has(id)) return null;
            return index.apply({ key: id, value: subs_of(id) });
        },

        /* The old formula on the same state. */
        reference () {
            const member_set = ISet(members);
            return reference_parts(
                IMap([...members].map(id => [id, subs_of(id)])),
                member_set);
        },

        /* `parents` worked out from nothing. */
        reference_parents () {
            const parents = new Map();
            for (const id of members) {
                for (const part of subclasses.get(id) ?? []) {
                    if (!parents.has(part)) parents.set(part, new Set());
                    parents.get(part).add(id);
                }
            }
            return parents;
        },
    };
}

const plain = map => Object.fromEntries(
    sorted(map.keys()).map(key => [key, sorted(map.get(key))]));

/* The keys whose entry is not the same in two maps, by value. */
function differing (before, after) {
    const keys = new Set([...before.keys(), ...after.keys()]);
    return sorted([...keys].filter(key =>
        !(before.has(key) && after.has(key)
            && imm_is(before.get(key), after.get(key)))));
}

const [A, B, C, D, X] = [1, 2, 3, 4, 5].map(uuid);

describe("PartsIndex readiness", () => {
    test("gives nothing until the members are known and every member has answered", () => {
        const m = model();
        m.subclasses.set(A, [B]);
        const [set, first, second] = m.start([A, B]);

        expect(set).toBeNull();
        expect(first).toBeNull();
        expect(second.changed).toBeNull();
        expect(plain(second.map)).toEqual({ [A]: [B], [B]: [] });
    });

    test("gives an empty map for an empty member Set, at once", () => {
        const m = model();
        const [set] = m.start([]);
        expect(set.changed).toBeNull();
        expect(set.map.size).toBe(0);
        expect(set.parents.size).toBe(0);
    });

    test("ignores an answer before the first Set", () => {
        const index = new PartsIndex();
        expect(index.apply({ key: A, value: ISet([B]) })).toBeNull();
        const result = index.apply({ set: new Set(), added: [], removed: [] });
        expect(result.map.size).toBe(0);
        expect(result.parents.size).toBe(0);
    });

    test("holds while a new member has not answered, then reports what gathered", () => {
        const m = model();
        m.subclasses.set(A, [X]);
        m.subclasses.set(X, [B]);
        m.start([A, B]);

        /* X joins: A's entry gains it, but nothing goes out until X's
         * own subclasses are known. */
        expect(m.add_unanswered(X)).toBeNull();
        /* Another member changes meanwhile. */
        expect(m.set_subclasses(B, [A])).toBeNull();

        const result = m.answer(X);
        expect(sorted(result.changed)).toEqual(sorted([A, B, X]));
        expect(plain(result.map)).toEqual({ [A]: [X], [B]: [A], [X]: [B] });
    });

    test("a member that joins and leaves before it answers changes nothing", () => {
        const m = model();
        m.subclasses.set(A, [X]);
        const before = m.start([A, B]).at(-1).map;

        expect(m.add_unanswered(X)).toBeNull();
        /* A gained X and lost it again: nothing to report. */
        expect(m.remove(X)).toBeNull();
        expect(m.index.map).toBe(before);
        expect(m.index.raw.has(X)).toBe(false);

        /* The next change reports itself alone. */
        const result = m.set_subclasses(A, [X, B]);
        expect(sorted(result.changed)).toEqual([A]);
        expect(plain(result.map)).toEqual({ [A]: [B], [B]: [] });
        expect(result.map.get(B)).toBe(before.get(B));
    });

    test("an answer from a UUID that is no member is ignored", () => {
        const m = model();
        m.start([A]);
        expect(m.index.apply({ key: X, value: ISet([A]) })).toBeNull();
        expect(m.index.parents.size).toBe(0);
        expect(m.index.raw.has(X)).toBe(false);
    });
});

describe("PartsIndex changes", () => {
    test("a part becomes a member while its parent's subclass list stays the same", () => {
        const m = model();
        m.subclasses.set(A, [B, X]);
        const [, , last] = m.start([A, B]);
        expect(plain(last.map)).toEqual({ [A]: [B], [B]: [] });
        /* The index knows A lists X before X is a member. */
        expect(sorted(last.parents.get(X))).toEqual([A]);

        const [held, result] = m.add(X);
        expect(held).toBeNull();
        expect(sorted(result.changed)).toEqual(sorted([A, X]));
        expect(plain(result.map)).toEqual({ [A]: [B, X], [B]: [], [X]: [] });
        /* B was not touched. */
        expect(result.map.get(B)).toBe(last.map.get(B));
    });

    test("a part stops being a member, and its parent's entry loses it", () => {
        const m = model();
        m.subclasses.set(A, [B, X]);
        const [, , , last] = m.start([A, B, X]);
        expect(plain(last.map)).toEqual({ [A]: [B, X], [B]: [], [X]: [] });

        const result = m.remove(X);
        expect(sorted(result.changed)).toEqual(sorted([A, X]));
        expect(plain(result.map)).toEqual({ [A]: [B], [B]: [] });
        expect(result.map.get(B)).toBe(last.map.get(B));
        /* A still lists X, so X coming back is noticed. */
        expect(sorted(result.parents.get(X))).toEqual([A]);
    });

    test("a member change marks only that member and the datasets that list it", () => {
        const m = model();
        m.subclasses.set(A, [X]);
        m.subclasses.set(B, [X, C]);
        m.subclasses.set(C, [D]);
        const results = m.start([A, B, C, D]);
        const before = results.at(-1).map;

        const [, result] = m.add(X);
        expect(sorted(result.changed)).toEqual(sorted([A, B, X]));
        for (const id of [C, D])
            expect(result.map.get(id)).toBe(before.get(id));
    });

    test("removing a member removes its entry and its links as a parent", () => {
        const m = model();
        m.subclasses.set(A, [B, C]);
        m.subclasses.set(D, [C]);
        m.start([A, B, C, D]);
        expect(sorted(m.index.parents.get(C))).toEqual(sorted([A, D]));
        expect(sorted(m.index.parents.get(B))).toEqual([A]);

        const result = m.remove(A);
        expect(sorted(result.changed)).toEqual([A]);
        expect(result.map.has(A)).toBe(false);
        expect(m.index.raw.has(A)).toBe(false);
        expect(sorted(result.parents.get(C))).toEqual([D]);
        /* Nothing lists B any more, so its key is gone too. */
        expect(result.parents.has(B)).toBe(false);
    });

    test("a member with no subclasses has an empty entry", () => {
        const m = model();
        const [, result] = m.start([A]);
        expect(result.map.has(A)).toBe(true);
        expect(result.map.get(A).size).toBe(0);
    });

    test("a new subclass list changes that one entry", () => {
        const m = model();
        m.subclasses.set(A, [B]);
        const results = m.start([A, B, C]);
        const before = results.at(-1).map;

        const result = m.set_subclasses(A, [B, C]);
        expect(sorted(result.changed)).toEqual([A]);
        expect(plain(result.map)).toEqual({ [A]: [B, C], [B]: [], [C]: [] });
        expect(result.map.get(B)).toBe(before.get(B));
        expect(sorted(result.parents.get(C))).toEqual([A]);

        const less = m.set_subclasses(A, [C]);
        expect(plain(less.map)[A]).toEqual([C]);
        expect(less.parents.has(B)).toBe(false);
    });

    test("a subclass list that changes only in non-members changes no entry", () => {
        const m = model();
        m.subclasses.set(A, [B]);
        m.start([A, B]);

        /* X is no member, so A's parts are the same. */
        expect(m.set_subclasses(A, [B, X])).toBeNull();
        /* The link is kept all the same. */
        expect(sorted(m.index.parents.get(X))).toEqual([A]);
    });

    test("the same Set or the same subclass list again changes nothing", () => {
        const m = model();
        m.subclasses.set(A, [B]);
        m.start([A, B]);

        expect(m.index.apply({ set: new Set([A, B]), added: [], removed: [] }))
            .toBeNull();
        expect(m.index.apply({ key: A, value: ISet([B]) })).toBeNull();
    });

    test("the parts keep the order ConfigDB listed the subclasses in", () => {
        const m = model();
        const listed = [D, X, B, C];
        m.subclasses.set(A, listed);
        m.start([A, B, C]);

        m.add(X);
        m.add(D);
        const want = ISet(listed).filter(id => m.members.has(id));
        expect([...m.index.map.get(A)]).toEqual([...want]);
        expect([...m.index.map.get(A)]).toEqual(listed);
    });

    test("takes a native Set of subclasses", () => {
        const index = new PartsIndex();
        index.apply({ set: new Set([A, B]), added: [A, B], removed: [] });
        index.apply({ key: A, value: new Set([B, X]) });
        const result = index.apply({ key: B, value: new Set() });
        expect(ISet.isSet(result.map.get(A))).toBe(true);
        expect(plain(result.map)).toEqual({ [A]: [B], [B]: [] });
    });
});

describe("PartsIndex against the old formula", () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    test.each(seeds)("seed %i: after every step of a random walk the map equals the old formula", seed => {
        const rand = prng(seed);
        const int = n => Math.floor(rand() * n);
        const universe = Array.from({ length: 24 }, (_, i) => uuid(0x100 + i));
        const pick = () => universe[int(universe.length)];
        const some = () => {
            const list = [];
            for (let i = int(5); i > 0; i--) {
                const id = pick();
                if (!list.includes(id)) list.push(id);
            }
            return list;
        };

        const m = model();
        for (const id of universe)
            if (rand() < 0.5) m.subclasses.set(id, some());
        const results = m.start(universe.filter(() => rand() < 0.5));
        let held = results.at(-1).map;
        expect(imm_is(held, m.reference())).toBe(true);

        for (let step = 0; step < 400; step++) {
            const id = pick();
            const roll = rand();
            let result;
            let what;
            if (roll < 0.35) {
                what = "subclasses";
                result = m.set_subclasses(id, some());
            }
            else if (m.members.has(id)) {
                what = "remove";
                result = m.remove(id);
            }
            else {
                what = "add";
                result = m.add(id).at(-1);
            }

            const at = `seed ${seed} step ${step} (${what} ${id})`;
            const want = m.reference();
            const got = m.index.map;
            expect([at, plain(got)]).toEqual([at, plain(want)]);
            expect([at, imm_is(got, want)]).toEqual([at, true]);

            /* `changed` names exactly the entries that differ, and
             * every other entry is the same object as before. */
            const changed = differing(held, got);
            expect([at, result == null ? [] : sorted(result.changed)])
                .toEqual([at, changed]);
            if (result != null) expect(result.map).toBe(got);
            for (const [key, value] of got)
                if (!changed.includes(key)) expect(value).toBe(held.get(key));
            held = got;

            const parents = m.reference_parents();
            expect([at, plain(m.index.parents)]).toEqual([at, plain(parents)]);
            expect(sorted(m.index.members)).toEqual(sorted(m.members));
            expect(sorted(m.index.raw.keys())).toEqual(sorted(m.members));
        }
    });
});

/* The site's ConfigDB with every subclass watch counted while it is
 * open. The fake site keeps a WATCH it has opened, as the library does
 * for a while, so it cannot show that a caller let one go. `live` maps
 * a class to the number of subscriptions open on it. */
function tracking (site) {
    const live = new Map();
    const cdb = {
        ...site.cdb,
        watch_subclasses: klass => new rx.Observable(subscriber => {
            live.set(klass, (live.get(klass) ?? 0) + 1);
            const sub = site.cdb.watch_subclasses(klass).subscribe(subscriber);
            return () => {
                sub.unsubscribe();
                if (live.get(klass) == 1) live.delete(klass);
                else live.set(klass, live.get(klass) - 1);
            };
        }),
    };
    return { cdb, live };
}

/* A built site with a DataFlow over it. */
function fixture (opts) {
    const site = make_site();
    const built = build_site(site, opts);
    const { cdb, live } = tracking(site);
    const data = new DataFlow({ debug, cdb, auth: site.auth });
    data.run();
    cleanup.push(() => {
        data.stop();
        site.close();
    });
    return { site, built, data, live };
}

/* Record every value and error of a sequence. */
function record (seq) {
    const seen = { values: [], errors: [] };
    const sub = seq.subscribe({
        next:   v => seen.values.push(v),
        error:  e => seen.errors.push(e),
    });
    cleanup.push(() => sub.unsubscribe());
    return seen;
}

/* The old formula on the site's state. */
function site_parts (site) {
    const members = ISet(site.members(Class.Dataset));
    return reference_parts(
        IMap([...members].map(m => [m, ISet(site.subclasses(m))])),
        members);
}

describe("DataFlow.parts", () => {
    test("run() does not watch the parts", async () => {
        const { site } = fixture({ datasets: 60, seed: 71 });
        await site.settle();
        expect(site.counters.watch.subclass.total()).toBe(0);
        expect(site.counters.opened.subclass.total()).toBe(0);
    });

    test("equals the old formula after every step of a random walk", async () => {
        const { site, built, data } = fixture({ datasets: 60, seed: 72 });
        const seen = record(data.parts);
        expect(imm_is(seen.values.at(-1), site_parts(site))).toBe(true);
        expect(seen.values).toHaveLength(1);

        const rand = prng(72);
        const int = n => Math.floor(rand() * n);
        const universe = [
            ...built.datasets,
            ...Array.from({ length: 8 }, (_, i) => built.spare(i)),
        ];
        const pick = () => universe[int(universe.length)];

        for (let step = 0; step < 300; step++) {
            const id = pick();
            const roll = rand();
            const before = seen.values.length;
            const was = site_parts(site);
            if (roll < 0.4) {
                const list = new Set();
                for (let i = int(4); i > 0; i--) list.add(pick());
                site.set_subclasses(id, list);
            }
            else if (site.members(Class.Dataset).has(id)) {
                site.remove_member(Class.Dataset, id);
            }
            else {
                site.add_member(Class.Dataset, id);
            }

            const want = site_parts(site);
            const at = `step ${step}`;
            expect([at, imm_is(seen.values.at(-1), want)]).toEqual([at, true]);
            /* One value for a change, none for no change. */
            expect([at, seen.values.length - before])
                .toEqual([at, imm_is(was, want) ? 0 : 1]);
        }
        expect(seen.errors).toEqual([]);
    });

    test.each([250, 1000])("adding one member to %i opens one subclass watch and looks at every member once", async n => {
        const { site, built, data, live } = fixture({ datasets: n, seed: 73 });
        const changes = record(data.parts_changes);
        const members = site.members(Class.Dataset).size;
        expect(members).toBeGreaterThan(n - 10);
        expect(changes.values).toHaveLength(1);
        expect(changes.values[0].changed).toBeNull();
        expect(changes.values[0].map.size).toBe(members);
        expect(site.counters.watch.subclass.total()).toBe(members);
        expect(data.parts_stats.scanned).toBe(members);

        /* The part the site builder left outside the Dataset members:
         * its parent lists it already. */
        const { part_parent, part_pending } = built.named;
        expect(changes.values[0].map.get(part_parent).has(part_pending)).toBe(false);
        /* It, and the datasets that list it, are all that change. */
        const touched = sorted([part_pending,
            ...[...site.members(Class.Dataset)]
                .filter(m => site.subclasses(m).has(part_pending))]);
        expect(touched).toContain(part_parent);
        expect(touched.length).toBeLessThan(10);
        expect(live.size).toBe(members);

        site.reset_counters();
        const scanned = data.parts_stats.scanned;
        site.add_member(Class.Dataset, part_pending);

        /* One new watch, on the new member, and no other. */
        expect([...site.counters.watch.subclass]).toEqual([[part_pending, 1]]);
        expect([...site.counters.opened.subclass]).toEqual([[part_pending, 1]]);
        expect(site.counters.watch.member.total()).toBe(0);
        /* The one pass that stays: the member list ConfigDB sent. */
        expect(data.parts_stats.scanned - scanned).toBe(members + 1);

        expect(changes.values).toHaveLength(2);
        expect(sorted(changes.values[1].changed)).toEqual(touched);
        expect(changes.values[1].map.get(part_parent).has(part_pending)).toBe(true);
        expect(imm_is(changes.values[1].map, site_parts(site))).toBe(true);
        expect(live.size).toBe(members + 1);
        expect(live.get(part_pending)).toBe(1);

        /* Every other entry is the same object. */
        const untouched = [...changes.values[0].map.keys()]
            .filter(id => !touched.includes(id));
        expect(untouched).toHaveLength(members + 1 - touched.length);
        for (const id of untouched)
            expect(changes.values[1].map.get(id)).toBe(changes.values[0].map.get(id));

        /* A member that leaves costs the same pass and no new watch. */
        site.reset_counters();
        site.remove_member(Class.Dataset, part_pending);
        expect(site.counters.watch.subclass.total()).toBe(0);
        expect(data.parts_stats.scanned - scanned).toBe(2 * members + 1);
        expect(sorted(changes.values[2].changed)).toEqual(touched);
        /* Its watch is let go, and no other. */
        expect(live.has(part_pending)).toBe(false);
        expect(live.size).toBe(members);
    });

    test("a subclass change on one member looks at no other", async () => {
        const { site, built, data } = fixture({ datasets: 250, seed: 74 });
        const changes = record(data.parts_changes);
        const scanned = data.parts_stats.scanned;
        site.reset_counters();

        const parent = built.kinds.sparkplug[1];
        const part = built.kinds.subset[0];
        site.set_subclasses(parent, [part]);

        expect(data.parts_stats.scanned).toBe(scanned);
        expect(site.counters.watch.subclass.total()).toBe(0);
        expect(sorted(changes.values.at(-1).changed)).toEqual([parent]);
        expect([...changes.values.at(-1).map.get(parent)]).toEqual([part]);
    });

    test("waits for a new member's subclasses before it says anything", async () => {
        const { site, built, data } = fixture({ datasets: 60, seed: 75 });
        const seen = record(data.parts);
        const { part_parent, part_pending } = built.named;

        site.hold("subclass", part_pending);
        site.add_member(Class.Dataset, part_pending);
        expect(seen.values).toHaveLength(1);

        site.release("subclass", part_pending);
        expect(seen.values).toHaveLength(2);
        expect(seen.values[1].has(part_pending)).toBe(true);
        expect(seen.values[1].get(part_parent).has(part_pending)).toBe(true);
    });

    test("answers nothing while one member's subclasses have not answered", async () => {
        const { site, built, data } = fixture({ datasets: 60, seed: 76 });
        const slow = built.kinds.sparkplug[1];
        site.hold("subclass", slow);
        const seen = record(data.parts);
        expect(seen.values).toEqual([]);

        site.release("subclass", slow);
        expect(seen.values).toHaveLength(1);
        expect(imm_is(seen.values[0], site_parts(site))).toBe(true);
    });

    test("a subclass watch that fails errors the parts, and the next reader starts again", async () => {
        const { site, built, data } = fixture({ datasets: 60, seed: 77 });
        const seen = record(data.parts);
        expect(seen.values).toHaveLength(1);

        site.error("subclass", built.kinds.sparkplug[0], new Error("gone"));
        expect(seen.errors.map(e => e.message)).toEqual(["gone"]);

        const again = await rx.firstValueFrom(data.parts);
        expect(imm_is(again, site_parts(site))).toBe(true);
    });

    test("a late reader gets the whole map, with changed: null first for its own index", async () => {
        const { site, built, data } = fixture({ datasets: 60, seed: 78 });
        const first = record(data.parts_changes);
        site.set_subclasses(built.kinds.sparkplug[1], [built.kinds.subset[0]]);
        expect(first.values.at(-1).changed).not.toBeNull();

        /* The value replayed names one key. A reader that joins late
         * must still count every key as changed; the map is whole. */
        const late = await rx.firstValueFrom(data.parts_changes);
        expect(late).toBe(first.values.at(-1));
        expect(imm_is(late.map, site_parts(site))).toBe(true);
    });

    test("does not use watch_members_subclasses", async () => {
        const site = make_site();
        build_site(site, { datasets: 20, seed: 79 });
        const cdb = {
            ...site.cdb,
            watch_members_subclasses () {
                throw new Error("watch_members_subclasses was called");
            },
        };
        const data = new DataFlow({ debug, cdb, auth: site.auth });
        cleanup.push(() => site.close());

        const parts = await rx.firstValueFrom(data.parts);
        expect(imm_is(parts, site_parts(site))).toBe(true);
        const one = await rx.firstValueFrom(data.allowed_dataset_parts(
            [...site.members(Class.Dataset)][0], ROOT, Perm.ReadDataset));
        expect(ISet.isSet(one)).toBe(true);
    });
});

describe("DataFlow.dataset_parts", () => {
    /* A small site: PARENT lists CHILD, LATER and a UUID that is no
     * dataset. LATER is not a Dataset member yet. */
    const [PARENT, CHILD, LATER, OTHER, STRANGER] = [0x10, 0x11, 0x12, 0x13, 0x14].map(uuid);

    function small () {
        const site = make_site();
        for (const id of [PARENT, CHILD, OTHER])
            site.add_member(Class.Dataset, id);
        site.set_subclasses(PARENT, [CHILD, LATER, STRANGER]);
        const { cdb, live } = tracking(site);
        const data = new DataFlow({ debug, cdb, auth: site.auth });
        cleanup.push(() => site.close());
        site.set_acl("reader@EXAMPLE.ORG", [
            { permission: Perm.ReadDataset, target: PARENT },
            { permission: Perm.ReadDataset, target: LATER },
        ]);
        return { site, data, live };
    }

    test("gives null for a UUID that is no Dataset member, and opens no subclass watch", () => {
        const { site, data } = small();
        const seen = record(data.dataset_parts(LATER));
        expect(seen.values).toEqual([null]);
        expect(site.counters.watch.subclass.total()).toBe(0);
        expect(site.counters.opened.subclass.total()).toBe(0);
    });

    test("gives an empty Set for a member with no subclasses", () => {
        const { site, data } = small();
        const seen = record(data.dataset_parts(OTHER));
        expect(seen.values).toHaveLength(1);
        expect(ISet.isSet(seen.values[0])).toBe(true);
        expect(seen.values[0].size).toBe(0);
        expect([...site.counters.watch.subclass]).toEqual([[OTHER, 1]]);
    });

    test("gives the subclasses that are Dataset members, with one subclass watch", () => {
        const { site, data } = small();
        const seen = record(data.dataset_parts(PARENT));
        expect(seen.values.map(v => [...v])).toEqual([[CHILD]]);
        expect([...site.counters.watch.subclass]).toEqual([[PARENT, 1]]);
        expect([...site.counters.opened.subclass]).toEqual([[PARENT, 1]]);
    });

    test("follows a part that becomes a member, and one that leaves", () => {
        const { site, data } = small();
        const seen = record(data.dataset_parts(PARENT));

        site.add_member(Class.Dataset, LATER);
        expect(sorted(seen.values.at(-1))).toEqual(sorted([CHILD, LATER]));
        site.remove_member(Class.Dataset, CHILD);
        expect([...seen.values.at(-1)]).toEqual([LATER]);
        expect(seen.values).toHaveLength(3);
        /* Still the one watch. */
        expect([...site.counters.watch.subclass]).toEqual([[PARENT, 1]]);
    });

    test("follows the dataset's own subclass list", () => {
        const { site, data } = small();
        const seen = record(data.dataset_parts(PARENT));
        site.set_subclasses(PARENT, [OTHER, STRANGER]);
        expect(seen.values.map(v => [...v])).toEqual([[CHILD], [OTHER]]);
    });

    test("says nothing for a change that leaves its parts the same", () => {
        const { site, data } = small();
        const seen = record(data.dataset_parts(PARENT));

        site.add_member(Class.Dataset, uuid(0x20));
        site.set_subclasses(OTHER, [CHILD]);
        site.set_subclasses(PARENT, [CHILD, LATER]);
        expect(seen.values).toHaveLength(1);
    });

    test("goes to null when the dataset leaves the members, and back", () => {
        const { site, data, live } = small();
        const seen = record(data.dataset_parts(PARENT));
        expect([...live]).toEqual([[PARENT, 1]]);

        site.remove_member(Class.Dataset, PARENT);
        expect(seen.values.at(-1)).toBeNull();
        /* The subclass watch is let go. */
        expect(live.size).toBe(0);

        site.add_member(Class.Dataset, PARENT);
        expect([...seen.values.at(-1)]).toEqual([CHILD]);
        expect(seen.values).toHaveLength(3);
        expect([...live]).toEqual([[PARENT, 1]]);
    });

    test("opens its watch when a UUID becomes a member", () => {
        const { site, data } = small();
        site.set_subclasses(LATER, [CHILD]);
        const seen = record(data.dataset_parts(LATER));
        expect(site.counters.watch.subclass.total()).toBe(0);

        site.add_member(Class.Dataset, LATER);
        expect(seen.values.map(v => v && [...v])).toEqual([null, [CHILD]]);
        expect([...site.counters.watch.subclass]).toEqual([[LATER, 1]]);
    });

    test("waits for the member list, and then for the subclass list", () => {
        const { site, data } = small();
        site.hold("member", Class.Dataset);
        site.hold("subclass", PARENT);
        /* A fresh member watch, so the hold applies. */
        site.shared.member.delete(Class.Dataset);
        const seen = record(data.dataset_parts(PARENT));
        expect(seen.values).toEqual([]);

        site.release("member", Class.Dataset);
        expect(seen.values).toEqual([]);
        site.release("subclass", PARENT);
        expect(seen.values.map(v => [...v])).toEqual([[CHILD]]);
    });

    test("answers over sources that complete", async () => {
        /* Root's check still reads the default devices, so the
         * dataset map has to answer: with no structure application it
         * is empty. */
        const cdb = {
            watch_members: klass => rx.of(ISet(
                klass == Class.Dataset ? [PARENT, CHILD] : [])),
            watch_subclasses: () => rx.of(ISet([CHILD, LATER])),
        };
        const data = new DataFlow({ debug, cdb, auth: { root_principal: ROOT } });

        expect([...await rx.firstValueFrom(data.dataset_parts(PARENT))])
            .toEqual([CHILD]);
        expect(await rx.firstValueFrom(data.dataset_parts(LATER))).toBeNull();
        expect([...await rx.lastValueFrom(
            data.allowed_dataset_parts(PARENT, ROOT, Perm.ReadDataset))])
            .toEqual([CHILD]);
        expect((await rx.firstValueFrom(data.parts)).toJS())
            .toEqual({ [PARENT]: [CHILD], [CHILD]: [CHILD] });
    });

    test("dataset_parts_changes gives the one entry in the shape of parts_changes", () => {
        const { site, data } = small();
        const seen = record(data.dataset_parts_changes(PARENT));

        expect(seen.values).toHaveLength(1);
        expect(Object.keys(seen.values[0])).toEqual(["map", "changed", "parents"]);
        expect(seen.values[0].map.toJS()).toEqual({ [PARENT]: [CHILD] });
        expect(seen.values[0].changed).toEqual(new Set([PARENT]));
        expect(seen.values[0].parents).toEqual(new Map([[CHILD, new Set([PARENT])]]));

        site.add_member(Class.Dataset, LATER);
        expect(plain(seen.values[1].map)).toEqual({ [PARENT]: sorted([CHILD, LATER]) });
        expect(seen.values[1].changed).toEqual(new Set([PARENT]));
        expect(sorted(seen.values[1].parents.keys())).toEqual(sorted([CHILD, LATER]));

        /* No entry while the dataset is not a member. */
        site.remove_member(Class.Dataset, PARENT);
        expect(seen.values[2].map.size).toBe(0);
        expect(seen.values[2].changed).toEqual(new Set([PARENT]));
        expect(seen.values[2].parents.size).toBe(0);
        expect([...site.counters.watch.subclass]).toEqual([[PARENT, 1]]);
    });

    test("dataset_parts_changes for a UUID that is no member opens no subclass watch", () => {
        const { site, data } = small();
        const seen = record(data.dataset_parts_changes(STRANGER));
        expect(seen.values).toHaveLength(1);
        expect(seen.values[0].map.size).toBe(0);
        expect(seen.values[0].changed).toEqual(new Set([STRANGER]));
        expect(site.counters.watch.subclass.total()).toBe(0);
    });

    test("allowed_dataset_parts filters the parts by the reader's grants, with no validity check", () => {
        const { site, data } = small();
        const reader = record(data.allowed_dataset_parts(
            PARENT, "reader@EXAMPLE.ORG", Perm.ReadDataset));
        const root = record(data.allowed_dataset_parts(PARENT, ROOT, Perm.ReadDataset));

        /* CHILD is a part the reader may not read. */
        expect(reader.values.map(v => [...v])).toEqual([[]]);
        expect(root.values.map(v => [...v])).toEqual([[CHILD]]);
        expect(ISet.isSet(reader.values[0])).toBe(true);

        /* LATER has no structure entry, so it is no valid dataset. It
         * is a part as soon as it is a Dataset member. */
        site.add_member(Class.Dataset, LATER);
        expect([...reader.values.at(-1)]).toEqual([LATER]);

        site.grant("reader@EXAMPLE.ORG", Perm.ReadDataset, CHILD);
        expect(sorted(reader.values.at(-1))).toEqual(sorted([CHILD, LATER]));
    });

    test("allowed_dataset_parts gives a plain empty array for a UUID that is no member", () => {
        const { data } = small();
        const seen = record(data.allowed_dataset_parts(STRANGER, ROOT, Perm.ReadDataset));
        expect(seen.values).toEqual([[]]);
        expect(Array.isArray(seen.values[0])).toBe(true);
    });
});

describe("allowed_dataset_parts on a built site", () => {
    test("gives every principal what the old whole-map formula gave", async () => {
        const { site, built, data } = fixture({ datasets: 60, seed: 81 });
        await site.settle();
        const whole = site_parts(site);
        const ids = [...built.datasets, built.spare(1)];
        let with_parts = 0;

        for (const principal of [ROOT, PRINCIPALS.wild, PRINCIPALS.some, PRINCIPALS.none]) {
            const ok = await rx.firstValueFrom(
                data.watch_allowed(principal, Perm.ReadDataset));
            for (const id of ids) {
                /* The body of the old allowed_dataset_parts. */
                const parts = whole.get(id);
                const want = parts ? parts.filter(part => ok(part)) : [];

                const got = await rx.firstValueFrom(
                    data.allowed_dataset_parts(id, principal, Perm.ReadDataset));
                expect([principal, id, ISet.isSet(got)])
                    .toEqual([principal, id, ISet.isSet(want)]);
                expect([principal, id, [...got]]).toEqual([principal, id, [...want]]);
                if (got.size) with_parts++;
            }
        }
        /* The comparison saw parts, and saw some filtered out. */
        expect(with_parts).toBeGreaterThan(0);
        const some_ok = await rx.firstValueFrom(
            data.watch_allowed(PRINCIPALS.some, Perm.ReadDataset));
        expect([...whole.values()].some(parts =>
            parts.some(part => !some_ok(part)))).toBe(true);
    });
});

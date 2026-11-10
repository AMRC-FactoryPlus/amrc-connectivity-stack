/*
 * ACS Data Access Service
 * Unit tests for the per-change application entry maps
 * Copyright 2026 University of Sheffield
 */

/* These are pure: no cluster, no rxjs, no timer. The test plays the
 * part of ConfigDB and hands each class the values the real change
 * sequence would give it. */

import * as imm from "immutable";
import { describe, expect, test } from "vitest";

import { AppConfigs, AppMap } from "../../lib/app-configs.js";

import { reference_group } from "../support/reference-datasets.js";

const APP_A = "a0000000-0000-4000-8000-00000000000a";
const APP_B = "b0000000-0000-4000-8000-00000000000b";
const APP_C = "c0000000-0000-4000-8000-00000000000c";

const obj = n => `0b000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/* A copy with no object in common, as a second read from the wire. */
const clone = value => JSON.parse(JSON.stringify(value));

/** One application as ConfigDB holds it. Each method changes the state
 * and returns the value `search_app_changes` would emit for it. */
class FakeApp {
    constructor (entries = {}) {
        this.map = imm.Map(entries);
    }

    /* A full snapshot. Every body is a new object, as after a
     * reconnect. */
    snapshot () {
        this.map = this.map.map(clone);
        return { map: this.map, child: null, previous: null };
    }

    put (id, config) {
        const previous = this.map;
        this.map = previous.set(id, config);
        return { map: this.map, child: id, previous };
    }

    del (id) {
        const previous = this.map;
        this.map = previous.delete(id);
        return { map: this.map, child: id, previous };
    }

    /* Change the state without a notification, as a change made while
     * the connection was down. */
    lose (fn) {
        this.map = fn(this.map);
    }
}

/* The { set, added, removed } value watch_each gives for a move from
 * one list of applications to another. */
function set_event (before, after) {
    return {
        set:        imm.OrderedSet(after),
        added:      after.filter(a => !before.includes(a)),
        removed:    before.filter(a => !after.includes(a)),
    };
}

/* An AppConfigs fed with the given applications, all answered. */
function ready_configs (apps) {
    const configs = new AppConfigs();
    const ids = [...apps.keys()];
    let result = configs.apply(set_event([], ids));
    for (const [id, app] of apps)
        result = configs.apply({ key: id, value: app.snapshot() });
    return { configs, result };
}

const plain = grouped => grouped.map(inner => inner.toJS()).toJS();

describe("AppMap", () => {
    test("the first value gives the map and marks every key", () => {
        const app = new FakeApp({ [obj(1)]: { n: 1 } });
        const held = new AppMap();
        expect(held.map).toBe(null);

        const result = held.apply(app.snapshot());
        expect(result.changed).toBe(null);
        expect(result.map).toBe(app.map);
        expect(held.map).toBe(app.map);
    });

    test("a first value that is a child update counts as a snapshot", () => {
        const app = new FakeApp({ [obj(1)]: { n: 1 } });
        const held = new AppMap();

        const result = held.apply(app.put(obj(2), { n: 2 }));
        expect(result.changed).toBe(null);
        expect(result.map.toJS()).toEqual({
            [obj(1)]: { n: 1 }, [obj(2)]: { n: 2 } });
    });

    test("a child create, update and delete each mark exactly one key", () => {
        const app = new FakeApp({ [obj(1)]: { n: 1 } });
        const held = new AppMap();
        held.apply(app.snapshot());
        const untouched = held.map.get(obj(1));

        const created = held.apply(app.put(obj(2), { n: 2 }));
        expect([...created.changed]).toEqual([obj(2)]);
        expect(created.map.get(obj(2))).toEqual({ n: 2 });

        const updated = held.apply(app.put(obj(2), { n: 3 }));
        expect([...updated.changed]).toEqual([obj(2)]);
        expect(updated.map.get(obj(2))).toEqual({ n: 3 });

        const deleted = held.apply(app.del(obj(2)));
        expect([...deleted.changed]).toEqual([obj(2)]);
        expect(deleted.map.has(obj(2))).toBe(false);

        expect(held.map.get(obj(1))).toBe(untouched);
        expect(held.map.size).toBe(1);
    });

    test("a no-op delete marks nothing", () => {
        const app = new FakeApp({ [obj(1)]: { n: 1 } });
        const held = new AppMap();
        held.apply(app.snapshot());
        const before = held.map;

        const change = app.del(obj(9));
        expect(change.map).toBe(change.previous);
        expect(held.apply(change)).toBe(null);
        expect(held.map).toBe(before);
    });

    test("a repeated identical value marks nothing and keeps the body", () => {
        const app = new FakeApp({ [obj(1)]: { n: 1, list: [1, 2] } });
        const held = new AppMap();
        held.apply(app.snapshot());
        const body = held.map.get(obj(1));

        expect(held.apply(app.put(obj(1), { list: [1, 2], n: 1 }))).toBe(null);
        expect(held.map.get(obj(1))).toBe(body);
    });

    test("a stored null config is an entry, not a missing one", () => {
        const app = new FakeApp({ [obj(1)]: { n: 1 } });
        const held = new AppMap();
        held.apply(app.snapshot());

        const result = held.apply(app.put(obj(2), null));
        expect([...result.changed]).toEqual([obj(2)]);
        expect(held.map.has(obj(2))).toBe(true);
        expect(held.map.get(obj(2))).toBe(null);

        expect(held.apply(app.put(obj(2), null))).toBe(null);
        expect([...held.apply(app.del(obj(2))).changed]).toEqual([obj(2)]);
    });

    test("a resync with identical content returns null and keeps every body", () => {
        const app = new FakeApp({
            [obj(1)]: { n: 1 }, [obj(2)]: { deep: { list: [1, { x: 2 }] } },
            [obj(3)]: [obj(1), obj(2)],
        });
        const held = new AppMap();
        held.apply(app.snapshot());
        const before = held.map;
        const bodies = new Map(before);

        const resync = app.snapshot();
        /* The resync holds new objects with the same content. */
        expect(resync.map.get(obj(2))).not.toBe(bodies.get(obj(2)));
        expect(held.apply(resync)).toBe(null);

        expect(held.map).toBe(before);
        for (const [id, body] of bodies)
            expect(held.map.get(id)).toBe(body);
    });

    test("a resync that changes 3 entries marks exactly 3", () => {
        const entries = {};
        for (let i = 0; i < 20; i++) entries[obj(i)] = { n: i };
        const app = new FakeApp(entries);
        const held = new AppMap();
        held.apply(app.snapshot());
        const bodies = new Map(held.map);

        app.lose(map => map
            .set(obj(3), { n: "three" })
            .set(obj(7), { n: 7, more: true })
            .set(obj(50), { n: 50 }));
        const result = held.apply(app.snapshot());

        expect([...result.changed].sort())
            .toEqual([obj(3), obj(7), obj(50)].sort());
        expect(result.map).toBe(held.map);
        expect(held.map.toJS()).toEqual(app.map.toJS());
        for (const [id, body] of bodies) {
            if (result.changed.has(id)) continue;
            expect(held.map.get(id)).toBe(body);
        }
    });

    test("a resync that omits 2 keys deletes and marks exactly those 2", () => {
        const entries = {};
        for (let i = 0; i < 20; i++) entries[obj(i)] = { n: i };
        const app = new FakeApp(entries);
        const held = new AppMap();
        held.apply(app.snapshot());
        const bodies = new Map(held.map);

        app.lose(map => map.delete(obj(4)).delete(obj(11)));
        const result = held.apply(app.snapshot());

        expect([...result.changed].sort()).toEqual([obj(4), obj(11)].sort());
        expect(held.map.has(obj(4))).toBe(false);
        expect(held.map.has(obj(11))).toBe(false);
        expect(held.map.size).toBe(18);
        for (const [id, body] of bodies) {
            if (result.changed.has(id)) continue;
            expect(held.map.get(id)).toBe(body);
        }
    });

    test("a resync to an empty application marks every key", () => {
        const app = new FakeApp({ [obj(1)]: 1, [obj(2)]: 2 });
        const held = new AppMap();
        held.apply(app.snapshot());

        app.lose(() => imm.Map());
        const result = held.apply(app.snapshot());
        expect([...result.changed].sort()).toEqual([obj(1), obj(2)]);
        expect(held.map.size).toBe(0);
    });

    test("the map of an earlier result is never changed in place", () => {
        const app = new FakeApp({ [obj(1)]: { n: 1 } });
        const held = new AppMap();
        const first = held.apply(app.snapshot()).map;

        held.apply(app.put(obj(2), { n: 2 }));
        held.apply(app.del(obj(1)));
        expect(first.toJS()).toEqual({ [obj(1)]: { n: 1 } });
    });
});

describe("AppConfigs", () => {
    test("the first result waits for every wanted app", () => {
        const a = new FakeApp({ [obj(1)]: { from: "a" } });
        const b = new FakeApp({ [obj(2)]: { from: "b" } });
        const c = new FakeApp();
        const configs = new AppConfigs();

        expect(configs.apply(set_event([], [APP_A, APP_B, APP_C]))).toBe(null);
        expect(configs.apply({ key: APP_A, value: a.snapshot() })).toBe(null);
        /* A change to an app that has answered does not end the wait. */
        expect(configs.apply({ key: APP_A, value: a.put(obj(3), { n: 3 }) }))
            .toBe(null);
        expect(configs.apply({ key: APP_C, value: c.snapshot() })).toBe(null);

        const result = configs.apply({ key: APP_B, value: b.snapshot() });
        expect(result.changed).toBe(null);
        expect(plain(result.map)).toEqual({
            [obj(1)]: { [APP_A]: { from: "a" } },
            [obj(2)]: { [APP_B]: { from: "b" } },
            [obj(3)]: { [APP_A]: { n: 3 } },
        });
    });

    test("nothing is returned before the wanted set is known", () => {
        const configs = new AppConfigs();
        const a = new FakeApp({ [obj(1)]: 1 });
        expect(configs.apply({ key: APP_A, value: a.snapshot() })).toBe(null);
    });

    test("an empty wanted set gives an empty map", () => {
        const configs = new AppConfigs();
        const result = configs.apply(set_event([], []));
        expect(result.changed).toBe(null);
        expect(imm.Map.isMap(result.map)).toBe(true);
        expect(result.map.size).toBe(0);

        /* The same empty set again changes nothing. */
        expect(configs.apply(set_event([], []))).toBe(null);
    });

    test("a child create, update and delete each mark exactly one key", () => {
        const a = new FakeApp({ [obj(1)]: { n: 1 }, [obj(2)]: { n: 2 } });
        const b = new FakeApp({ [obj(3)]: { n: 3 } });
        const { configs, result } = ready_configs(
            new Map([[APP_A, a], [APP_B, b]]));
        const inners = new Map(result.map);

        const created = configs.apply({ key: APP_B, value: b.put(obj(4), { n: 4 }) });
        expect([...created.changed]).toEqual([obj(4)]);
        expect(created.map.get(obj(4)).toJS()).toEqual({ [APP_B]: { n: 4 } });

        const updated = configs.apply({ key: APP_B, value: b.put(obj(4), { n: 5 }) });
        expect([...updated.changed]).toEqual([obj(4)]);
        expect(updated.map.get(obj(4)).toJS()).toEqual({ [APP_B]: { n: 5 } });

        const deleted = configs.apply({ key: APP_B, value: b.del(obj(4)) });
        expect([...deleted.changed]).toEqual([obj(4)]);
        expect(deleted.map.has(obj(4))).toBe(false);

        /* Every other object keeps the same inner map throughout. */
        for (const [id, inner] of inners)
            expect(deleted.map.get(id)).toBe(inner);
        expect(deleted.map.size).toBe(3);
    });

    test("a no-op delete and a repeated identical value mark nothing", () => {
        const a = new FakeApp({ [obj(1)]: { n: 1 } });
        const { configs, result } = ready_configs(new Map([[APP_A, a]]));

        expect(configs.apply({ key: APP_A, value: a.del(obj(9)) })).toBe(null);
        expect(configs.apply({ key: APP_A, value: a.put(obj(1), { n: 1 }) }))
            .toBe(null);
        expect(configs.grouped).toBe(result.map);
    });

    test("a resync with identical content returns null and keeps every body", () => {
        const a = new FakeApp({ [obj(1)]: { n: 1 }, [obj(2)]: { n: 2 } });
        const b = new FakeApp({ [obj(2)]: { also: true }, [obj(3)]: [1, 2] });
        const { configs, result } = ready_configs(
            new Map([[APP_A, a], [APP_B, b]]));
        const inners = new Map(result.map);
        const bodies = [];
        for (const [id, inner] of result.map)
            for (const [app, body] of inner) bodies.push([id, app, body]);

        expect(configs.apply({ key: APP_A, value: a.snapshot() })).toBe(null);
        expect(configs.apply({ key: APP_B, value: b.snapshot() })).toBe(null);

        expect(configs.grouped).toBe(result.map);
        for (const [id, inner] of inners)
            expect(configs.grouped.get(id)).toBe(inner);
        for (const [id, app, body] of bodies)
            expect(configs.grouped.get(id).get(app)).toBe(body);
    });

    test("a resync that changes 3 entries marks exactly 3", () => {
        const entries = {};
        for (let i = 0; i < 30; i++) entries[obj(i)] = { n: i };
        const a = new FakeApp(entries);
        const b = new FakeApp({ [obj(100)]: { n: 100 } });
        const { configs, result } = ready_configs(
            new Map([[APP_A, a], [APP_B, b]]));
        const inners = new Map(result.map);

        a.lose(map => map
            .set(obj(5), { n: "five" })
            .set(obj(6), { n: "six" })
            .set(obj(200), { n: 200 }));
        const resync = configs.apply({ key: APP_A, value: a.snapshot() });

        expect([...resync.changed].sort())
            .toEqual([obj(5), obj(6), obj(200)].sort());
        for (const [id, inner] of inners) {
            if (resync.changed.has(id)) continue;
            expect(resync.map.get(id)).toBe(inner);
        }
        expect(resync.map.get(obj(200)).toJS()).toEqual({ [APP_A]: { n: 200 } });
    });

    test("a resync that omits 2 keys deletes and marks exactly those 2", () => {
        const entries = {};
        for (let i = 0; i < 30; i++) entries[obj(i)] = { n: i };
        const a = new FakeApp(entries);
        const { configs, result } = ready_configs(new Map([[APP_A, a]]));
        const inners = new Map(result.map);

        a.lose(map => map.delete(obj(8)).delete(obj(21)));
        const resync = configs.apply({ key: APP_A, value: a.snapshot() });

        expect([...resync.changed].sort()).toEqual([obj(8), obj(21)].sort());
        expect(resync.map.has(obj(8))).toBe(false);
        expect(resync.map.has(obj(21))).toBe(false);
        expect(resync.map.size).toBe(28);
        for (const [id, inner] of inners) {
            if (resync.changed.has(id)) continue;
            expect(resync.map.get(id)).toBe(inner);
        }
    });

    test("removing an app from the wanted set removes its entries", () => {
        const a = new FakeApp({ [obj(1)]: { n: 1 }, [obj(2)]: { n: 2 } });
        const b = new FakeApp({ [obj(2)]: { b: 2 }, [obj(3)]: { b: 3 } });
        const { configs, result } = ready_configs(
            new Map([[APP_A, a], [APP_B, b]]));
        const kept = result.map.get(obj(1));

        const after = configs.apply(set_event([APP_A, APP_B], [APP_A]));
        /* A change to the set of apps marks every key. */
        expect(after.changed).toBe(null);
        expect(plain(after.map)).toEqual({
            [obj(1)]: { [APP_A]: { n: 1 } },
            [obj(2)]: { [APP_A]: { n: 2 } },
        });
        /* An object the app had no entry for keeps its inner map. */
        expect(after.map.get(obj(1))).toBe(kept);

        /* A late value from the app that left changes nothing. */
        expect(configs.apply({ key: APP_B, value: b.put(obj(9), { b: 9 }) }))
            .toBe(null);
        expect(configs.grouped).toBe(after.map);
    });

    test("removing the last app gives an empty map", () => {
        const a = new FakeApp({ [obj(1)]: { n: 1 } });
        const { configs } = ready_configs(new Map([[APP_A, a]]));

        const after = configs.apply(set_event([APP_A], []));
        expect(after.changed).toBe(null);
        expect(after.map.size).toBe(0);
    });

    test("adding an app holds output until it answers and then reports the accumulated changes", () => {
        const a = new FakeApp({ [obj(1)]: { n: 1 } });
        const b = new FakeApp({ [obj(1)]: { b: 1 }, [obj(5)]: { b: 5 } });
        const { configs, result } = ready_configs(new Map([[APP_A, a]]));

        expect(configs.apply(set_event([APP_A], [APP_A, APP_B]))).toBe(null);
        /* Changes to the app that has answered are held too. */
        expect(configs.apply({ key: APP_A, value: a.put(obj(2), { n: 2 }) }))
            .toBe(null);
        expect(configs.apply({ key: APP_A, value: a.del(obj(1)) })).toBe(null);
        expect(configs.grouped).toBe(result.map);

        const after = configs.apply({ key: APP_B, value: b.snapshot() });
        expect(after.changed).toBe(null);
        expect(plain(after.map)).toEqual({
            [obj(1)]: { [APP_B]: { b: 1 } },
            [obj(2)]: { [APP_A]: { n: 2 } },
            [obj(5)]: { [APP_B]: { b: 5 } },
        });

        /* After that, changes are reported one key at a time again. */
        const next = configs.apply({ key: APP_B, value: b.put(obj(6), { b: 6 }) });
        expect([...next.changed]).toEqual([obj(6)]);
    });

    test("an added app with no entries changes nothing", () => {
        const a = new FakeApp({ [obj(1)]: { n: 1 } });
        const { configs, result } = ready_configs(new Map([[APP_A, a]]));

        expect(configs.apply(set_event([APP_A], [APP_A, APP_B]))).toBe(null);
        expect(configs.apply({ key: APP_B, value: new FakeApp().snapshot() }))
            .toBe(null);
        expect(configs.grouped).toBe(result.map);
    });

    test("an object with entries in two apps keeps both and loses its key only when the last goes", () => {
        const a = new FakeApp({ [obj(1)]: { a: 1 } });
        const b = new FakeApp({ [obj(1)]: { b: 1 } });
        const { configs, result } = ready_configs(
            new Map([[APP_A, a], [APP_B, b]]));
        expect(result.map.get(obj(1)).toJS())
            .toEqual({ [APP_A]: { a: 1 }, [APP_B]: { b: 1 } });
        const b_body = result.map.get(obj(1)).get(APP_B);

        const one_left = configs.apply({ key: APP_A, value: a.del(obj(1)) });
        expect([...one_left.changed]).toEqual([obj(1)]);
        expect(one_left.map.has(obj(1))).toBe(true);
        expect(one_left.map.get(obj(1)).toJS()).toEqual({ [APP_B]: { b: 1 } });
        expect(one_left.map.get(obj(1)).get(APP_B)).toBe(b_body);

        const none_left = configs.apply({ key: APP_B, value: b.del(obj(1)) });
        expect([...none_left.changed]).toEqual([obj(1)]);
        expect(none_left.map.has(obj(1))).toBe(false);
    });

    test("the inner map's key order equals the reference grouping loop's order", () => {
        const a = new FakeApp({ [obj(1)]: { a: 1 }, [obj(2)]: { a: 2 } });
        const b = new FakeApp({ [obj(1)]: { b: 1 } });
        const c = new FakeApp({ [obj(1)]: { c: 1 }, [obj(2)]: { c: 2 } });
        const apps = new Map([[APP_C, c], [APP_A, a], [APP_B, b]]);
        const { configs, result } = ready_configs(apps);
        let order = [...apps.keys()];
        let latest = result.map;

        const check = () => {
            const reference = reference_group(
                order.map(id => [id, apps.get(id).map]));
            expect(plain(latest)).toEqual(plain(reference));
            for (const [id, inner] of reference) {
                expect([...latest.get(id).keys()]).toEqual([...inner.keys()]);
                expect(JSON.stringify(latest.get(id)))
                    .toBe(JSON.stringify(inner));
            }
        };
        const apply = event => {
            const res = configs.apply(event);
            if (res) latest = res.map;
            return res;
        };
        check();
        expect([...latest.get(obj(1)).keys()]).toEqual([APP_C, APP_A, APP_B]);

        /* An entry added later lands in app order, not at the end. */
        apply({ key: APP_C, value: c.del(obj(1)) });
        check();
        apply({ key: APP_C, value: c.put(obj(1), { c: "again" }) });
        check();
        expect([...latest.get(obj(1)).keys()]).toEqual([APP_C, APP_A, APP_B]);

        apply({ key: APP_A, value: a.put(obj(1), { a: "changed" }) });
        check();

        /* An app is removed. */
        const without_a = order.filter(id => id != APP_A);
        apply(set_event(order, without_a));
        order = without_a;
        check();
        expect([...latest.get(obj(1)).keys()]).toEqual([APP_C, APP_B]);

        /* The app comes back, now last in the member set. */
        const a_last = [...order, APP_A];
        apply(set_event(order, a_last));
        order = a_last;
        apply({ key: APP_A, value: a.snapshot() });
        check();
        expect([...latest.get(obj(1)).keys()]).toEqual([APP_C, APP_B, APP_A]);
    });

    test("a member set in another order builds every inner map again in that order", () => {
        const a = new FakeApp({ [obj(1)]: { a: 1 } });
        const b = new FakeApp({ [obj(1)]: { b: 1 }, [obj(2)]: { b: 2 } });
        const { configs, result } = ready_configs(
            new Map([[APP_A, a], [APP_B, b]]));
        const single = result.map.get(obj(2));

        const after = configs.apply(set_event([APP_A, APP_B], [APP_B, APP_A]));
        expect(after.changed).toBe(null);
        expect([...after.map.get(obj(1)).keys()]).toEqual([APP_B, APP_A]);
        /* An inner map the order cannot change stays the same object. */
        expect(after.map.get(obj(2))).toBe(single);
    });

    test("the map of an earlier result is never changed in place", () => {
        const a = new FakeApp({ [obj(1)]: { n: 1 } });
        const { configs, result } = ready_configs(new Map([[APP_A, a]]));
        const first = result.map;

        configs.apply({ key: APP_A, value: a.put(obj(2), { n: 2 }) });
        configs.apply({ key: APP_A, value: a.del(obj(1)) });
        expect(plain(first)).toEqual({ [obj(1)]: { [APP_A]: { n: 1 } } });
    });

    test("it accepts a native Set of applications", () => {
        const a = new FakeApp({ [obj(1)]: { n: 1 } });
        const configs = new AppConfigs();
        configs.apply({ set: new Set([APP_A]), added: [APP_A], removed: [] });
        const result = configs.apply({ key: APP_A, value: a.snapshot() });
        expect(plain(result.map)).toEqual({ [obj(1)]: { [APP_A]: { n: 1 } } });
    });
});

/*
 * ACS Data Access Service
 * Unit tests for the RX utility functions
 * Copyright 2026 University of Sheffield
 */

/* These run against fakes, so they need no cluster. No test here uses
 * a timer: each step is a promise the test resolves itself. */

import * as imm from "immutable";
import * as rx from "rxjs";
import { afterEach, describe, expect, test } from "vitest";

import {
    coalesce, same_set, set_changes, watch_each,
} from "../../lib/rx-util.js";

/* Let every promise callback that is ready run. */
const turn = () => new Promise(r => setImmediate(r));

/* An async function the test finishes by hand. `calls` holds one
 * record per call, in order. */
function manual () {
    const calls = [];
    const fn = () => new Promise((resolve, reject) => {
        calls.push({ resolve, reject });
    });
    return { fn, calls };
}

const open = [];

/* Subscribe and record everything the output does. */
function record (source) {
    const seen = { values: [], error: undefined, errored: false, complete: false };
    const sub = source.subscribe({
        next: v => seen.values.push(v),
        error: e => { seen.errored = true; seen.error = e; },
        complete: () => { seen.complete = true; },
    });
    open.push(sub);
    return { seen, sub };
}

afterEach(() => {
    for (const sub of open.splice(0)) sub.unsubscribe();
});

describe("coalesce", () => {
    test("runs the first trigger at once", async () => {
        const { fn, calls } = manual();
        const triggers = new rx.Subject();
        const { seen } = record(triggers.pipe(coalesce(fn)));

        expect(calls).toHaveLength(0);
        triggers.next("a");
        await turn();
        expect(calls).toHaveLength(1);

        calls[0].resolve(7);
        await turn();
        expect(seen.values).toEqual([7]);
        expect(calls).toHaveLength(1);
        expect(seen.complete).toBe(false);
    });

    test("ignores the upstream values and passes on what the function returns", async () => {
        const got = [];
        const triggers = new rx.Subject();
        const { seen } = record(triggers.pipe(
            coalesce(async (...args) => { got.push(args); return "done"; })));

        triggers.next("ignored");
        await turn();
        expect(got).toEqual([[undefined]]);
        expect(seen.values).toEqual(["done"]);
    });

    test("triggers during a call collapse into exactly one further call", async () => {
        const { fn, calls } = manual();
        const triggers = new rx.Subject();
        const { seen } = record(triggers.pipe(coalesce(fn)));

        triggers.next(1);
        await turn();
        for (let i = 0; i < 25; i++) triggers.next(i);
        await turn();
        /* One call in flight, however many triggers. */
        expect(calls).toHaveLength(1);

        calls[0].resolve("first");
        await turn();
        expect(calls).toHaveLength(2);

        calls[1].resolve("second");
        await turn();
        expect(calls).toHaveLength(2);
        expect(seen.values).toEqual(["first", "second"]);
    });

    test("a trigger after a call has ended starts a new call", async () => {
        const { fn, calls } = manual();
        const triggers = new rx.Subject();
        record(triggers.pipe(coalesce(fn)));

        triggers.next(1);
        await turn();
        calls[0].resolve();
        await turn();
        expect(calls).toHaveLength(1);

        triggers.next(2);
        await turn();
        expect(calls).toHaveLength(2);
    });

    test("the last call starts after the last trigger", async () => {
        const events = [];
        const pending = [];
        const fn = () => new Promise(resolve => {
            events.push("start");
            pending.push(resolve);
        });
        const triggers = new rx.Subject();
        record(triggers.pipe(coalesce(fn)));
        const trigger = () => {
            events.push("trigger");
            triggers.next(null);
        };

        trigger();
        await turn();
        trigger();
        trigger();
        pending.shift()();
        await turn();
        /* A trigger during the second call needs a third. */
        trigger();
        pending.shift()();
        await turn();
        pending.shift()();
        await turn();

        expect(pending).toHaveLength(0);
        expect(events).toEqual([
            "trigger", "start", "trigger", "trigger", "start", "trigger", "start"]);
        expect(events.lastIndexOf("start"))
            .toBeGreaterThan(events.lastIndexOf("trigger"));
    });

    test("an fn rejection errors the output, and nothing runs after it", async () => {
        const { fn, calls } = manual();
        const triggers = new rx.Subject();
        const { seen } = record(triggers.pipe(coalesce(fn)));

        triggers.next(1);
        await turn();
        triggers.next(2);
        const failure = new Error("The call failed");
        calls[0].reject(failure);
        await turn();

        expect(seen.errored).toBe(true);
        expect(seen.error).toBe(failure);
        expect(seen.values).toEqual([]);
        /* The trigger that was waiting is dropped with the error. */
        expect(calls).toHaveLength(1);
        expect(triggers.observed).toBe(false);
    });

    test("a function that throws at once errors the output", async () => {
        const failure = new Error("Thrown, not rejected");
        const triggers = new rx.Subject();
        const { seen } = record(triggers.pipe(
            coalesce(() => { throw failure; })));

        triggers.next(1);
        await turn();
        expect(seen.error).toBe(failure);
    });

    test("unsubscribe stops further calls", async () => {
        const { fn, calls } = manual();
        const triggers = new rx.Subject();
        const { seen, sub } = record(triggers.pipe(coalesce(fn)));

        triggers.next(1);
        await turn();
        triggers.next(2);
        sub.unsubscribe();
        expect(triggers.observed).toBe(false);

        /* The call in flight ends. The waiting trigger starts nothing,
         * and the result goes nowhere. */
        calls[0].resolve("late");
        await turn();
        triggers.next(3);
        await turn();

        expect(calls).toHaveLength(1);
        expect(seen.values).toEqual([]);
        expect(seen.errored).toBe(false);
        expect(seen.complete).toBe(false);
    });

    test("a rejection after unsubscribe goes nowhere", async () => {
        const { fn, calls } = manual();
        const triggers = new rx.Subject();
        const { seen, sub } = record(triggers.pipe(coalesce(fn)));

        triggers.next(1);
        await turn();
        sub.unsubscribe();
        calls[0].reject(new Error("Too late to matter"));
        await turn();

        expect(seen.errored).toBe(false);
    });

    test("completes when the upstream has completed and the last call has ended", async () => {
        const { fn, calls } = manual();
        const triggers = new rx.Subject();
        const { seen } = record(triggers.pipe(coalesce(fn)));

        triggers.next(1);
        await turn();
        triggers.next(2);
        triggers.complete();
        expect(seen.complete).toBe(false);

        calls[0].resolve("a");
        await turn();
        expect(calls).toHaveLength(2);
        expect(seen.complete).toBe(false);

        calls[1].resolve("b");
        await turn();
        expect(seen.values).toEqual(["a", "b"]);
        expect(seen.complete).toBe(true);
    });

    test("completes at once when the upstream completes with no call running", () => {
        const { seen } = record(rx.EMPTY.pipe(coalesce(async () => 1)));
        expect(seen.complete).toBe(true);
    });

    /* The default dataset maker depends on this: it keeps its own
     * guard against a second pass, because the operator cannot. */
    test("an upstream error reaches the output while a call still runs", async () => {
        const { fn, calls } = manual();
        const triggers = new rx.Subject();
        const { seen } = record(triggers.pipe(coalesce(fn)));

        triggers.next(1);
        await turn();
        const failure = new Error("The source failed");
        triggers.error(failure);

        expect(seen.error).toBe(failure);
        /* The call is still in flight. Its result goes nowhere. */
        expect(calls).toHaveLength(1);
        calls[0].resolve("late");
        await turn();
        expect(seen.values).toEqual([]);
    });

    test("each subscription has its own state", async () => {
        const { fn, calls } = manual();
        const triggers = new rx.Subject();
        const source = triggers.pipe(coalesce(fn));
        record(source);
        record(source);

        triggers.next(1);
        await turn();
        expect(calls).toHaveLength(2);
    });
});

/* One inner source per key, each a Subject the test drives. `subscribes`
 * and `unsubscribes` list the keys in the order it happened. */
function inner_sources () {
    const subjects = new Map();
    const subscribes = [];
    const unsubscribes = [];
    const factory = key => new rx.Observable(subscriber => {
        subscribes.push(key);
        if (!subjects.has(key)) subjects.set(key, new rx.Subject());
        const sub = subjects.get(key).subscribe(subscriber);
        return () => {
            unsubscribes.push(key);
            sub.unsubscribe();
        };
    });
    return { subjects, subscribes, unsubscribes, factory };
}

const is_set_event = v => v.set !== undefined;

describe("watch_each", () => {
    test("the set event comes before the first value of a new key, for a synchronous inner", () => {
        const sets = new rx.Subject();
        const { seen } = record(sets.pipe(
            watch_each(key => rx.of(`${key}-1`, `${key}-2`))));

        const first = new Set(["a", "b"]);
        sets.next(first);
        expect(seen.values).toEqual([
            { set: first, added: ["a", "b"], removed: [] },
            { key: "a", value: "a-1" },
            { key: "a", value: "a-2" },
            { key: "b", value: "b-1" },
            { key: "b", value: "b-2" },
        ]);
        expect(seen.values[0].set).toBe(first);

        const second = new Set(["a", "b", "c"]);
        sets.next(second);
        expect(seen.values.slice(5)).toEqual([
            { set: second, added: ["c"], removed: [] },
            { key: "c", value: "c-1" },
            { key: "c", value: "c-2" },
        ]);
    });

    test("the set event comes before the first value of a new key, for a live Subject", () => {
        const sets = new rx.Subject();
        const { subjects, factory } = inner_sources();
        const { seen } = record(sets.pipe(watch_each(factory)));

        sets.next(new Set(["a"]));
        expect(seen.values).toHaveLength(1);
        expect(seen.values[0].added).toEqual(["a"]);

        subjects.get("a").next(1);
        sets.next(new Set(["a", "b"]));
        subjects.get("b").next(2);
        subjects.get("a").next(3);

        expect(seen.values.slice(1)).toEqual([
            { key: "a", value: 1 },
            { set: new Set(["a", "b"]), added: ["b"], removed: [] },
            { key: "b", value: 2 },
            { key: "a", value: 3 },
        ]);
        /* For every key, its set event is earlier than its values. */
        for (const key of ["a", "b"]) {
            const joined = seen.values.findIndex(
                v => is_set_event(v) && v.added.includes(key));
            const spoke = seen.values.findIndex(v => v.key === key);
            expect(joined).toBeGreaterThanOrEqual(0);
            expect(spoke).toBeGreaterThan(joined);
        }
    });

    /* A replaying source answers inside subscribe. The value must still
     * follow the set event that added its key. */
    test("a replayed value follows the set event of its key", () => {
        const sets = new rx.BehaviorSubject(new Set(["a"]));
        const held = new rx.BehaviorSubject("held");
        const { seen } = record(sets.pipe(watch_each(() => held)));

        expect(seen.values).toEqual([
            { set: new Set(["a"]), added: ["a"], removed: [] },
            { key: "a", value: "held" },
        ]);
    });

    test("adding one key to a set of 1,000 subscribes exactly one inner and re-subscribes none", () => {
        const sets = new rx.Subject();
        const { subscribes, unsubscribes, factory } = inner_sources();
        const { seen } = record(sets.pipe(watch_each(factory)));

        const keys = Array.from({ length: 1000 }, (_, i) => `key-${i}`);
        sets.next(new Set(keys));
        expect(subscribes).toHaveLength(1000);
        expect(new Set(subscribes).size).toBe(1000);

        sets.next(new Set([...keys, "one-more"]));
        expect(subscribes).toHaveLength(1001);
        expect(subscribes[1000]).toBe("one-more");
        expect(unsubscribes).toEqual([]);
        expect(seen.values[1].added).toEqual(["one-more"]);
        expect(seen.values[1].removed).toEqual([]);
    });

    test("removing a key unsubscribes exactly that inner", () => {
        const sets = new rx.Subject();
        const { subjects, subscribes, unsubscribes, factory } = inner_sources();
        const { seen } = record(sets.pipe(watch_each(factory)));

        sets.next(new Set(["a", "b", "c"]));
        sets.next(new Set(["a", "c"]));

        expect(unsubscribes).toEqual(["b"]);
        expect(subscribes).toEqual(["a", "b", "c"]);
        expect(seen.values[1]).toEqual(
            { set: new Set(["a", "c"]), added: [], removed: ["b"] });
        expect(subjects.get("b").observed).toBe(false);
        expect(subjects.get("a").observed).toBe(true);
        expect(subjects.get("c").observed).toBe(true);

        /* Nothing from the key that left gets through. */
        subjects.get("b").next("late");
        subjects.get("a").next("still here");
        expect(seen.values.slice(2)).toEqual([
            { key: "a", value: "still here" },
        ]);
    });

    test("a key that leaves and comes back is subscribed again", () => {
        const sets = new rx.Subject();
        const { subscribes, unsubscribes, factory } = inner_sources();
        record(sets.pipe(watch_each(factory)));

        sets.next(new Set(["a"]));
        sets.next(new Set());
        sets.next(new Set(["a"]));

        expect(subscribes).toEqual(["a", "a"]);
        expect(unsubscribes).toEqual(["a"]);
    });

    test("a repeated identical Set emits an event with empty added and removed and subscribes nothing", () => {
        const sets = new rx.Subject();
        const { subscribes, unsubscribes, factory } = inner_sources();
        const { seen } = record(sets.pipe(watch_each(factory)));

        const set = new Set(["a", "b"]);
        sets.next(set);
        sets.next(set);
        /* An equal Set that is another object counts as a repeat. */
        sets.next(new Set(["b", "a"]));

        expect(subscribes).toEqual(["a", "b"]);
        expect(unsubscribes).toEqual([]);
        expect(seen.values.slice(1)).toEqual([
            { set, added: [], removed: [] },
            { set: new Set(["b", "a"]), added: [], removed: [] },
        ]);
    });

    test("an inner error errors the output and lets go of every source", () => {
        const sets = new rx.Subject();
        const { subjects, factory } = inner_sources();
        const { seen } = record(sets.pipe(watch_each(factory)));

        sets.next(new Set(["a", "b"]));
        const failure = new Error("One source failed");
        subjects.get("b").error(failure);

        expect(seen.errored).toBe(true);
        expect(seen.error).toBe(failure);
        expect(seen.complete).toBe(false);
        expect(subjects.get("a").observed).toBe(false);
        expect(sets.observed).toBe(false);

        /* Nothing is sent after the error. */
        const count = seen.values.length;
        subjects.get("a").next("late");
        expect(seen.values).toHaveLength(count);
    });

    test("an inner that fails inside subscribe errors the output", () => {
        const failure = new Error("Failed at once");
        const sets = new rx.Subject();
        const { seen } = record(sets.pipe(
            watch_each(() => rx.throwError(() => failure))));

        sets.next(new Set(["a", "b"]));
        expect(seen.error).toBe(failure);
        expect(sets.observed).toBe(false);
    });

    test("a factory that throws errors the output", () => {
        const failure = new Error("No source for this key");
        const sets = new rx.Subject();
        const { seen } = record(sets.pipe(
            watch_each(() => { throw failure; })));

        sets.next(new Set(["a"]));
        expect(seen.error).toBe(failure);
        expect(sets.observed).toBe(false);
    });

    test("an upstream error errors the output and lets go of every inner", () => {
        const sets = new rx.Subject();
        const { subjects, factory } = inner_sources();
        const { seen } = record(sets.pipe(watch_each(factory)));

        sets.next(new Set(["a"]));
        const failure = new Error("The member list failed");
        sets.error(failure);

        expect(seen.error).toBe(failure);
        expect(subjects.get("a").observed).toBe(false);
    });

    test("with rx.of sources the output completes", () => {
        const { seen } = record(rx.of(new Set(["a", "b"])).pipe(
            watch_each(key => rx.of(key.toUpperCase()))));

        expect(seen.values).toEqual([
            { set: new Set(["a", "b"]), added: ["a", "b"], removed: [] },
            { key: "a", value: "A" },
            { key: "b", value: "B" },
        ]);
        expect(seen.complete).toBe(true);
        expect(seen.errored).toBe(false);
    });

    test("an empty Set from a completed source completes the output", () => {
        const { seen } = record(rx.of(new Set()).pipe(
            watch_each(() => rx.NEVER)));

        expect(seen.values).toEqual([
            { set: new Set(), added: [], removed: [] },
        ]);
        expect(seen.complete).toBe(true);
    });

    test("the output stays open while an inner or the upstream is open", () => {
        const sets = new rx.Subject();
        const { subjects, factory } = inner_sources();
        const { seen } = record(sets.pipe(watch_each(factory)));

        sets.next(new Set(["a", "b"]));
        subjects.get("a").complete();
        sets.complete();
        /* "b" is still open. */
        expect(seen.complete).toBe(false);

        subjects.get("b").next("last");
        subjects.get("b").complete();
        expect(seen.values.at(-1)).toEqual({ key: "b", value: "last" });
        expect(seen.complete).toBe(true);
    });

    test("a key that left with its inner still open does not hold the output open", () => {
        const sets = new rx.Subject();
        const { factory } = inner_sources();
        const { seen } = record(sets.pipe(watch_each(factory)));

        sets.next(new Set(["a"]));
        sets.next(new Set());
        sets.complete();
        expect(seen.complete).toBe(true);
    });

    test("a completed inner is not subscribed again while its key stays", () => {
        const sets = new rx.Subject();
        let subscribes = 0;
        const { seen } = record(sets.pipe(watch_each(key => rx.defer(() => {
            subscribes++;
            return rx.of(key);
        }))));

        sets.next(new Set(["a"]));
        sets.next(new Set(["a"]));
        sets.next(new Set(["a", "b"]));

        expect(subscribes).toBe(2);
        expect(seen.values.filter(v => v.key === "a")).toHaveLength(1);
        expect(seen.complete).toBe(false);
    });

    test("it accepts an Immutable Set and a native Set", () => {
        const sets = new rx.Subject();
        const { subscribes, unsubscribes, factory } = inner_sources();
        const { seen } = record(sets.pipe(watch_each(factory)));

        const first = imm.Set(["a", "b"]);
        sets.next(first);
        sets.next(new Set(["b", "c"]));
        const third = imm.Set(["c"]);
        sets.next(third);

        expect(subscribes).toEqual(["a", "b", "c"]);
        expect(unsubscribes).toEqual(["a", "b"]);
        expect(seen.values[0].set).toBe(first);
        expect(seen.values[0].added).toEqual(["a", "b"]);
        expect(seen.values[1].added).toEqual(["c"]);
        expect(seen.values[1].removed).toEqual(["a"]);
        expect(seen.values[2].set).toBe(third);
        expect(seen.values[2].removed).toEqual(["b"]);
    });

    test("stats.scanned rises by exactly the Set size per Set", () => {
        const stats = { scanned: 0 };
        const sets = new rx.Subject();
        const { factory } = inner_sources();
        record(sets.pipe(watch_each(factory, stats)));

        sets.next(new Set(["a", "b", "c"]));
        expect(stats.scanned).toBe(3);
        sets.next(imm.Set(["a", "b", "c", "d"]));
        expect(stats.scanned).toBe(7);
        sets.next(new Set(["a"]));
        expect(stats.scanned).toBe(8);
        sets.next(new Set());
        expect(stats.scanned).toBe(8);
    });

    test("stats can start empty, and is optional", () => {
        const stats = {};
        const sets = new rx.Subject();
        record(sets.pipe(watch_each(() => rx.NEVER, stats)));
        record(sets.pipe(watch_each(() => rx.NEVER)));

        sets.next(new Set(["a", "b"]));
        expect(stats).toEqual({ scanned: 2 });
    });

    test("unsubscribe lets go of the upstream and every inner", () => {
        const sets = new rx.Subject();
        const { subjects, unsubscribes, factory } = inner_sources();
        const { seen, sub } = record(sets.pipe(watch_each(factory)));

        sets.next(new Set(["a", "b"]));
        sub.unsubscribe();

        expect(sets.observed).toBe(false);
        expect([...unsubscribes].sort()).toEqual(["a", "b"]);
        subjects.get("a").next("late");
        expect(seen.values).toHaveLength(1);
        expect(seen.complete).toBe(false);
    });

    test("unsubscribe while the set event is handled starts no inner", () => {
        const sets = new rx.Subject();
        const { subscribes, factory } = inner_sources();
        const sub = sets.pipe(watch_each(factory)).subscribe(v => {
            if (is_set_event(v)) sub.unsubscribe();
        });
        open.push(sub);

        sets.next(new Set(["a", "b"]));
        expect(subscribes).toEqual([]);
        expect(sets.observed).toBe(false);
    });

    test("each subscription has its own inners", () => {
        const sets = new rx.BehaviorSubject(new Set(["a"]));
        const { subscribes, factory } = inner_sources();
        const source = sets.pipe(watch_each(factory));
        record(source);
        record(source);

        expect(subscribes).toEqual(["a", "a"]);
    });
});

describe("same_set", () => {
    test("is true for the same members in any order", () => {
        expect(same_set(new Set(), new Set())).toBe(true);
        expect(same_set(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
        const set = new Set(["a"]);
        expect(same_set(set, set)).toBe(true);
    });

    test("is false when a member differs or one Set is larger", () => {
        expect(same_set(new Set(["a"]), new Set(["b"]))).toBe(false);
        expect(same_set(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
        expect(same_set(new Set(["a", "b"]), new Set(["a"]))).toBe(false);
        expect(same_set(new Set(), new Set(["a"]))).toBe(false);
    });

    test("compares a native Set with an Immutable Set", () => {
        expect(same_set(new Set(["a", "b"]), imm.Set(["b", "a"]))).toBe(true);
        expect(same_set(imm.Set(["a"]), new Set(["a", "b"]))).toBe(false);
    });
});

describe("set_changes", () => {
    test("gives the members that are in exactly one Set", () => {
        const changes = set_changes(
            new Set(["a", "b", "c"]), new Set(["b", "c", "d"]));
        expect(changes).toBeInstanceOf(Set);
        expect([...changes].sort()).toEqual(["a", "d"]);
    });

    test("is empty for equal Sets", () => {
        expect(set_changes(new Set(["a"]), new Set(["a"])).size).toBe(0);
        expect(set_changes(new Set(), new Set()).size).toBe(0);
    });

    test("gives every member when one Set is empty", () => {
        expect([...set_changes(new Set(), new Set(["a", "b"]))].sort())
            .toEqual(["a", "b"]);
        expect([...set_changes(new Set(["a", "b"]), new Set())].sort())
            .toEqual(["a", "b"]);
    });

    test("leaves both arguments as they were", () => {
        const a = new Set(["a", "b"]);
        const b = new Set(["b"]);
        set_changes(a, b);
        expect([...a]).toEqual(["a", "b"]);
        expect([...b]).toEqual(["b"]);
    });
});

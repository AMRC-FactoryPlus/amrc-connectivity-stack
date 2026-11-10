/*
 * ACS Data Access Service
 * Unit tests for the RX utility functions
 * Copyright 2026 University of Sheffield
 */

/* These run against fakes, so they need no cluster. No test here uses
 * a timer: each step is a promise the test resolves itself. */

import * as rx from "rxjs";
import { afterEach, describe, expect, test } from "vitest";

import { coalesce } from "../../lib/rx-util.js";

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

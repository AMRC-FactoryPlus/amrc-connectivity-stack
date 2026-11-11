/*
 * ACS Data Access Service
 * RX utility functions
 * Copyright 2026 University of Sheffield
 */

import * as rx from "rxjs";

/* Copied from acs-configdb/lib/rx-util.js, so the two services share
 * one behaviour without a change to a shared library.
 *
 * Run an async function when the upstream emits, with at most one call
 * in flight. Upstream values that arrive while a call is running are
 * collapsed into a single further call, which starts once the running
 * call has finished. The upstream values themselves are ignored.
 *
 * Every upstream value is followed by the start of a call, either at
 * once or after the running call. So the last call always starts after
 * the last upstream value: nothing is lost at the end of a burst.
 *
 * An upstream error reaches the subscriber at once, while a call may
 * still be running. A caller that retries must make sure itself that
 * the new subscription does not start a second call beside the first. */
export function coalesce (fn) {
    return upstream => new rx.Observable(subscriber => {
        let running = false;
        let again = false;
        let done = false;
        let closed = false;

        const run = () => {
            running = true;
            again = false;
            Promise.resolve()
                .then(fn)
                .then(
                    value => { if (!closed) subscriber.next(value); },
                    err => {
                        if (closed) return;
                        closed = true;
                        subscriber.error(err);
                    })
                .finally(() => {
                    running = false;
                    if (closed) return;
                    if (again) run();
                    else if (done) subscriber.complete();
                });
        };

        const sub = upstream.subscribe({
            next () {
                if (running) again = true;
                else run();
            },
            error (err) { subscriber.error(err); },
            complete () {
                done = true;
                if (!running) subscriber.complete();
            },
        });

        return () => {
            closed = true;
            sub.unsubscribe();
        };
    });
}

/* A retry whose delay the caller can put back to the start.
 *
 * `retry()` gives an operator that subscribes to its source again
 * after an error. The first wait is `delay` ms and each error after
 * it waits twice as long, up to 64 times `delay`: the same waits as
 * `retryBackoff` in @amrc-factoryplus/rx-util. `log`, if given, is
 * called with each error.
 *
 * `retryBackoff` goes back to the first wait when a value comes out
 * of the retried sequence. That is no use when the sequence says
 * nothing while its source is well: every error then counts as one
 * more in a row, for the life of the process. Here the caller calls
 * `reset()` when it knows the source has answered, wherever in the
 * pipeline that shows. */
export function backoff (delay, log) {
    let failures = 0;
    return {
        reset () { failures = 0; },
        retry () {
            return rx.retry({
                delay: err => {
                    log?.(err);
                    const doublings = Math.min(failures++, 6);
                    return rx.timer(delay * (2 ** doublings));
                },
            });
        },
    };
}

/* Follow a changing set of keys, with one inner sequence per key.
 *
 * The upstream is a sequence of Sets: anything with `size`, `has` and
 * iteration will do, so an Immutable Set and a native Set both work.
 * For each key in the Set the operator subscribes `factory(key)` once
 * and keeps that subscription for as long as the key stays in the Set.
 * The output carries two kinds of value:
 *
 *  - `{ set, added, removed }` for every upstream Set. `added` and
 *    `removed` are arrays of the keys that joined and left since the
 *    Set before; both are empty when the Set repeats.
 *  - `{ key, value }` for every value of a key's inner sequence.
 *
 * The Set value always comes before the first value of a key it adds:
 * the operator emits it, then unsubscribes the keys that left, then
 * subscribes the keys that joined. A key that stays is never
 * subscribed again, so adding one key to a large Set costs one
 * subscribe. Finding the difference is one pass over the new Set and
 * one over the keys held, with native `has` calls and no copy.
 *
 * An error from the upstream or from any inner sequence errors the
 * output. So does anything that goes wrong while a Set is handled: a
 * value that is no Set, a factory that throws, or an inner sequence
 * that throws when it is unsubscribed. The output completes when the
 * upstream and every inner sequence still held have completed.
 *
 * `stats`, if given, is an object the operator counts its own work
 * on: `stats.scanned` rises by the size of each upstream Set. */
export function watch_each (factory, stats) {
    return upstream => new rx.Observable(subscriber => {
        /* key -> { sub, done }. `done` is true when the inner
         * sequence has completed; the key is still held. */
        const inners = new Map();
        let live = 0;
        let upstream_done = false;
        let closed = false;

        /* The consumer can unsubscribe while it handles a value. When
         * the upstream answers inside subscribe, that happens before
         * the teardown below exists, so `closed` alone does not show
         * it. */
        const stopped = () => closed || subscriber.closed;

        /* Unsubscribe each inner sequence given. One that throws does
         * not stop the rest: the first error is thrown at the end. */
        const drop = recs => {
            let failed = false;
            let failure;
            for (const rec of recs) {
                try {
                    rec.sub?.unsubscribe();
                }
                catch (err) {
                    if (!failed) failure = err;
                    failed = true;
                }
            }
            if (failed) throw failure;
        };
        const close = () => {
            closed = true;
            const held = [...inners.values()];
            inners.clear();
            drop(held);
        };
        const fail = err => {
            if (closed) return;
            /* `err` is the failure to report, whatever letting go of
             * the inner sequences throws after it. */
            try {
                close();
            }
            catch {
                /* Nothing to do: every inner has been let go. */
            }
            subscriber.error(err);
        };
        const finish = () => {
            if (closed || !upstream_done || live > 0) return;
            close();
            subscriber.complete();
        };

        const start = (key, rec) => {
            const sub = factory(key).subscribe({
                next (value) {
                    if (closed || inners.get(key) !== rec) return;
                    subscriber.next({ key, value });
                },
                error (err) {
                    if (inners.get(key) === rec) fail(err);
                },
                complete () {
                    if (rec.done) return;
                    rec.done = true;
                    if (inners.get(key) !== rec) return;
                    live--;
                    finish();
                },
            });
            /* A synchronous inner sequence can end, or the key can
             * leave, before subscribe returns. */
            if (stopped() || inners.get(key) !== rec) sub.unsubscribe();
            else rec.sub = sub;
        };

        const handle = set => {
            if (stats) stats.scanned = (stats.scanned ?? 0) + set.size;

            const added = [];
            for (const key of set)
                if (!inners.has(key)) added.push(key);
            const removed = [];
            for (const key of inners.keys())
                if (!set.has(key)) removed.push(key);

            /* Take the keys that left out of the table first, so
             * nothing they send while the Set value is handled gets
             * through. */
            const gone = removed.map(key => {
                const rec = inners.get(key);
                inners.delete(key);
                if (!rec.done) live--;
                return rec;
            });
            const fresh = added.map(key => {
                const rec = { sub: null, done: false };
                inners.set(key, rec);
                live++;
                return rec;
            });

            subscriber.next({ set, added, removed });

            drop(gone);
            added.forEach((key, i) => {
                if (stopped() || inners.get(key) !== fresh[i]) return;
                start(key, fresh[i]);
            });
        };

        const upstream_sub = upstream.subscribe({
            next (set) {
                if (stopped()) return;
                /* A throw from here would leave the output open and
                 * reach nobody but the process. */
                try {
                    handle(set);
                }
                catch (err) {
                    fail(err);
                }
            },
            error: fail,
            complete () {
                upstream_done = true;
                finish();
            },
        });

        return () => {
            /* Let go of the upstream whatever an inner throws. */
            try {
                close();
            }
            finally {
                upstream_sub?.unsubscribe();
            }
        };
    });
}

/* True when two Sets hold the same members. Either can be a native Set
 * or anything else with `size`, `has` and iteration. */
export function same_set (a, b) {
    if (a === b) return true;
    if (a.size !== b.size) return false;
    for (const member of a)
        if (!b.has(member)) return false;
    return true;
}

/* The members that are in exactly one of two Sets, as a native Set. */
export function set_changes (a, b) {
    const changes = new Set();
    for (const member of a)
        if (!b.has(member)) changes.add(member);
    for (const member of b)
        if (!a.has(member)) changes.add(member);
    return changes;
}

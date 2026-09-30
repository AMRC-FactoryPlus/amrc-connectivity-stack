/*
 * ACS ConfigDB
 * RX utility functions
 * Copyright 2024 University of Sheffield
 */

import * as rx from "rxjs";

/* This will be in RxJS 8 as rx.rx. This is the final result of waiting
 * for suitable JS pipe syntax that never came... */
function rx_rx (src, ...pipe) {
    return rx.pipe(...pipe)(rx.from(src));
}
export { rx_rx as rx };

/* This is like `scan`, but allows for the preserved state and the value
 * returned down the pipeline to be different. */
export function withState (initial, accum) {
    return upstream => new rx.Observable(subscriber => {
        let state = initial;
        return upstream.subscribe({
            next (value) {
                const [st, val] = accum(state, value);
                state = st;
                subscriber.next(val);
            },
            error (err) { subscriber.error(err); },
            complete () { subscriber.complete(); },
        });
    });
}

/* Run an async function when the upstream emits, with at most one call
 * in flight. Upstream values that arrive while a call is running are
 * collapsed into a single further call, which starts once the running
 * call has finished. The upstream values themselves are ignored.
 *
 * Every upstream value is followed by the start of a call, either at
 * once or after the running call. So the last call always starts after
 * the last upstream value: nothing is lost at the end of a burst. */
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

/* Split a seq by key. Returns a function which takes a key and returns
 * a seq of the source values with that key. The source is subscribed
 * once, here, and each value goes only to the subscribers for its key.
 * So the cost of a value does not grow with the number of keys being
 * watched, as it would with one `filter` per subscriber. */
export function keyed (source, keyfn) {
    const subjects = new Map();
    source.subscribe(value => subjects.get(keyfn(value))?.next(value));

    return key => new rx.Observable(subscriber => {
        let subject = subjects.get(key);
        if (!subject) {
            subject = new rx.Subject();
            subjects.set(key, subject);
        }
        const sub = subject.subscribe(subscriber);
        return () => {
            sub.unsubscribe();
            if (!subject.observed && subjects.get(key) === subject)
                subjects.delete(key);
        };
    });
}

/* This is like `withState` but the accumulator function is async. */
export function asyncState (initial, accum) {
    return upstream => new rx.Observable(subscriber => {
        let state = initial;
        return upstream.subscribe({
            next (value) {
                accum(state, value)
                    .then(([st, val]) => {
                        state = st;
                        subscriber.next(val);
                    });
            },
            error (err) { subscriber.error(err); },
            complete () { subscriber.complete(); },
        });
    });
}

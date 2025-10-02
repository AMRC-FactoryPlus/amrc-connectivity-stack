/*
 * ACS Rx utilities
 * State-handling operators.
 * Copyright 2025 University of Sheffield AMRC
 */

import * as rx  from "rxjs";

/** Map over an Observable with state.
 * This is an Rx operator; call within `pipe`.
 *
 * This is like `scan` but the values sent down the sequence are
 * different from the state. The accumulator is a function from `(state,
 * value)` to `[new_state, new_value]`; the new state is preserved for
 * the next call and the new value is passed downstream.
 *
 * @arg initial The initial state. Not optional.
 * @arg accum The accumulator function.
 */
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

/** Map asyncronously over an Observable, with state.
 * This is an Rx operator.
 *
 * This is like `withState` but the accumulator function is async. This
 * operator is deprecated; it doesn't handle concurrency correctly.
 *
 * @deprecated
 * @arg initial The initial state.
 * @arg accum The async accumulator function.
 */
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

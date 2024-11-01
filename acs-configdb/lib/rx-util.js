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

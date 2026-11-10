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

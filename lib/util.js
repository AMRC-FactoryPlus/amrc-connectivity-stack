/*
 * ACS Rx utilities
 * Random useful functions
 * Copyright 2023 AMRC
 */

import rx from "rxjs";

export function log_observer (log, label) {
    return {
        next:       v => log("NEXT %s: %o", label, v),
        error:      e => log("ERROR %s: %o", label, e),
        complete:   () => log("COMPLETE %s", label),
    };
}

export const console_observer = log_observer.bind(null, console.log);

/* Retry with backoff. Logs caught errors to the optional log function.
 * Retry delay defaults to 5s and will back off to 64*. */
export function retry_backoff (delay, log) {
    delay ??= 5000;
    log ??= (e => {});

    return rx.retry({
        delay: (err, n) => {
            log(err);
            const p = n < 7 ? n - 1 : 6;
            return rx.timer(delay * (2 ** p));
        },
        resetOnSuccess: true,
    });
}

export class StoppedError extends Error { }

/* Ensure a sequence runs forever. Competions throw StoppedError and
 * then retry. */
export function forever (...args) {
    return rx.pipe(
        rx.concatWith(rx.throwError(() => 
            new StoppedError("Observable completed unexpectedly"))),
        retry_backoff(...args),
    );
}

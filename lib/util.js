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

/* Cache the latest value and return it to new subscribers. */
export function shareLatest (...args) {
    /* Use varargs so we can support an explicit undefined */
    const connector = args.length
        ? () => new rx.BehaviorSubject(args[0])
        : () => new rx.ReplaySubject(1);

    return rx.share({
        connector,
        /* We don't expect our sources to error or complete. If they do
         * we want our consumers to have the option to retry. */
        resetOnError:       true,
        resetOnComplete:    true,
        /* Delay reset on no subscribers. This may be transient (a
         * single subscriber retrying) and in that case we don't want to
         * restart our source. */
        resetOnRefCountZero: () => rx.timer(1000),   
    });
}

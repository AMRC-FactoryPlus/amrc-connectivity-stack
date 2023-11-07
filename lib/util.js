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

/* Ensure a sequence runs forever. Wait for the supplied delay between
 * restarts. Error restarts will back off exponentially to 64* the
 * provided delay; completion restarts will not. Delay defaults to 5
 * seconds. */
export function forever (delay, log) {
    delay ??= 5000;
    log ??= (e => {});

    return rx.pipe(
        rx.repeat({ delay }),
        rx.retry({
            delay: (err, n) => {
                log(err);
                const p = n < 7 ? n - 1 : 6;
                return rx.timer(delay * (2 ** p));
            },
            resetOnSuccess: true,
        }),
    );
}

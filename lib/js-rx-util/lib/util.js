/*
 * ACS Rx utilities
 * Random useful functions
 * Copyright 2023 AMRC
 */

import * as rx  from "rxjs";

/* This will be in RxJS 8 as rx.rx. This is the final result of waiting
 * for suitable JS pipe syntax that never came... */
function rx_rx (src, ...pipe) {
    return rx.pipe(...pipe)(rx.from(src));
}
export { rx_rx as rx };

export function logObserver (log, label) {
    return {
        next:       v => log("NEXT %s: %o", label, v),
        error:      e => log("ERROR %s: %o", label, e),
        complete:   () => log("COMPLETE %s", label),
    };
}
export { logObserver as log_observer };

export const consoleObserver = logObserver.bind(null, console.log);
export { consoleObserver as console_observer };

/* Retry with backoff. Logs caught errors to the optional log function.
 * Retry delay defaults to 5s and will back off to 64*. */
export function retryBackoff (delay, log) {
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
export { retryBackoff as retry_backoff };

export class StoppedError extends Error { }

/* Ensure a sequence runs forever. Competions throw StoppedError and
 * then retry. */
export function forever (...args) {
    return rx.pipe(
        rx.concatWith(rx.throwError(() => 
            new StoppedError("Observable completed unexpectedly"))),
        retryBackoff(...args),
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

/* Emit nulls after each time interval, with random jitter. */
export function jitterInterval (each, jitter) {
    return rx_rx(
        rx.of(null),
        rx.repeat({ 
            delay: () => rx.timer(each + Math.random()*jitter),
        }),
        rx.skip(1),
    );
}

/* Wrap a sequence-generating function and cache the results.
 *
 * Accepts a function (the factory) or an object with these keys:
 *
 * `factory`:   The function to wrap.
 * `replay`:    If true, returned seqs will replay the last value.
 * `initial`:   Initial value for replay.
 * `timeout`:   Timeout to expire a seq with no subscribers.
 *
 * The factory function must accept one argument and return a sequence.
 * This sequence will be shared with `rx.share` and cached against the
 * argument. Subsequent calls with the same argument will return the
 * same sequence. The inner seq will be unsubscribed and cleared from
 * the cache when the outer seq has had no subscribers for `timeout` ms;
 * after that a new call or new subscription will call `factory` again.
 *
 * If `replay` is true: use a ReplaySubject(1) to share. If `initial` is
 * supplies: use a BehaviorSubject(initial) to share.
 */
export function cacheSeq (opts) {
    if (opts instanceof Function)
        opts = { factory: opts };

    const connector = 
        "initial" in opts   ? () => new rx.BehaviorSubject(opts.initial)
        : opts.replay       ? () => new rx.ReplaySubject(1)
        : undefined;
    const timeout = opts.timeout ?? 5000;

    const cache = new Map();

    /* Use defer() so every subscription rechecks the cache */
    return arg => rx.defer(() => {
        if (cache.has(arg))
            return cache.get(arg);
        const seq = rx_rx(
            opts.factory(arg),
            rx.finalize(() => cache.delete(arg)),
            rx.share({
                connector,
                resetOnError:           true,           
                resetOnComplete:        true,
                resetOnRefCountZero:    () => rx.timer(timeout),
            }));
        cache.set(arg, seq);
        return seq;
    });
}

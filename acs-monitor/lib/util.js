/*
 * ACS Monitor component
 * Random utilities
 * Copyright 2024 AMRC
 */

import * as rx from "rxjs";

/* This will be in RxJS 8 as rx.rx. This is the final result of waiting
 * for suitable JS pipe syntax that never came... */
export function rx_rx (src, ...pipe) {
    return rx.pipe(...pipe)(rx.from(src));
}

/* Guard against unhandled promise rejections killing the process.
 *
 * The `mqtt` client library creates internal Promises (e.g. for
 * subscribe acknowledgement) that we never see or hold a reference to.
 * If the underlying connection drops while one of those is pending, the
 * library can reject it with nothing attached to observe the rejection,
 * and Node's default `unhandledRejection` behaviour is to crash the
 * process (see issue #746). A dropped MQTT connection is a routine,
 * recoverable event - the client already reconnects on its own - so it
 * should never be able to take the whole service down.
 *
 * This mirrors how we already handle failures one layer up: a failed
 * fetch (e.g. to cmdescd) is caught and logged without crashing (see
 * fetch.js), and this is the same policy applied at the process
 * boundary for rejections that don't have an application-level catch to
 * land in.
 */
export function ignore_unhandled_rejections (fplus) {
    const log = fplus.debug.bound("process");
    process.on("unhandledRejection", reason =>
        log("Unhandled rejection, ignoring: %s", reason));
}

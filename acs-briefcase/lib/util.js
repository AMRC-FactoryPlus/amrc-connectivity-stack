/*
 * ACS Briefcase exporter
 * Small helpers
 * Copyright 2026 University of Sheffield
 */

import * as imm         from "immutable";
import * as rx          from "rxjs";

/** Copy an object without its null and undefined properties, so they
 * don't appear in the JSON at all. */
export function defined (obj) {
    return Object.fromEntries(
        Object.entries(obj).filter(([, v]) => v != null));
}

/** Watch the members of a class, as an immutable Set.
 *
 * ConfigDB's `watch_members` reads a failed response, such as a 403
 * while a grant is missing, as an empty class. Here a failed response
 * is logged and the watch is opened again after a delay, while the
 * last good membership stands: an empty Published class would withdraw
 * every briefcase. ConfigDB only checks the grant again when the class
 * changes, so waiting on the same watch could take days.
 *
 * @param opts.cdb The ConfigDB interface.
 * @param opts.klass The class UUID.
 * @param opts.log A function to log failures with.
 * @param opts.delay How long to wait before watching again, in ms.
 */
export function watch_members ({ cdb, klass, log, delay }) {
    const url = `v2/class/${klass}/member/`;
    return rx.defer(() => cdb.notify.watch_full(url)).pipe(
        rx.map(res => {
            if (!res.isOK)
                throw new Error(`Can't read the members of ${klass}: ${res.status}`);
            return imm.Set(res.body);
        }),
        rx.retry({ delay: e => {
            log("%s, watching again in %ds", e.message, delay / 1000);
            return rx.timer(delay);
        } }),
        rx.distinctUntilChanged(imm.is));
}

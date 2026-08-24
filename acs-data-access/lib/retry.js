/*
 * ACS Data Access Service
 * Bounded retry for ConfigDB writes.
 */

import * as rx from "rxjs";

import { retryBackoff } from "@amrc-factoryplus/rx-util";
import { APIError } from "@amrc-factoryplus/service-api";

/* Base delay before the first retry. The backoff doubles each time, so
 * MAX_RETRIES retries take 500 + 1000 + 2000 + 4000 = 7.5s in total.
 * That covers a ConfigDB pod restart or a short database stall without
 * holding an HTTP request open for long enough to matter. */
export const RETRY_DELAY = 500;

/* Number of retries after the first attempt, so five attempts in all.
 * Any cap at all removes the failure mode this replaces: an error that
 * never clears used to be retried forever. Five is enough for a
 * transient fault and small enough that a client which keeps retrying
 * cannot generate meaningful load on ConfigDB. */
export const MAX_RETRIES = 4;

/* Status reported by the service client when it could not connect at
 * all. */
const CONNECTION_FAILED = 0;

/** Decide whether an error is worth retrying.
 * A 4xx from ConfigDB is a settled answer: the request is not allowed,
 * or the object does not exist. Asking again cannot change it, and each
 * attempt costs ConfigDB a permission check. A 5xx, a connection
 * failure, or an error with no status at all may clear on its own.
 * @arg err The error thrown by the service client.
 * @returns True if the operation should be retried.
 */
export function is_transient_error (err) {
    const status = err?.status;
    if (typeof status != "number") return true;
    if (status == CONNECTION_FAILED) return true;
    return status < 400 || status > 499;
}

/** Map a ConfigDB error onto a status to return to our client.
 * A ServiceError which reaches the WebAPI error handler unchanged is
 * reported as 503, which tells the client to try again. That is wrong
 * for a 4xx. Pass the ConfigDB status through instead, so a caller who
 * is not allowed to link to a source sees 403 and a caller naming a
 * source which no longer exists sees 404.
 */
function api_status (err) {
    const status = err?.status;
    if (typeof status != "number") return 500;
    if (status >= 400 && status <= 499) return status;
    return 503;
}

/** Run a ConfigDB write with a bounded retry.
 * Transient failures are retried with backoff, up to MAX_RETRIES times.
 * Non-transient failures fail at once. Either way a failure is logged
 * with the dataset UUID and the status, and then thrown as an APIError
 * so the dataset operation fails rather than reporting success with the
 * relationship missing.
 * @arg opts.log The logging function to use.
 * @arg opts.dataset The dataset UUID the write belongs to.
 * @arg opts.what A description of the write, for the log.
 * @arg opts.op A function returning a promise for the write.
 * @arg opts.delay Base backoff in ms. Defaults to RETRY_DELAY. Used by
 * the tests to keep the backoff short.
 */
export async function retry_cdb_write (opts) {
    const { log, dataset, what, op } = opts;
    const delay = opts.delay ?? RETRY_DELAY;

    try {
        await rx.lastValueFrom(
            rx.defer(op).pipe(retryBackoff(delay, e => log(
                "Retrying %s for dataset %s: %s", what, dataset, e), {
                count:          MAX_RETRIES,
                shouldRetry:    is_transient_error,
            })),
            /* class_add_subclass resolves with no value. */
            { defaultValue: undefined });
    }
    catch (err) {
        const status = err?.status ?? "no status";
        const reason = is_transient_error(err)
            ? `gave up after ${MAX_RETRIES} retries`
            : "will not retry";
        log("ConfigDB %s for dataset %s failed (status %s), %s: %s",
            what, dataset, status, reason, err);
        throw new APIError(api_status(err));
    }
}

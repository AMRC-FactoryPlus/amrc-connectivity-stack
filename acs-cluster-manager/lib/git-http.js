/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Deployment operator
 * HTTP client for isomorphic-git, with a longer timeout and retries
 * Copyright 2026 University of Sheffield
 */

import http         from "http";
import https        from "https";
import { setTimeout as sleep } from "timers/promises";

import git_http     from "isomorphic-git/http/node";

/* isomorphic-git's Node client uses the global HTTP agent unless it
 * is given one, and since Node 19 the global agent gives up on a
 * socket after 5 seconds without data. The Git service can take
 * longer than that to answer when it has to look up our permissions
 * from cold, so we use our own agents with a longer timeout. */
export const DEFAULT_TIMEOUT = 30000;

/* Retry a failed request after these delays, so three tries in all. */
export const RETRY_DELAYS = [1000, 3000];

/* Network errors which mean the request never got a definite answer. */
const RETRY_CODES = new Set([
    "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE",
    "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH",
]);

/* HTTP statuses from a proxy or a service which is restarting. */
const RETRY_STATUSES = new Set([502, 503, 504]);

/** Parse the timeout in ms from the environment, with a default. */
export function git_timeout (value) {
    const ms = Number.parseInt(value, 10);
    return Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_TIMEOUT;
}

const clients = new Map();

/** An isomorphic-git `http` client with the given socket timeout.
 * Clients are shared so the agents can keep connections alive. */
export function http_client (timeout) {
    if (clients.has(timeout))
        return clients.get(timeout);

    const agents = {
        "http:":    new http.Agent({ keepAlive: true, timeout }),
        "https:":   new https.Agent({ keepAlive: true, timeout }),
    };
    const client = {
        request: opts => git_http.request({
            ...opts,
            agent:  opts.agent ?? agents[new URL(opts.url).protocol],
        }),
    };
    clients.set(timeout, client);
    return client;
}

/** Should we try a failed git request again?
 * Only for timeouts, network errors and gateway errors. Auth failures
 * and other answers from the Git service are definite. */
export function is_retryable (err) {
    if (!err) return false;
    /* simple-get, under isomorphic-git, reports a socket timeout like
     * this, with no code. */
    if (err.message == "Request timed out") return true;
    if (RETRY_CODES.has(err.code)) return true;
    if (err.code == "HttpError")
        return RETRY_STATUSES.has(err.data?.statusCode);
    return false;
}

/** Call `fn`, retrying it if it fails with a retryable error.
 * @arg fn An async function to call
 * @arg opts.delays Delays in ms before each retry
 * @arg opts.on_retry Called as (err, attempt, delay) before a retry
 * @arg opts.sleep Override the delay function, for tests
 */
export async function with_retry (fn, opts) {
    const delays = opts?.delays ?? RETRY_DELAYS;
    const wait = opts?.sleep ?? sleep;

    for (let attempt = 1; ; attempt++) {
        try {
            return await fn();
        }
        catch (err) {
            const delay = delays[attempt - 1];
            if (delay == undefined || !is_retryable(err))
                throw err;
            opts?.on_retry?.(err, attempt, delay);
            await wait(delay);
        }
    }
}

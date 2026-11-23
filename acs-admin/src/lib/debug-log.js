/*
 * ACS Admin
 * Debug logging that only runs when Verbose logging is on
 * Copyright 2026 University of Sheffield
 */

/* The stores and the edge agent config updater log every change they
 * see, some with whole lists (every device, every connection). With
 * DevTools showing verbose messages that is thousands of lines, and
 * each one keeps its list alive in memory. They now log only when the
 * person ticked Verbose logging at sign-in (the same setting that turns
 * on the service client's own logging), or the build sets VERBOSE. */

let cached = null;
let checked = 0;

/** Whether Verbose logging is on. Read at most once a second. */
export function verbose () {
    const now = Date.now();
    if (cached !== null && now - checked < 1000) return cached;
    checked = now;
    let setting = "";
    try {
        setting = JSON.parse(localStorage.getItem("opts") ?? "{}")?.verbose ?? "";
    }
    catch { /* no storage, or not JSON: off */ }
    cached = Boolean(setting || import.meta.env?.VERBOSE);
    return cached;
}

/** console.debug, when Verbose logging is on. */
export function debug_log (...args) {
    if (verbose()) console.debug(...args);
}

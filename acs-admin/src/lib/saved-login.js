/*
 * ACS Admin
 * The sign-in details kept so a page reload stays signed in
 * Copyright 2026 University of Sheffield
 */

/* The service client signs in to each service with the username and
 * password, and each service's bearer token lives only in that
 * service's memory, so there is no single token we could keep instead.
 * We keep the sign-in details in sessionStorage: a reload in the same
 * tab stays signed in, and closing the tab or the browser forgets
 * them. They used to live in localStorage, where the password stayed
 * on disk until someone pressed Sign out. */

const KEY = "opts";

function session () {
    try { return globalThis.sessionStorage ?? null; }
    catch { return null; }
}

function local () {
    try { return globalThis.localStorage ?? null; }
    catch { return null; }
}

/** Move details an older Admin left in localStorage into this tab's
 * session, and delete them from localStorage either way. */
function migrate () {
    const old = local();
    let json = null;
    try {
        json = old?.getItem(KEY) ?? null;
        if (json != null) old.removeItem(KEY);
    }
    catch { /* storage refused: nothing to move */ }
    if (json == null) return;

    try {
        const s = session();
        if (s && s.getItem(KEY) == null)
            s.setItem(KEY, json);
    }
    catch { /* no session storage: they sign in again */ }
}

/** The saved sign-in options, or null if there are none. */
export function load_login () {
    migrate();
    try {
        const json = session()?.getItem(KEY);
        return json ? JSON.parse(json) : null;
    }
    catch {
        return null;
    }
}

/** Keep the sign-in options for this tab's session. */
export function save_login (opts) {
    try { session()?.setItem(KEY, JSON.stringify(opts)); }
    catch { /* no storage: a reload asks them to sign in */ }
}

/** Forget the sign-in options, here and anywhere an older Admin left them. */
export function clear_login () {
    for (const s of [session(), local()]) {
        try { s?.removeItem(KEY); }
        catch { /* nothing to clear */ }
    }
}

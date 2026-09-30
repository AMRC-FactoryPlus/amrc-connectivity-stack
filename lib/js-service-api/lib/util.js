/*
 * Factory+ Service HTTP API
 * Random utility functions
 * Copyright 2025 University of Sheffield AMRC
 */

/**
 * Performs internal forwarding within Express.
 * @param dest The internal URL to forward to.
 * @returns An Express middleware function.
 */
export function forward (dest) {
    const pieces = dest.split("/");
    return (req, res, next) => {
        req.url = pieces
            .map(p => p[0] == ":"
                ? req.params[p.slice(1)]
                : p)
            .join("/");
        req.log?.("FORWARD: -> %s", req.url);
        req.app.handle(req, res);
    };
}

/** Perform merge-patch matching.
 * Tests if a candidate value matches a filter. Values match if a
 * merge-patch of the filter onto the candidate would make no change.
 * @arg cand Candidate value to test.
 * @arg filter Filter to test against.
 */
export function jmp_match (cand, filter) {
    if (filter === null || typeof(filter) != "object")
        return cand === filter;
    if (Array.isArray(filter))
        return deep_equal(cand, filter);

    for (const [k, v] of Object.entries(filter)) {
        if (v === null) {
            if (k in cand)
                return false;
        }
        else {
            if (!(k in cand) || !jmp_match(cand[k], v))
                return false;
        }
    }
    return true;
}

/** Compare two JSON values.
 * Objects are equal if they have the same own keys, in any order, with
 * equal values. Arrays are equal if they have equal elements in the
 * same order. Anything else compares with `===`. This is meant for
 * values that will be sent as JSON; it doesn't handle Maps, Sets,
 * Dates or other types JSON can't carry.
 * @arg a A JSON value.
 * @arg b Another JSON value.
 */
export function json_equal (a, b) {
    if (a === b) return true;
    if (typeof a != "object" || typeof b != "object" || !a || !b)
        return false;

    const array = Array.isArray(a);
    if (array != Array.isArray(b)) return false;
    if (array) {
        if (a.length != b.length) return false;
        for (let i = 0; i < a.length; i++)
            if (!json_equal(a[i], b[i])) return false;
        return true;
    }

    const keys = Object.keys(a);
    if (keys.length != Object.keys(b).length) return false;
    for (const k of keys)
        if (!Object.hasOwn(b, k) || !json_equal(a[k], b[k])) return false;
    return true;
}

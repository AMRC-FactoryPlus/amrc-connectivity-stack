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
        return json_equal(cand, filter);

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

/** Compare two values as they will be sent as JSON.
 * A value with a `toJSON` method is replaced with its result first, at
 * every level, as `JSON.stringify` does; so Dates compare as their ISO
 * strings, and Immutable collections and Buffers as plain objects and
 * arrays. Objects are then equal if they have the same own keys, in any
 * order, with equal values. Arrays are equal if they have equal
 * elements in the same order. Anything else compares with `===`. If
 * this returns true the JSON is the same. It can return false for
 * values with the same JSON, such as `{ a: undefined }` and `{}`, or
 * `NaN` and `null`; that only means a repeat is not dropped.
 * @arg a A value to compare.
 * @arg b Another value to compare.
 */
export function json_equal (a, b) {
    if (typeof a?.toJSON == "function") a = a.toJSON();
    if (typeof b?.toJSON == "function") b = b.toJSON();
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

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

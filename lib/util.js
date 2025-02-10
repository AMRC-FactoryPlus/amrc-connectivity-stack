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
        this.log("FORWARD: -> %s", req.url);
        req.app.handle(req, res);
    };
}

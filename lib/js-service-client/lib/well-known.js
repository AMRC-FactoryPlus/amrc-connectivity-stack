/*
 * Factory+ JS ServiceClient
 * Well-known UUID lookups
 * Copyright 2025 University of Sheffield AMRC
 */

import util from "util";

const uuid_rx = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/* grr */
function bad (str) {
    throw new Error(util.format("Bad UUID: %s", str));
}

function u_flat (obj) {
    const es = obj instanceof Map
        ? [es.entries()]
        : Object.entries(obj);
    return es.flatMap(([k, v]) =>
        typeof v == "string" ?
            uuid_rx.test(v) ? [[k, v]]
            : bad(v)
        : u_flat(v)
            .map(([s, v]) => [`${k}.${s}`, v]));
}

export class WellKnown {
    constructor (opts) {
        this.wk = new Map(u_flat(opts.uuids));
    }

    lookup (str) {
        if (uuid_rx.test(str))
            return str;
        const u = this.wk.get(str);
        if (u)
            return u;
        bad(str);
    }
}

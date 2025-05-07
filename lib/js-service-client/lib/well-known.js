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

/** Class supporting lists of well-known UUIDs. */
export class WellKnown {
    /** Construct a WellKnown.
     * Arguments are passed as an object. The UUIDs list should be a
     * nested object of names of UUIDs, as used throughout ACS.
     * @arg uuids A tree of names for UUIDs.
     */
    constructor (opts) {
        this.wk = new Map(u_flat(opts.uuids));
    }

    /** Look up a UUID by name.
     * If the given string is already a UUID, return it.
     * Otherwise look up as a dot-separated name.
     * Throws if the string can't be translated.
     * @arg str A string to convert to UUID.
     * @returns A UUID string
     */
    lookup (str) {
        if (uuid_rx.test(str))
            return str;
        const u = this.wk.get(str);
        if (u)
            return u;
        bad(str);
    }
}

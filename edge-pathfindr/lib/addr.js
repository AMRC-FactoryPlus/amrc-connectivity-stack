/*
 * ACS Pathfindr driver
 * Address parsing.
 * Copyright 2026 University of Sheffield AMRC
 */

/* Pathfindr addresses name a piece of data, not an endpoint. The driver
 * translates them into requests, so an operator never needs to know that
 * "the latest temperature" lives on the asset collection rather than on the
 * enviro history endpoint.
 *
 * A parsed address is:
 *
 *   {
 *     addr,                             the original string, for logging
 *     req:    { key, path, query, collection },
 *     select: { ident, field } | null
 *   }
 *
 * `req.key` is the cache key: every address that resolves to the same
 * upstream request shares one, which is what keeps a hundred configured
 * metrics down to a handful of API calls. `select` picks one asset out of a
 * collection, and optionally one field out of that asset.
 */

/* Collections covering the whole estate. Every per-asset address is served
 * out of one of these rather than by fetching that asset on its own. */
const Collections = new Map([
    ["assets",      "assets"],
    ["activity",    "assets/activitydata"],
    ["runtime",     "assets/runtimedata"],
]);

/* Projections of a single asset record from the asset collection. These cost
 * nothing extra: the data is already in the sweep. */
const Projections = new Map([
    ["enviro",      "enviro"],
    ["fluid",       "fluid_level_latest"],
    ["location",    "location_data"],
    ["attrs",       "attrs"],
]);

/* Per-serial history endpoints. These cannot be served from a collection, so
 * each configured history metric is its own request. */
const Histories = new Map([
    ["envirohistory",   "assets/envirohistory"],
    ["impacthistory",   "assets/impacthistory"],
    ["runtimehistory",  "assets/runtimehistory"],
    ["activityhistory", "assets/activitydatahistory"],
]);

/* Sub-resources of a building or a cell. */
const SubResources = new Map([
    ["buildings",   new Set(["cells", "assets"])],
    ["cells",       new Set(["zones", "assets"])],
]);

/** Build the cache key for a request. Addresses sharing a key share a fetch. */
function req_key (path, query) {
    const qs = Object.entries(query ?? {})
        .filter(([, v]) => v != null && v !== "")
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([k, v]) => `${k}=${v}`)
        .join("&");
    return qs ? `${path}?${qs}` : path;
}

function request (path, opts) {
    const query = opts?.query ?? {};
    return {
        key:        req_key(path, query),
        path, query,
        collection: opts?.collection ?? false,
    };
}

/** A Pathfindr numeric object id. */
function valid_id (str) {
    return /^[0-9]+$/.test(str);
}

/** A serial number. Pathfindr serials are free-form and vary by site, so we
 * only reject what would break the address grammar or the query string. */
function valid_serial (str) {
    return str.length > 0 && str.length <= 128 && !/[/?#&]/.test(str);
}

/**
 * Parse a Pathfindr address.
 *
 * This must stay a pure function of its argument: the driver library calls
 * it unbound and may call it before the handler has connected.
 *
 * @param {string} addr The address from the Edge Agent.
 * @returns {object|undefined} A spec, or undefined if the address is invalid.
 */
export function parse_addr (addr) {
    if (typeof addr != "string") return;

    const parts = addr.trim().split("/");
    if (parts.length < 1 || parts.length > 3) return;
    if (parts.some(p => p === "")) return;

    const [head, second, third] = parts;

    /* A whole collection: "assets", "runtime", "activity". */
    if (parts.length == 1) {
        const path = Collections.get(head);
        if (!path) return;
        return {
            addr,
            req:    request(path, { collection: true }),
            select: null,
        };
    }

    if (parts.length == 2) {
        /* One asset out of a collection: "assets/SN123". */
        const coll = Collections.get(head);
        if (coll) {
            if (!valid_serial(second)) return;
            return {
                addr,
                req:    request(coll, { collection: true }),
                select: { ident: second, field: null },
            };
        }

        /* A projection of one asset: "enviro/SN123". Served from the asset
         * collection, so it costs nothing beyond the sweep already made. */
        const field = Projections.get(head);
        if (field) {
            if (!valid_serial(second)) return;
            return {
                addr,
                req:    request(Collections.get("assets"), { collection: true }),
                select: { ident: second, field },
            };
        }

        /* A per-serial history endpoint. */
        const hist = Histories.get(head);
        if (hist) {
            if (!valid_serial(second)) return;
            return {
                addr,
                req:    request(hist, {
                    query:      { serial: second },
                    collection: true,
                }),
                select: null,
            };
        }

        /* A single building: "buildings/55". Cells have no single-object
         * endpoint of their own, only sub-resources. */
        if (head == "buildings") {
            if (!valid_id(second)) return;
            return {
                addr,
                req:    request(`buildings/${second}`),
                select: null,
            };
        }

        return;
    }

    /* Three parts: a sub-resource, "buildings/55/cells". */
    const subs = SubResources.get(head);
    if (!subs || !subs.has(third)) return;
    if (!valid_id(second)) return;

    return {
        addr,
        req:    request(`${head}/${second}/${third}`, { collection: true }),
        select: null,
    };
}

/**
 * Pick the requested value out of a fetched body.
 *
 * @param {*} body The normalised response.
 * @param {object|null} select The spec's select clause.
 * @returns {*} The value, or undefined if the asset or field is absent.
 */
export function select_value (body, select) {
    if (!select) return body;

    const list = Array.isArray(body) ? body : [body];
    /* Serials are compared as strings; Pathfindr returns them as strings but
     * an all-digits serial could plausibly arrive as a number. */
    const rec = list.find(r => r != null && String(r.serialno) === String(select.ident));
    if (!rec) return;

    return select.field ? rec[select.field] : rec;
}

/** Addresses the driver understands, for documentation and the UI panel. */
export const ADDRESS_FORMS = [
    ...[...Collections.keys()].map(k => k),
    ...[...Collections.keys()].map(k => `${k}/<serial>`),
    ...[...Projections.keys()].map(k => `${k}/<serial>`),
    ...[...Histories.keys()].map(k => `${k}/<serial>`),
    "buildings/<id>",
    "buildings/<id>/cells",
    "buildings/<id>/assets",
    "cells/<id>/zones",
    "cells/<id>/assets",
];

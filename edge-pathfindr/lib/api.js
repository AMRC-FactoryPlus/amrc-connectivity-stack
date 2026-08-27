/*
 * ACS Pathfindr driver
 * Pathfindr v5 API client.
 * Copyright 2026 University of Sheffield AMRC
 */

import timers from "timers/promises";

/* Pathfindr permits 120 calls per minute across the whole tenant. The Edge
 * Agent polls per address, so a driver that made one call per address would
 * saturate a site's entire budget at about twenty metrics. Everything in
 * this file exists to decouple API cost from metric count:
 *
 *   - collection endpoints are fetched whole and cached, so any number of
 *     per-asset metrics ride on one sweep;
 *   - concurrent polls for the same collection await one in-flight request;
 *   - a sliding window keeps us under the limit whatever else happens.
 */

const DEFAULTS = {
    cacheMs:    60000,
    rateLimit:  110,
    timeout:    15000,
    maxPages:   20,
    perPage:    null,
};

/* Refresh a token once it is this far through its stated life.
 *
 * The documented example shows `expires_in: 63115200`, which is two years.
 * The real service does not do that: portal.pathfindr.co.uk issues JWTs with
 * `expires_in: 1200`, so twenty minutes. Trust the field, never the example.
 *
 * That difference matters more than it looks. At two years this refresh path
 * would never run in production and any bug in it would sit undiscovered; at
 * twenty minutes it runs several times an hour on every connection. */
const TOKEN_REFRESH_AT = 0.9;

/* Cached entries are dropped once the map grows past this. Bounded so a
 * long-running driver polling many histories cannot grow without limit. */
const CACHE_MAX = 500;

/** How long we are prepared to block a poll waiting for a rate-limit slot.
 * Beyond this the poll gives up; the Edge Agent will ask again shortly. */
const SLOT_WAIT_MS = 10000;

/* Statuses from the token endpoint that mean the service is having a bad
 * time rather than that our credentials are wrong.
 *
 * Everything else is treated as a credentials problem, which is not what
 * the OAuth2 spec would suggest but is what Pathfindr actually does:
 * observed against portal.pathfindr.co.uk in August 2026, a well-formed
 * request carrying a bad client_id or client_secret returns
 * `500 {"message":""}` rather than `401 invalid_client`.
 *
 * Getting this wrong is expensive in one direction in particular. Report a
 * wrong secret as a connection failure and the operator goes hunting
 * firewalls and DNS for something that is a typo in a config field. */
const GATEWAY_STATUS = new Set([502, 503, 504]);

export class PathfindrError extends Error {
    constructor (kind, message) {
        super(message);
        this.name = "PathfindrError";
        /* "auth" and "conn" map onto driver connection states; "http" and
         * "rate" are transient and must not tear the connection down. */
        this.kind = kind;
    }
}

/** Flatten one JSON:API resource into something JSONPath can address.
 *
 * Turns { type, id, attributes: { serialno, ... } } into
 * { type, id, serialno, ... } so a path reads `$.serialno` rather than
 * `$.data.attributes.serialno`. */
function flatten_resource (res) {
    if (res == null || typeof res != "object") return res;

    const attrs = res.attributes;
    if (attrs == null || typeof attrs != "object") return res;

    const out = { id: res.id, type: res.type, ...attrs };

    /* Assets carry a list of site-defined attributes. Re-key it by name so
     * a path can reach one directly; the original list stays put. */
    if (Array.isArray(attrs.attributes)) {
        out.attrs = Object.fromEntries(attrs.attributes
            .filter(a => a && typeof a.name == "string")
            .map(a => [a.name, a.value]));
    }

    return out;
}

/** Normalise a response body.
 *
 * Pathfindr is inconsistent here: collections arrive wrapped in `data`, a
 * single asset arrives as a bare resource, and the documented runtime example
 * shows no wrapper at all. Handle all three rather than assuming one. */
export function normalise (body) {
    if (body == null) return body;

    if (Object.hasOwn(body, "data")) {
        const data = body.data;
        return Array.isArray(data)
            ? data.map(flatten_resource)
            : flatten_resource(data);
    }

    if (Object.hasOwn(body, "attributes") || Object.hasOwn(body, "type"))
        return flatten_resource(body);

    return body;
}

/** Sliding-window rate limiter. */
export class RateLimiter {
    constructor (per_minute, now = () => Date.now()) {
        this.limit = per_minute;
        this.now = now;
        this.calls = [];
    }

    /** Drop timestamps that have aged out of the window. */
    prune () {
        const cut = this.now() - 60000;
        while (this.calls.length && this.calls[0] <= cut)
            this.calls.shift();
    }

    /** Take a slot if one is free. Returns false rather than waiting. */
    try_take () {
        this.prune();
        if (this.calls.length >= this.limit) return false;
        this.calls.push(this.now());
        return true;
    }

    /** Milliseconds until the next slot frees, or 0 if one is free now. */
    wait_ms () {
        this.prune();
        if (this.calls.length < this.limit) return 0;
        return Math.max(0, this.calls[0] + 60000 - this.now()) + 1;
    }
}

export class PathfindrAPI {
    constructor (opts) {
        this.log = opts.log ?? (() => {});

        const conf = opts.conf ?? {};
        this.base = String(conf.baseURL ?? "").replace(/\/+$/, "");
        this.client_id = conf.clientId;
        this.client_secret = conf.clientSecret;

        this.cache_ms   = conf.cacheMs   ?? DEFAULTS.cacheMs;
        this.rate_limit = conf.rateLimit ?? DEFAULTS.rateLimit;
        this.timeout    = conf.timeout   ?? DEFAULTS.timeout;
        this.max_pages  = conf.maxPages  ?? DEFAULTS.maxPages;
        this.per_page   = conf.perPage   ?? DEFAULTS.perPage;

        /* Optional scoping, so a site with a large estate can narrow a
         * connection to the assets it cares about. */
        this.filters = {};
        if (conf.filterPartNo) this.filters["filter[partno]"] = conf.filterPartNo;
        if (conf.filterSerial) this.filters["filter[serial]"] = conf.filterSerial;

        this.limiter  = new RateLimiter(this.rate_limit);
        this.token    = null;
        this.cache    = new Map();
        this.inflight = new Map();
        this.closed   = false;
    }

    /** Acquire a token. Returns a driver connection status. */
    async login () {
        this.token = null;
        this.cache.clear();

        if (!this.base || !this.client_id || !this.client_secret) {
            this.log("Missing baseURL, clientId or clientSecret");
            return "CONF";
        }

        try {
            await this.fetch_token();
            this.log("Authenticated to %s", this.base);
            return "UP";
        }
        catch (e) {
            if (e.kind == "auth") {
                /* Name the likely cause. Pathfindr returns an empty 500 for
                 * a wrong client id or secret rather than saying so, and the
                 * secrets are long random strings where l and 1, O and 0 are
                 * easy to transpose. Someone reading this line at 3am should
                 * not have to already know that. */
                this.log("Authentication rejected: %s. Pathfindr answers 500 "
                    + "to a wrong client id or secret, so check those first: "
                    + "watch for l/1 and O/0 in the secret.", e.message);
                return "AUTH";
            }
            this.log("Cannot reach %s: %s", this.base, e.message);
            return "CONN";
        }
    }

    close () {
        this.closed = true;
        this.cache.clear();
        this.inflight.clear();
        this.token = null;
    }

    async fetch_token () {
        const body = new URLSearchParams({
            grant_type:     "client_credentials",
            client_id:      this.client_id,
            client_secret:  this.client_secret,
        });

        const res = await this.raw_fetch(`${this.base}/oauth/token`, {
            method:  "POST",
            headers: {
                "content-type": "application/x-www-form-urlencoded",
                "accept":       "application/json",
            },
            body,
        });

        if (!res.ok) {
            /* See GATEWAY_STATUS: Pathfindr answers bad credentials with a
             * 500, so anything that is not a gateway code is treated as an
             * authentication problem. */
            const kind = GATEWAY_STATUS.has(res.status) ? "conn" : "auth";
            throw new PathfindrError(kind,
                `token endpoint returned ${res.status}`);
        }

        const json = await res.json().catch(() => null);
        const access = json?.access_token;
        if (!access)
            throw new PathfindrError("auth", "token response had no access_token");

        /* Trust the shape of expires_in, not its generosity. */
        const life = Number(json.expires_in);
        const ttl = Number.isFinite(life) && life > 0 ? life * 1000 : 3600000;

        this.token = {
            access,
            expires_at: Date.now() + ttl * TOKEN_REFRESH_AT,
        };
        return this.token;
    }

    async bearer () {
        if (!this.token || Date.now() >= this.token.expires_at)
            await this.fetch_token();
        return this.token.access;
    }

    /** The one place a network call actually happens. Separated so tests can
     * drive the client against a local server without stubbing internals. */
    async raw_fetch (url, init) {
        try {
            return await fetch(url, {
                ...init,
                signal: AbortSignal.timeout(this.timeout),
            });
        }
        catch (e) {
            throw new PathfindrError("conn", e.message ?? String(e));
        }
    }

    /** Wait for a rate-limit slot, up to SLOT_WAIT_MS. */
    async take_slot () {
        const deadline = Date.now() + SLOT_WAIT_MS;
        for (;;) {
            if (this.limiter.try_take()) return;
            const wait = this.limiter.wait_ms();
            if (Date.now() + wait > deadline) {
                throw new PathfindrError("rate",
                    "no rate-limit slot within " + SLOT_WAIT_MS + "ms");
            }
            await timers.setTimeout(Math.min(wait, 1000));
        }
    }

    /** Issue one authenticated GET, retrying once through a fresh token. */
    async get (path, query, retried = false) {
        await this.take_slot();

        const url = new URL(`${this.base}/api/client/v5/${path}`);
        for (const [k, v] of Object.entries(query ?? {})) {
            if (v != null && v !== "") url.searchParams.set(k, v);
        }

        const res = await this.raw_fetch(url, {
            headers: {
                authorization: `Bearer ${await this.bearer()}`,
                accept:        "application/json",
            },
        });

        if (res.status == 401 && !retried) {
            /* The documented token life is long enough that expiry is
             * unlikely, but a revoked or rotated secret looks identical. */
            this.token = null;
            return this.get(path, query, true);
        }
        if (res.status == 401 || res.status == 403)
            throw new PathfindrError("auth", `${path} returned ${res.status}`);
        if (res.status == 429)
            throw new PathfindrError("rate", `${path} was rate limited`);
        if (!res.ok)
            throw new PathfindrError("http", `${path} returned ${res.status}`);

        const json = await res.json().catch(() => null);
        if (json == null)
            throw new PathfindrError("http", `${path} returned unparseable JSON`);
        return json;
    }

    /**
     * Fetch every page of a collection.
     *
     * The vendor documentation is explicit that paging links drop query
     * parameters, so `links.next` is never followed. Pages are constructed
     * here with our own parameters reapplied every time.
     */
    async get_pages (path, query, first_page_only = false) {
        const base_query = { ...this.filters, ...query };
        if (this.per_page) base_query.per_page = this.per_page;

        const first = await this.get(path, { ...base_query, page: 1 });
        const last = Number(first?.meta?.last_page ?? 1);

        /* History addresses want the newest record, not the archive. The
         * enviro endpoint ignores per_page and forces 1440 rows a page, so
         * walking its eight pages would spend eight calls and eleven
         * thousand records to read one current temperature. */
        if (first_page_only) return first;

        if (!Number.isFinite(last) || last <= 1) return first;

        const pages = Math.min(last, this.max_pages);
        if (last > this.max_pages) {
            /* Never let a truncated sweep look like a whole estate. */
            this.log("TRUNCATED %s: fetched %d of %d pages (maxPages=%d); "
                + "assets beyond this will not report. Raise maxPages, "
                + "lengthen cacheMs, or scope the connection with filterPartNo.",
                path, pages, last, this.max_pages);
        }

        const data = Array.isArray(first.data) ? [...first.data] : [];
        for (let page = 2; page <= pages; page++) {
            const next = await this.get(path, { ...base_query, page });
            if (Array.isArray(next?.data)) data.push(...next.data);
        }

        return { ...first, data };
    }

    /** Drop expired cache entries, and the oldest if still over budget. */
    prune_cache () {
        const now = Date.now();
        for (const [k, v] of this.cache) {
            if (now - v.at >= this.cache_ms) this.cache.delete(k);
        }
        while (this.cache.size > CACHE_MAX) {
            const oldest = this.cache.keys().next();
            if (oldest.done) break;
            this.cache.delete(oldest.value);
        }
    }

    /**
     * Fetch a request, from cache when it is fresh.
     *
     * Concurrent callers for the same key share one in-flight request, so a
     * poll of fifty metrics backed by the same collection makes one call.
     */
    async fetch (req) {
        const hit = this.cache.get(req.key);
        if (hit && Date.now() - hit.at < this.cache_ms)
            return hit.value;

        const existing = this.inflight.get(req.key);
        if (existing) return existing;

        const pending = (async () => {
            const body = req.collection
                ? await this.get_pages(req.path, req.query, req.firstPage)
                : await this.get(req.path, { ...req.query });
            return normalise(body);
        })()
            .then(value => {
                if (!this.closed) {
                    this.cache.set(req.key, { at: Date.now(), value });
                    this.prune_cache();
                }
                return value;
            })
            .finally(() => this.inflight.delete(req.key));

        this.inflight.set(req.key, pending);
        return pending;
    }
}

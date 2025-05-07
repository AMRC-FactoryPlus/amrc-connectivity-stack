/*
 * Factory+ NodeJS Utilities
 * HTTP client code.
 * Copyright 2022 AMRC.
 */

import { build_node_fetch, GSS, WebSocket } from "../deps.js";

import { ServiceError, ServiceInterface } from "./service-interface.js";

const Auth_rx = /^([A-Za-z]+) +([A-Za-z0-9._~+/=-]+)$/;

class Warning extends Error {
    constructor (msg, opts) {
        super(msg, opts);
        this.name = "Warning";
    }
}

class ErrorHeaders {
    append () { throw new TypeError("Immutable headers"); }
    delete () { throw new TypeError("Immutable headers"); }
    *entries () { }
    forEach () { }
    get () { return null; }
    has () { return false; }
    *keys () { }
    set () { throw new TypeError("Immutable headers"); }
    *values () { }
}

class ErrorResponse {
    constructor () {
        this.body = null;
        this.headers = new ErrorHeaders();
        this.ok = false;
        this.redirected = false;
        this.status = 0;
        this.statusText = "Network error";
        this.type = "error";
        this.url = null;
    }

    arrayBuffer () { return Promise.reject("Network error"); }
    blob () { return Promise.reject("Network error"); }
    formData () { return Promise.reject("Network error"); }
    json () { return Promise.reject("Network error"); }
    text () { return Promise.reject("Network error"); }
}

function _with_auth (opts, scheme, creds) {
    opts = {...opts};
    opts.headers = {...opts.headers};
    opts.headers.Authorization = `${scheme} ${creds}`;
    return opts;
}

function _idempotent (opts) {
    if (opts.method && opts.method !== "GET")
        return false;
    if (opts.headers) return false;
    return !opts.body;
}

/** HTTP request interface.

This is not an interface to a particular service, but provides HTTP
request facitilies to the other interfaces. This interface handles:

- Discovery of service URLs
- Authentication using Basic or GSSAPI
- Fetching bearer tokens from the `/token` endpoint
- Refreshing tokens when needed

Options (supplied via ServiceClient) are:

- `username`: The username for Basic auth.
- `password`: The password for Basic auth.
- `browser`: This must be set to true if we are running in a browser.
- `cache`: The default cache setting to use.

If username and password are not supplied we will use GSSAPI auth. This
means `KRB5CCNAME` must be set in the environment to the name of a
ccache.

Under Node we use the `got-fetch` library as it provides HTTP caching
support. In the brower we use the native Fetch. Auto-detection is not
reliable so this must be explicitly specified.
*/
export class Fetch extends ServiceInterface {
    /** Private. Construct via ServiceClient. */
    constructor (fplus) {
        super(fplus);
        this.tokens = new Map();
        this.inflight = new Map();

        /** Hook to control caching behaviour.
         * The value of this property will be supplied as the `cache`
         * option to all `fetch` calls. If it is changed to `reload` the
         * server will be contacted for every request.
         *
         * This is global across the whole ServiceClient.
         */
        this.cache = "default";
    }

    /** Make an HTTP request.
Options are supplied as an object. Options not listed are passed
directly to the `fetch` call. If there is a network problem a Response
with status 0 will be returned

Note that the `url` parameter should not begin with a slash. This will
prevent non-root service registrations from working correctly.

@arg service (required) The service UUID
@arg url (required) The URL path, relative to the registered service URL.
@arg query An object of query-string parameters.
@arg method The HTTP method to use, default `GET`.
@arg cache Override the cache option for this request.
@returns A Fetch Response object
*/
    async fetch (opts) {
        try {
            /* XXX Call service_urls instead and find one that works. */
            opts.service_url = await this.fplus.service_url(opts.service);
            const url = new URL(opts.url, opts.service_url);
            if (opts.query)
                url.search = new URLSearchParams(Object.entries(opts.query));

            opts.cache ??= this.cache ?? this.fplus.opts.cache;

            /* Don't mess with stateful requests. */
            if (!_idempotent(opts))
                return await this.do_fetch(url, opts);

            /* If we have a request to this URL in-flight, don't make
             * another, wait for the first to complete. */
            const inflight = this.inflight.get(url);
            if (inflight) return await inflight;

            const res_pr = this.do_fetch(url, opts)
                /* Make sure we clear in-flight on failure too */
                .finally(() => this.inflight.delete(url));
            this.inflight.set(url, res_pr);
            return await res_pr;
        }
        catch (e) {
            this.debug.log("fetch", `Fetch error: ${e}\n${e.stack}`);
            return new ErrorResponse();
        }
    }

    /** Open a websocket to the service.
     * Returns a Promise. If the websocket opens succesfully the Promise
     * resolves with a WebSocket object. Otherwise it rejects with a
     * ServiceError.
     *
     * Arguments are supplied as an object.
     * @arg service The service UUID
     * @arg url The path for the websocket relative to the service URL
     */
    async websocket (opts) {
        const base = opts.service_url
            ?? await this.fplus.service_url(opts.service);
        const url = new URL(opts.url, base);

        const ws = new WebSocket(url);
        await new Promise((resolve, reject) => {
            const errh = e => {
                const msg = e.type == "error"
                    ? `WebSocket connection error: ${e.message}`
                    : "WebSocket connection failed";
                /* XXX should supply e as cause here */
                reject(new ServiceError(opts.service, msg));
            };
            ws.addEventListener("open", resolve, { once: true });
            ws.addEventListener("error", errh, { once: true });
        });
        return ws;
    }

    /** Open a websocket and perform authentication.
     * This opens a websocket to the service and performs an initial
     * authentication exchange as specified by the notify/v2 spec.
     *
     * Arguments are supplied as an object.
     * @arg service The service UUID
     * @arg url The path for the websocket, relative to the service URL
     * @returns A Promise to a WebSocket
     */
    async ws_with_auth (opts) {
        const base = await this.fplus.service_url(opts.service);

        const try_ws = async bad => {
            const ws = await this.websocket({ ...opts, service_url: base });
            const token = await this.service_token(base, bad);

            ws.send(`Bearer ${token}`);
            const msg = await new Promise((resolve, reject) => {
                ws.addEventListener("message", resolve, { once: true });
                ws.addEventListener("error", reject, { once: true });
            });

            return [ws, msg.data, token];
        };

        let [ws, st, bad] = await try_ws();
        if (st == "401")
            [ws, st] = await try_ws(bad);
        if (st == "200")
            return ws;
        
        if (typeof st == "string" && /^[0-9]{3}$/.test(st)) {
            throw new ServiceError(opts.service,
                "WebSocket auth refused",
                Number.parseInt(st, 10));
        }

        throw new ServiceError(opts.service,
            "Unrecognised WS auth response: %s", st);
    }
        
    async do_fetch (url, opts) {
        let token;
        const try_fetch = async () => {
            token = await this.service_token(opts.service_url, token);
            if (!token) return null;
            return await this._real_fetch(url, _with_auth(opts, "Bearer", token));
        };

        let res = await try_fetch();
        if (res?.status === 401)
            res = await try_fetch();

        return res;
    }

    /** Get a token for a service.
     * This fetches a bearer token from the /token endpoint. If a
     * known-bad token is passed in, because it has been used in a
     * request which got a 401 response, a new token will be requested
     * if the current token matches.
     * @arg base_url The service URL to get a token for.
     * @arg bad (optional) A known-expired token.
     */
    async service_token (base_url, bad) {
        /* This might be a token or a promise for one */
        let token = this.tokens.get(base_url);

        const is_bad = bad !== undefined &&
            typeof token == "string" &&
            token === bad;

        if (!token || is_bad) {
            token = this._fetch_token(base_url);
            /* We push a promise to the cache here */
            this.tokens.set(base_url, token);
        }

        try {
            token = await token;
            const tok = token.slice(0, 4);
            this.debug.log("token", `Using token ${tok}... for ${base_url}`);
            return token;
        }
        catch (e) {
            this.tokens.delete(base_url);
            throw e;
        }
    }
    
    /* Some code was consuming the private interface */
    _service_token (base_url, bad) {
        this.debug.log("warning", new Warning("Private method called"));
        return this.service_token(base_url, bad);
    }

    async _fetch_token (base_url) {
        const tok_url = new URL("/token", base_url);

        this.debug.log("token", `Requesting new token from ${tok_url}`);
        const res = await this._gss_fetch(tok_url, {
            method: "POST",
            body: "",
        });

        if (!res?.ok) {
            this.debug.log("token", `Token request failed (${res.status})`);
            /* XXX How should we handle failure here? This indicates,
             * perhaps, that our Kerberos creds are bad, or the service
             * is down. Probably the only strategy that makes sense is
             * to log and exit; let K8s handle restart/backoff. */
            throw `Token fetch fetch failed for ${base_url}`;
        }

        const json = await res.json();
        /* There will be a promise in the cache already; overwrite it
         * with the real token. */
        this.tokens.set(base_url, json.token);
        return json.token;
    }


    async _gss_fetch(url, opts) {
        if (this.fplus.opts.username && this.fplus.opts.password) {
            this.debug.log("fetch", `Basic auth with ${this.fplus.opts.username}`);
            return await this._real_fetch(url, _with_auth(opts,
                "Basic", Buffer.from(`${this.fplus.opts.username}:${this.fplus.opts.password}`)
                    .toString('base64')));
        } else {
            const ctx = GSS.createClientContext({ server: `HTTP@${url.hostname}` });
            const cli_tok = await GSS.initSecContext(ctx);
            const cli_b64 = cli_tok.toString("base64");
            const res = await fetch(url, _with_auth(opts, "Negotiate", cli_b64));
            if (res.status === 401)
                throw `Server denied GSS auth for ${url}`;

            /* Grr crummy M$ protocol... */
            const [, scheme, creds] = res.headers
                .get("WWW-Authenticate")
                .match(Auth_rx) ?? [];
            if (scheme !== "Negotiate")
                throw `Bad WWW-A scheme '${scheme}' from ${url}`;

            await GSS.initSecContext(ctx, Buffer.from(creds, "base64"));
            if (!ctx.isComplete())
                throw `GSS mutual auth failed for ${url}`;

            return res;
        }
    }

    /* We have to decide which fetch to use on first call */
    async _real_fetch (...args) {
        if (this.fplus.opts.browser) {
            this.debug.log("fetch", "Using native fetch() implementation");
            this._real_fetch = globalThis.fetch.bind(globalThis);
        }
        else {
            this.debug.log("fetch", "Using got-fetch for NodeJS");
            this._real_fetch = await build_node_fetch();
        }
        return this._real_fetch(...args);
    }
}

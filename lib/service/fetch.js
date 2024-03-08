/*
 * Factory+ NodeJS Utilities
 * HTTP client code.
 * Copyright 2022 AMRC.
 */

import {fetch, GSS} from "../deps.js";

import { ServiceInterface } from "./service-interface.js";

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

export default class Fetch extends ServiceInterface {
    constructor (fplus) {
        super(fplus);
        this.tokens = new Map();
        this.inflight = new Map();
        this.cache = "default";
    }

    async fetch (opts) {
        try {
            /* XXX Call service_urls instead and find one that works. */
            opts.service_url = await this.fplus.service_url(opts.service);
            const url = new URL(opts.url, opts.service_url);
            if (opts.query)
                url.search = new URLSearchParams(Object.entries(opts.query));

            opts.cache ??= this.cache;

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

    async do_fetch (url, opts) {
        let token;
        const try_fetch = async () => {
            token = await this.service_token(opts.service_url, token);
            if (!token) return null;
            return await fetch(url, _with_auth(opts, "Bearer", token));
        };

        let res = await try_fetch();
        if (res?.status === 401)
            res = await try_fetch();

        return res;
    }

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
            this.debug.log("token", `Using token ${token} for ${base_url}`);
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
            return await fetch(url, _with_auth(opts,
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
}

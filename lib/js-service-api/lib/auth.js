/*
 * Factory+ Service HTTP API
 * HTTP Auth verification
 * Copyright 2024 University of Sheffield
 */

import crypto from "crypto";

import { pathToRegexp } from "path-to-regexp";

/* GSS comes via the service-client re-export so we pick up the same
 * implementation the client side uses (the @amrc-factoryplus/gssapi
 * fork when installed, upstream gssapi.js otherwise). It is undefined
 * on platforms with no GSS support; auth attempts then fail rather
 * than the module failing to load. */
import { GSS, jwt_context } from "@amrc-factoryplus/service-client";

import { AuthUnavailable, JwtVerifier, looks_like_jwt } from "./jwt.js";

const Auth_rx = /^([A-Za-z]+) +([A-Za-z0-9._~+/=-]+)$/;
const SESSION_LENGTH = 3*3600*1000;
const DATE_FUZZ = 1*60*1000;
const BASIC_CACHE_MS = 60*1000;
const BASIC_CACHE_MAX = 1000;

/* Basic auth checks a password with GSS.verifyCredentials, which runs
 * a full Kerberos exchange (krb5_get_init_creds_password then
 * krb5_verify_init_creds) on the libuv threadpool. Two of these at
 * once can crash the process with a segfault, so a client making
 * overlapping Basic auth requests could take a service down every few
 * minutes. This queue makes the checks run one at a time across the
 * whole process, whichever FplusHttpAuth instance asks. */
let basic_queue = Promise.resolve();

function one_at_a_time (work) {
    const run = basic_queue.then(work);
    /* The next check waits for this one whether it succeeds or not. */
    basic_queue = run.catch(() => {});
    return run;
}

/* This class handles HTTP auth; it accepts Basic and Negotiate and
 * verifies them against Kerberos. It also sets up /token as a POST
 * endpoint which issues a token, and accepts those tokens as Bearer
 * auth. */
export class FplusHttpAuth {
    /* Opts is an object; properties as follows. ? means optional.
     *  realm:              Our Kerberos realm
     *  hostname:           A hostname we have a Kerberos key for instead of the principle.
     *  principle:          The principle we have a kerberos key for instead a hostname for non "HTTP/" principles.
     *  keytab:             The path to our keytab file (our private key).
     *  session_length?:    How long should tokens be valid for? (ms)
     *  forward_jwt?:       Forward a caller's JWT on onward calls (default true).
     *  gss?:               The GSS module (tests pass a stand-in).
     *  basic_cache_ms?:    How long a verified Basic password is trusted
     *                      without asking Kerberos again (ms, default 60s,
     *                      0 to turn off).
     *
     * realm and hostname are needed to support Basic auth. Client
     * usernames will have `@${realm}` added if they don't include an @,
     * and we need a ticket for `HTTP/${hostname}@${realm}` available in
     * the keytab to use to verify the client's credentials.
     */
    constructor (opts) {
        this.realm = opts.realm;
        this.principal = opts.hostname ? `HTTP/${opts.hostname}` : opts.principal;
        this.keytab = opts.keytab;
        /* Tests pass a stand-in; services use the real module. */
        this.gss = opts.gss ?? GSS;
        this.session_length = opts.session_length ?? SESSION_LENGTH;
        /* A service which checks fine-grained permissions itself and
         * then acts with its own rights turns this off, so onward
         * calls use the service's credentials, not the caller's JWT. */
        this.forward_jwt = opts.forward_jwt ?? true;
        this.log = opts.log
            ?? ((req, res, ...args) => console.log(...args));

        if (opts.public) {
            this.public = pathToRegexp(opts.public);
        }

        this.tokens = new Map();

        /* Passwords recently verified, so a client which polls with
         * Basic auth costs one Kerberos exchange a minute rather than
         * one per request. Keyed by an HMAC of user and password under
         * a key which never leaves this process, so the cache holds no
         * password. Only successes are cached, and an entry lasts
         * basic_cache_ms (default 60s, 0 turns the cache off). */
        this.basic_cache_ms = opts.basic_cache_ms ?? BASIC_CACHE_MS;
        this.basic_cache = new Map();
        this.basic_pending = new Map();
        this.basic_key = crypto.randomBytes(32);

        /* Keycloak JWT acceptance. Lazy: services that never see a JWT
         * never reach Keycloak. Disabled if OIDC_DISCOVERY_URL is unset
         * so chart upgrades that haven't wired the env var yet keep
         * working unchanged. */
        const discovery_url = opts.oidc_discovery_url
            ?? process.env.OIDC_DISCOVERY_URL;
        if (discovery_url) {
            this.jwt = new JwtVerifier({
                discovery_url,
                log: (...a) => this.log(null, null, ...a),
            });
        }
    }

    /* Set up our auth middleware on an express app, and install the
     * /token endpoint. */
    setup (app) {
        app.use(this.auth.bind(this));
        app.post("/token", this.token.bind(this));
    }

    async auth (req, res, next) {
        const ctx = {
            req, res,
            log: (...a) => this.log(req, res, ...a),
        };
        let client;

        try {
            const auth = req.header("Authorization");
            if (!auth) {
                if (this.public && this.public.test(req.path)) {
                    ctx.log("Allowing public access");
                    req.auth = null;
                    return next();
                }
                throw "No HTTP auth provided";
            }

            const [, scheme, creds] = auth.match(Auth_rx) ?? ["Unknown"];
            ctx.creds = creds;

            ctx.log(`Handling ${scheme} auth`);
            switch (scheme) {
            case "Basic":
                client = await this.auth_basic(ctx);
                break;
            case "Negotiate":
                client = await this.auth_gssapi(ctx);
                break;
            case "Bearer":
                client = await this.auth_bearer(ctx);
                break;
            default:
                throw `Unknown authentication scheme ${scheme}`;
            }
        }
        catch (e) {
            /* 401 tells the caller their credentials are bad, and
             * clients react by throwing away tokens that are still
             * good. If we could not check the credentials at all
             * that is our failure, not theirs. */
            if (e instanceof AuthUnavailable) {
                ctx.log(`Auth unavailable: ${e.message}`);
                return res
                    .status(503)
                    .type("text/plain")
                    .send("Authentication is temporarily unavailable");
            }
            ctx.log(`Auth failed: ${e}`);
            return res
                .status(401)
                .header("WWW-Authenticate", `Basic realm="Factory+"`)
                .end();
        }

        ctx.log(`Auth succeeded for [${client}]`);
        req.auth = client;

        /* When the inbound auth was a JWT, run the rest of the
         * middleware chain inside an AsyncLocalStorage scope carrying
         * the raw JWT. The service-client picks this up on outbound
         * calls and forwards the same JWT to downstream services
         * instead of negotiating + minting opaque tokens. */
        if (req.auth_jwt && this.forward_jwt) {
            jwt_context.run({ jwt: req.auth_jwt }, () => next());
            return;
        }

        next();
    }

    async auth_basic (ctx) {
        const [, user, pass] = atob(ctx.creds).match(/^([^:]+):(.+)/);

        const client = user.includes("@") 
            ? user : `${user}@${this.realm}`;

        const key = crypto.createHmac("sha256", this.basic_key)
            .update(client).update("\0").update(pass)
            .digest("base64");

        const expiry = this.basic_cache.get(key);
        if (expiry && expiry > Date.now())
            return client;

        /* The same credentials arriving together share one check. */
        let pending = this.basic_pending.get(key);
        if (!pending) {
            pending = one_at_a_time(() => this.gss.verifyCredentials(client, pass, {
                keytab: `FILE:${this.keytab}`,
                serverPrincipal: this.principal,
            }));
            this.basic_pending.set(key, pending);
            pending.then(
                () => this.remember_basic(key),
                () => this.basic_cache.delete(key),
            ).finally(() => this.basic_pending.delete(key));
        }

        await pending;
        return client;
    }

    remember_basic (key) {
        if (!(this.basic_cache_ms > 0)) return;
        const now = Date.now();
        if (this.basic_cache.size >= BASIC_CACHE_MAX) {
            for (const [k, exp] of this.basic_cache)
                if (exp <= now) this.basic_cache.delete(k);
            /* Still full: drop the oldest entry. */
            if (this.basic_cache.size >= BASIC_CACHE_MAX)
                this.basic_cache.delete(this.basic_cache.keys().next().value);
        }
        this.basic_cache.set(key, now + this.basic_cache_ms);
    }

    async auth_gssapi (ctx) {
        const cli_tok = Buffer.from(ctx.creds, "base64");

        /* This is an appalling API... */
        this.gss.setKeytabPath(this.keytab);
        const srv_ctx = this.gss.createServerContext();
        const srv_tok = await this.gss.acceptSecContext(srv_ctx, cli_tok);

        const client = srv_ctx.clientName();
        if (!srv_ctx.isComplete())
            throw `GSSAPI auth failed for ${client}`;

        ctx.res.header("WWW-Authenticate", 
            "Negotiate " + srv_tok.toString("base64"));
        return client;
    }

    async auth_bearer (ctx) {
        const { creds } = ctx;

        /* Keycloak JWT? Structural test, no network call. */
        if (this.jwt && looks_like_jwt(creds))
            return await this.auth_jwt(ctx);

        const client = this.tokens.get(creds);

        if (!client) throw "Bad token";
        if (client.expiry < Date.now() + DATE_FUZZ) {
            this.tokens.delete(creds);
            throw "Expired token";
        }

        return client.principal;
    }

    async auth_jwt (ctx) {
        const { creds } = ctx;
        const payload = await this.jwt.verify(creds);

        /* The acs-keycloak-spi protocol mapper stamps fp_principal_uuid
         * on every token issued by our realm. A JWT without it isn't
         * one of ours, even if the signature is valid. */
        const principal = payload.fp_principal_uuid;
        if (!principal)
            throw "JWT missing fp_principal_uuid claim";

        /* Stash the raw JWT for the service-client to forward on
         * outbound calls (see auth() above for the ALS bridge). Only
         * HTTP requests carry a `req` to stash this on; WS callers
         * (notify/v2) have no outbound call to forward it to. */
        if (ctx.req)
            ctx.req.auth_jwt = creds;
        return principal;
    }

    token (req, res) {
        const token = crypto.randomBytes(66).toString("base64");
        const expiry = Date.now() + this.session_length;
        this.tokens.set(token, {
            principal: req.auth,
            expiry,
        });

        this.log(req, res, "Created token %o", {
            principal: req.auth, 
            expiry: new Date(expiry),
        });

        return res.json({ token, expiry });
    }
}


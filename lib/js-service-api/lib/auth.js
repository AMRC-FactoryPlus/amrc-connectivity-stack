/*
 * Factory+ Service HTTP API
 * HTTP Auth verification
 * Copyright 2024 University of Sheffield
 */

import crypto from "crypto";

import GSS from "gssapi.js";
import { pathToRegexp } from "path-to-regexp";

import { jwt_context } from "@amrc-factoryplus/service-client";

import { JwtVerifier, looks_like_jwt } from "./jwt.js";

const Auth_rx = /^([A-Za-z]+) +([A-Za-z0-9._~+/=-]+)$/;
const SESSION_LENGTH = 3*3600*1000;
const DATE_FUZZ = 1*60*1000;

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
        this.session_length = opts.session_length ?? SESSION_LENGTH;
        this.log = opts.log
            ?? ((req, res, ...args) => console.log(...args));

        if (opts.public) {
            this.public = pathToRegexp(opts.public);
        }

        this.tokens = new Map();

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
        if (req.auth_jwt) {
            jwt_context.run({ jwt: req.auth_jwt }, () => next());
            return;
        }

        next();
    }

    async auth_basic (ctx) {
        const [, user, pass] = atob(ctx.creds).match(/^([^:]+):(.+)/);

        const client = user.includes("@") 
            ? user : `${user}@${this.realm}`;

        await GSS.verifyCredentials(client, pass, {
            keytab: `FILE:${this.keytab}`,
            serverPrincipal: this.principal,
        });
        return client;
    }

    async auth_gssapi (ctx) {
        const cli_tok = Buffer.from(ctx.creds, "base64");

        /* This is an appalling API... */
        GSS.setKeytabPath(this.keytab);
        const srv_ctx = GSS.createServerContext();
        const srv_tok = await GSS.acceptSecContext(srv_ctx, cli_tok);

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
         * outbound calls (see auth() above for the ALS bridge). */
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


/*
 * Factory+ NodeJS Utilities
 * Service Web API framework.
 * Copyright 2022 AMRC
 */

import http from "http";
import crypto from "crypto";

import express from "express";
import createError from "http-errors";
import cors from "cors";
import { pathToRegexp } from "path-to-regexp";

import { Debug, GSS } from "@amrc-factoryplus/service-client";

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
     *  hostname:           A hostname we have a Kerberos key for.
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
        this.principal = `HTTP/${opts.hostname}`;
        this.keytab = opts.keytab;
        this.session_length = opts.session_length ?? SESSION_LENGTH;
        this.log = opts.log 
            ?? ((req, res, ...args) => console.log(...args));

        if (opts.public) {
            this.public = pathToRegexp(opts.public);
        }

        this.tokens = new Map();
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
        const client = this.tokens.get(creds);

        if (!client) throw "Bad token";
        if (client.expiry < Date.now() + DATE_FUZZ) {
            this.tokens.delete(creds);
            throw "Expired token";
        }
        
        return client.principal;
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

export class WebAPI {
    constructor (opts) {
        this.max_age = opts.max_age;
        this.ping_response = opts.ping;
        this.port = opts.http_port || 80;
        this.routes = opts.routes;

        this.debug = new Debug(opts);
        this.auth = new FplusHttpAuth({
            ...opts,
            log: (req, res, ...args) => this.debug.log("http", ...args),
        });
        this.app = express();
    }

    async init () {
        let app = this.app;

        /* CORS */
        app.use(cors({ credentials: true, maxAge: 86400 }));

        /* Body decoders. These will only decode request bodies of the
         * appropriate content-type. */
        app.use(express.json());
        app.use(express.text());

        /* Logging */
        app.use((req, res, next) => {
            this.debug.log("http", `>>> ${req.method} ${req.originalUrl}`);
            res.on("finish", () =>
                this.debug.log("http",
                    `<<< ${res.statusCode} ${res.getHeader("Content-Type")}`));
            next();
        });

        this.auth.setup(app);
        app.get("/ping", this.ping.bind(this));

        /* Set caching */
        if (this.max_age) {
            const cc = `max-age=${this.max_age}`
            app.use((req, res, next) => {
                if (req.method == "GET")
                    res.header("Cache-Control", cc);
                next();
            });
        }

        /* Set up real routes */
        this.routes(app);

        /* Catch-all 404 */
        app.use((req, res, next) => next(createError(404)));

        /* Error handling */
        app.use((err, req, res, next) => {
            console.error(err);
            res.status(err.status || 500)
                .type("text/plain")
                .send(`Server error: ${err.message}`);
        });

        this.http = http.createServer(app);

        return this;
    }

    run () {
        this.debug.log("http", `Creating HTTP server on port ${this.port}`);
        this.http.listen(this.port);
    }

    ping (req, res) {
        res.json(this.ping_response);
    }
}


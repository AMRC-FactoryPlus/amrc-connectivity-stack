/*
 * Factory+ Service HTTP API
 * JWT validation tests.
 * Copyright 2026 University of Sheffield AMRC
 *
 * Run with `node --test test/`.
 *
 * Self-contained: spins up a fake OIDC issuer on localhost that serves
 * a discovery doc + JWKS minted from an ephemeral RSA key, and exercises
 * the auth middleware end-to-end against locally-issued JWTs.
 */

import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";

import express from "express";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

import { FplusHttpAuth } from "../lib/auth.js";
import { looks_like_jwt } from "../lib/jwt.js";
/* The lib's file:..  deps don't resolve into a runnable node_modules
 * layout on a dev machine; import the ALS module by relative path so
 * these tests run with just `npm install` in this package. */
import { jwt_context } from "../../js-service-client/lib/jwt-context.js";

/* Fake Keycloak: serves discovery + JWKS for a key we hold. */
async function fake_issuer () {
    const kp = await generateKeyPair("RS256");
    const jwk = await exportJWK(kp.publicKey);
    jwk.kid = "test-kid";
    jwk.alg = "RS256";
    jwk.use = "sig";

    const srv = http.createServer((req, res) => {
        if (req.url === "/.well-known/openid-configuration") {
            const base = `http://localhost:${srv.address().port}`;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({
                issuer: `${base}/realm`,
                jwks_uri: `${base}/jwks`,
            }));
            return;
        }
        if (req.url === "/jwks") {
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ keys: [jwk] }));
            return;
        }
        res.statusCode = 404;
        res.end();
    });
    srv.keepAliveTimeout = 0;
    await new Promise(r => srv.listen(0, r));
    const port = srv.address().port;
    return {
        port,
        discovery_url: `http://localhost:${port}/.well-known/openid-configuration`,
        issuer: `http://localhost:${port}/realm`,
        kp,
        kid: "test-kid",
        close: () => new Promise(r => {
            srv.closeAllConnections?.();
            srv.close(r);
        }),
    };
}

async function mint_jwt (issuer, kp, claims, opts = {}) {
    const builder = new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: opts.kid ?? "test-kid" })
        .setIssuer(opts.issuer ?? issuer.issuer)
        .setIssuedAt()
        .setExpirationTime(opts.exp ?? "1h");
    return await builder.sign(kp.privateKey);
}

/* Build an express app wired up with FplusHttpAuth, bind it to an
 * ephemeral port, return the base URL and a teardown handle. */
async function build_app (oidc_discovery_url) {
    const app = express();
    const auth = new FplusHttpAuth({
        realm: "TEST.EXAMPLE",
        hostname: "test.example",
        keytab: "/dev/null",
        oidc_discovery_url,
        log: () => {},
    });
    auth.setup(app);
    app.get("/whoami", (req, res) => {
        res.json({
            auth: req.auth,
            jwt_in_als: !!jwt_context.getStore()?.jwt,
        });
    });
    const srv = http.createServer(app);
    /* Default keepAliveTimeout is 5s. Tests make a single one-shot
     * request and then close; without setting this to 0 srv.close()
     * blocks for 5s waiting for keep-alive idle. */
    srv.keepAliveTimeout = 0;
    await new Promise(r => srv.listen(0, r));
    const port = srv.address().port;
    return {
        base: `http://localhost:${port}`,
        close: () => new Promise(r => {
            srv.closeAllConnections?.();
            srv.close(r);
        }),
    };
}

async function call (app, headers = {}) {
    const res = await fetch(`${app.base}/whoami`, { headers });
    const body = await res.text();
    return { status: res.status, body };
}

test("looks_like_jwt accepts well-formed JWTs", () => {
    const real = "eyJhbGciOiJSUzI1NiIsImtpZCI6ImEifQ.eyJzdWIiOiJ4In0.SIG-here";
    assert.equal(looks_like_jwt(real), true);
});

test("looks_like_jwt rejects opaque session tokens", () => {
    /* 66 random bytes base64-encoded - the existing opaque-token shape. */
    const opaque = Buffer.alloc(66, 1).toString("base64");
    assert.equal(looks_like_jwt(opaque), false);
});

test("looks_like_jwt rejects garbage", () => {
    assert.equal(looks_like_jwt(""), false);
    assert.equal(looks_like_jwt("not-a-jwt"), false);
    assert.equal(looks_like_jwt("two.parts"), false);
    assert.equal(looks_like_jwt("aaa.bbb.ccc.ddd"), false);
    /* Three parts but the header isn't a JSON object. */
    assert.equal(looks_like_jwt("YQ.YQ.YQ"), false);
});

test("valid JWT authenticates and populates req.auth + ALS", async (t) => {
    const oidc = await fake_issuer();
    t.after(() => oidc.close());
    const app = await build_app(oidc.discovery_url);
    t.after(() => app.close());

    const jwt = await mint_jwt(oidc, oidc.kp, {
        fp_principal_uuid: "11111111-2222-3333-4444-555555555555",
    });

    const res = await call(app, { authorization: `Bearer ${jwt}` });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.auth, "11111111-2222-3333-4444-555555555555");
    assert.equal(body.jwt_in_als, true);
});

test("JWT without fp_principal_uuid is rejected", async (t) => {
    const oidc = await fake_issuer();
    t.after(() => oidc.close());
    const app = await build_app(oidc.discovery_url);
    t.after(() => app.close());

    const jwt = await mint_jwt(oidc, oidc.kp, { sub: "anonymous" });

    const res = await call(app, { authorization: `Bearer ${jwt}` });
    assert.equal(res.status, 401);
});

test("expired JWT is rejected", async (t) => {
    const oidc = await fake_issuer();
    t.after(() => oidc.close());
    const app = await build_app(oidc.discovery_url);
    t.after(() => app.close());

    const jwt = await mint_jwt(oidc, oidc.kp,
        { fp_principal_uuid: "u" }, { exp: Math.floor(Date.now() / 1000) - 60 });

    const res = await call(app, { authorization: `Bearer ${jwt}` });
    assert.equal(res.status, 401);
});

test("JWT from wrong issuer is rejected", async (t) => {
    const oidc = await fake_issuer();
    t.after(() => oidc.close());
    const app = await build_app(oidc.discovery_url);
    t.after(() => app.close());

    const jwt = await mint_jwt(oidc, oidc.kp,
        { fp_principal_uuid: "u" }, { issuer: "https://evil.example/realm" });

    const res = await call(app, { authorization: `Bearer ${jwt}` });
    assert.equal(res.status, 401);
});

test("JWT signed by a different key is rejected", async (t) => {
    const oidc = await fake_issuer();
    t.after(() => oidc.close());
    const app = await build_app(oidc.discovery_url);
    t.after(() => app.close());

    const evil_kp = await generateKeyPair("RS256");
    const jwt = await mint_jwt(oidc, evil_kp,
        { fp_principal_uuid: "u" });

    const res = await call(app, { authorization: `Bearer ${jwt}` });
    assert.equal(res.status, 401);
});

test("opaque Bearer token still works without OIDC config", async (t) => {
    /* No discovery URL: JWT acceptance is disabled, opaque-token path
     * unaffected. */
    const app = await build_app(undefined);
    t.after(() => app.close());

    const res = await call(app, { authorization: "Bearer not-a-real-token" });
    /* Opaque-token lookup fails (no token issued), but the request
     * reaches the bearer branch rather than throwing on JWT logic. */
    assert.equal(res.status, 401);
});

test("opaque-shaped tokens still go through the opaque path even with OIDC on", async (t) => {
    const oidc = await fake_issuer();
    t.after(() => oidc.close());
    const app = await build_app(oidc.discovery_url);
    t.after(() => app.close());

    /* 66 random bytes base64-encoded - never contains a `.` so the
     * structural JWT check rejects it. */
    const opaque = Buffer.alloc(66, 7).toString("base64");
    const res = await call(app, { authorization: `Bearer ${opaque}` });
    /* No such token was minted, so 401 - but importantly the path
     * fell through to the opaque-token store rather than trying JWT
     * verification (which would have tried to fetch JWKS). */
    assert.equal(res.status, 401);
});

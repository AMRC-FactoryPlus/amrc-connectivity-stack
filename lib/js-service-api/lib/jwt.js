/*
 * Factory+ Service HTTP API
 * Keycloak JWT validation
 * Copyright 2026 University of Sheffield AMRC
 */

import { createRemoteJWKSet, jwtVerify } from "jose";

const JWT_DOT_RX = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/* Bearer credentials arrive on the same wire as our opaque session
 * tokens (66 random bytes, base64 of the alphabet A-Za-z0-9+/=, no
 * dots). A JWT is three base64url segments joined by dots whose first
 * segment decodes to a JSON header with an `alg` field. Disambiguate
 * by structure so we don't change behaviour for existing callers. */
export function looks_like_jwt (creds) {
    if (!JWT_DOT_RX.test(creds)) return false;
    const [hdr_b64] = creds.split(".");
    try {
        const hdr = JSON.parse(
            Buffer.from(hdr_b64, "base64url").toString("utf8"));
        return typeof hdr.alg === "string";
    }
    catch {
        return false;
    }
}

/* Validate a Keycloak-issued JWT against a configured discovery URL.
 *
 * Opts:
 *  discovery_url:  Full URL to the OIDC well-known discovery doc, e.g.
 *                  https://openid.acs/realms/factory_plus/.well-known/openid-configuration
 *  log?:           Optional log function.
 *
 * verify(token) returns the JWT payload on success, throws on failure.
 *
 * Discovery is fetched lazily on first verify(), then the resulting
 * jwks_uri is handed to jose's createRemoteJWKSet which handles JWKS
 * caching, kid rotation, and concurrent fetches internally. */
export class JwtVerifier {
    constructor (opts) {
        this.discovery_url = opts.discovery_url;
        this.log = opts.log ?? (() => {});

        this._issuer = null;
        this._jwks = null;
        this._discovery = null;
    }

    async _discover () {
        if (this._discovery) return this._discovery;
        this._discovery = (async () => {
            this.log("Fetching OIDC discovery from %s", this.discovery_url);
            const res = await fetch(this.discovery_url);
            if (!res.ok)
                throw `OIDC discovery failed: HTTP ${res.status}`;
            const doc = await res.json();
            if (!doc.issuer || !doc.jwks_uri)
                throw "OIDC discovery doc missing issuer/jwks_uri";
            this._issuer = doc.issuer;
            this._jwks = createRemoteJWKSet(new URL(doc.jwks_uri));
            return doc;
        })().catch(e => {
            /* Don't memoise failure: a transient network error
             * shouldn't permanently break JWT auth. */
            this._discovery = null;
            throw e;
        });
        return this._discovery;
    }

    async verify (token) {
        await this._discover();
        const { payload } = await jwtVerify(token, this._jwks, {
            issuer: this._issuer,
        });
        return payload;
    }
}

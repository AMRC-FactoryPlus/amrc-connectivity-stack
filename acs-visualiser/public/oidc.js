/*
 * Factory+ visualisation.
 * Keycloak OIDC login (Authorization Code + PKCE) and token refresh.
 * Copyright 2026 University of Sheffield AMRC
 */

const STORAGE = "fpvis-oidc";
const SESSION = "fpvis-oidc-flow";

/* Refresh this many seconds before the access token expires. */
const REFRESH_MARGIN = 60;

function b64url (buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* Pure-JS SHA-256 (FIPS 180-4). crypto.subtle only exists in secure
 * contexts and several ACS deployments (kiosks especially) are served
 * over plain http, so we need a fallback for the PKCE challenge. */
function sha256_js (bytes) {
    const K = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
        0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
        0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
        0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
        0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
        0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
        0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
        0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    const H = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];
    const rr = (x, n) => (x >>> n) | (x << (32 - n));

    const len = bytes.length;
    const padded = new Uint8Array((len + 9 + 63) & ~63);
    padded.set(bytes);
    padded[len] = 0x80;
    new DataView(padded.buffer).setUint32(padded.length - 4, len * 8);

    const w = new Int32Array(64);
    const view = new DataView(padded.buffer);
    for (let off = 0; off < padded.length; off += 64) {
        for (let i = 0; i < 16; i++)
            w[i] = view.getUint32(off + i * 4);
        for (let i = 16; i < 64; i++) {
            const s0 = rr(w[i-15], 7) ^ rr(w[i-15], 18) ^ (w[i-15] >>> 3);
            const s1 = rr(w[i-2], 17) ^ rr(w[i-2], 19) ^ (w[i-2] >>> 10);
            w[i] = (w[i-16] + s0 + w[i-7] + s1) | 0;
        }

        let [a, b, c, d, e, f, g, h] = H;
        for (let i = 0; i < 64; i++) {
            const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
            const ch = (e & f) ^ (~e & g);
            const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
            const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (S0 + maj) | 0;
            h = g; g = f; f = e; e = (d + t1) | 0;
            d = c; c = b; b = a; a = (t1 + t2) | 0;
        }
        H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0;
        H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
        H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0;
        H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }

    const out = new Uint8Array(32);
    const ov = new DataView(out.buffer);
    H.forEach((v, i) => ov.setUint32(i * 4, v >>> 0));
    return out;
}

async function sha256 (bytes) {
    if (crypto.subtle)
        return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return sha256_js(bytes);
}

function jwt_claims (token) {
    try {
        const b64 = token.split(".")[1]
            .replace(/-/g, "+").replace(/_/g, "/");
        return JSON.parse(atob(b64));
    }
    catch { return undefined; }
}

/* Delegates login to the Keycloak realm advertised by the discovery
 * URL. Usage: construct, then `await ensure_login()`; this may
 * navigate away (to Keycloak) and never resolve. Afterwards `token()`
 * returns a valid access token, refreshing when needed.
 *
 * A token supplied via the `auth_token` query parameter (kiosk mode,
 * matching Grafana's url_login) is used as-is: no refresh is possible
 * as we hold no refresh token, so such tokens should be issued with a
 * long lifespan (see values.yaml `accessTokenLifespan`). */
export class OidcClient {
    constructor (opts) {
        this.discovery_url = opts.discovery_url;
        this.client_id = opts.client_id;
        this.redirect_uri = new URL(location.pathname, location.origin)
            .toString();
        this.tokens = null;
        this.static_token = null;
    }

    async init () {
        const res = await fetch(this.discovery_url);
        if (!res.ok)
            throw new Error(`OIDC discovery failed: ${res.status}`);
        this.provider = await res.json();
        return this;
    }

    /* The kerberos UPN of the logged-in user, for display. */
    get username () {
        const tok = this.static_token ?? this.tokens?.access_token;
        return tok ? jwt_claims(tok)?.preferred_username : undefined;
    }

    async ensure_login () {
        const here = new URL(location.href);

        /* Kiosk mode: a JWT in the URL bypasses login entirely. Strip
         * it from the address bar so it doesn't leak via bookmarks or
         * copied links. */
        const auth_token = here.searchParams.get("auth_token");
        if (auth_token) {
            here.searchParams.delete("auth_token");
            history.replaceState(null, "", here);
            this.static_token = auth_token;
            return;
        }

        /* Returning from Keycloak with an authorization code. */
        if (here.searchParams.get("code")) {
            await this.finish_code_flow(here);
            return;
        }

        /* An earlier session we can resume with the refresh token. */
        const stored = this.load_tokens();
        if (stored) {
            this.tokens = stored;
            try {
                if (this.expiring_soon())
                    await this.refresh();
                this.schedule_refresh();
                return;
            }
            catch (e) {
                console.log(`Stored session unusable: ${e}`);
                this.clear_tokens();
            }
        }

        /* No credentials at all: go to Keycloak. If the Keycloak SSO
         * session is still alive this bounces straight back without
         * showing a login form. This navigates away; park forever. */
        await this.start_code_flow();
        await new Promise(() => {});
    }

    async start_code_flow () {
        const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
        const challenge = b64url(await sha256(
            new TextEncoder().encode(verifier)));
        const state = b64url(crypto.getRandomValues(new Uint8Array(16)));

        sessionStorage.setItem(SESSION,
            JSON.stringify({ verifier, state }));

        const url = new URL(this.provider.authorization_endpoint);
        url.search = new URLSearchParams({
            response_type:          "code",
            client_id:              this.client_id,
            redirect_uri:           this.redirect_uri,
            scope:                  "openid profile",
            state,
            code_challenge:         challenge,
            code_challenge_method:  "S256",
        });
        location.assign(url);
    }

    async finish_code_flow (here) {
        const flow = JSON.parse(sessionStorage.getItem(SESSION) ?? "null");
        sessionStorage.removeItem(SESSION);

        const code = here.searchParams.get("code");
        const state = here.searchParams.get("state");

        /* Clean the code out of the address bar whatever happens. */
        for (const p of ["code", "state", "session_state", "iss"])
            here.searchParams.delete(p);
        history.replaceState(null, "", here);

        if (!flow || flow.state !== state)
            throw new Error("OIDC state mismatch");

        await this.grant({
            grant_type:     "authorization_code",
            code,
            redirect_uri:   this.redirect_uri,
            code_verifier:  flow.verifier,
        });
        this.schedule_refresh();
    }

    async grant (params) {
        const res = await fetch(this.provider.token_endpoint, {
            method:     "POST",
            headers:    { "Content-Type": "application/x-www-form-urlencoded" },
            body:       new URLSearchParams({
                client_id: this.client_id,
                ...params,
            }),
        });
        if (!res.ok)
            throw new Error(`Token request failed: ${res.status}`);

        const json = await res.json();
        this.tokens = {
            access_token:   json.access_token,
            refresh_token:  json.refresh_token,
            expires_at:     Date.now() + json.expires_in * 1000,
        };
        this.save_tokens();
    }

    async refresh () {
        if (!this.tokens?.refresh_token)
            throw new Error("No refresh token");
        await this.grant({
            grant_type:     "refresh_token",
            refresh_token:  this.tokens.refresh_token,
        });
    }

    expiring_soon () {
        return this.tokens.expires_at - Date.now() < REFRESH_MARGIN * 1000;
    }

    /* Refresh proactively rather than waiting for a 401: this keeps
     * the Keycloak session alive on an unattended display and means
     * an MQTT reconnect always finds a live token. */
    schedule_refresh () {
        clearTimeout(this._timer);
        const delay = Math.max(5000,
            this.tokens.expires_at - Date.now() - REFRESH_MARGIN * 1000);
        this._timer = setTimeout(async () => {
            try {
                await this.refresh();
                this.schedule_refresh();
            }
            catch (e) {
                /* Refresh token expired or revoked. Head back to
                 * Keycloak; a live SSO session makes this invisible. */
                console.log(`Token refresh failed, re-authenticating: ${e}`);
                this.clear_tokens();
                this.start_code_flow();
            }
        }, delay);
    }

    /* Token provider for the ServiceClient `bearer_jwt` option. `bad`
     * is a token which has just been rejected; if it is our current
     * token, refresh before returning. */
    async token (bad) {
        if (this.static_token) {
            if (jwt_claims(this.static_token)?.exp * 1000 < Date.now())
                console.log("Kiosk auth_token has expired");
            return this.static_token;
        }

        if (!this.tokens) {
            /* Tokens were cleared (failed refresh) while another
             * caller was in flight; re-auth is already underway. */
            await new Promise(() => {});
        }

        if (this.expiring_soon()
                || (bad && bad === this.tokens.access_token)) {
            try {
                await this.refresh();
                this.schedule_refresh();
            }
            catch (e) {
                console.log(`Token refresh failed, re-authenticating: ${e}`);
                this.clear_tokens();
                await this.start_code_flow();
                await new Promise(() => {});
            }
        }
        return this.tokens.access_token;
    }

    logout () {
        clearTimeout(this._timer);
        this.clear_tokens();
        if (this.static_token || !this.provider.end_session_endpoint) {
            location.reload();
            return;
        }
        const url = new URL(this.provider.end_session_endpoint);
        url.search = new URLSearchParams({
            client_id:                  this.client_id,
            post_logout_redirect_uri:   this.redirect_uri,
        });
        location.assign(url);
    }

    save_tokens () {
        try {
            localStorage.setItem(STORAGE, JSON.stringify(this.tokens));
        }
        catch (e) {
            console.log(`LocalStorage failed: ${e}`);
        }
    }

    load_tokens () {
        try {
            return JSON.parse(localStorage.getItem(STORAGE) ?? "null");
        }
        catch { return null; }
    }

    clear_tokens () {
        this.tokens = null;
        localStorage.removeItem(STORAGE);
    }
}

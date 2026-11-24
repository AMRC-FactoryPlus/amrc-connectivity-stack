/*
 * ACS Admin
 * Sign-in through the ACS Keycloak (OIDC Authorization Code + PKCE)
 * Copyright 2026 University of Sheffield
 */

/* When the deployment has Keycloak (the chart's openid service) the
 * Admin signs people in there instead of asking for a password itself.
 * The Admin is a public client, so the code exchange is protected by
 * PKCE, not a client secret.
 *
 * The tokens live only in this module's memory, never in storage a
 * script could read. A reload or a new tab sends the browser back to
 * Keycloak, which recognises its own session cookie (HttpOnly, on the
 * openid host) and returns straight away without showing a form. So
 * closing a tab does not sign anyone out; Keycloak's session length
 * decides that, and "Remember me" on its sign-in page lengthens it.
 *
 * While the page is open the access token is renewed a minute before
 * it expires. That also keeps the Keycloak session alive, and means an
 * MQTT reconnect always finds a live token.
 *
 * Only the short-lived PKCE verifier and state go in sessionStorage,
 * for the round trip to Keycloak, and they are removed on return. */

const FLOW_KEY = "acs-oidc-flow";

/* Renew this long before the access token expires. */
const REFRESH_MARGIN_MS = 60 * 1000;

/* Query parameters Keycloak adds on the way back. */
const CALLBACK_PARAMS = ["code", "state", "session_state", "iss",
    "error", "error_description"];

/** The Keycloak settings from the deployment's environment, or null
 * when the deployment has no Keycloak and the Admin uses its own
 * password form. */
export function oidc_config (env) {
    const url = env?.OPENID_URL?.replace(/\/+$/, "");
    const realm = env?.OPENID_REALM;
    if (!url || !realm) return null;
    return { url, realm, client_id: env.OPENID_CLIENT || "admin" };
}

function b64url (bytes) {
    return btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* Pure-JS SHA-256 (FIPS 180-4), from acs-visualiser/public/oidc.js.
 * crypto.subtle only exists in secure contexts and some ACS
 * deployments serve the Admin over plain http, so PKCE needs this. */
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

/** SHA-256 of some bytes, with crypto.subtle where the page has it. */
export async function sha256 (bytes) {
    if (globalThis.crypto?.subtle)
        return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return sha256_js(bytes);
}

/** The claims of a JWT, unverified. The services verify it; the Admin
 * only reads the name to show. */
export function jwt_claims (token) {
    try {
        const b64 = token.split(".")[1]
            .replace(/-/g, "+").replace(/_/g, "/");
        return JSON.parse(atob(b64));
    }
    catch { return undefined; }
}

/** A refresh refused by Keycloak, as opposed to one that did not get
 * there. The session has ended and the person must sign in again. */
export class SessionEnded extends Error {}

export class OIDCSession {
    /**
     * @param opts.config     from oidc_config()
     * @param opts.window     the page's window (location, history,
     *                        sessionStorage); tests pass a stand-in
     * @param opts.fetch      fetch to use, default globalThis.fetch
     * @param opts.on_ended   called when Keycloak refuses a refresh
     */
    constructor (opts) {
        this.config = opts.config;
        this.window = opts.window ?? globalThis;
        this.fetch = opts.fetch ?? ((...a) => globalThis.fetch(...a));
        this.on_ended = opts.on_ended ?? (() => {});

        this.tokens = null;
        this.refreshing = null;
        this.timer = null;
    }

    endpoint (name) {
        const { url, realm } = this.config;
        return `${url}/realms/${encodeURIComponent(realm)}/protocol/openid-connect/${name}`;
    }

    /* Keycloak sends the browser back to the Admin's root. The route
     * travels in the flow record, because Keycloak refuses a redirect
     * URI with a fragment and the Admin routes on the fragment. */
    redirect_uri () {
        const { origin, pathname } = this.window.location;
        return `${origin}${pathname}`;
    }

    get signed_in () { return !!this.tokens; }

    /** The person's name from the token: the Kerberos UPN without the
     * realm, as the password form used. */
    get username () {
        const claims = jwt_claims(this.tokens?.access_token) ?? {};
        const name = claims.preferred_username ?? claims.sub ?? "";
        return name.split("@")[0];
    }

    /** Send the browser to Keycloak. With a live Keycloak session it
     * comes straight back; otherwise Keycloak shows its sign-in form.
     * @param return_to the Admin route to open afterwards */
    async start_sign_in (return_to) {
        const random = n => b64url(crypto.getRandomValues(new Uint8Array(n)));
        const verifier = random(32);
        const state = random(16);
        const challenge = b64url(await sha256(new TextEncoder().encode(verifier)));

        try {
            this.window.sessionStorage.setItem(FLOW_KEY,
                JSON.stringify({ verifier, state, return_to }));
        }
        catch { /* no storage: the state check on return will fail */ }

        const url = new URL(this.endpoint("auth"));
        url.search = new URLSearchParams({
            response_type:          "code",
            client_id:              this.config.client_id,
            redirect_uri:           this.redirect_uri(),
            scope:                  "openid",
            state,
            code_challenge:         challenge,
            code_challenge_method:  "S256",
        });
        this.window.location.assign(url.toString());
    }

    /** Finish a sign-in if the page has just come back from Keycloak.
     * Returns null when it has not, { return_to } when it has signed
     * in, and { error } when it could not. The callback parameters are
     * removed from the address bar whatever happens. */
    async finish_sign_in () {
        const { location, history, sessionStorage } = this.window;
        const here = new URL(location.href);
        const params = here.searchParams;
        if (!params.has("code") && !params.has("error")) return null;

        let flow = null;
        try {
            flow = JSON.parse(sessionStorage.getItem(FLOW_KEY) ?? "null");
            sessionStorage.removeItem(FLOW_KEY);
        }
        catch { /* treated as a state mismatch below */ }

        const code = params.get("code");
        const state = params.get("state");
        const error = params.get("error");
        const description = params.get("error_description");

        for (const p of CALLBACK_PARAMS) params.delete(p);
        here.hash = flow?.return_to ? `#${flow.return_to}` : here.hash;
        history.replaceState(null, "", here.toString());

        if (error)
            return { error: description ? `${error}: ${description}` : error };
        if (!flow || flow.state !== state)
            return { error: "The sign-in reply did not match this tab's request." };

        try {
            await this.grant({
                grant_type:     "authorization_code",
                code,
                redirect_uri:   this.redirect_uri(),
                code_verifier:  flow.verifier,
            });
        }
        catch (e) {
            return { error: e.message };
        }
        return { return_to: flow.return_to ?? "/" };
    }

    async grant (params) {
        const res = await this.fetch(this.endpoint("token"), {
            method:     "POST",
            headers:    { "Content-Type": "application/x-www-form-urlencoded" },
            body:       new URLSearchParams({
                client_id: this.config.client_id,
                ...params,
            }).toString(),
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            const msg = `Keycloak refused the token request (${res.status} ${body.error ?? ""})`.trim();
            throw res.status == 400 || res.status == 401
                ? new SessionEnded(msg) : new Error(msg);
        }

        const json = await res.json();
        this.tokens = {
            access_token:   json.access_token,
            refresh_token:  json.refresh_token,
            id_token:       json.id_token ?? this.tokens?.id_token,
            expires_at:     Date.now() + json.expires_in * 1000,
        };
        this.schedule_refresh();
    }

    schedule_refresh () {
        clearTimeout(this.timer);
        if (!this.tokens) return;
        const wait = Math.max(0,
            this.tokens.expires_at - Date.now() - REFRESH_MARGIN_MS);
        this.timer = setTimeout(() =>
            this.refresh().catch(() => { /* handled in refresh */ }), wait);
    }

    /** Renew the access token. One request at a time: callers that
     * arrive while it is running share it. */
    refresh () {
        if (this.refreshing) return this.refreshing;
        this.refreshing = (async () => {
            try {
                if (!this.tokens?.refresh_token)
                    throw new SessionEnded("Not signed in");
                await this.grant({
                    grant_type:     "refresh_token",
                    refresh_token:  this.tokens.refresh_token,
                });
            }
            catch (e) {
                if (e instanceof SessionEnded) {
                    this.forget();
                    this.on_ended(e);
                }
                throw e;
            }
            finally {
                this.refreshing = null;
            }
        })();
        return this.refreshing;
    }

    /** An access token for the services. Given the token a service
     * just refused, or near expiry, it renews first. This is the
     * service client's `bearer_jwt` option. */
    async token (bad) {
        if (!this.tokens) throw new SessionEnded("Not signed in");
        const { access_token, expires_at } = this.tokens;
        if ((bad && bad === access_token) || expires_at - Date.now() < REFRESH_MARGIN_MS)
            await this.refresh();
        return this.tokens.access_token;
    }

    forget () {
        clearTimeout(this.timer);
        this.tokens = null;
    }

    /** Sign out of Keycloak, which ends the session for the Admin and
     * every other ACS app signed in through it, then come back to the
     * Admin, which asks the person to sign in again. */
    sign_out () {
        const id_token = this.tokens?.id_token;
        this.forget();
        const url = new URL(this.endpoint("logout"));
        url.search = new URLSearchParams({
            client_id:                  this.config.client_id,
            post_logout_redirect_uri:   this.redirect_uri(),
            ...(id_token ? { id_token_hint: id_token } : {}),
        });
        this.window.location.assign(url.toString());
    }
}

/* The Admin's one session, when the deployment has Keycloak. */
let session = undefined;

/** The Admin's OIDC session, or null when the deployment has no
 * Keycloak. */
export function oidc_session () {
    if (session === undefined) {
        /* import-meta-env substitutes each import.meta.env.KEY where it
         * is read, so name the keys; the object itself is not there. */
        const config = oidc_config({
            OPENID_URL:     import.meta.env.OPENID_URL,
            OPENID_REALM:   import.meta.env.OPENID_REALM,
            OPENID_CLIENT:  import.meta.env.OPENID_CLIENT,
        });
        session = config ? new OIDCSession({ config }) : null;
    }
    return session;
}

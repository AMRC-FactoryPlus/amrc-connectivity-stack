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
        const challenge = b64url(await crypto.subtle.digest("SHA-256",
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

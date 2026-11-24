/*
 * ACS Admin
 * Tests for sign-in through the ACS Keycloak
 * Copyright 2026 University of Sheffield
 */

import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    OIDCSession, SessionEnded, jwt_claims, oidc_config, sha256,
} from "../src/lib/oidc.js";

const CONFIG = { url: "https://openid.example.test", realm: "factory_plus", client_id: "admin" };
const TOKEN_URL = "https://openid.example.test/realms/factory_plus/protocol/openid-connect/token";

class MemoryStorage {
    constructor () { this.map = new Map(); }
    getItem (k) { return this.map.has(k) ? this.map.get(k) : null; }
    setItem (k, v) { this.map.set(k, String(v)); }
    removeItem (k) { this.map.delete(k); }
}

/* A window with an address bar we can read and set. */
function fake_window (href = "https://admin.example.test/#/devices") {
    const win = {
        sessionStorage: new MemoryStorage(),
        assigned: [],
        location: null,
        history: {
            replaceState (_s, _t, url) { win.set(url); },
        },
        set (url) {
            const u = new URL(url);
            win.location = {
                href: u.toString(), origin: u.origin, pathname: u.pathname,
                assign: to => win.assigned.push(to),
            };
        },
    };
    win.set(href);
    return win;
}

function jwt (claims) {
    const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
    return `${b64({ alg: "RS256" })}.${b64(claims)}.sig`;
}

/* A Keycloak token endpoint that hands out numbered tokens. */
function fake_keycloak () {
    const kc = { calls: [], n: 0, refuse: false };
    kc.fetch = vi.fn(async (url, opts) => {
        expect(url).toBe(TOKEN_URL);
        const body = Object.fromEntries(new URLSearchParams(opts.body));
        kc.calls.push(body);
        if (kc.refuse)
            return { ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) };
        kc.n++;
        return {
            ok: true, status: 200,
            json: async () => ({
                access_token: jwt({ preferred_username: "alice@EXAMPLE.TEST", n: kc.n }),
                refresh_token: `refresh-${kc.n}`,
                id_token: `id-${kc.n}`,
                expires_in: 300,
            }),
        };
    });
    return kc;
}

/* Run a sign-in to Keycloak and back. */
async function sign_in (win, kc, return_to = "/devices") {
    const s = new OIDCSession({ config: CONFIG, window: win, fetch: kc.fetch });
    await s.start_sign_in(return_to);
    const auth = new URL(win.assigned.at(-1));
    const state = auth.searchParams.get("state");
    win.set(`https://admin.example.test/?code=abc&state=${state}&session_state=x&iss=y`);
    const done = await s.finish_sign_in();
    return { s, auth, done };
}

describe("oidc_config", () => {
    it("is null without Keycloak, so the password form is used", () => {
        expect(oidc_config({})).toBeNull();
        expect(oidc_config({ OPENID_URL: "", OPENID_REALM: "r" })).toBeNull();
    });

    it("reads the deployment's Keycloak settings", () => {
        expect(oidc_config({ OPENID_URL: "https://openid.example.test/", OPENID_REALM: "factory_plus" }))
            .toEqual(CONFIG);
    });
});

describe("sha256", () => {
    it("matches node's SHA-256 without crypto.subtle (plain http)", async () => {
        vi.stubGlobal("crypto", { getRandomValues: a => a });
        try {
            for (const text of ["", "abc", "x".repeat(200)]) {
                const want = createHash("sha256").update(text).digest("hex");
                const got = Buffer.from(await sha256(new TextEncoder().encode(text))).toString("hex");
                expect(got).toBe(want);
            }
        }
        finally { vi.unstubAllGlobals(); }
    });
});

describe("OIDCSession", () => {
    let win, kc;
    beforeEach(() => {
        vi.useFakeTimers();
        win = fake_window();
        kc = fake_keycloak();
    });
    afterEach(() => vi.useRealTimers());

    it("sends the browser to Keycloak with PKCE and no fragment in the redirect", async () => {
        const { auth } = await sign_in(win, kc);
        expect(auth.origin + auth.pathname)
            .toBe("https://openid.example.test/realms/factory_plus/protocol/openid-connect/auth");
        expect(auth.searchParams.get("client_id")).toBe("admin");
        expect(auth.searchParams.get("redirect_uri")).toBe("https://admin.example.test/");
        expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
        expect(auth.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it("exchanges the code with the verifier, cleans the address bar and returns to the route", async () => {
        const { s, auth, done } = await sign_in(win, kc);
        expect(done).toEqual({ return_to: "/devices" });
        expect(win.location.href).toBe("https://admin.example.test/#/devices");

        const [call] = kc.calls;
        expect(call.grant_type).toBe("authorization_code");
        expect(call.redirect_uri).toBe("https://admin.example.test/");
        const challenge = createHash("sha256").update(call.code_verifier).digest("base64url");
        expect(challenge).toBe(auth.searchParams.get("code_challenge"));

        expect(s.signed_in).toBe(true);
        expect(s.username).toBe("alice");
        expect(jwt_claims(await s.token()).n).toBe(1);
    });

    it("keeps nothing but the short-lived flow in storage, and removes that on return", async () => {
        await sign_in(win, kc);
        expect(win.sessionStorage.map.size).toBe(0);
    });

    it("does nothing on an ordinary page load", async () => {
        const s = new OIDCSession({ config: CONFIG, window: win, fetch: kc.fetch });
        expect(await s.finish_sign_in()).toBeNull();
        expect(kc.fetch).not.toHaveBeenCalled();
    });

    it("refuses a reply this tab did not ask for", async () => {
        const s = new OIDCSession({ config: CONFIG, window: win, fetch: kc.fetch });
        win.set("https://admin.example.test/?code=abc&state=forged");
        const done = await s.finish_sign_in();
        expect(done.error).toMatch(/did not match/);
        expect(kc.fetch).not.toHaveBeenCalled();
        expect(win.location.href).toBe("https://admin.example.test/");
    });

    it("reports an error Keycloak sends back", async () => {
        const s = new OIDCSession({ config: CONFIG, window: win, fetch: kc.fetch });
        await s.start_sign_in("/");
        win.set("https://admin.example.test/?error=access_denied&error_description=No");
        expect(await s.finish_sign_in()).toEqual({ error: "access_denied: No" });
    });

    it("renews the token a minute before it expires", async () => {
        const { s } = await sign_in(win, kc);
        await vi.advanceTimersByTimeAsync(239 * 1000);
        expect(kc.calls).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(2 * 1000);
        expect(kc.calls).toHaveLength(2);
        expect(kc.calls[1]).toMatchObject({ grant_type: "refresh_token", refresh_token: "refresh-1" });
        expect(jwt_claims(await s.token()).n).toBe(2);
    });

    it("renews once when a service refuses the token, sharing the request", async () => {
        const { s } = await sign_in(win, kc);
        const bad = await s.token();
        const [a, b] = await Promise.all([s.token(bad), s.token(bad)]);
        expect(a).toBe(b);
        expect(kc.calls).toHaveLength(2);
    });

    it("forgets the session and says so when Keycloak refuses a renewal", async () => {
        const on_ended = vi.fn();
        const s = new OIDCSession({ config: CONFIG, window: win, fetch: kc.fetch, on_ended });
        await s.start_sign_in("/");
        const state = new URL(win.assigned.at(-1)).searchParams.get("state");
        win.set(`https://admin.example.test/?code=abc&state=${state}`);
        await s.finish_sign_in();

        kc.refuse = true;
        await expect(s.token(await s.token())).rejects.toBeInstanceOf(SessionEnded);
        expect(on_ended).toHaveBeenCalledOnce();
        expect(s.signed_in).toBe(false);
    });

    it("signs out through Keycloak with the id token, back to the Admin", async () => {
        const { s } = await sign_in(win, kc);
        s.sign_out();
        const out = new URL(win.assigned.at(-1));
        expect(out.pathname).toBe("/realms/factory_plus/protocol/openid-connect/logout");
        expect(out.searchParams.get("id_token_hint")).toBe("id-1");
        expect(out.searchParams.get("post_logout_redirect_uri")).toBe("https://admin.example.test/");
        expect(s.signed_in).toBe(false);
    });
});

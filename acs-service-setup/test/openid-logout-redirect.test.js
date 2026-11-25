/*
 * ACS service setup
 * Tests for the OIDC clients' post-logout redirect URIs
 * Copyright 2026 University of Sheffield AMRC
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { OpenIDSetup, post_logout_redirect_uris } from "../lib/openid.js";

const ROOT = "http://admin.example.test";
const ATTR = "post.logout.redirect.uris";

/* Keycloak's matching for these URIs: exact, or a prefix when the
 * registered URI ends in `*`. */
function keycloak_allows (registered, uri) {
    return registered.split("##").some(r => r.endsWith("*")
        ? uri.startsWith(r.slice(0, -1))
        : uri == r);
}

test("by default the root and anything under it may be returned to", () => {
    const uris = post_logout_redirect_uris(ROOT, {});
    /* What the Admin and the visualiser send. */
    assert.ok(keycloak_allows(uris, `${ROOT}/`));
    assert.ok(keycloak_allows(uris, `${ROOT}/index.html`));
    /* What Grafana sends. */
    assert.ok(keycloak_allows(uris, ROOT));
    /* Never another host. */
    assert.ok(!keycloak_allows(uris, "http://admin.example.test.evil.test/"));
    assert.ok(!keycloak_allows(uris, "http://grafana.example.test/"));
});

test("a client's own list replaces the default", () => {
    const uris = post_logout_redirect_uris(ROOT, {
        postLogoutRedirectUris: ["https://oauth.example.test/callback"],
    });
    assert.equal(uris, "https://oauth.example.test/callback");
    assert.ok(!keycloak_allows(uris, `${ROOT}/`));
});

/* An OpenIDSetup talking to a fake Keycloak admin API which holds
 * `existing` as the only client. */
function harness (existing) {
    process.env.OPENID_URL ??= "http://openid.example.test";
    const setup = new OpenIDSetup({
        fplus:          { debug: { bound: () => () => {} } },
        config:         {},
        acs_config:     { secure: false, domain: "example.test", realm: "EXAMPLE.TEST" },
    });
    setup.realm = "factory_plus";
    const calls = [];
    let client = existing;
    setup.api = async (method, path, body) => {
        calls.push([method, path, body]);
        if (method == "GET")
            return { body: client ? [client] : [] };
        if (method == "POST")
            client = { id: "new-id", ...body };
        return { body: undefined };
    };
    return { setup, calls };
}

test("a new client is created with the default logout URIs", async () => {
    const { setup, calls } = harness(undefined);
    await setup.ensure_client("admin", { publicClient: true });
    const [, , body] = calls.find(([m]) => m == "POST");
    assert.ok(keycloak_allows(body.attributes[ATTR], `${ROOT}/`));
});

test("an existing client's logout URIs are updated on the next run", async () => {
    const { setup, calls } = harness({
        id:             "old-id",
        clientId:       "admin",
        protocolMappers: [{ name: "fp_principal_uuid" }],
        attributes:     { [ATTR]: ROOT },
    });
    await setup.ensure_client("admin", { publicClient: true });

    const put = calls.find(([m]) => m == "PUT");
    assert.ok(put, "the existing client is updated");
    assert.match(put[1], /\/clients\/old-id$/);
    assert.ok(keycloak_allows(put[2].attributes[ATTR], `${ROOT}/`));
    assert.equal(put[2].protocolMappers, undefined);
});

/* The Admin is served at admin.<baseUrl> and at the bare <baseUrl>.
 * Keycloak refuses a sign-in whose redirect_uri the client doesn't
 * list, with "Invalid parameter: redirect_uri", so a client served at
 * both must list both. */
const BARE = "http://example.test";

test("a client also at the base URL accepts sign-ins from both hosts", async () => {
    const { setup, calls } = harness(undefined);
    await setup.ensure_client("admin", { publicClient: true, alsoAtBaseUrl: true });
    const [, , body] = calls.find(([m]) => m == "POST");

    assert.deepEqual(body.redirectUris, [`${ROOT}/*`, `${BARE}/*`]);
    assert.deepEqual(body.webOrigins, [ROOT, BARE]);
    for (const uri of [ROOT, `${ROOT}/`, BARE, `${BARE}/`, `${BARE}/index.html`])
        assert.ok(keycloak_allows(body.attributes[ATTR], uri), uri);
    assert.equal(body.rootUrl, ROOT);
});

test("a client not at the base URL accepts only its own host", async () => {
    const { setup, calls } = harness(undefined);
    await setup.ensure_client("grafana", { publicClient: true });
    const [, , body] = calls.find(([m]) => m == "POST");

    assert.deepEqual(body.redirectUris, ["http://grafana.example.test/*"]);
    assert.ok(!keycloak_allows(body.attributes[ATTR], `${BARE}/`));
});

test("the chart's admin client is also at the base URL", async () => {
    const { readFile } = await import("node:fs/promises");
    const values = await readFile(new URL("../../deploy/values.yaml", import.meta.url), "utf8");
    const admin = values.match(/\n      admin:\n((?: {8}.*\n|\s*\n)+)/);
    assert.ok(admin, "openidClients.admin in values.yaml");
    assert.match(admin[1], /alsoAtBaseUrl: true/);
});

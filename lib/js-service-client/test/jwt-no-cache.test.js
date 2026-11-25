/*
 * Factory+ NodeJS Utilities
 * Tests that requests carrying a caller's JWT stay out of the HTTP cache
 * Copyright 2026 University of Sheffield AMRC
 */

/* The HTTP cache is private to the process and keyed by URL alone. A
 * service forwards a Keycloak caller's JWT on the calls it makes for
 * them, so a cached response must never cross between callers, or
 * between a caller and the service's own identity. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { Fetch } from "../lib/service/fetch.js";
import { jwt_context } from "../lib/jwt-context.js";

const SERVICE = "00000000-0000-0000-0000-000000000001";

function harness () {
    const seen = [];
    const fplus = {
        debug:          { log: () => {} },
        opts:           {},
        service_url:    async () => "http://127.0.0.1:1/",
    };
    const fetch = new Fetch(fplus);
    fetch.service_token = async () => "service-token";
    fetch._real_fetch = async (url, opts) => {
        seen.push({ cache: opts.cache, auth: opts.headers?.Authorization });
        return new Response("{}", { status: 200 });
    };
    return { fetch, seen };
}

test("a request with a forwarded JWT is not cached", async () => {
    const { fetch, seen } = harness();
    await jwt_context.run({ jwt: "aaa.bbb.ccc" }, () =>
        fetch.fetch({ service: SERVICE, url: "v2/app" }));

    assert.equal(seen.length, 1);
    assert.equal(seen[0].cache, "no-store");
    assert.equal(seen[0].auth, "Bearer aaa.bbb.ccc");
});

test("a request with the service's own identity can use the cache", async () => {
    const { fetch, seen } = harness();
    await fetch.fetch({ service: SERVICE, url: "v2/app" });

    assert.equal(seen.length, 1);
    assert.equal(seen[0].cache, "default");
});

test("a caller cannot turn the cache back on with a cache option", async () => {
    const { fetch, seen } = harness();
    await jwt_context.run({ jwt: "aaa.bbb.ccc" }, () =>
        fetch.fetch({ service: SERVICE, url: "v2/app", cache: "default" }));

    assert.equal(seen[0].cache, "no-store");
});

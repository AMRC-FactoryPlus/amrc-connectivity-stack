/*
 * Factory+ Service HTTP API
 * Basic auth tests: password checks run one at a time and are cached.
 * Copyright 2026 University of Sheffield
 *
 * Run with `node --test test/`.
 *
 * GSS.verifyCredentials runs a Kerberos exchange on the threadpool,
 * and two at once can segfault the process. These tests use a stand-in
 * GSS which records how many checks overlap.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { FplusHttpAuth } from "../lib/auth.js";

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* A stand-in GSS. Each check takes `delay` ms; passwords other than
 * `good` fail. It counts calls and the most checks in flight at once. */
function fake_gss ({ delay = 20, good = "right" } = {}) {
    const g = { calls: 0, in_flight: 0, max_in_flight: 0 };
    g.verifyCredentials = async (client, pass) => {
        g.calls++;
        g.in_flight++;
        g.max_in_flight = Math.max(g.max_in_flight, g.in_flight);
        try {
            await sleep(delay);
            if (pass !== good) throw new Error("Preauthentication failed");
        }
        finally {
            g.in_flight--;
        }
    };
    return g;
}

function auth_with (gss, opts = {}) {
    return new FplusHttpAuth({
        realm: "EXAMPLE.ORG", hostname: "svc.example.org", keytab: "/dev/null",
        gss, log: () => {}, ...opts,
    });
}

/* Run the middleware with a Basic header; resolve to the status (200
 * when next() was called) and the principal. */
function basic (auth, user, pass) {
    const creds = Buffer.from(`${user}:${pass}`).toString("base64");
    return new Promise(resolve => {
        const req = {
            header: h => h === "Authorization" ? `Basic ${creds}` : undefined,
            path: "/v1/x",
        };
        const res = {
            status (code) { this.code = code; return this; },
            header () { return this; },
            end () { resolve({ status: this.code, principal: null }); },
        };
        auth.auth(req, res, () => resolve({ status: 200, principal: req.auth }));
    });
}

test("overlapping Basic auth requests never verify two passwords at once", async () => {
    const gss = fake_gss();
    const auth = auth_with(gss, { basic_cache_ms: 0 });
    const users = Array.from({ length: 8 }, (_, i) => `user${i}`);

    const results = await Promise.all(users.map(u => basic(auth, u, "right")));

    assert.ok(results.every(r => r.status === 200));
    assert.equal(gss.calls, 8);
    assert.equal(gss.max_in_flight, 1);
});

test("the one-at-a-time rule spans every auth instance in the process", async () => {
    const gss = fake_gss();
    const a = auth_with(gss, { basic_cache_ms: 0 });
    const b = auth_with(gss, { basic_cache_ms: 0 });

    await Promise.all([
        basic(a, "alice", "right"), basic(b, "bob", "right"),
        basic(a, "carol", "right"), basic(b, "dave", "right"),
    ]);

    assert.equal(gss.max_in_flight, 1);
});

test("a failed check does not stop the next one", async () => {
    const gss = fake_gss();
    const auth = auth_with(gss, { basic_cache_ms: 0 });

    const [bad, good] = await Promise.all([
        basic(auth, "alice", "wrong"),
        basic(auth, "bob", "right"),
    ]);

    assert.equal(bad.status, 401);
    assert.equal(good.status, 200);
    assert.equal(good.principal, "bob@EXAMPLE.ORG");
});

test("a verified password is trusted for the cache time", async () => {
    const gss = fake_gss({ delay: 1 });
    const auth = auth_with(gss, { basic_cache_ms: 200 });

    for (let i = 0; i < 5; i++)
        assert.equal((await basic(auth, "alice", "right")).status, 200);
    assert.equal(gss.calls, 1);

    await sleep(250);
    assert.equal((await basic(auth, "alice", "right")).status, 200);
    assert.equal(gss.calls, 2);
});

test("identical credentials arriving together share one check", async () => {
    const gss = fake_gss();
    const auth = auth_with(gss);

    const results = await Promise.all(
        Array.from({ length: 6 }, () => basic(auth, "alice", "right")));

    assert.ok(results.every(r => r.status === 200));
    assert.equal(gss.calls, 1);
});

test("a wrong password is never cached, and a cached one does not let a wrong one in", async () => {
    const gss = fake_gss({ delay: 1 });
    const auth = auth_with(gss);

    assert.equal((await basic(auth, "alice", "right")).status, 200);
    assert.equal((await basic(auth, "alice", "wrong")).status, 401);
    assert.equal((await basic(auth, "alice", "wrong")).status, 401);
    /* One success, then each wrong password asked Kerberos again. */
    assert.equal(gss.calls, 3);
});

test("the user's name alone does not hit the cache", async () => {
    const gss = fake_gss({ delay: 1 });
    const auth = auth_with(gss);

    await basic(auth, "alice", "right");
    assert.equal((await basic(auth, "alice@EXAMPLE.ORG", "wrong")).status, 401);
});

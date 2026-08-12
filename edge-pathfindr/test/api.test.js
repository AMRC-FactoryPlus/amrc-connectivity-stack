/*
 * ACS Pathfindr driver
 * API client tests.
 * Copyright 2026 University of Sheffield AMRC
 *
 * Run with `node --test test/`.
 *
 * Self-contained: spins up a fake Pathfindr on localhost that speaks the
 * documented v5 shapes, including the paging quirk where links drop query
 * parameters. Nothing here reaches the real service.
 */

import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";

import { PathfindrAPI, RateLimiter, normalise } from "../lib/api.js";

/* ---- fake Pathfindr ---------------------------------------------------- */

function asset (n) {
    return {
        type: "assets",
        id:   String(n),
        attributes: {
            partno:   "TP_PARTNO",
            serialno: `SN${n}`,
            status:   "complete",
            enviro:   { latest_temperature: 20 + n, latest_humidity: 50 },
            location_data: { location: { building: "Rotatives" } },
            attributes: [
                { name: "SAP Order Number", value: `000${n}`, data_type: "text" },
            ],
        },
    };
}

async function fake_pathfindr (opts = {}) {
    const state = {
        calls:      [],
        tokens:     0,
        total:      opts.total ?? 3,
        per_page:   opts.per_page ?? 100,
        token_status: opts.token_status ?? 200,
        expire_first: opts.expire_first ?? false,
        expires_in: opts.expires_in,
        used_token: null,
    };

    const srv = http.createServer((req, res) => {
        const url = new URL(req.url, "http://localhost");
        state.calls.push(url.pathname + url.search);

        const send = (code, body) => {
            res.writeHead(code, { "content-type": "application/json" });
            res.end(JSON.stringify(body));
        };

        if (url.pathname === "/oauth/token") {
            state.tokens++;
            if (state.token_status !== 200)
                return send(state.token_status, { errors: [{ status: "401" }] });
            const body = {
                access_token: `token-${state.tokens}`,
                token_type:   "Bearer",
            };
            /* The real service issues 1200, not the 63115200 in the
             * published example. "OMIT" drops the field entirely. */
            if (state.expires_in !== "OMIT")
                body.expires_in = state.expires_in === undefined
                    ? 1200 : state.expires_in;
            return send(200, body);
        }

        const auth = req.headers.authorization ?? "";
        state.used_token = auth.replace(/^Bearer /, "");

        /* Simulate a secret rotated out from under us: the first token is
         * rejected once, forcing the client to re-authenticate. */
        if (state.expire_first && state.used_token === "token-1")
            return send(401, { errors: [{ status: "401" }] });

        if (url.pathname === "/api/client/v5/assets") {
            const page = Number(url.searchParams.get("page") ?? 1);
            const last = Math.max(1, Math.ceil(state.total / state.per_page));
            const from = (page - 1) * state.per_page;
            const data = [];
            for (let i = from; i < Math.min(from + state.per_page, state.total); i++)
                data.push(asset(i + 1));

            return send(200, {
                data,
                /* The documented quirk: paging links carry no query params. */
                links: {
                    next: page < last
                        ? "https://x.test/api/client/v5/assets?page=" + (page + 1)
                        : null,
                },
                meta: { current_page: page, last_page: last, total: state.total },
            });
        }

        if (url.pathname === "/api/client/v5/buildings/55") {
            /* Single object, bare-resource envelope. */
            return send(200, {
                data: {
                    type: "buildings", id: "55",
                    attributes: { name: "Building One", floor: 0 },
                },
            });
        }

        /* Mirrors the real enviro history endpoint: many pages, per_page
         * forced to 1440 whatever the client asks for, newest first. */
        if (url.pathname === "/api/client/v5/assets/envirohistory") {
            const page = Number(url.searchParams.get("page") ?? 1);
            return send(200, {
                data: [{
                    type: "envirohistory", id: String(10934162 - page),
                    attributes: {
                        temperature: 20.2, humidity: 58,
                        minute_stamp: "2024-09-25 12:00:00",
                    },
                }],
                meta: { current_page: page, last_page: 8, per_page: 1440,
                    total: 11089 },
            });
        }

        /* Single asset. Carries beacon_info, which the collection does not. */
        if (url.pathname === "/api/client/v5/assets/3731") {
            return send(200, {
                data: {
                    type: "assets", id: "3731",
                    attributes: {
                        serialno: "SN1",
                        beacon_info: {
                            serial: "EGRSX", battery: 78,
                            last_heartbeat: "2024-09-25 11:59:25",
                        },
                    },
                },
            });
        }

        /* The runtime endpoints answer this for anything that is not a GPS
         * tracker, so every plain BLE tag gets it. Routine, not a fault. */
        if (url.pathname === "/api/client/v5/assets/3731/runtimedata") {
            return send(422, { errors: [{ status: "422",
                code: "invalid_gps_tracker",
                title: "The current asset is not linked to a valid GPS tracker" }] });
        }

        if (url.pathname === "/api/client/v5/boom")
            return send(500, { errors: [{ status: "500" }] });

        return send(404, { errors: [{ status: "404", code: "resource_not_found" }] });
    });

    await new Promise(r => srv.listen(0, "127.0.0.1", r));
    state.base = `http://127.0.0.1:${srv.address().port}`;
    state.close = () => new Promise(r => {
        /* fetch keeps sockets alive, and server.close() waits on them.
         * Without this every test sits out the 5s keep-alive timeout. */
        srv.closeAllConnections();
        srv.close(r);
    });
    return state;
}

function client (fake, conf = {}) {
    return new PathfindrAPI({
        log:  () => {},
        conf: {
            baseURL:      fake.base,
            clientId:     "id",
            clientSecret: "secret",
            cacheMs:      60000,
            ...conf,
        },
    });
}

/* ---- normalise --------------------------------------------------------- */

test("normalise flattens a wrapped collection", () => {
    const out = normalise({ data: [asset(1)] });
    assert.equal(out.length, 1);
    /* The point of flattening: a path reads $.serialno, not
     * $.data.attributes.serialno. */
    assert.equal(out[0].serialno, "SN1");
    assert.equal(out[0].id, "1");
    assert.equal(out[0].type, "assets");
    assert.equal(out[0].enviro.latest_temperature, 21);
});

test("normalise flattens a wrapped single resource", () => {
    const out = normalise({ data: asset(2) });
    assert.equal(out.serialno, "SN2");
});

test("normalise flattens a bare resource with no data wrapper", () => {
    /* The documented runtime example arrives like this. */
    const out = normalise(asset(3));
    assert.equal(out.serialno, "SN3");
});

test("normalise re-keys site-defined attributes by name", () => {
    const out = normalise({ data: asset(1) });
    assert.equal(out.attrs["SAP Order Number"], "0001");
    /* The original list survives for anyone who wants it. */
    assert.ok(Array.isArray(out.attributes));
});

test("normalise leaves an unrecognised body alone", () => {
    assert.deepEqual(normalise({ meta: { x: 1 } }), { meta: { x: 1 } });
    assert.equal(normalise(null), null);
});

/* ---- rate limiter ------------------------------------------------------ */

test("rate limiter admits up to the limit then refuses", () => {
    let now = 1000;
    const rl = new RateLimiter(3, () => now);

    assert.equal(rl.try_take(), true);
    assert.equal(rl.try_take(), true);
    assert.equal(rl.try_take(), true);
    assert.equal(rl.try_take(), false);
    assert.ok(rl.wait_ms() > 0);
});

test("rate limiter frees slots as the window slides", () => {
    let now = 1000;
    const rl = new RateLimiter(2, () => now);

    rl.try_take();
    rl.try_take();
    assert.equal(rl.try_take(), false);

    now += 60001;
    assert.equal(rl.try_take(), true, "slot should free after a minute");
    assert.equal(rl.wait_ms(), 0);
});

/* ---- API client -------------------------------------------------------- */

test("login authenticates and reports UP", async t => {
    const fake = await fake_pathfindr();
    t.after(() => fake.close());

    const api = client(fake);
    assert.equal(await api.login(), "UP");
    assert.equal(fake.tokens, 1);
});

test("login reports AUTH on rejected credentials", async t => {
    const fake = await fake_pathfindr({ token_status: 401 });
    t.after(() => fake.close());

    assert.equal(await client(fake).login(), "AUTH");
});

test("login reports AUTH when bad credentials come back as a 500", async t => {
    /* Not hypothetical. Observed against portal.pathfindr.co.uk in August
     * 2026: a well-formed token request carrying a wrong client_id or
     * client_secret answers `500 {"message":""}`, not the 401
     * invalid_client OAuth2 asks for.
     *
     * Reporting that as CONN would send an operator hunting network faults
     * for what is a typo in a config field. */
    const fake = await fake_pathfindr({ token_status: 500 });
    t.after(() => fake.close());

    assert.equal(await client(fake).login(), "AUTH");
});

test("login still reports CONN for gateway errors", async t => {
    /* The other side of that trade: a real outage must not be reported as
     * a credentials problem. */
    for (const status of [502, 503, 504]) {
        const fake = await fake_pathfindr({ token_status: status });
        assert.equal(await client(fake).login(), "CONN",
            `${status} should be a connection failure`);
        await fake.close();
    }
});

test("login reports CONF when the config is incomplete", async t => {
    const fake = await fake_pathfindr();
    t.after(() => fake.close());

    const api = new PathfindrAPI({ log: () => {}, conf: { baseURL: fake.base } });
    assert.equal(await api.login(), "CONF");
});

test("login reports CONN when the host is unreachable", async () => {
    const api = new PathfindrAPI({
        log: () => {},
        conf: {
            /* Reserved TEST-NET-1, guaranteed not to answer. */
            baseURL: "http://192.0.2.1:9", clientId: "a", clientSecret: "b",
            timeout: 250,
        },
    });
    assert.equal(await api.login(), "CONN");
});

test("pagination rebuilds page URLs and never follows links.next", async t => {
    /* 250 assets over 3 pages. The fake's links.next points at a different
     * host, so following it would either fail or hit the wrong server. */
    const fake = await fake_pathfindr({ total: 250, per_page: 100 });
    t.after(() => fake.close());

    const api = client(fake);
    await api.login();

    const out = await api.fetch({
        key: "assets", path: "assets", query: {}, collection: true,
    });

    assert.equal(out.length, 250, "all three pages should be concatenated");
    assert.equal(out[0].serialno, "SN1");
    assert.equal(out[249].serialno, "SN250");

    const pages = fake.calls.filter(c => c.startsWith("/api/client/v5/assets"));
    assert.equal(pages.length, 3);
    assert.ok(pages.every(p => p.includes("page=")), "every page is explicit");
});

test("pagination reapplies filters to every page", async t => {
    const fake = await fake_pathfindr({ total: 250, per_page: 100 });
    t.after(() => fake.close());

    const api = client(fake, { filterPartNo: "WIDGET" });
    await api.login();
    await api.fetch({ key: "assets", path: "assets", query: {}, collection: true });

    const pages = fake.calls.filter(c => c.startsWith("/api/client/v5/assets"));
    assert.equal(pages.length, 3);
    /* The vendor drops query params from paging links, so we must put them
     * back on each page ourselves. */
    assert.ok(pages.every(p => p.includes("filter%5Bpartno%5D=WIDGET")),
        `filters missing from a page: ${pages.join(" ")}`);
});

test("live: a history sweep stops after one page", async t => {
    /* The real enviro endpoint reports 8 pages of 1440 records for a single
     * tag. Walking them to read the current temperature would cost eight
     * calls and eleven thousand records on every cache window. */
    const fake = await fake_pathfindr();
    t.after(() => fake.close());

    const api = client(fake);
    await api.login();

    const out = await api.fetch({
        key:       "assets/envirohistory?serial=SN1",
        path:      "assets/envirohistory",
        query:     { serial: "SN1" },
        collection: true,
        firstPage: true,
    });

    assert.equal(out.length, 1);
    assert.equal(out[0].temperature, 20.2);

    const calls = fake.calls.filter(c => c.includes("envirohistory"));
    assert.equal(calls.length, 1,
        `walked ${calls.length} pages of history; should have stopped at one`);
});

test("live: a 422 for a non-GPS asset is non-fatal", async t => {
    /* Every plain BLE tag returns invalid_gps_tracker from the runtime
     * endpoints. It must surface as a per-address http error, never as an
     * auth or connection fault that would take the whole connection down. */
    const fake = await fake_pathfindr();
    t.after(() => fake.close());

    const api = client(fake);
    await api.login();

    await assert.rejects(
        () => api.fetch({
            key: "assets/3731/runtimedata", path: "assets/3731/runtimedata",
            query: {}, collection: false,
        }),
        e => e.kind === "http");
});

test("a truncated sweep is logged, never silently partial", async t => {
    const fake = await fake_pathfindr({ total: 500, per_page: 100 });
    t.after(() => fake.close());

    const logs = [];
    const api = new PathfindrAPI({
        log:  (...a) => logs.push(a.join(" ")),
        conf: {
            baseURL: fake.base, clientId: "id", clientSecret: "secret",
            maxPages: 2,
        },
    });
    await api.login();

    const out = await api.fetch({
        key: "assets", path: "assets", query: {}, collection: true,
    });

    assert.equal(out.length, 200, "capped at maxPages");
    assert.ok(logs.some(l => l.includes("TRUNCATED")),
        "truncation must be announced");
});

test("a collection is fetched once and served from cache", async t => {
    const fake = await fake_pathfindr({ total: 3 });
    t.after(() => fake.close());

    const api = client(fake);
    await api.login();

    const req = { key: "assets", path: "assets", query: {}, collection: true };
    await api.fetch(req);
    await api.fetch(req);
    await api.fetch(req);

    const pages = fake.calls.filter(c => c.startsWith("/api/client/v5/assets"));
    assert.equal(pages.length, 1, "cache should collapse repeat polls");
});

test("concurrent polls for one collection share a single request", async t => {
    /* This is what stops a fifty-metric poll becoming fifty API calls. */
    const fake = await fake_pathfindr({ total: 3 });
    t.after(() => fake.close());

    const api = client(fake);
    await api.login();

    const req = { key: "assets", path: "assets", query: {}, collection: true };
    const all = await Promise.all(Array.from({ length: 50 }, () => api.fetch(req)));

    assert.equal(all.length, 50);
    assert.ok(all.every(r => r.length === 3));

    const pages = fake.calls.filter(c => c.startsWith("/api/client/v5/assets"));
    assert.equal(pages.length, 1, "fifty concurrent polls, one call");
});

test("cache expires once the window passes", async t => {
    const fake = await fake_pathfindr({ total: 3 });
    t.after(() => fake.close());

    const api = client(fake, { cacheMs: 1 });
    await api.login();

    const req = { key: "assets", path: "assets", query: {}, collection: true };
    await api.fetch(req);
    await new Promise(r => setTimeout(r, 15));
    await api.fetch(req);

    const pages = fake.calls.filter(c => c.startsWith("/api/client/v5/assets"));
    assert.equal(pages.length, 2);
});

test("the token is refreshed before it expires, without waiting for a 401",
async t => {
    /* The live service issues 20 minute tokens, not the two years the
     * published example suggests, so this path runs several times an hour on
     * every connection rather than never. Refreshing proactively means a
     * poll is not spent discovering the token has died. */
    const fake = await fake_pathfindr({ total: 3, expires_in: 0.02 });
    t.after(() => fake.close());

    const api = client(fake, { cacheMs: 1 });
    await api.login();
    assert.equal(fake.tokens, 1);

    const req = { key: "assets", path: "assets", query: {}, collection: true };
    await api.fetch(req);
    assert.equal(fake.tokens, 1, "no refresh while the token is fresh");

    /* Past 90% of a 20ms life. */
    await new Promise(r => setTimeout(r, 30));
    await api.fetch(req);

    assert.equal(fake.tokens, 2, "token should have been renewed proactively");
    assert.equal(fake.used_token, "token-2");
    /* Nothing 401'd; the refresh happened before the request went out. */
});

test("an absurd expires_in does not disable refreshing", async t => {
    /* Defensive: if the field ever came back as the documented 63115200 we
     * would simply refresh in two years, which is correct behaviour for a
     * token that genuinely lasts that long. */
    const fake = await fake_pathfindr({ expires_in: 63115200 });
    t.after(() => fake.close());

    const api = client(fake);
    await api.login();
    assert.ok(api.token.expires_at > Date.now());
});

test("a missing or nonsensical expires_in falls back to an hour", async t => {
    for (const bad of ["OMIT", 0, -1, "soon"]) {
        const fake = await fake_pathfindr({ expires_in: bad });
        const api = client(fake);
        await api.login();
        const life = api.token.expires_at - Date.now();
        /* One hour, discounted by the 0.9 refresh factor. */
        assert.ok(life > 3000000 && life <= 3240000,
            `expires_in ${bad} gave a ${life}ms life`);
        await fake.close();
    }
});

test("a 401 mid-session triggers one re-authentication", async t => {
    const fake = await fake_pathfindr({ total: 3, expire_first: true });
    t.after(() => fake.close());

    const api = client(fake);
    await api.login();
    assert.equal(fake.tokens, 1);

    const out = await api.fetch({
        key: "assets", path: "assets", query: {}, collection: true,
    });

    assert.equal(out.length, 3, "the retry should succeed");
    assert.equal(fake.tokens, 2, "exactly one extra token fetch");
});

test("a single-object request is not paginated", async t => {
    const fake = await fake_pathfindr();
    t.after(() => fake.close());

    const api = client(fake);
    await api.login();

    const out = await api.fetch({
        key: "buildings/55", path: "buildings/55", query: {}, collection: false,
    });

    assert.equal(out.name, "Building One");
    assert.ok(!fake.calls.some(c => c.includes("buildings/55?page=")),
        "no page parameter on a single object");
});

test("a server error surfaces as a non-fatal http error", async t => {
    const fake = await fake_pathfindr();
    t.after(() => fake.close());

    const api = client(fake);
    await api.login();

    await assert.rejects(
        () => api.fetch({ key: "boom", path: "boom", query: {}, collection: false }),
        e => e.kind === "http");
});

test("a 404 surfaces as http, not as a connection failure", async t => {
    /* One bad address must never take the whole connection down. */
    const fake = await fake_pathfindr();
    t.after(() => fake.close());

    const api = client(fake);
    await api.login();

    await assert.rejects(
        () => api.fetch({ key: "nope", path: "nope", query: {}, collection: false }),
        e => e.kind === "http");
});

test("the cache is bounded", async t => {
    const fake = await fake_pathfindr({ total: 1 });
    t.after(() => fake.close());

    const api = client(fake, { cacheMs: 1 });
    await api.login();

    for (let i = 0; i < 60; i++) {
        await api.fetch({
            key: `assets#${i}`, path: "assets", query: {}, collection: true,
        });
    }

    /* Entries expire at 1ms, so pruning should keep this far below the
     * number of distinct keys used. */
    assert.ok(api.cache.size < 60,
        `cache grew to ${api.cache.size} and is not being pruned`);
});

test("closing clears cached data", async t => {
    const fake = await fake_pathfindr();
    t.after(() => fake.close());

    const api = client(fake);
    await api.login();
    await api.fetch({ key: "assets", path: "assets", query: {}, collection: true });
    assert.ok(api.cache.size > 0);

    api.close();
    assert.equal(api.cache.size, 0);
    assert.equal(api.token, null);
});

/*
 * Factory+ NodeJS Utilities
 * Tests that a service's websockets use its own identity
 * Copyright 2026 University of Sheffield AMRC
 */

/* A request that authenticated with a Keycloak JWT runs inside
 * jwt_context, so the service's onward calls carry the caller's JWT.
 * That is right for calls made for the caller. It is wrong for a
 * websocket: the shared notify connections are opened lazily, often
 * inside the first request that needs them, and their reconnect
 * timers keep that request's context for as long as the process runs.
 * When the caller's JWT expired, every reconnect forwarded it, failed
 * 401, and the service could no longer read anyone's ACL. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { WebSocketServer } from "ws";

import { Fetch } from "../lib/service/fetch.js";
import { jwt_context, without_jwt } from "../lib/jwt-context.js";

const SERVICE = "00000000-0000-0000-0000-000000000001";
const LIMIT = { timeout: 5000 };

const listening = srv => new Promise(resolve =>
    srv.once("listening", () => resolve(srv.address().port)));

/* A notify server that accepts any auth. */
async function ws_server (t) {
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    const port = await listening(wss);
    wss.on("connection", ws => {
        ws.on("error", () => {});
        ws.once("message", () => ws.send("200"));
    });
    t.after(() => {
        wss.clients.forEach(ws => ws.terminate());
        wss.close();
    });
    return port;
}

/* A Fetch which records the JWT in scope when it looks the service up
 * and when it asks for a token. */
function harness (port) {
    const seen = { lookup: [], token: [] };
    const fplus = {
        debug:          { log: () => {} },
        opts:           {},
        service_url:    async () => {
            seen.lookup.push(jwt_context.getStore()?.jwt);
            return `http://127.0.0.1:${port}/`;
        },
    };
    const fetch = new Fetch(fplus);
    fetch.service_token = async () => {
        seen.token.push(jwt_context.getStore()?.jwt);
        return "service-token";
    };
    return { fetch, seen };
}

test("a websocket opened in a request does not use the caller's JWT", LIMIT, async t => {
    const { fetch, seen } = harness(await ws_server(t));

    const ws = await jwt_context.run({ jwt: "caller-jwt" },
        () => fetch.ws_with_auth({ service: SERVICE, url: "notify/v2" }));
    ws.close();

    assert.deepEqual(seen.lookup, [undefined]);
    assert.deepEqual(seen.token, [undefined]);
});

test("a reconnect scheduled inside a request does not use the caller's JWT", LIMIT, async t => {
    const { fetch, seen } = harness(await ws_server(t));

    /* As rx.repeat's delay timer does: scheduled while the request is
     * in scope, run long after it has finished. */
    const ws = await jwt_context.run({ jwt: "caller-jwt" },
        () => new Promise((resolve, reject) => setTimeout(
            () => fetch.ws_with_auth({ service: SERVICE, url: "notify/v2" })
                .then(resolve, reject),
            10)));
    ws.close();

    assert.deepEqual(seen.lookup, [undefined]);
    assert.deepEqual(seen.token, [undefined]);
});

test("without_jwt leaves the caller's JWT in scope afterwards", () => {
    jwt_context.run({ jwt: "caller-jwt" }, () => {
        assert.equal(without_jwt(() => jwt_context.getStore()), undefined);
        assert.equal(jwt_context.getStore()?.jwt, "caller-jwt");
    });
});

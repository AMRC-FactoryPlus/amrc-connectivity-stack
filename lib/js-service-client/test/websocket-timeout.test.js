/*
 * Factory+ NodeJS Utilities
 * Tests for WebSocket connect and auth timeouts
 * Copyright 2026 University of Sheffield AMRC
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";

import { WebSocketServer } from "ws";

import { Fetch } from "../lib/service/fetch.js";
import { ServiceError } from "../lib/service/service-interface.js";

const SERVICE = "00000000-0000-0000-0000-000000000001";
const TIMEOUT = 200;
/* A test fails, where without a timeout it would hang. */
const LIMIT = { timeout: 5000 };

/* A Fetch which finds the service on a local port and has a token. */
function harness (port) {
    const fplus = {
        debug:          { log: () => {} },
        opts:           { ws_timeout: TIMEOUT },
        service_url:    async () => `http://127.0.0.1:${port}/`,
    };
    const fetch = new Fetch(fplus);
    fetch.service_token = async () => "token";
    return fetch;
}

const listening = srv => new Promise(resolve =>
    srv.once("listening", () => resolve(srv.address().port)));

const eventually = async (pred, what) => {
    for (let i = 0; i < 100; i++) {
        if (pred()) return;
        await new Promise(r => setTimeout(r, 10));
    }
    assert.fail(`Timed out waiting for ${what}`);
};

/* A TCP server which accepts connections and never answers, as a peer
 * does when it goes away without closing the connection. */
async function silent_tcp (t) {
    const socks = new Set();
    const srv = net.createServer(sock => {
        socks.add(sock);
        /* Read, so we see the client close its end. */
        sock.resume();
        sock.on("error", () => {});
        sock.on("close", () => socks.delete(sock));
    });
    srv.listen(0, "127.0.0.1");
    const port = await listening(srv);
    t.after(() => {
        socks.forEach(s => s.destroy());
        srv.close();
    });
    return { port, socks };
}

/* A WebSocket server. `on_auth` is called with each socket and the
 * auth message the client sent on it. */
async function ws_server (t, on_auth) {
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    const port = await listening(wss);
    const seen = [];
    wss.on("connection", ws => {
        seen.push(ws);
        ws.on("error", () => {});
        ws.once("message", m => on_auth?.(ws, m.toString(), seen.length));
    });
    t.after(() => {
        wss.clients.forEach(ws => ws.terminate());
        wss.close();
    });
    return { port, wss, seen };
}

const is_error = rx => err => {
    assert.ok(err instanceof ServiceError, `not a ServiceError: ${err}`);
    assert.equal(err.service, SERVICE);
    assert.match(err.message, rx);
    return true;
};

test("websocket rejects if the socket never opens", LIMIT, async t => {
    const { port, socks } = await silent_tcp(t);
    const fetch = harness(port);

    const start = Date.now();
    await assert.rejects(
        fetch.websocket({ service: SERVICE, url: "notify/v2" }),
        is_error(/connection timed out/));
    assert.ok(Date.now() - start < 10 * TIMEOUT);

    /* We closed our end, so the socket is not leaked. */
    await eventually(() => socks.size == 0, "the socket to close");
});

test("ws_with_auth rejects if the socket never opens", LIMIT, async t => {
    const { port } = await silent_tcp(t);
    const fetch = harness(port);

    await assert.rejects(
        fetch.ws_with_auth({ service: SERVICE, url: "notify/v2" }),
        is_error(/connection timed out/));
});

test("ws_with_auth rejects if the auth is never answered", LIMIT, async t => {
    const auths = [];
    const { port, wss } = await ws_server(t, (ws, msg) => auths.push(msg));
    const fetch = harness(port);

    const start = Date.now();
    await assert.rejects(
        fetch.ws_with_auth({ service: SERVICE, url: "notify/v2" }),
        is_error(/auth timed out/));
    assert.ok(Date.now() - start < 10 * TIMEOUT);

    assert.deepEqual(auths, ["Bearer token"]);
    await eventually(() => wss.clients.size == 0, "the socket to close");
});

test("ws_with_auth rejects if the socket closes before the auth reply",
    LIMIT, async t => {
        const { port } = await ws_server(t, ws => ws.close());
        const fetch = harness(port);

        await assert.rejects(
            fetch.ws_with_auth({ service: SERVICE, url: "notify/v2" }),
            is_error(/closed during auth/));
    });

test("ws_with_auth rejects if the token request never ends", LIMIT, async t => {
    const { port, wss } = await ws_server(t);
    const fetch = harness(port);
    fetch.service_token = () => new Promise(() => {});

    await assert.rejects(
        fetch.ws_with_auth({ service: SERVICE, url: "notify/v2" }),
        is_error(/auth timed out/));
    await eventually(() => wss.clients.size == 0, "the socket to close");
});

test("a timeout in the call overrides the client option", LIMIT, async t => {
    const { port } = await silent_tcp(t);
    const fetch = harness(port);
    fetch.fplus.opts.ws_timeout = 60000;

    await assert.rejects(
        fetch.websocket({ service: SERVICE, url: "notify/v2", timeout: 50 }),
        is_error(/timed out after 50ms/));
});

test("ws_with_auth returns an open socket when the auth is accepted",
    LIMIT, async t => {
        const { port } = await ws_server(t, ws => ws.send("200"));
        const fetch = harness(port);

        const ws = await fetch.ws_with_auth(
            { service: SERVICE, url: "notify/v2" });
        t.after(() => ws.terminate());
        assert.equal(ws.readyState, ws.constructor.OPEN);

        /* The socket stays open after the timeout has passed, and an
         * error on it later is not an unhandled rejection. */
        await new Promise(r => setTimeout(r, 2 * TIMEOUT));
        assert.equal(ws.readyState, ws.constructor.OPEN);
    });

test("ws_with_auth retries a 401 with a new token and closes the first socket",
    LIMIT, async t => {
        const auths = [];
        const { port, wss } = await ws_server(t, (ws, msg, n) => {
            auths.push(msg);
            ws.send(n == 1 ? "401" : "200");
        });
        const fetch = harness(port);
        fetch.service_token = async (base, bad) => bad ? "new" : "old";

        const ws = await fetch.ws_with_auth(
            { service: SERVICE, url: "notify/v2" });
        t.after(() => ws.terminate());

        assert.deepEqual(auths, ["Bearer old", "Bearer new"]);
        await eventually(() => wss.clients.size == 1,
            "the refused socket to close");
    });

test("ws_with_auth closes the socket when the auth is refused",
    LIMIT, async t => {
        const { port, wss } = await ws_server(t, ws => ws.send("403"));
        const fetch = harness(port);

        await assert.rejects(
            fetch.ws_with_auth({ service: SERVICE, url: "notify/v2" }),
            err => err instanceof ServiceError && err.status == 403);
        await eventually(() => wss.clients.size == 0, "the socket to close");
    });

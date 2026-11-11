/*
 * Factory+ Rx interface
 * Tests for NotifyV2 retrying a connection which stalls
 * Copyright 2026 University of Sheffield AMRC
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";

import * as rx from "rxjs";
import { WebSocketServer } from "ws";

import { Fetch } from "@amrc-factoryplus/service-client/lib/service/fetch.js";

import { NotifyV2 } from "../lib/notify-v2.js";

const SERVICE = "00000000-0000-0000-0000-000000000001";
/* NotifyV2 waits 5 to 7 seconds before it retries. A test fails at
 * this limit, where without a timeout in Fetch it would hang. */
const LIMIT = { timeout: 15000 };

const listening = srv => new Promise(resolve =>
    srv.once("listening", () => resolve(srv.address().port)));

/* A NotifyV2 on a real Fetch, which finds the service on a local port.
 * `logs` holds the messages NotifyV2 logged. */
function harness (port) {
    const fplus = {
        debug:          { log: () => {} },
        opts:           { ws_timeout: 200 },
        service_url:    async () => `http://127.0.0.1:${port}/`,
    };
    const fetch = new Fetch(fplus);
    fetch.service_token = async () => "token";

    const logs = [];
    const service = {
        log:        (...args) => logs.push(args.join(" ")),
        debug:      { bound: () => () => {} },
        websocket:  url => fetch.ws_with_auth({ service: SERVICE, url }),
    };
    return { notify: new NotifyV2(service), logs };
}

/* Resolves when the notify connection is open. */
const opened = notify => rx.firstValueFrom(notify.notify);

test("a connection which never opens is retried", LIMIT, async t => {
    /* The first connection gets a TCP peer which never answers. Every
     * later connection is handed to a WebSocket server. */
    const wss = new WebSocketServer({ noServer: true });
    wss.on("connection", ws => {
        ws.on("error", () => {});
        ws.once("message", () => ws.send("200"));
    });

    const socks = new Set();
    let attempts = 0;
    const srv = net.createServer(sock => {
        socks.add(sock);
        sock.on("error", () => {});
        if (++attempts > 1)
            wss.emit("tcp", sock);
    });
    /* Speak just enough HTTP to pass the upgrade to the WS server. */
    wss.on("tcp", sock => sock.once("data", head => {
        const key = /sec-websocket-key: (.*)\r\n/i.exec(head.toString())[1];
        const req = {
            method:     "GET",
            headers:    {
                upgrade:                    "websocket",
                "sec-websocket-key":        key,
                "sec-websocket-version":    "13",
            },
        };
        wss.handleUpgrade(req, sock, Buffer.alloc(0),
            ws => wss.emit("connection", ws, req));
    }));
    srv.listen(0, "127.0.0.1");
    const port = await listening(srv);
    t.after(() => {
        socks.forEach(s => s.destroy());
        srv.close();
    });

    const { notify, logs } = harness(port);
    const sub = notify.notify.subscribe();
    t.after(() => sub.unsubscribe());

    await opened(notify);
    assert.equal(attempts, 2);
    assert.ok(logs.some(l => /connect error.*connection timed out/.test(l)),
        `no timeout logged: ${logs}`);
});

test("a connection whose auth is never answered is retried",
    LIMIT, async t => {
        let attempts = 0;
        const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
        const port = await listening(wss);
        wss.on("connection", ws => {
            ws.on("error", () => {});
            const answer = ++attempts > 1;
            ws.once("message", () => answer && ws.send("200"));
        });
        t.after(() => {
            wss.clients.forEach(ws => ws.terminate());
            wss.close();
        });

        const { notify, logs } = harness(port);
        const sub = notify.notify.subscribe();
        t.after(() => sub.unsubscribe());

        await opened(notify);
        assert.equal(attempts, 2);
        assert.ok(logs.some(l => /connect error.*auth timed out/.test(l)),
            `no timeout logged: ${logs}`);
    });

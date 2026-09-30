/*
 * Factory+ Service HTTP API
 * notify/v2: SEARCH snapshot failure.
 * Copyright 2026 University of Sheffield AMRC
 *
 * Kept in its own file: before the SEARCH serialisation fix a
 * rejected full() was an unhandled promise rejection, which ends the
 * Node process (and so this test file) rather than failing one test.
 */

import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";

import * as rx from "rxjs";
import WebSocket from "ws";

import { Notify } from "../lib/notify-v2.js";

test("SEARCH: a failing full() gives 500 and ends the subscription", async t => {
    const srv = http.createServer();
    const notify = new Notify({
        api: { http: srv, auth: { auth_bearer: async () => "tester" } },
        log: () => {},
    });
    notify.search("s/:name/", () => ({
        updates:    rx.NEVER,
        full:       () => Promise.reject(new Error("database gone")),
        acl:        rx.identity,
    }));
    notify.run();
    await new Promise(r => srv.listen(0, "127.0.0.1", r));
    t.after(() => {
        notify.wss.clients.forEach(c => c.terminate());
        notify.wss.close();
        srv.close();
    });

    const ws = new WebSocket(`ws://127.0.0.1:${srv.address().port}/notify/v2`);
    await new Promise(r => ws.once("open", r));
    ws.send("Bearer x");
    await new Promise(r => ws.once("message", r));
    const msgs = [];
    ws.on("message", m => msgs.push(JSON.parse(m)));
    ws.send(JSON.stringify({ method: "SEARCH", parent: "s/app/", uuid: "u" }));

    const end = Date.now() + 2000;
    while (!msgs.length && Date.now() < end)
        await new Promise(r => setTimeout(r, 10));
    assert.deepEqual(msgs, [{ uuid: "u", status: 500 }]);
});

/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * The SSE stream is sent uncompressed, whatever the client accepts.
 * Compressed, each event went through a zlib stream that takes one
 * write per turn of the event loop, so while other requests kept the
 * loop busy live values fell behind by as long as that work lasted.
 */

import { describe, it, expect, afterEach } from "@jest/globals";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { routes, isEventStream } from "../lib/routes.js";
import { SubscriptionManager } from "../lib/subscriptions.js";
import type { I3xVqt } from "../lib/types/i3x.js";
import { allowAll } from "./helpers/allow-all.js";

const OWNER = "test@REALM";
const ACCEPT = "br, gzip, deflate";

function setup() {
    let listener: ((id: string, vqt: I3xVqt) => void) | undefined;
    const valueCache = {
        onValueChange: (l: any) => { listener = l; },
        offValueChange: () => {},
    };
    const subscriptions = new SubscriptionManager({ valueCache, viewers: allowAll, ttl: 60_000 });
    managers.push(subscriptions);
    /* Enough namespaces for a body over compression's 1 kB threshold. */
    const namespaces = Array.from({ length: 50 }, (_, i) =>
        ({ uri: `urn:test:namespace:${i}`, displayName: `Namespace ${i}` }));
    const objectTree = { isReady: () => true, getNamespaces: () => namespaces };

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as any).auth = OWNER; next(); });
    routes({ objectTree: objectTree as any, access: allowAll as any, valueCache: valueCache as any,
        history: {} as any, subscriptions })(app);

    const { subscriptionId } = subscriptions.create(OWNER, "c");
    subscriptions.registerOne(OWNER, "c", subscriptionId, "leaf-1");
    const send = (n: number) => {
        for (let i = 0; i < n; i++)
            listener!("leaf-1", { value: i, quality: "Good", timestamp: new Date().toISOString() });
    };
    return { app, subscriptions, subscriptionId, send };
}

const managers: SubscriptionManager[] = [];
let server: Server | undefined;
let stop: (() => void) | undefined;
afterEach(() => {
    stop?.();
    server?.closeAllConnections();
    server?.close();
    server = stop = undefined;
    for (const m of managers.splice(0)) m.destroy();
});

async function listen(app: express.Express): Promise<string> {
    server = app.listen(0, "127.0.0.1");
    await new Promise(r => server!.once("listening", r));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

describe("SSE compression", () => {
    it("recognises the event-stream content type", () => {
        expect(isEventStream("text/event-stream")).toBe(true);
        expect(isEventStream("text/event-stream; charset=utf-8")).toBe(true);
        expect(isEventStream("Text/Event-Stream")).toBe(true);
        expect(isEventStream("application/json; charset=utf-8")).toBe(false);
        expect(isEventStream(undefined)).toBe(false);
    });

    it("still compresses ordinary responses", async () => {
        const { app } = setup();
        const base = await listen(app);
        const res = await fetch(`${base}/v1/namespaces`, { headers: { "accept-encoding": ACCEPT } });
        expect(res.headers.get("content-encoding")).toBe("br");
        expect((await res.json()).result).toHaveLength(50);

        const gz = await fetch(`${base}/v1/namespaces`, { headers: { "accept-encoding": "gzip" } });
        expect(gz.headers.get("content-encoding")).toBe("gzip");
    });

    it("sends the stream uncompressed to a client that accepts br and gzip", async () => {
        const { app, subscriptionId, send } = setup();
        const base = await listen(app);
        const res = await fetch(`${base}/v1/subscriptions/stream`, {
            method: "POST",
            headers: { "content-type": "application/json", "accept-encoding": ACCEPT },
            body: JSON.stringify({ clientId: "c", subscriptionId }),
        });
        const reader = res.body!.getReader();
        stop = () => { reader.cancel().catch(() => {}); };
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
        expect(res.headers.get("content-encoding")).toBeNull();

        send(20);
        let text = "";
        while ((text.match(/\n\n/g) ?? []).length < 20)
            text += new TextDecoder().decode((await reader.read()).value);
        expect(text.startsWith('data: [{"elementId":"leaf-1","value":0,')).toBe(true);
    });

    it("keeps up while other work holds the event loop in 10 ms slices", async () => {
        const { app, subscriptionId, send } = setup();
        const base = await listen(app);
        const res = await fetch(`${base}/v1/subscriptions/stream`, {
            method: "POST",
            headers: { "content-type": "application/json", "accept-encoding": ACCEPT },
            body: JSON.stringify({ clientId: "c", subscriptionId }),
        });
        const reader = res.body!.getReader();

        /* Synchronous work a slice at a time, as streamText does while
         * it builds a large response. */
        let busy = true;
        const spin = () => {
            const until = performance.now() + 10;
            while (performance.now() < until) { /* hold the loop */ }
            if (busy) setImmediate(spin);
        };
        stop = () => { busy = false; reader.cancel().catch(() => {}); };
        setImmediate(spin);

        /* 200 events. Through zlib, at two writes each and one write a
         * turn, they took about 4 s; uncompressed they arrive within a
         * few turns. */
        const started = performance.now();
        send(200);
        let events = 0;
        const dec = new TextDecoder();
        while (events < 200) {
            const { value, done } = await reader.read();
            if (done) break;
            events += (dec.decode(value, { stream: true }).match(/\n\n/g) ?? []).length;
        }
        const ms = performance.now() - started;
        busy = false;
        expect(events).toBe(200);
        expect(ms).toBeLessThan(1000);
    });

    it("adds no listener per write when the socket is full", () => {
        const { subscriptions, subscriptionId, send } = setup();
        const res: any = {
            setHeader() {}, flushHeaders() {}, on() {}, end() {},
            write: () => false,
            once: () => { throw new Error("listener added"); },
        };
        subscriptions.stream(OWNER, "c", subscriptionId, res);
        expect(() => send(20)).not.toThrow();
    });
});

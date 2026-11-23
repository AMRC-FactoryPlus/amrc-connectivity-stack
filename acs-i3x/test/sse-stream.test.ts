/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * The SSE stream is compressed like every other response, as i3X
 * requires. A zlib stream takes one write per turn of the event loop,
 * so the stream writes once a turn rather than once an update: written
 * once an update, live values fell behind for as long as other
 * requests kept the loop busy. A client that does not keep up has each
 * element's older updates replaced by its newest.
 */

import { describe, it, expect, afterEach } from "@jest/globals";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { routes } from "../lib/routes.js";
import { SseStream } from "../lib/sse-stream.js";
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
    it("still compresses ordinary responses", async () => {
        const { app } = setup();
        const base = await listen(app);
        const res = await fetch(`${base}/v1/namespaces`, { headers: { "accept-encoding": ACCEPT } });
        expect(res.headers.get("content-encoding")).toBe("br");
        expect((await res.json()).result).toHaveLength(50);

        const gz = await fetch(`${base}/v1/namespaces`, { headers: { "accept-encoding": "gzip" } });
        expect(gz.headers.get("content-encoding")).toBe("gzip");
    });

    it.each([["gzip", "gzip"], [ACCEPT, "br"]])("compresses the stream for Accept-Encoding: %s", async (accept, encoding) => {
        const { app, subscriptionId, send } = setup();
        const base = await listen(app);
        const res = await fetch(`${base}/v1/subscriptions/stream`, {
            method: "POST",
            headers: { "content-type": "application/json", "accept-encoding": accept },
            body: JSON.stringify({ clientId: "c", subscriptionId }),
        });
        const reader = res.body!.getReader();
        stop = () => { reader.cancel().catch(() => {}); };
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
        expect(res.headers.get("content-encoding")).toBe(encoding);

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

        /* 200 events. Through zlib at two writes each and one write a
         * turn, they took about 4 s. Written once a turn they arrive
         * within a few turns. */
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

    it("holds only the newest value per element for a client that stops reading", async () => {
        const { app, subscriptions, subscriptionId } = setup();
        subscriptions.registerOne(OWNER, "c", subscriptionId, "leaf-2");
        const base = await listen(app);
        const res = await fetch(`${base}/v1/subscriptions/stream`, {
            method: "POST",
            headers: { "content-type": "application/json", "accept-encoding": "gzip" },
            body: JSON.stringify({ clientId: "c", subscriptionId }),
        });
        const reader = res.body!.getReader();
        stop = () => { reader.cancel().catch(() => {}); };
        const stream = (subscriptions as any).subscriptions.get(subscriptionId).activeStream;

        /* Values that compress badly, so the buffers fill quickly. */
        const noise = () => Math.random().toString(36).repeat(8);
        const feed = (subscriptions as any).boundOnValueChange;
        let last: Record<string, string> = {};
        for (let turn = 0; turn < 400 && !(stream as any).blocked; turn++) {
            for (let i = 0; i < 200; i++) {
                const id = i % 2 ? "leaf-1" : "leaf-2";
                last[id] = noise();
                feed(id, { value: last[id], quality: "Good", timestamp: new Date().toISOString() });
            }
            await new Promise(r => setImmediate(r));
        }
        expect((stream as any).blocked).toBe(true);

        /* Another 100,000 updates while it is not reading. */
        for (let i = 0; i < 100_000; i++) {
            const id = i % 2 ? "leaf-1" : "leaf-2";
            last[id] = String(i);
            feed(id, { value: last[id], quality: "Good", timestamp: new Date().toISOString() });
        }
        expect((stream as any).held.size).toBe(2);

        /* Reading again gets the newest value of each, after whatever
         * was already in the buffers. */
        const dec = new TextDecoder();
        let text = "";
        while (!text.includes(`"value":"${last["leaf-1"]}"`) || !text.includes(`"value":"${last["leaf-2"]}"`))
            text += dec.decode((await reader.read()).value, { stream: true });
        expect(stream.superseded).toBeGreaterThanOrEqual(100_000 - 2);
    }, 20_000);

    it("adds no listener per write when the socket is full", async () => {
        const { subscriptions, subscriptionId, send } = setup();
        let listeners = 0;
        const res: any = {
            setHeader() {}, flushHeaders() {}, on() {}, end() {},
            write: () => false,
            once: () => { listeners++; },
        };
        subscriptions.stream(OWNER, "c", subscriptionId, res);
        for (let i = 0; i < 5; i++) {
            send(20);
            await new Promise(r => setImmediate(r));
        }
        expect(listeners).toBe(1);
    });
});

/** A response whose socket is full until drain() is called. */
function fullResponse() {
    const writes: string[] = [];
    let onDrain: (() => void) | undefined;
    let full = true;
    const res: any = {
        on() {}, end() {}, flush() {},
        write: (data: string) => { writes.push(data); return !full; },
        once: (ev: string, l: () => void) => { if (ev === "drain") onDrain = l; },
    };
    const drain = () => { full = false; const l = onDrain; onDrain = undefined; l?.(); };
    return { res, writes, drain };
}

const tick = () => new Promise(r => setImmediate(r));
const item = (elementId: string, value: number) =>
    ({ elementId, value, quality: "Good", timestamp: "2026-11-23T00:00:00Z" } as any);
const events = (data: string) =>
    data.split("\n\n").filter(Boolean).map(e => JSON.parse(e.slice("data: ".length))[0]);

describe("SseStream", () => {
    it("writes the updates of one turn in one write", async () => {
        const { res, writes, drain } = fullResponse();
        drain();
        const s = new SseStream(res);
        for (let i = 0; i < 50; i++) s.send(item("a", i));
        await tick();
        expect(writes).toHaveLength(1);
        expect(events(writes[0]).map(e => e.value)).toEqual([...Array(50).keys()]);
    });

    it("keeps only each element's newest update while the client is not reading", async () => {
        const { res, writes, drain } = fullResponse();
        const s = new SseStream(res);
        s.send(item("a", 0));
        await tick();
        expect(writes).toHaveLength(1);

        /* The client has stopped reading: a million updates to three
         * elements hold three. */
        for (let i = 1; i <= 1_000_000; i++) s.send(item(["a", "b", "c"][i % 3], i));
        await tick();
        expect(writes).toHaveLength(1);
        expect((s as any).held.size).toBe(3);
        expect(s.superseded).toBe(1_000_000 - 3);

        drain();
        expect(writes).toHaveLength(2);
        const latest = events(writes[1])
            .sort((x, y) => x.elementId.localeCompare(y.elementId));
        expect(latest).toEqual([item("a", 999_999), item("b", 1_000_000), item("c", 999_998)]);
    });

    it("sends nothing after the response closes", async () => {
        const writes: string[] = [];
        const res: any = {
            on() {},
            write: (d: string) => { writes.push(d); return true; },
            once() {}, end() {},
        };
        const s = new SseStream(res);
        s.send(item("a", 1));
        s.close();
        s.send(item("a", 2));
        await tick();
        expect(writes).toHaveLength(0);
    });
});

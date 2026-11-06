/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * History is read from InfluxDB and sent as a stream, a batch of rows
 * at a time, rather than built in memory. These tests run the real
 * History and APIv1 against a stand-in InfluxDB transport that sends
 * annotated CSV, and check the body, the status, failures part way
 * through, the InfluxDB timeout and a client that goes away.
 */

import { jest } from "@jest/globals";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { HttpError, RequestTimedOutError } from "@influxdata/influxdb-client";

import { History } from "../lib/history.js";
import { routes } from "../lib/routes.js";
import type { ObjectTree } from "../lib/object-tree.js";
import type { I3xVqt } from "../lib/types/i3x.js";
import { annotatedCsv, csvTransport } from "./helpers/influx-csv.js";

const T0 = Date.parse("2026-11-01T00:00:00Z");
const START = "2026-11-01T00:00:00Z";
const END = "2026-11-02T00:00:00Z";

/* Leaves temp and speed, a leaf without data, a composition, and a
 * leaf the caller may not see. */
const META = (name: string) => ({
    topLevelInstanceUuid: "dev", metricPath: "", metricName: name,
    sparkplugType: "Double", typeSuffix: "d",
});
const OBJECTS: Record<string, { isComposition: boolean; meta?: ReturnType<typeof META> }> = {
    temp: { isComposition: false, meta: META("Temp") },
    speed: { isComposition: false, meta: META("Speed") },
    empty: { isComposition: false, meta: META("Empty") },
    broken: { isComposition: false, meta: META("Broken") },
    dev: { isComposition: true },
    secret: { isComposition: false, meta: META("Secret") },
};

function tree(): ObjectTree {
    return {
        isReady: () => true,
        getObject: (id: string, visible?: (id: string, d: string | null) => boolean) => {
            const o = OBJECTS[id];
            if (!o || (visible && !visible(id, null))) return undefined;
            return { elementId: id, isComposition: o.isComposition, parentId: null };
        },
        getMetricMeta: (id: string) => OBJECTS[id]?.meta,
        unsDeviceSegment: () => "dev",
    } as unknown as ObjectTree;
}

/* Hides `secret`, as Access would for a caller without a grant. */
const access = {
    grants: async () => ({}),
    visible: () => (id: string) => id !== "secret",
};

function rows(n: number, from = 0): Array<{ _value: number; _time: string }> {
    return Array.from({ length: n }, (_, i) => ({
        _value: (from + i) / 4,
        _time: new Date(T0 + (from + i) * 40).toISOString(),
    }));
}
const vqts = (r: ReturnType<typeof rows>): I3xVqt[] =>
    r.map(x => ({ value: x._value, quality: "Good", timestamp: x._time }));

/* Which measurement a history query reads. */
const measurement = (q: string) => /_measurement"\] == "(\w+):d"/.exec(q)?.[1];

function makeHistory(transport: any, opts: { queryTimeout?: number; influxConcurrency?: number } = {}) {
    const history = new History({
        influxUrl: "http://influx.invalid", influxToken: "", influxOrg: "o", influxBucket: "b",
        objectTree: tree(), ...opts,
    });
    (history as any).streamTransport = transport;
    return history;
}

/* The production middleware: compression, envelope and routes. */
function app(history: History) {
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => { (req as any).auth = "test@REALM"; next(); });
    routes({ objectTree: tree(), access, history,
        valueCache: {} as any, subscriptions: {} as any })(a);
    return a;
}

/* Read the body as text, whatever its content type says. */
function text(req: request.Test) {
    return req.buffer(true).parse((res, cb) => {
        let s = "";
        res.setEncoding("utf8");
        res.on("data", (c: string) => { s += c; });
        res.on("end", () => cb(null, s));
    });
}

const SEMAPHORE = (h: History) => (h as any).semaphore;

describe("History.streamHistory", () => {
    it("yields the rows a batch per chunk, with lines split across chunks", async () => {
        const data = rows(5000);
        const h = makeHistory(csvTransport(() => data, { chunkSize: 1000 }));
        const batches: I3xVqt[][] = [];
        for await (const b of h.streamHistory("temp", START, END)) batches.push(b);
        expect(batches.length).toBeGreaterThan(10);
        expect(batches.flat()).toEqual(vqts(data));
        expect(await h.queryHistory("temp", START, END)).toEqual(vqts(data));
        expect(SEMAPHORE(h).running).toBe(0);
    });

    it("yields nothing, and sends no query, for a composition or an id without meta", async () => {
        const iterate = jest.fn();
        const h = makeHistory({ iterate });
        for await (const _ of h.streamHistory("dev", START, END)) throw new Error("rows");
        for await (const _ of h.streamHistory("nope", START, END)) throw new Error("rows");
        expect(iterate).not.toHaveBeenCalled();
    });

    it("fails when InfluxDB sends nothing for the query timeout, and closes the request", async () => {
        let signal: AbortSignal | undefined;
        const h = makeHistory({
            async *iterate(_p: string, _b: string, o: { signal: AbortSignal }) {
                signal = o.signal;
                yield Buffer.from(annotatedCsv(rows(10)).replace(/\r\n\r\n$/, "\r\n"));
                await new Promise((_, reject) =>
                    o.signal.addEventListener("abort", () => reject(new Error("aborted"))));
            },
        }, { queryTimeout: 50 });
        const got: I3xVqt[] = [];
        await expect((async () => {
            for await (const b of h.streamHistory("temp", START, END)) got.push(...b);
        })()).rejects.toBeInstanceOf(RequestTimedOutError);
        expect(got).toHaveLength(10);
        expect(signal!.aborted).toBe(true);
        expect(SEMAPHORE(h).running).toBe(0);
    });

    it("does not time a slow consumer against the query timeout", async () => {
        const data = rows(300);
        const h = makeHistory(csvTransport(() => data, { chunkSize: 2000 }), { queryTimeout: 30 });
        const got: I3xVqt[] = [];
        for await (const b of h.streamHistory("temp", START, END)) {
            got.push(...b);
            await new Promise(r => setTimeout(r, 60));
        }
        expect(got).toEqual(vqts(data));
    });

    it("closes the request and frees its slot when the caller aborts or stops early", async () => {
        const signals: AbortSignal[] = [];
        const h = makeHistory({
            async *iterate(_p: string, _b: string, o: { signal: AbortSignal }) {
                signals.push(o.signal);
                const head = annotatedCsv(rows(1)).replace(/\r\n\r\n$/, "\r\n");
                yield Buffer.from(head);
                for (let i = 1; ; i++) {
                    if (o.signal.aborted) throw new Error("aborted");
                    await new Promise(r => setTimeout(r, 1));
                    yield Buffer.from(`,,0,${new Date(T0 + i).toISOString()},${i}\r\n`);
                }
            },
        }, { influxConcurrency: 1 });

        /* Stopping early, as for-await does on break. */
        for await (const _ of h.streamHistory("temp", START, END)) break;
        expect(signals[0].aborted).toBe(true);
        expect(SEMAPHORE(h).running).toBe(0);

        /* Aborting while waiting for InfluxDB. */
        const abort = new AbortController();
        const it = h.streamHistory("temp", START, END, { signal: abort.signal });
        await it.next();
        const pending = it.next().then(() => it.next());
        abort.abort();
        await expect(pending).rejects.toThrow();
        expect(signals[1].aborted).toBe(true);
        expect(SEMAPHORE(h).running).toBe(0);
    });

    it("fails on an error InfluxDB reports after the response has started", async () => {
        const h = makeHistory({
            async *iterate() {
                yield Buffer.from(annotatedCsv(rows(3)));
                yield Buffer.from("#datatype,string,string\r\n#group,true,true\r\n#default,,\r\n"
                    + ",error,reference\r\n,query ran out of memory,\r\n\r\n");
            },
        });
        await expect(h.queryHistory("temp", START, END)).rejects.toThrow("query ran out of memory");
    });
});

describe("POST /v1/objects/history, streamed", () => {
    const tempRows = rows(40_000);
    const speedRows = rows(3, 100);
    const transport = csvTransport(q => {
        switch (measurement(q)) {
            case "Temp": return tempRows;
            case "Speed": return speedRows;
            case "Broken": throw new HttpError(500, "Internal Server Error", "{\"message\":\"boom\"}");
            default: return [];
        }
    }, { chunkSize: 16 * 1024 });

    it("sends the same object the in-memory response did, for every kind of element", async () => {
        const h = makeHistory(transport);
        const ids = ["temp", "speed", "dev", "empty", "secret", "nope", "broken"];
        const res = await request(app(h)).post("/v1/objects/history")
            .set("Accept-Encoding", "gzip")
            .send({ elementIds: ids, startTime: START, endTime: END });

        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toMatch(/^application\/json/);
        expect(res.headers["content-encoding"]).toBe("gzip");
        expect(res.headers["transfer-encoding"]).toBe("chunked");
        const item = (id: string, values: I3xVqt[]) =>
            ({ success: true, elementId: id, result: { elementId: id, values } });
        expect(res.body).toEqual({
            success: false,
            results: [
                item("temp", vqts(tempRows)),
                item("speed", vqts(speedRows)),
                item("dev", []),
                item("empty", []),
                { success: false, elementId: "secret", error: { code: 404, message: "Object secret not found" } },
                /* Unknown to a caller with limited access, as hidden. */
                { success: false, elementId: "nope", error: { code: 404, message: "Object nope not found" } },
                { success: false, elementId: "broken", error: { code: 500, message: expect.stringContaining("boom") } },
            ],
        });
        expect(SEMAPHORE(h).running).toBe(0);
    });

    it("says success when every element succeeds", async () => {
        const res = await request(app(makeHistory(transport))).post("/v1/objects/history")
            .send({ elementIds: ["speed", "temp"], startTime: START, endTime: END });
        expect(res.body.success).toBe(true);
        expect(res.body.results.map((r: any) => r.result.values.length)).toEqual([3, 40_000]);
    });

    it("refuses bad bounds with a 400 before any query", async () => {
        const iterate = jest.fn();
        const res = await request(app(makeHistory({ iterate }))).post("/v1/objects/history")
            .send({ elementIds: ["temp"], startTime: "-30d", endTime: END });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ success: false, error: { code: 400, message: expect.any(String) } });
        expect(iterate).not.toHaveBeenCalled();
    });

    it("leaves the JSON visibly incomplete when InfluxDB fails part way through", async () => {
        const err = jest.spyOn(console, "error").mockImplementation(() => {});
        try {
            const h = makeHistory({
                async *iterate() {
                    yield Buffer.from(annotatedCsv(rows(20_000)).replace(/\r\n\r\n$/, "\r\n"));
                    throw new Error("connection reset");
                },
            });
            for (const gzip of [false, true]) {
                const res = await text(request(app(h)).post("/v1/objects/history")
                    .set("Accept-Encoding", gzip ? "gzip" : "identity")
                    .send({ elementIds: ["speed", "temp", "speed"], startTime: START, endTime: END }));
                expect(res.status).toBe(200);
                const body = res.body as string;
                expect(body.startsWith('{"results":[')).toBe(true);
                expect(body.length).toBeGreaterThan(64 * 1024);
                /* Cut off in the middle of an element's values. */
                expect(body).not.toMatch(/\]\}\}?\]?,?("success":\w+)?\}?$/);
                expect(body).toMatch(/\{"value":[\d.]+,"quality":"Good","timestamp":"[^"]+"\}$/);
                expect(() => JSON.parse(body)).toThrow(SyntaxError);
            }
            expect(err).toHaveBeenCalledWith(expect.stringContaining("failed while streaming"),
                "POST", "/v1/objects/history", expect.any(Error));
            expect(SEMAPHORE(h).running).toBe(0);
        } finally {
            err.mockRestore();
        }
    });
});

describe("GET /v1/objects/:elementId/history, streamed", () => {
    it("sends the same body as before", async () => {
        const data = rows(30_000);
        const res = await request(app(makeHistory(csvTransport(() => data, { chunkSize: 8192 }))))
            .get("/v1/objects/temp/history").query({ startTime: START, endTime: END });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, result: { elementId: "temp", values: vqts(data) } });
    });

    it("answers 404 for a hidden element and an error response for an early failure", async () => {
        const h = makeHistory(csvTransport(() => {
            throw new HttpError(400, "Bad Request", "{\"message\":\"bad query\"}");
        }));
        const hidden = await request(app(h)).get("/v1/objects/secret/history")
            .query({ startTime: START, endTime: END });
        expect(hidden.status).toBe(404);
        expect(hidden.body.success).toBe(false);

        const failed = await request(app(h)).get("/v1/objects/temp/history")
            .query({ startTime: START, endTime: END });
        expect(failed.status).toBe(500);
        expect(failed.body).toEqual({ success: false, error: { code: 500, message: expect.stringContaining("bad query") } });
        expect(SEMAPHORE(h).running).toBe(0);
    });
});

describe("History stream and a client that goes away", () => {
    it("aborts the InfluxDB query and frees its slot", async () => {
        let signal: AbortSignal | undefined;
        let sent = 0;
        const h = makeHistory({
            async *iterate(_p: string, _b: string, o: { signal: AbortSignal }) {
                signal = o.signal;
                yield Buffer.from(annotatedCsv(rows(1)).replace(/\r\n\r\n$/, "\r\n"));
                /* An endless history, a little at a time. */
                for (let i = 1; ; i += 500) {
                    if (o.signal.aborted) throw new Error("aborted");
                    await new Promise(r => setImmediate(r));
                    sent += 500;
                    yield Buffer.from(rows(500, i).map(r => `,,0,${r._time},${r._value}\r\n`).join(""));
                }
            },
        });
        const server = http.createServer(app(h)).listen(0);
        await new Promise(r => server.once("listening", r));
        try {
            const port = (server.address() as AddressInfo).port;
            const req = http.request({ port, method: "POST", path: "/v1/objects/history",
                headers: { "content-type": "application/json" } });
            req.on("error", () => {});
            req.end(JSON.stringify({ elementIds: ["temp"], startTime: START, endTime: END }));
            const res = await new Promise<http.IncomingMessage>(r => req.once("response", r));
            expect(res.statusCode).toBe(200);
            await new Promise(r => res.once("data", r));
            res.destroy();
            for (let i = 0; i < 100 && !signal?.aborted; i++) await new Promise(r => setTimeout(r, 10));
            expect(signal!.aborted).toBe(true);
            for (let i = 0; i < 100 && SEMAPHORE(h).running; i++) await new Promise(r => setTimeout(r, 10));
            expect(SEMAPHORE(h).running).toBe(0);
            const after = sent;
            await new Promise(r => setTimeout(r, 50));
            expect(sent).toBe(after);
        } finally {
            server.close();
        }
    });
});

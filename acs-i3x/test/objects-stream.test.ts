/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * GET /v1/objects streams the tree. The body must be byte for byte
 * what res.json sent for the whole array, and the server must stop
 * reading the tree while the client is not reading the response.
 */

import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";

import { APIv1 } from "../lib/api-v1.js";
import { routes } from "../lib/routes.js";
import { ObjectTree } from "../lib/object-tree.js";
import { ValueCache } from "../lib/value-cache.js";
// @ts-ignore - plain ESM benchmark fixture
import { pipelineSnapshot } from "../bench/dataset.mjs";

function tree(devices: number): ObjectTree {
    const t = new ObjectTree({ namespaceName: "NS", namespaceUri: "urn:ns" });
    t.refreshFromSnapshot(pipelineSnapshot(devices));
    t.setReady();
    return t;
}

/** The i3X routes alone, as routes.ts mounts them but without
 * compression, so byte counts are the body's. */
function bareApp(objectTree: ObjectTree) {
    const api = new APIv1({
        objectTree,
        valueCache: new ValueCache({ objectTree, staleThreshold: 60_000 }),
        history: {} as any,
        subscriptions: {} as any,
    });
    const app = express();
    app.use((req, _res, next) => { (req as any).auth = "p@R"; next(); });
    app.use("/v1", api.routes);
    return app;
}

/** What the old route sent: res.json of the whole array. */
const oldBody = (t: ObjectTree, opts?: any) =>
    JSON.stringify({ success: true, result: t.getObjects(opts) });

describe("GET /v1/objects", () => {
    const t = tree(300);

    it("sends exactly the old body, with and without filters", async () => {
        const app = bareApp(t);
        const types = t.getObjectTypes().map(o => o.elementId);
        const cases: Array<[string, any]> = [
            ["", undefined],
            ["?root=true", { root: true }],
            ["?includeMetadata=true", undefined],
            [`?typeElementId=${encodeURIComponent(types[0])}`, { typeElementId: types[0] }],
            ["?typeElementId=no-such-type", { typeElementId: "no-such-type" }],
        ];
        for (const [query, opts] of cases) {
            const res = await request(app).get(`/v1/objects${query}`);
            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
            expect(res.text).toBe(oldBody(t, opts));
        }
        // Big enough to take many chunks.
        expect(oldBody(t).length).toBeGreaterThan(1_000_000);
        expect(JSON.parse(oldBody(t, { typeElementId: "no-such-type" })))
            .toEqual({ success: true, result: [] });
    });

    it("sends the same body through routes(), with gzip", async () => {
        const app = express();
        app.use((req, _res, next) => { (req as any).auth = "p@R"; next(); });
        routes({
            objectTree: t,
            valueCache: new ValueCache({ objectTree: t, staleThreshold: 60_000 }),
            history: {} as any,
            subscriptions: {} as any,
        })(app);
        const res = await request(app).get("/v1/objects").set("Accept-Encoding", "gzip");
        expect(res.headers["content-encoding"]).toBe("gzip");
        expect(res.text).toBe(oldBody(t));
    });

    it("answers 503 before the tree is ready", async () => {
        const empty = new ObjectTree({ namespaceName: "NS", namespaceUri: "urn:ns" });
        const res = await request(bareApp(empty)).get("/v1/objects");
        expect(res.status).toBe(503);
    });

    it("stops reading the tree while the client is not reading", async () => {
        const big = tree(1500);
        const total = big.objectCount();
        let read = 0;
        const iterate = big.iterateObjects.bind(big);
        big.iterateObjects = function* (opts?: any) {
            for (const o of iterate(opts)) { read++; yield o; }
        } as any;

        const server = http.createServer(bareApp(big)).listen(0);
        try {
            const port = (server.address() as AddressInfo).port;
            const res = await new Promise<http.IncomingMessage>(r =>
                http.get({ port, path: "/v1/objects" }, r));
            res.pause();
            await new Promise(r => setTimeout(r, 300));
            // The socket buffers have filled and the server is waiting.
            expect(read).toBeLessThan(total);

            const chunks: Buffer[] = [];
            res.on("data", c => chunks.push(c));
            res.resume();
            await new Promise(r => res.on("end", r));
            expect(read).toBe(total);
            expect(Buffer.concat(chunks).toString()).toBe(oldBody(big));
        } finally {
            server.close();
        }
    }, 60_000);

    it("stops when the client goes away", async () => {
        const big = tree(1500);
        let read = 0;
        let finished = false;
        const iterate = big.iterateObjects.bind(big);
        big.iterateObjects = function* (opts?: any) {
            try {
                for (const o of iterate(opts)) { read++; yield o; }
            } finally {
                finished = true;
            }
        } as any;

        const server = http.createServer(bareApp(big)).listen(0);
        try {
            const port = (server.address() as AddressInfo).port;
            const req = http.get({ port, path: "/v1/objects" }, res => {
                res.once("data", () => req.destroy());
            });
            req.on("error", () => {});
            for (let i = 0; i < 100 && !finished; i++)
                await new Promise(r => setTimeout(r, 20));
            expect(finished).toBe(true);
            expect(read).toBeLessThan(big.objectCount());
        } finally {
            server.close();
        }
    }, 60_000);
});

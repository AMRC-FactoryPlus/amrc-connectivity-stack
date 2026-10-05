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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import request from "supertest";

import { APIv1 } from "../lib/api-v1.js";
import { routes } from "../lib/routes.js";
import { ObjectTree } from "../lib/object-tree.js";
import { ValueCache } from "../lib/value-cache.js";
import { I3xStore } from "../lib/store.js";
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

    it("adds one drain listener per response under gzip", async () => {
        /* compression() moves 'drain' listeners to its gzip stream and
         * does not remove them with res.off(); adding one per wait
         * leaked one each time the client was slow. */
        const big = tree(1500);
        const app = express();
        app.use((req, _res, next) => { (req as any).auth = "p@R"; next(); });
        routes({
            objectTree: big,
            valueCache: new ValueCache({ objectTree: big, staleThreshold: 60_000 }),
            history: {} as any,
            subscriptions: {} as any,
        })(app);

        const zlib = await import("node:zlib");
        const proto = Object.getPrototypeOf(zlib.createGzip());
        const on = proto.on;
        let drains = 0;
        proto.on = function (ev: string, fn: any) {
            if (ev === "drain") drains++;
            return on.call(this, ev, fn);
        };
        const server = http.createServer(app).listen(0);
        try {
            const port = (server.address() as AddressInfo).port;
            const res = await new Promise<http.IncomingMessage>(r =>
                http.get({ port, path: "/v1/objects",
                    headers: { "Accept-Encoding": "gzip" } }, r));
            expect(res.headers["content-encoding"]).toBe("gzip");
            const ended = new Promise(r => res.on("end", r));
            let waits = 0;
            // Read slowly, so the server waits many times
            res.on("data", () => {
                res.pause();
                waits++;
                setTimeout(() => res.resume(), 2);
            });
            await ended;
            expect(waits).toBeGreaterThan(20);
            expect(drains).toBeLessThanOrEqual(2);
        } finally {
            proto.on = on;
            server.close();
        }
    }, 60_000);

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

describe("GET /v1/objects ETag", () => {
    it("answers 304 to a matching If-None-Match without a body", async () => {
        const t = tree(50);
        const app = bareApp(t);
        const first = await request(app).get("/v1/objects");
        const etag = first.headers["etag"];
        expect(etag).toMatch(/^W\/"objects-/);

        const again = await request(app).get("/v1/objects")
            .set("If-None-Match", etag);
        expect(again.status).toBe(304);
        expect(again.text).toBe("");

        // Strong form, a list, and * all match
        const strong = etag.replace(/^W\//, "");
        for (const h of [strong, `"other", ${etag}`, "*"]) {
            const r = await request(app).get("/v1/objects").set("If-None-Match", h);
            expect(r.status).toBe(304);
        }
    });

    it("gives each filter its own ETag", async () => {
        const t = tree(20);
        const app = bareApp(t);
        const all = (await request(app).get("/v1/objects")).headers["etag"];
        const root = (await request(app).get("/v1/objects?root=true")).headers["etag"];
        expect(root).not.toBe(all);

        const r = await request(app).get("/v1/objects?root=true")
            .set("If-None-Match", all);
        expect(r.status).toBe(200);
        expect(r.text).toBe(oldBody(t, { root: true }));
    });

    it("changes after every kind of change to the objects", async () => {
        const t = tree(5);
        const app = bareApp(t);
        const dev = t.getObjects({ root: false })
            .find(o => o.typeElementId !== "isa95-level" && o.parentId !== null
                && t.getChildElementIds(o.elementId).length > 0
                && t.getObject(o.parentId!)?.typeElementId === "isa95-level")!;
        const snap = pipelineSnapshot(5);
        const [uuid, cfg] = [...snap.devices.entries()][0];

        const changes: Array<[string, () => void]> = [
            ["rename", () => t.updateDeviceName(dev.elementId, "Renamed")],
            ["UNS node", () => t.addCompositionFromUns(
                [uuid, "etag-sub-uuid"], ["s0", "s1", "s2"], ["Extra", "Leaf"])],
            ["replace", () => t.replaceDeviceSubtree(uuid, cfg.devInfo, cfg.info)],
            ["remove", () => t.removeDevice(uuid)],
            ["add", () => t.addDevice(uuid, cfg.devInfo, cfg.info)],
        ];
        for (const [name, change] of changes) {
            const before = (await request(app).get("/v1/objects")).headers["etag"];
            const objsBefore = JSON.stringify(t.getObjects());
            change();
            if (JSON.stringify(t.getObjects()) === objsBefore) continue;
            const r = await request(app).get("/v1/objects").set("If-None-Match", before);
            expect([name, r.status]).toEqual([name, 200]);
            expect(r.text).toBe(oldBody(t));
        }
    });

    it("does not change when only values change", async () => {
        const t = tree(5);
        const rev = t.revision();
        const vc = new ValueCache({ objectTree: t, staleThreshold: 60_000 });
        const leaf = t.getObjects().find(o => !o.isComposition)!;
        (vc as any).set?.(leaf.elementId, { value: 1, quality: "Good", timestamp: new Date().toISOString() });
        expect(t.revision()).toBe(rev);
    });
});

describe("GET /v1/objects snapshot", () => {
    it("streams one consistent view while a device is rebuilt mid-stream", async () => {
        const dir = mkdtempSync(join(tmpdir(), "i3x-stream-"));
        const store = new I3xStore({ path: join(dir, "i3x.db") });
        const server = http.createServer();
        try {
            const t = new ObjectTree({ namespaceName: "NS", namespaceUri: "urn:ns", store });
            const snap = pipelineSnapshot(1500);
            t.refreshFromSnapshot(snap);
            t.setReady();
            const before = oldBody(t);

            server.on("request", bareApp(t)).listen(0);
            await new Promise(r => server.once("listening", r));
            const port = (server.address() as AddressInfo).port;
            const res = await new Promise<http.IncomingMessage>(r =>
                http.get({ port, path: "/v1/objects" }, r));
            res.pause();
            await new Promise(r => setTimeout(r, 300));

            /* The first device, whose rows went out first, is rebuilt
             * and renamed; its rows get new, higher seqs. */
            const [uuid, d] = [...snap.devices][0] as [string, any];
            t.replaceDeviceSubtree(uuid, d.devInfo, { name: "Renamed while streaming" });
            store.commit();

            const chunks: Buffer[] = [];
            res.on("data", c => chunks.push(c));
            res.resume();
            await new Promise(r => res.on("end", r));
            const text = Buffer.concat(chunks).toString();
            const ids = JSON.parse(text).result.map((o: any) => o.elementId);
            expect(new Set(ids).size).toBe(ids.length);
            // Exactly the tree as it was when the stream began.
            expect(text).toBe(before);
            expect(t.getObject(uuid)!.displayName).toBe("Renamed while streaming");
        } finally {
            server.close();
            store.close();
            rmSync(dir, { recursive: true, force: true });
        }
    }, 60_000);

    it("closes the reader when the client goes away", async () => {
        const dir = mkdtempSync(join(tmpdir(), "i3x-stream-"));
        const store = new I3xStore({ path: join(dir, "i3x.db") });
        const server = http.createServer();
        try {
            const t = new ObjectTree({ namespaceName: "NS", namespaceUri: "urn:ns", store });
            t.refreshFromSnapshot(pipelineSnapshot(1500));
            t.setReady();
            const readers: any[] = [];
            const open = store.openReader.bind(store);
            store.openReader = () => { const r = open(); readers.push(r); return r; };

            server.on("request", bareApp(t)).listen(0);
            await new Promise(r => server.once("listening", r));
            const port = (server.address() as AddressInfo).port;
            await new Promise<void>(resolve => {
                const req = http.get({ port, path: "/v1/objects" }, res => {
                    res.once("data", () => { req.destroy(); resolve(); });
                });
                req.on("error", () => {});
            });
            for (let i = 0; i < 100 && readers[0]?.isOpen; i++)
                await new Promise(r => setTimeout(r, 20));
            expect(readers).toHaveLength(1);
            expect(readers[0].isOpen).toBe(false);
        } finally {
            server.close();
            store.close();
            rmSync(dir, { recursive: true, force: true });
        }
    }, 60_000);
});


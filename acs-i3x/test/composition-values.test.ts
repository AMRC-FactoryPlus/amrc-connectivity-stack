/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * Cached values of compositions. A composition's cached value is every
 * UNS value in its whole subtree (the cache path never honoured
 * maxDepth). High in the ISA-95 hierarchy that is millions of
 * components, so they are read with one ordered query and streamed to
 * the client, never built in memory. These tests check the order and
 * the bytes against the recursive walk the cache used to do, and that
 * a slow client holds the read back.
 */

import { jest } from "@jest/globals";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";

import { APIv1 } from "../lib/api-v1.js";
import { ObjectTree } from "../lib/object-tree.js";
import { ValueCache } from "../lib/value-cache.js";
import { I3xStore } from "../lib/store.js";
// @ts-ignore - plain ESM benchmark fixture
import { pipelineSnapshot } from "../bench/dataset.mjs";

function stack(devices: number, store = new I3xStore()) {
    const tree = new ObjectTree({ namespaceName: "NS", namespaceUri: "urn:ns", store });
    tree.refreshFromSnapshot(pipelineSnapshot(devices));
    tree.setReady();
    const valueCache = new ValueCache({ objectTree: tree, store, staleThreshold: 60_000 });
    return { store, tree, valueCache };
}

/* A UNS value for every leaf, filed under its parent, in a scrambled
 * first-seen order; some also have a newer InfluxDB row, which
 * compositions must ignore. */
function fill(s: ReturnType<typeof stack>, pad = 0) {
    s.store.prepare(`
        insert into last_value (element_id, anchor, device_uuid, value_json, timestamp, quality, source)
        select o.element_id, o.parent_id, m.top_level,
            json_quote(printf('%d%s', o.seq, substr(hex(zeroblob(?)), 1, ?))),
            printf('2026-10-05T12:%02d:%02dZ', o.seq % 60, (o.seq * 7) % 60), 'Good',
            case when o.seq % 11 = 0 then 'influx' else 'uns' end
        from object o join metric_meta m on m.element_id = o.element_id
        order by (o.seq * 7919) % 1009, o.seq
    `).run(pad, pad);
}

/* What the cache used to return: the recursive walk over the tree. */
function oldValue(s: ReturnType<typeof stack>, id: string) {
    const components = (s.valueCache as any).collectChildValues(id, 0) as Record<string, any> | null;
    if (!components) return null;
    const ts = Object.values(components).reduce(
        (best: string, c: any) => (c.timestamp > best ? c.timestamp : best), "");
    return { elementId: id, isComposition: true, value: null, quality: "Good", timestamp: ts, components };
}

function app(s: ReturnType<typeof stack>) {
    const api = new APIv1({
        objectTree: s.tree, valueCache: s.valueCache,
        history: {
            getValues: async () => new Map(),
            getCompositionValue: async () => null,
            getCurrentValue: async () => null,
        } as any,
        subscriptions: {} as any,
    });
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => { (req as any).auth = "p@R"; next(); });
    a.use("/v1", api.routes);
    return a;
}

describe("composition values from the cache", () => {
    it("are exactly the old recursive walk, for every composition", () => {
        const s = stack(40);
        fill(s);
        const compositions = s.tree.getObjects().filter(o => o.isComposition);
        expect(compositions.length).toBeGreaterThan(200);
        let checked = 0;
        for (const o of compositions) {
            const want = oldValue(s, o.elementId);
            const got = s.valueCache.getValue(o.elementId);
            expect(JSON.stringify(got)).toBe(JSON.stringify(want));
            if (want) checked++;
        }
        expect(checked).toBeGreaterThan(100);
        // Leaves are unchanged, InfluxDB rows included.
        const leaf = s.tree.getObjects().find(o => !o.isComposition)!;
        expect(s.valueCache.getValue(leaf.elementId)!.isComposition).toBe(false);
    });

    it("are sent byte for byte as before, by both value routes", async () => {
        const s = stack(40);
        fill(s);
        const a = app(s);
        const root = s.tree.getObjects({ root: true })[0].elementId;
        const device = s.tree.getChildElementIds(s.tree.getChildElementIds(root)[0])[0];
        const leaf = s.tree.getObjects().find(o => !o.isComposition)!.elementId;

        const one = await request(a).get(`/v1/objects/${root}/value`);
        expect(one.text).toBe(JSON.stringify({ success: true, result: oldValue(s, root) }));
        expect(one.headers["content-type"]).toBe("application/json; charset=utf-8");

        const ids = [root, leaf, "no-such-id", device, root];
        const many = await request(a).post("/v1/objects/value").send({ elementIds: ids });
        const results = ids.map(id => {
            const v = id === leaf ? s.valueCache.getValue(leaf) : id === "no-such-id" ? null : oldValue(s, id);
            return v
                ? { success: true, elementId: id, result: v }
                : { success: false, elementId: id, error: { code: 404, message: `No value for ${id}` } };
        });
        expect(many.text).toBe(JSON.stringify({ success: false, results }));
    });

    it("are read as they are sent: a slow client holds the read back", async () => {
        const dir = mkdtempSync(join(tmpdir(), "i3x-comp-"));
        const store = new I3xStore({ path: join(dir, "i3x.db") });
        const server = http.createServer();
        try {
            const s = stack(1500, store);
            fill(s, 200);
            const root = s.tree.getObjects({ root: true })[0].elementId;
            const want = JSON.stringify({ success: true, result: oldValue(s, root) });
            const total = Object.keys(oldValue(s, root)!.components).length;

            /* Count the component rows read from the snapshot. */
            let read = 0;
            const open = store.openReader.bind(store);
            store.openReader = () => {
                const r: any = open();
                const prep = r.prepare.bind(r);
                r.prepare = (sql: string) => {
                    const st = prep(sql);
                    const iterate = st.iterate.bind(st);
                    st.iterate = (...args: any[]) => (function* () {
                        for (const row of iterate(...args)) { read++; yield row; }
                    })();
                    return st;
                };
                return r;
            };
            const getValue = jest.spyOn(s.valueCache, "getValue");

            server.on("request", app(s)).listen(0);
            await new Promise(r => server.once("listening", r));
            const port = (server.address() as AddressInfo).port;
            const res = await new Promise<http.IncomingMessage>(r =>
                http.get({ port, path: `/v1/objects/${root}/value` }, r));
            res.pause();
            await new Promise(r => setTimeout(r, 300));
            expect(read).toBeGreaterThan(0);
            expect(read).toBeLessThan(total);

            const chunks: Buffer[] = [];
            res.on("data", c => chunks.push(c));
            res.resume();
            await new Promise(r => res.on("end", r));
            expect(read).toBe(total);
            expect(Buffer.concat(chunks).toString()).toBe(want);
            // The route never built the whole value.
            expect(getValue).not.toHaveBeenCalled();
        } finally {
            server.close();
            store.close();
            rmSync(dir, { recursive: true, force: true });
        }
    }, 60_000);
});

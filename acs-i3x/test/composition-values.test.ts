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
import { History } from "../lib/history.js";
import { RelType } from "../lib/constants.js";
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

            /* Count the component rows each snapshot reader reads. The
             * first reader is the pass that works out the head; the
             * second feeds the body. */
            const reads: number[] = [];
            const open = store.openReader.bind(store);
            store.openReader = () => {
                const r: any = open();
                const n = reads.push(0) - 1;
                const prep = r.prepare.bind(r);
                r.prepare = (sql: string) => {
                    const st = prep(sql);
                    if (!sql.includes("from last_value")) return st;
                    const all = st.all.bind(st);
                    st.all = (...args: any[]) => { const rows = all(...args); reads[n] += rows.length; return rows; };
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
            expect(reads).toHaveLength(2);
            expect(reads[0]).toBe(total);
            expect(reads[1]).toBeGreaterThan(0);
            expect(reads[1]).toBeLessThan(total);

            const chunks: Buffer[] = [];
            res.on("data", c => chunks.push(c));
            res.resume();
            await new Promise(r => res.on("end", r));
            expect(reads[1]).toBe(total);
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

describe("long reads and the event loop", () => {
    /* The longest gap between turns of the event loop while `work`
     * runs, from a timer that should fire every 2 ms. */
    async function longestStall(work: () => Promise<unknown>): Promise<number> {
        let last = performance.now(), worst = 0;
        const t = setInterval(() => {
            const now = performance.now();
            worst = Math.max(worst, now - last);
            last = now;
        }, 2);
        try {
            await work();
        } finally {
            clearInterval(t);
        }
        // Work that never let the timer fire is one long stall.
        return Math.max(worst, performance.now() - last);
    }

    it("a large composition value and a full GET /objects never stall it for long", async () => {
        const dir = mkdtempSync(join(tmpdir(), "i3x-stall-"));
        const store = new I3xStore({ path: join(dir, "i3x.db") });
        try {
            const s = stack(3000, store);
            fill(s, 40);
            // Commit the setup now, so the reads below do not pay for it.
            store.commit();
            const a = app(s);
            const root = s.tree.getObjects({ root: true })[0].elementId;
            const total = Object.keys(oldValue(s, root)!.components).length;
            expect(total).toBeGreaterThan(50_000);

            /* A raw client that only collects bytes: parsing a large
             * body in this process would stall the loop itself. */
            const server = http.createServer(a).listen(0);
            await new Promise(r => server.once("listening", r));
            const port = (server.address() as AddressInfo).port;
            const get = (path: string) => new Promise<Buffer[]>((resolve, reject) => {
                http.get({ port, path }, res => {
                    const chunks: Buffer[] = [];
                    res.on("data", c => chunks.push(c));
                    res.on("end", () => resolve(chunks));
                }).on("error", reject);
            });
            let chunks: Buffer[] = [];
            let valueStall = 0, objectsStall = 0, relatedStall = 0;
            try {
                valueStall = await longestStall(async () => { chunks = await get(`/v1/objects/${root}/value`); });
                objectsStall = await longestStall(() => get("/v1/objects"));
                relatedStall = await longestStall(() => get(`/v1/objects/${root}/related`));
            } finally {
                server.close();
            }
            expect(Buffer.concat(chunks).toString()).toBe(JSON.stringify({ success: true, result: oldValue(s, root) }));
            console.log(`longest stall at 3,000 devices: composition value ${valueStall.toFixed(0)} ms, `
                + `GET /objects ${objectsStall.toFixed(0)} ms, related ${relatedStall.toFixed(0)} ms`);
            // Each step is a few small queries and pauses every 20 ms;
            // allow for a slow, busy test machine.
            expect(valueStall).toBeLessThan(150);
            expect(objectsStall).toBeLessThan(150);
            expect(relatedStall).toBeLessThan(150);
        } finally {
            store.close();
            rmSync(dir, { recursive: true, force: true });
        }
    }, 120_000);
});

describe("paged tree reads", () => {
    it("iterateDescendantLeafIds and iterateRelated give exactly the old lists", () => {
        const s = stack(60);
        const leaf = s.tree.getObjects().find(o => !o.isComposition && o.parentId !== "/")!;
        for (const o of s.tree.getObjects().filter(o => o.isComposition)) {
            for (const depth of [0, 1, 2, 3])
                expect([...s.tree.iterateDescendantLeafIds(o.elementId, depth)].filter(x => x !== null))
                    .toEqual(s.tree.getDescendantLeafIds(o.elementId, depth));
            for (const rt of [undefined, RelType.HasParent, RelType.HasChildren])
                expect([...s.tree.iterateRelated(o.elementId, rt, 7)]).toEqual(s.tree.getRelated(o.elementId, rt));
        }
        expect([...s.tree.iterateRelated(leaf.elementId)]).toEqual(s.tree.getRelated(leaf.elementId));
        expect([...s.tree.iterateRelated("no-such-id")]).toEqual([]);
    });

    it("expanding a whole fleet to leaves for InfluxDB does not stall the event loop", async () => {
        const s = stack(3000);
        s.store.commit();
        const history = new History({ influxUrl: "http://influx.invalid", influxToken: "", influxOrg: "o",
            influxBucket: "b", objectTree: s.tree, valueCache: s.valueCache });
        let leaves = 0;
        (history as any).queryApi = { collectRows: async () => [] };
        const getMetricMeta = s.tree.getMetricMeta.bind(s.tree);
        jest.spyOn(s.tree, "getMetricMeta").mockImplementation((id: string) => { leaves++; return getMetricMeta(id); });
        const root = s.tree.getObjects({ root: true })[0].elementId;

        let last = performance.now(), worst = 0;
        const t = setInterval(() => { const now = performance.now(); worst = Math.max(worst, now - last); last = now; }, 2);
        let got: any;
        try {
            got = await history.getValues([root], 0);
        } finally {
            clearInterval(t);
        }
        worst = Math.max(worst, performance.now() - last);
        console.log(`expanding ${leaves} leaves: longest stall ${worst.toFixed(0)} ms`);
        expect(leaves).toBeGreaterThan(50_000);
        expect(got.get(root)).toBeNull();
        expect(worst).toBeLessThan(150);
    }, 120_000);
});


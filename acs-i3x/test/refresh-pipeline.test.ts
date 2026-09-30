/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * Tests for the reactive refresh pipeline itself (lib/refresh.ts),
 * driven by an in-memory ConfigDB that delivers notify updates
 * asynchronously, as notify-v2 does. Covers burst coalescing: the final
 * state after a burst, how quickly single changes land, that the last
 * change of a burst is kept, and the full-rebuild fallback.
 */

import { jest } from "@jest/globals";

import * as C from "../lib/constants.js";
import { ObjectTree } from "../lib/object-tree.js";
import { ObjectTreeRefresh } from "../lib/refresh.js";
import { I3xRag } from "../lib/rag/i3x-rag.js";
// @ts-ignore: plain JS helpers shared with the benchmark
import { FakeConfigDB, mk_fplus } from "../bench/fake-configdb.mjs";
// @ts-ignore: plain JS helpers shared with the benchmark
import { device_gen } from "../bench/device-gen.mjs";

const gen = device_gen(C);
const { device_uuid, device_information, info } = gen;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const tick = () => new Promise(r => setImmediate(r));

const valueCache = { getValue: () => null };
const history = {
    queryHistory: async () => [],
    getCurrentValue: async () => null,
    getCompositionValue: async () => null,
};

interface Stack {
    cdb: any;
    tree: ObjectTree;
    rag: I3xRag;
    rebuilds: number[];
}

/** Tree + RAG over `cdb`, built through the HTTP bootstrap path. */
async function mkStack (cdb: any): Promise<Stack> {
    const tree = await new ObjectTree({
        fplus: mk_fplus(cdb), namespaceName: "NS", namespaceUri: "urn:ns",
    }).init();
    const rag = new I3xRag(tree, valueCache as any, history as any);
    rag.init();
    const rebuilds: number[] = [];
    const orig = rag.rebuild.bind(rag);
    rag.rebuild = () => { orig(); rebuilds.push(Date.now()); };
    return { cdb, tree, rag, rebuilds };
}

/** Stack plus a running pipeline; resolves after the first snapshot. */
async function startPipeline (cdb: any, interval: number): Promise<Stack & { started: number }> {
    const stack = await mkStack(cdb);
    const started = Date.now();
    new ObjectTreeRefresh({
        fplus: mk_fplus(cdb), objectTree: stack.tree, i3xRag: stack.rag, interval,
    }).run();
    await waitFor(() => stack.rebuilds.length > 0);
    return { ...stack, started };
}

async function waitFor (cond: () => boolean, timeout = 10000): Promise<number> {
    const start = Date.now();
    while (!cond()) {
        if (Date.now() - start > timeout) throw new Error("waitFor timed out");
        await sleep(2);
    }
    return Date.now() - start;
}

/** Wait until no RAG rebuild has happened for `quiet` ms. */
async function settle (s: Stack, quiet: number): Promise<void> {
    let n = -1;
    while (n !== s.rebuilds.length) {
        n = s.rebuilds.length;
        await sleep(quiet);
    }
}

/** Everything a client can see: objects, types, search hits + scores. */
function fingerprint (s: Stack) {
    const objects = s.tree.getObjects()
        .map(o => `${o.elementId}|${o.displayName}|${o.parentId}|${o.typeElementId}|${o.isComposition}`)
        .sort();
    const types = s.tree.getObjectTypes()
        .map(t => `${t.elementId}|${t.displayName}`).sort();
    const search = ["Device", "Latitude", "WC1", "Cyber", "Site_1", "renamed"]
        .map(q => s.rag.search(q, Infinity)
            .map(r => `${r.elementId}:${r.score.toFixed(9)}`).sort());
    return { objects, types, search, nodes: s.rag.nodeCount(), edges: s.rag.edgeCount() };
}

/** The same ConfigDB contents, built from scratch with no pipeline. */
async function fromScratch (cdb: any) {
    const copy = new FakeConfigDB();
    for (const [k, v] of cdb.configs) copy.configs.set(k, v);
    for (const m of cdb.members) copy.members.add(m);
    return fingerprint(await mkStack(copy));
}

function importDevice (cdb: any, i: number) {
    for (const op of gen.import_ops(cdb, i)) op();
}

describe("ObjectTreeRefresh pipeline", () => {
    // refresh.ts shares each watch through rxx.cacheSeq, which drops an
    // unused watch after a 5 s timer. Deleted devices leave those
    // timers running; wait them out so the Jest worker exits cleanly.
    afterAll(() => sleep(5500), 10000);

    it("after a burst, the tree and RAG index match a from-scratch build", async () => {
        const cdb = new FakeConfigDB();
        gen.seed_schemas(cdb);
        for (let i = 0; i < 20; i++) importDevice(cdb, i);
        const s = await startPipeline(cdb, 50);

        // A mixed burst, one write per macrotask: new devices, renames,
        // content changes, and a delete.
        const writes: Array<() => void> = [];
        for (let i = 20; i < 80; i++) writes.push(...gen.import_ops(cdb, i));
        for (let i = 0; i < 80; i += 7)
            writes.push(() => cdb.put_config(C.INFO_APP_UUID, device_uuid(i), info(i, 1)));
        for (let i = 3; i < 80; i += 11)
            writes.push(() => cdb.put_config(C.DEVICE_INFORMATION_APP_UUID,
                device_uuid(i), device_information(i, 2)));
        writes.push(() => cdb.delete_object(device_uuid(5)));
        const before = s.rebuilds.length;
        for (const w of writes) { w(); await tick(); }

        await settle(s, 200);
        expect(fingerprint(s)).toEqual(await fromScratch(cdb));
        expect(s.tree.getObject(device_uuid(5))).toBeUndefined();
        expect(s.tree.getObject(device_uuid(79))).toBeDefined();
        // Coalesced: far fewer rebuilds than writes.
        expect(writes.length).toBeGreaterThanOrEqual(200);
        expect(s.rebuilds.length - before).toBeLessThan(writes.length / 5);
    });

    it("applies the first snapshot without waiting for the interval", async () => {
        const cdb = new FakeConfigDB();
        gen.seed_schemas(cdb);
        importDevice(cdb, 0);
        const s = await startPipeline(cdb, 5000);
        expect(s.rebuilds[0] - s.started).toBeLessThan(500);
        expect(s.tree.getObject(device_uuid(0))).toBeDefined();
    });

    it("applies a lone change at once, and a change inside the interval within one interval", async () => {
        const interval = 500;
        const cdb = new FakeConfigDB();
        gen.seed_schemas(cdb);
        importDevice(cdb, 0);
        const s = await startPipeline(cdb, interval);
        await sleep(interval + 50);

        const uuid = device_uuid(0);
        const name = () => s.tree.getObject(uuid)?.displayName;

        // Quiet before: leading edge, no wait for the interval.
        cdb.put_config(C.INFO_APP_UUID, uuid, { name: "first" });
        const t1 = await waitFor(() => name() === "first");
        expect(t1).toBeLessThan(interval / 2);

        // Inside the interval that change opened: trailing edge.
        cdb.put_config(C.INFO_APP_UUID, uuid, { name: "second" });
        const t2 = await waitFor(() => name() === "second");
        expect(t2).toBeLessThanOrEqual(interval + 100);

        // The index follows the tree.
        expect(s.rag.search("second").map(r => r.elementId)).toContain(uuid);
    });

    it("keeps the change that arrives at the very end of a burst", async () => {
        const interval = 200;
        const cdb = new FakeConfigDB();
        gen.seed_schemas(cdb);
        importDevice(cdb, 0);
        const s = await startPipeline(cdb, interval);

        const uuid = device_uuid(0);
        const start = s.rebuilds.length;
        const t0 = Date.now();
        let n = 0;
        // Rename continuously for 3 intervals, then stop.
        while (Date.now() - t0 < 3 * interval) {
            cdb.put_config(C.INFO_APP_UUID, uuid, { name: `burst ${++n}` });
            await sleep(5);
        }
        const last = `burst ${n}`;
        await waitFor(() => s.tree.getObject(uuid)?.displayName === last, 2 * interval + 100);

        await settle(s, 2 * interval);
        expect(s.tree.getObject(uuid)?.displayName).toBe(last);
        expect(fingerprint(s)).toEqual(await fromScratch(cdb));
        // Throttled, not starved: some updates during the burst, but
        // many fewer than writes.
        const during = s.rebuilds.length - start;
        expect(during).toBeGreaterThanOrEqual(3);
        expect(during).toBeLessThan(n / 3);
    });

    it("adds and removes devices within two intervals", async () => {
        const interval = 200;
        const cdb = new FakeConfigDB();
        gen.seed_schemas(cdb);
        importDevice(cdb, 0);
        const s = await startPipeline(cdb, interval);

        // Keep the pipeline busy so both edges are exercised.
        cdb.put_config(C.INFO_APP_UUID, device_uuid(0), { name: "busy" });
        await tick();
        importDevice(cdb, 1);
        const tAdd = await waitFor(() => s.tree.getObject(device_uuid(1)) !== undefined);
        expect(tAdd).toBeLessThanOrEqual(2 * interval + 100);

        cdb.delete_object(device_uuid(0));
        const tDel = await waitFor(() => s.tree.getObject(device_uuid(0)) === undefined);
        expect(tDel).toBeLessThanOrEqual(2 * interval + 100);

        await settle(s, 2 * interval);
        expect(fingerprint(s)).toEqual(await fromScratch(cdb));
    });

    it("falls back to a full rebuild when applying a change fails, and keeps going", async () => {
        const cdb = new FakeConfigDB();
        gen.seed_schemas(cdb);
        importDevice(cdb, 0);
        const s = await startPipeline(cdb, 50);

        const errors = jest.spyOn(console, "error").mockImplementation(() => {});
        jest.spyOn(s.tree, "addDevice").mockImplementationOnce(() => {
            throw new Error("injected");
        });
        try {
            importDevice(cdb, 1);
            await waitFor(() => s.tree.getObject(device_uuid(1)) !== undefined);
            expect(errors).toHaveBeenCalledWith(
                "Pipeline apply failed, falling back to full rebuild:",
                expect.any(Error));

            // The pipeline is still live after the fallback.
            importDevice(cdb, 2);
            await waitFor(() => s.tree.getObject(device_uuid(2)) !== undefined);
            await settle(s, 200);
            expect(fingerprint(s)).toEqual(await fromScratch(cdb));
        }
        finally {
            errors.mockRestore();
        }
    });
});

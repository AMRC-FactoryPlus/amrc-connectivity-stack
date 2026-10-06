/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * Last values in SQLite: UNS batching, InfluxDB write-back, device
 * removal, and the process-wide Flux semaphore. These use the real
 * ObjectTree, ValueCache, History and APIv1 over one store; only the
 * InfluxDB query API is faked.
 */

import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";

import { ObjectTree } from "../lib/object-tree.js";
import { ValueCache } from "../lib/value-cache.js";
import { History } from "../lib/history.js";
import { APIv1 } from "../lib/api-v1.js";
import { I3xStore } from "../lib/store.js";
import { Semaphore } from "../lib/semaphore.js";

const HIERARCHY = "84ac3397-f3a2-440a-99e5-5bb9f6a75091";
const DEV = "dev-1";

function devInfo() {
    return {
        schema: "top",
        sparkplugName: "Dev",
        originMap: {
            Schema_UUID: "top",
            Instance_UUID: DEV,
            Device_Information: {
                Schema_UUID: "di",
                ISA95_Hierarchy: { Schema_UUID: HIERARCHY, Enterprise: { Value: "AMRC" } },
            },
            Status: { Schema_UUID: "m", Sparkplug_Type: "String" },
            Speed: { Schema_UUID: "m", Sparkplug_Type: "Double" },
            Axis: {
                Schema_UUID: "axis",
                Instance_UUID: "axis-1",
                Position: { Schema_UUID: "m", Sparkplug_Type: "FloatLE" },
            },
        },
    };
}

function setup(opts: { flushInterval?: number; flushMaxRows?: number; influxConcurrency?: number } = {}) {
    const store = new I3xStore();
    const tree = new ObjectTree({ namespaceName: "NS", namespaceUri: "urn:ns", store });
    tree.addDevice(DEV, devInfo(), { name: "Device 1" });
    tree.setReady();
    const valueCache = new ValueCache({
        objectTree: tree, store, staleThreshold: 60_000,
        flushInterval: opts.flushInterval ?? 50, flushMaxRows: opts.flushMaxRows ?? 1000,
    });
    const history = new History({
        influxUrl: "http://influx.invalid", influxToken: "", influxOrg: "o", influxBucket: "b",
        objectTree: tree, valueCache, influxConcurrency: opts.influxConcurrency,
    });

    /* InfluxDB: one row per series, as the bulk last() query returns. */
    const queries: string[] = [];
    const series = new Map<string, { _value: unknown; _time: string }>();
    const collectRows = jest.fn(async (q: string) => {
        queries.push(q);
        const rows: any[] = [];
        for (const [leaf, s] of series) {
            const m = tree.getMetricMeta(leaf);
            if (!m) continue;
            rows.push({ _measurement: `${m.metricName}:${m.typeSuffix}`,
                topLevelInstance: m.topLevelInstanceUuid, path: m.metricPath || undefined, ...s });
        }
        return rows;
    });
    (history as any).queryApi = { collectRows };

    const leaf = (name: string, under: string = DEV) =>
        tree.getChildElementIds(under).find(id => tree.getObject(id)!.displayName === name)!;
    return { store, tree, valueCache, history, queries, series, collectRows, leaf };
}

function uns(vc: ValueCache, path: string[], value: unknown, ts: string, instancePath = `${DEV}:`) {
    vc.onUnsMessage(["UNS", "v1", "AMRC", "Edge", "Dev", ...path].join("/"),
        Buffer.from(JSON.stringify({ timestamp: ts, value })),
        { properties: { userProperties: { InstanceUUIDPath: instancePath, SchemaUUIDPath: "top:" } } });
}

function api(s: ReturnType<typeof setup>) {
    const v1 = new APIv1({
        objectTree: s.tree, valueCache: s.valueCache, history: s.history,
        subscriptions: {} as any,
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as any).auth = "p@R"; next(); });
    app.use("/v1", v1.routes);
    return app;
}

const rowCount = (store: I3xStore) =>
    (store.prepare("select count(*) n from last_value").get() as any).n;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe("UNS values", () => {
    it("are written in batches, and reads always see them", async () => {
        const s = setup({ flushInterval: 40 });
        uns(s.valueCache, ["Status"], "ok", "2026-10-05T12:00:00Z");
        uns(s.valueCache, ["Speed"], 1.5, "2026-10-05T12:00:00Z");
        // Not written yet...
        expect(rowCount(s.store)).toBe(0);
        await sleep(80);
        // ...until the flush interval passes.
        expect(rowCount(s.store)).toBe(2);

        uns(s.valueCache, ["Speed"], 2.5, "2026-10-05T12:00:01Z");
        // A read flushes first.
        expect(s.valueCache.getValue(s.leaf("Speed"))).toEqual({
            elementId: s.leaf("Speed"), isComposition: false,
            value: 2.5, quality: "Good", timestamp: "2026-10-05T12:00:01Z",
        });
    });

    it("write at once when the batch is full", () => {
        const s = setup({ flushInterval: 60_000, flushMaxRows: 3 });
        for (let i = 0; i < 3; i++)
            uns(s.valueCache, ["New", `M${i}`], i, "2026-10-05T12:00:00Z");
        expect(rowCount(s.store)).toBe(3);
    });

    it("keep values of every JSON type, and undefined", () => {
        const s = setup();
        const values = [0, -1.25, "text", true, false, null, { a: [1, "b"] }, [1, 2], undefined];
        values.forEach((v, i) => uns(s.valueCache, ["Types", `V${i}`], v, "2026-10-05T12:00:00Z"));
        const types = s.leaf("Types");
        values.forEach((v, i) => {
            expect(s.valueCache.getValue(s.leaf(`V${i}`, types))!.value).toEqual(v);
        });
    });

    it("file a metric sent with a trailing ':' under its device, not under ''", () => {
        const s = setup();
        // uns-ingester sends `device:` for a metric directly under the device.
        uns(s.valueCache, ["Status"], "ok", "2026-10-05T12:00:00Z", `${DEV}:`);
        const status = s.leaf("Status");
        // The message reused the config node; no node with an empty id.
        expect(s.tree.getObject("")).toBeUndefined();
        const dev = s.valueCache.getValue(DEV)!;
        expect(dev.isComposition).toBe(true);
        expect(Object.keys(dev.components!)).toEqual([status]);
        expect(s.valueCache.getChildValues(DEV, 1)).toEqual({ [status]: expect.objectContaining({ value: "ok" }) });
    });

    it("assemble compositions in the order the leaves were first seen", () => {
        const s = setup();
        uns(s.valueCache, ["Speed"], 1, "2026-10-05T12:00:00Z");
        uns(s.valueCache, ["Status"], "a", "2026-10-05T12:00:01Z");
        uns(s.valueCache, ["Speed"], 2, "2026-10-05T12:00:02Z");
        const dev = s.valueCache.getValue(DEV)!;
        expect(Object.keys(dev.components!)).toEqual([s.leaf("Speed"), s.leaf("Status")]);
        expect(dev.timestamp).toBe("2026-10-05T12:00:02Z");
    });

    it("go when their device is removed", () => {
        const s = setup({ flushInterval: 60_000 });
        uns(s.valueCache, ["Status"], "ok", "2026-10-05T12:00:00Z");
        s.valueCache.flush();
        uns(s.valueCache, ["Speed"], 1, "2026-10-05T12:00:00Z");   // still pending
        s.tree.addDevice("dev-2", { schema: "top", originMap: { Schema_UUID: "top", Instance_UUID: "dev-2" } }, null);
        uns(s.valueCache, ["X"], 1, "2026-10-05T12:00:00Z", "dev-2:");
        s.valueCache.removeDevice(DEV);
        expect(s.valueCache.size()).toBe(1);
        expect(s.valueCache.getValue(s.leaf("Status"))).toBeNull();
    });

    it("are forgotten when MQTT reconnects, and on start", async () => {
        const s = setup();
        uns(s.valueCache, ["Status"], "ok", "2026-10-05T12:00:00Z");
        expect(s.valueCache.size()).toBe(1);

        const handlers = new Map<string, Function>();
        const mqtt = { subscribe: () => {}, on: (ev: string, fn: Function) => handlers.set(ev, fn) };
        await s.valueCache.init({ mqtt_client: async () => mqtt, debug: { bound: () => () => {} } });
        // init starts empty: the earlier run may have missed messages.
        expect(s.valueCache.size()).toBe(0);

        handlers.get("connect")!();
        uns(s.valueCache, ["Status"], "ok", "2026-10-05T12:00:00Z");
        expect(s.valueCache.size()).toBe(1);
        handlers.get("connect")!();
        expect(s.valueCache.size()).toBe(0);
    });
});

describe("UNS message errors", () => {
    it("are logged and dropped, not thrown out of the MQTT handler", async () => {
        const s = setup();
        const handlers = new Map<string, Function>();
        const mqtt = { subscribe: () => {}, on: (ev: string, fn: Function) => handlers.set(ev, fn) };
        await s.valueCache.init({ mqtt_client: async () => mqtt, debug: { bound: () => () => {} } });
        const err = jest.spyOn(console, "error").mockImplementation(() => {});
        const add = jest.spyOn(s.tree, "addCompositionFromUns")
            .mockImplementation(() => { throw new Error("database is full"); });
        try {
            const msg = ["UNS/v1/AMRC/Edge/Dev/Status", Buffer.from('{"timestamp":"t","value":1}'),
                { properties: { userProperties: { InstanceUUIDPath: DEV, SchemaUUIDPath: "top" } } }];
            expect(() => handlers.get("message")!(...msg)).not.toThrow();
            expect(err).toHaveBeenCalled();
            add.mockRestore();
            handlers.get("message")!(...msg);
            expect(s.valueCache.getValue(s.leaf("Status"))!.value).toBe(1);
        } finally {
            err.mockRestore();
        }
    });
});

describe("UNS messages for devices not in the tree", () => {
    it("add no objects and keep no values", () => {
        const s = setup();
        const before = s.tree.objectCount();
        const seen: string[] = [];
        s.valueCache.onValueChange(id => seen.push(id));
        uns(s.valueCache, ["Some", "Metric"], 1, "2026-10-05T12:00:00Z", "not-a-device:");
        expect(s.tree.objectCount()).toBe(before);
        expect(s.valueCache.size()).toBe(0);
        expect(seen).toEqual([]);
        expect(s.tree.getObjects().filter(o => o.parentId === "not-a-device")).toEqual([]);
    });
});

describe("database errors while writing values", () => {
    it("keep the batch for the next write, newer values winning, and still notify subscribers", () => {
        const s = setup({ flushInterval: 60_000, flushMaxRows: 2 });
        const err = jest.spyOn(console, "error").mockImplementation(() => {});
        const seen: unknown[] = [];
        s.valueCache.onValueChange((_id, vqt) => seen.push(vqt.value));
        /* Fail the next write of values, once. */
        let fail = true;
        const prepare = s.store.prepare.bind(s.store);
        const tx = jest.spyOn(s.store, "prepare").mockImplementation((sql: string) => {
            if (fail && sql.includes("insert into last_value")) {
                fail = false;
                throw new Error("database or disk is full");
            }
            return prepare(sql);
        });
        try {
            uns(s.valueCache, ["Speed"], 1, "2026-10-05T12:00:00Z");
            // The second message fills the batch; its write fails.
            expect(() => uns(s.valueCache, ["Status"], "a", "2026-10-05T12:00:01Z")).not.toThrow();
            expect(seen).toEqual([1, "a"]);
            expect(err).toHaveBeenCalled();
            expect(rowCount(s.store)).toBe(0);

            uns(s.valueCache, ["Speed"], 3, "2026-10-05T12:00:02Z");
            expect(seen).toEqual([1, "a", 3]);
            tx.mockRestore();
            expect(s.valueCache.getValue(s.leaf("Speed"))!.value).toBe(3);
            expect(s.valueCache.getValue(s.leaf("Status"))!.value).toBe("a");
        } finally {
            tx.mockRestore();
            err.mockRestore();
        }
    });

    it("back off from 5 s, doubling to 60 s, and log at most once a minute", () => {
        const s = setup({ flushInterval: 60_000, flushMaxRows: 2 });
        const err = jest.spyOn(console, "error").mockImplementation(() => {});
        let now = 1_000_000;
        const clock = jest.spyOn(Date, "now").mockImplementation(() => now);
        let fail = true, tries = 0;
        const prepare = s.store.prepare.bind(s.store);
        const spy = jest.spyOn(s.store, "prepare").mockImplementation((sql: string) => {
            if (sql.includes("insert into last_value") && sql.includes("'uns'")) {
                tries++;
                if (fail) throw new Error("disk I/O error");
            }
            return prepare(sql);
        });
        /* Each message fills the batch of two and asks for a write. */
        let n = 0;
        const send = () => uns(s.valueCache, [n % 2 ? "Speed" : "Status"], n++, "2026-10-05T12:00:00Z");
        try {
            send(); send();
            for (let i = 0; i < 50; i++) send();
            expect(tries).toBe(1);
            now += 4_999; send();
            expect(tries).toBe(1);
            now += 1; send();                       // 5 s: second try, next in 10 s
            expect(tries).toBe(2);
            now += 9_999; send();
            expect(tries).toBe(2);
            now += 1; send();                       // then 20 s, 40 s, 60 s, 60 s
            expect(tries).toBe(3);
            for (const wait of [20_000, 40_000, 60_000, 60_000]) {
                now += wait - 1; send();
                now += 1; send();
            }
            expect(tries).toBe(7);
            /* Seven failures over 195 s: four logs, not seven. */
            expect(err).toHaveBeenCalledTimes(4);

            fail = false;
            now += 60_000; send();
            expect(tries).toBe(8);
            expect(rowCount(s.store)).toBe(2);
            /* Success reset the backoff: every second message writes. */
            for (let i = 0; i < 4; i++) send();
            expect(tries).toBe(10);
        } finally {
            spy.mockRestore();
            clock.mockRestore();
            err.mockRestore();
        }
    });

    it("a failed group commit forgets the stored and queued values", () => {
        const store = new I3xStore({ commitInterval: 60_000 });
        const tree = new ObjectTree({ namespaceName: "NS", namespaceUri: "urn:ns", store });
        tree.addDevice(DEV, devInfo(), { name: "Device 1" });
        tree.setReady();
        const vc = new ValueCache({ objectTree: tree, store, staleThreshold: 60_000, flushInterval: 60_000 });
        const speed = tree.getChildElementIds(DEV).find(id => tree.getObject(id)!.displayName === "Speed")!;
        const err = jest.spyOn(console, "error").mockImplementation(() => {});
        try {
            uns(vc, ["Speed"], 1, "2026-10-05T12:00:00Z");
            vc.flush();
            store.commit();
            /* The next batch holds a newer value; its commit fails. */
            uns(vc, ["Speed"], 2, "2026-10-05T12:00:01Z");
            vc.flush();
            uns(vc, ["Status"], "queued", "2026-10-05T12:00:02Z");
            const db = (store as any).db;
            const exec = db.exec.bind(db);
            const spy = jest.spyOn(db, "exec").mockImplementation((sql: any) => {
                if (sql === "commit") throw new Error("disk I/O error");
                return exec(sql);
            });
            store.commit();
            spy.mockRestore();
            /* Not the older value 1: that is no longer the last one. */
            expect(rowCount(store)).toBe(0);
            expect(vc.getValue(speed)).toBeNull();
            expect((vc as any).pending.size).toBe(0);
        } finally {
            err.mockRestore();
            store.close();
        }
    });

    it("a failed group commit backs off background writes and logs at most once a minute", () => {
        const store = new I3xStore({ commitInterval: 60_000 });
        const tree = new ObjectTree({ namespaceName: "NS", namespaceUri: "urn:ns", store });
        tree.addDevice(DEV, devInfo(), { name: "Device 1" });
        tree.setReady();
        /* The device is committed; only value batches fail. */
        store.commit();
        const vc = new ValueCache({ objectTree: tree, store, staleThreshold: 60_000,
            flushInterval: 60_000, flushMaxRows: 2 });
        const err = jest.spyOn(console, "error").mockImplementation(() => {});
        let now = 1_000_000;
        const clock = jest.spyOn(Date, "now").mockImplementation(() => now);
        let tries = 0;
        const prepare = store.prepare.bind(store);
        const prep = jest.spyOn(store, "prepare").mockImplementation((sql: string) => {
            if (sql.includes("insert into last_value") && sql.includes("'uns'")) tries++;
            return prepare(sql);
        });
        const db = (store as any).db;
        const exec = db.exec.bind(db);
        const ex = jest.spyOn(db, "exec").mockImplementation((sql: any) => {
            if (sql === "commit") throw new Error("database or disk is full");
            return exec(sql);
        });
        let n = 0;
        const send = () => uns(vc, [n % 2 ? "Speed" : "Status"], n++, "2026-10-05T12:00:00Z");
        try {
            /* The write succeeds into the open batch; its commit fails. */
            send(); send();
            expect(tries).toBe(1);
            store.commit();
            /* Backing off: a full batch does not write again for 5 s. */
            for (let i = 0; i < 20; i++) send();
            expect(tries).toBe(1);
            now += 5_000; send();
            expect(tries).toBe(2);
            store.commit();
            now += 5_000; send(); send();
            store.commit();
            const commitLogs = err.mock.calls.filter(c => String(c[0]).includes("commit failed"));
            expect(commitLogs.length).toBe(1);
        } finally {
            ex.mockRestore();
            prep.mockRestore();
            clock.mockRestore();
            err.mockRestore();
            store.close();
        }
    });

    it("at start and on an MQTT reconnect are logged, not thrown", async () => {
        const s = setup();
        const err = jest.spyOn(console, "error").mockImplementation(() => {});
        const prepare = s.store.prepare.bind(s.store);
        const spy = jest.spyOn(s.store, "prepare").mockImplementation((sql: string) => {
            if (sql.startsWith("delete from last_value")) throw new Error("database or disk is full");
            return prepare(sql);
        });
        try {
            const handlers = new Map<string, Function>();
            const mqtt = { subscribe: () => {}, on: (ev: string, fn: Function) => handlers.set(ev, fn) };
            await expect(s.valueCache.init({ mqtt_client: async () => mqtt, debug: { bound: () => () => {} } }))
                .resolves.toBe(s.valueCache);
            handlers.get("connect")!();
            expect(() => handlers.get("connect")!()).not.toThrow();
            expect(err).toHaveBeenCalledTimes(2);
        } finally {
            spy.mockRestore();
            err.mockRestore();
        }
    });
});

describe("InfluxDB write-back", () => {
    it("a value read from InfluxDB is served locally next time", async () => {
        const s = setup();
        s.series.set(s.leaf("Speed"), { _value: 7.5, _time: "2026-10-05T11:00:00Z" });
        s.series.set(s.leaf("Status"), { _value: "ok", _time: "2026-10-05T11:00:00Z" });
        const app = api(s);
        const body = { elementIds: [s.leaf("Speed"), s.leaf("Status")] };

        const first = await request(app).post("/v1/objects/value").send(body);
        expect(s.queries).toHaveLength(1);
        const second = await request(app).post("/v1/objects/value").send(body);
        expect(s.queries).toHaveLength(1);
        expect(second.body).toEqual(first.body);
        expect(second.body.results[0].result).toEqual({
            elementId: s.leaf("Speed"), isComposition: false,
            value: 7.5, quality: "Good", timestamp: "2026-10-05T11:00:00Z",
        });

        // The single-value route reads the same store.
        const one = await request(app).get(`/v1/objects/${s.leaf("Status")}/value`);
        expect(one.body.result.value).toBe("ok");
        expect(s.queries).toHaveLength(1);
    });

    it("a composition read whole from InfluxDB is answered from the cache next time", async () => {
        const s = setup();
        s.series.set(s.leaf("Speed"), { _value: 1, _time: "2026-10-05T11:00:00Z" });
        s.series.set(s.leaf("Position", "axis-1"), { _value: 2, _time: "2026-10-05T11:00:00Z" });
        const app = api(s);

        const r = await request(app).post("/v1/objects/value").send({ elementIds: [DEV], maxDepth: 0 });
        expect(Object.keys(r.body.results[0].result.components).sort())
            .toEqual([s.leaf("Speed"), s.leaf("Position", "axis-1")].sort());
        expect(s.queries).toHaveLength(1);

        // Each leaf is now local...
        expect(s.valueCache.getValue(s.leaf("Position", "axis-1"))!.value).toBe(2);
        const leaf = await request(app).post("/v1/objects/value")
            .send({ elementIds: [s.leaf("Speed"), s.leaf("Position", "axis-1")] });
        expect(leaf.body.success).toBe(true);
        expect(s.queries).toHaveLength(1);

        // ...and so is the composition: every leaf it covered has a
        // value or a "no data" marker, so it is complete.
        const again = await request(app).post("/v1/objects/value").send({ elementIds: [DEV], maxDepth: 0 });
        expect(again.body).toEqual(r.body);
        expect(s.queries).toHaveLength(1);
    });

    it("a composition is not answered from leaves read on their own", async () => {
        const s = setup();
        s.series.set(s.leaf("Speed"), { _value: 1, _time: "2026-10-05T11:00:00Z" });
        s.series.set(s.leaf("Position", "axis-1"), { _value: 2, _time: "2026-10-05T11:00:00Z" });
        const app = api(s);

        // One leaf read alone: the composition is not complete.
        await request(app).post("/v1/objects/value").send({ elementIds: [s.leaf("Speed")] });
        expect(s.queries).toHaveLength(1);
        expect(s.valueCache.getValue(DEV)).toBeNull();
        const r = await request(app).post("/v1/objects/value").send({ elementIds: [DEV], maxDepth: 0 });
        expect(Object.keys(r.body.results[0].result.components).sort())
            .toEqual([s.leaf("Speed"), s.leaf("Position", "axis-1")].sort());
        expect(s.queries).toHaveLength(2);
    });

    it("a composition read only one level deep is not complete", async () => {
        const s = setup();
        s.series.set(s.leaf("Speed"), { _value: 1, _time: "2026-10-05T11:00:00Z" });
        s.series.set(s.leaf("Position", "axis-1"), { _value: 2, _time: "2026-10-05T11:00:00Z" });
        const app = api(s);
        await request(app).post("/v1/objects/value").send({ elementIds: [DEV], maxDepth: 1 });
        // The nested leaf under axis-1 was not covered.
        expect(s.valueCache.getValue(DEV)).toBeNull();
    });

    it("a UNS value replaces a no-data marker, and a marker is not a leaf value", async () => {
        const s = setup();
        s.series.set(s.leaf("Speed"), { _value: 1, _time: "2026-10-05T11:00:00Z" });
        const app = api(s);
        await request(app).post("/v1/objects/value").send({ elementIds: [DEV], maxDepth: 0 });
        // Status had no data in InfluxDB: a marker, not a value.
        expect(s.valueCache.getValue(s.leaf("Status"))).toBeNull();
        uns(s.valueCache, ["Status"], "ok", "2026-10-05T12:00:00Z");
        expect(s.valueCache.getValue(s.leaf("Status"))!.value).toBe("ok");
        const dev = s.valueCache.getValue(DEV)!;
        expect(dev.components![s.leaf("Status")].value).toBe("ok");
        expect(dev.components![s.leaf("Speed")].value).toBe(1);
    });

    it("a composition is not complete while a value waits in the queue after a failed write", async () => {
        const s = setup();
        s.series.set(s.leaf("Speed"), { _value: 1, _time: "2026-10-05T11:00:00Z" });
        const app = api(s);
        await request(app).post("/v1/objects/value").send({ elementIds: [DEV], maxDepth: 0 });
        expect(s.valueCache.getValue(DEV)).not.toBeNull();

        // A new leaf arrives from UNS, but storing its value fails.
        uns(s.valueCache, ["Extra"], 5, "2026-10-05T12:00:00Z");
        const extra = s.leaf("Extra");
        expect(extra).toBeDefined();
        const err = jest.spyOn(console, "error").mockImplementation(() => {});
        const tx = jest.spyOn(s.store, "transaction")
            .mockImplementation(() => { throw new Error("database or disk is full"); });
        try {
            // Judged complete, the walk would leave out the queued leaf.
            const lazy = await s.valueCache.getValueLazy(DEV);
            const ids = lazy ? [...lazy.components!()].filter(Boolean).map(c => c![0]) : [];
            expect(lazy === null || ids.includes(extra)).toBe(true);
        } finally {
            tx.mockRestore();
            err.mockRestore();
        }
        // Once stored, the composition is complete again, with the leaf.
        expect(s.valueCache.getValue(DEV)!.components![extra].value).toBe(5);
    });

    it("leaves no markers for a device removed while InfluxDB is read", async () => {
        const s = setup();
        const read = s.collectRows.getMockImplementation()!;
        s.collectRows.mockImplementation(async (q: string) => {
            const rows = await read(q);
            // Sync removes the device before the read finishes.
            s.tree.removeDevice(DEV);
            s.valueCache.removeDevice(DEV);
            return rows;
        });
        await request(api(s)).post("/v1/objects/value").send({ elementIds: [DEV], maxDepth: 0 });
        expect(rowCount(s.store)).toBe(0);
    });

    it("files the marker of a leaf without InfluxDB metadata under its own device", async () => {
        const s = setup();
        // A leaf found from UNS has no MetricMeta. Drop its value.
        uns(s.valueCache, ["Extra"], 5, "2026-10-05T12:00:00Z");
        const extra = s.leaf("Extra");
        expect(s.tree.getMetricMeta(extra)).toBeFalsy();
        s.valueCache.flush();
        s.valueCache.removeElements([extra]);

        await request(api(s)).post("/v1/objects/value").send({ elementIds: [DEV], maxDepth: 0 });
        const row = s.store.prepare("select device_uuid, source from last_value where element_id = ?").get(extra) as any;
        expect(row).toEqual({ device_uuid: DEV, source: "empty" });
        s.valueCache.removeDevice(DEV);
        expect(rowCount(s.store)).toBe(0);
    });

    it("a composition is not answered from leaves cached from InfluxDB", async () => {
        const s = setup();
        s.series.set(s.leaf("Speed"), { _value: 7, _time: "2026-10-05T11:00:00Z" });
        s.series.set(s.leaf("Status"), { _value: "ok", _time: "2026-10-05T11:00:00Z" });
        const app = api(s);

        // Reading one leaf keeps it.
        await request(app).post("/v1/objects/value").send({ elementIds: [s.leaf("Speed")] });
        // The device then still gets every leaf, from InfluxDB.
        const r = await request(app).get(`/v1/objects/${DEV}/value`);
        expect(Object.keys(r.body.result.components).sort())
            .toEqual([s.leaf("Speed"), s.leaf("Status")].sort());
        expect(s.queries).toHaveLength(2);
    });

    it("files UNS and InfluxDB values for a leaf under the same parent: its parent in the tree", () => {
        const s = setup();
        // The instance path stops at the device, but Position's parent
        // in the tree is the Axis composition.
        uns(s.valueCache, ["Axis", "Position"], 5, "2026-10-05T12:00:00Z", DEV);
        const pos = s.leaf("Position", "axis-1");
        const anchor = () => (s.valueCache.flush(), s.store.prepare("select anchor from last_value where element_id = ?").get(pos) as any).anchor;
        expect(anchor()).toBe("axis-1");
        expect(Object.keys(s.valueCache.getChildValues("axis-1", 1)!)).toEqual([pos]);
        expect(s.valueCache.getChildValues(DEV, 1)).toBeNull();

        s.valueCache.recordInfluxValues([{ elementId: pos, device: DEV,
            anchor: s.tree.getObject(pos)!.parentId, value: 6, quality: "Good", timestamp: "2026-10-05T13:00:00Z" }]);
        expect(anchor()).toBe("axis-1");
    });

    it("does not replace a newer UNS value", async () => {
        const s = setup();
        uns(s.valueCache, ["Speed"], 99, "2026-10-05T12:00:00.500Z");
        s.valueCache.recordInfluxValues([{ elementId: s.leaf("Speed"), device: DEV, anchor: DEV,
            value: 1, quality: "Good", timestamp: "2026-10-05T12:00:00.250Z" }]);
        expect(s.valueCache.getValue(s.leaf("Speed"))!.value).toBe(99);
        s.valueCache.recordInfluxValues([{ elementId: s.leaf("Speed"), device: DEV, anchor: DEV,
            value: 2, quality: "Good", timestamp: "2026-10-05T12:00:01Z" }]);
        expect(s.valueCache.getValue(s.leaf("Speed"))!.value).toBe(2);
    });

    it("getCurrentValue writes back too", async () => {
        const s = setup();
        s.series.set(s.leaf("Speed"), { _value: 3, _time: "2026-10-05T11:00:00Z" });
        (s.history as any).queryApi = {
            collectRows: async () => [{ _value: 3, _time: "2026-10-05T11:00:00Z" }],
        };
        expect((await s.history.getCurrentValue(s.leaf("Speed")))!.value).toBe(3);
        expect(s.valueCache.getValue(s.leaf("Speed"))!.value).toBe(3);
    });
});

/* A device whose DeviceInformation has no ISA-95 hierarchy, or the
 * given one. uns-ingester-sparkplug publishes it to UNS only with one. */
function plainDevInfo(uuid: string, enterprise?: string) {
    return {
        schema: "top",
        originMap: {
            Schema_UUID: "top",
            Instance_UUID: uuid,
            ...(enterprise ? { Device_Information: {
                Schema_UUID: "di",
                ISA95_Hierarchy: { Schema_UUID: HIERARCHY, Enterprise: { Value: enterprise } },
            } } : {}),
            Temp: { Schema_UUID: "m", Sparkplug_Type: "Double" },
            Mode: { Schema_UUID: "m", Sparkplug_Type: "String" },
        },
    };
}

/* DEV's DeviceInformation without its ISA-95 hierarchy. */
function devInfoWithoutIsa95() {
    const d = devInfo();
    delete (d.originMap as any).Device_Information;
    return d;
}

const lastValueRows = (store: I3xStore) =>
    store.prepare("select element_id, device_uuid, source from last_value order by element_id").all() as any[];

describe("InfluxDB write-back for devices that do not publish to UNS", () => {
    const T1 = "2026-10-05T11:00:00Z";
    const T2 = "2026-10-05T11:00:10Z";

    it("a leaf of a device without ISA-95 hierarchy is read from InfluxDB every time", async () => {
        const s = setup();
        s.tree.addDevice("dev-2", plainDevInfo("dev-2"), null);
        const temp = s.leaf("Temp", "dev-2");
        const app = api(s);

        s.series.set(temp, { _value: 1, _time: T1 });
        const first = await request(app).post("/v1/objects/value").send({ elementIds: [temp] });
        expect(first.body.results[0].result.value).toBe(1);

        // No UNS message will ever replace a kept value: none is kept.
        expect(rowCount(s.store)).toBe(0);
        s.series.set(temp, { _value: 2, _time: T2 });
        const second = await request(app).post("/v1/objects/value").send({ elementIds: [temp] });
        expect(second.body.results[0].result.value).toBe(2);
        s.series.set(temp, { _value: 3, _time: T2 });
        const one = await request(app).get(`/v1/objects/${temp}/value`);
        expect(one.body.result.value).toBe(3);
        expect(s.queries).toHaveLength(3);

        (s.history as any).queryApi = { collectRows: async () => [{ _value: 4, _time: T2 }] };
        expect((await s.history.getCurrentValue(temp))!.value).toBe(4);
        expect(rowCount(s.store)).toBe(0);
    });

    it("a composition of such a device gets no markers, and is read from InfluxDB every time", async () => {
        const s = setup();
        s.tree.addDevice("dev-2", plainDevInfo("dev-2"), null);
        const temp = s.leaf("Temp", "dev-2");
        const app = api(s);

        s.series.set(temp, { _value: 1, _time: T1 });
        await request(app).post("/v1/objects/value").send({ elementIds: ["dev-2"], maxDepth: 0 });
        expect(rowCount(s.store)).toBe(0);
        expect(s.valueCache.getValue("dev-2")).toBeNull();

        s.series.set(temp, { _value: 2, _time: T2 });
        const r = await request(app).post("/v1/objects/value").send({ elementIds: ["dev-2"], maxDepth: 0 });
        expect(r.body.results[0].result.components[temp].value).toBe(2);
        expect(s.queries).toHaveLength(2);
    });

    it("a composition over devices with and without ISA-95 hierarchy is never complete", async () => {
        const s = setup();
        // dev-3 sits directly under the NS enterprise; dev-2, without
        // hierarchy, under NS/Unknown. Both are under the NS level.
        s.tree.addDevice("dev-2", plainDevInfo("dev-2"), null);
        s.tree.addDevice("dev-3", plainDevInfo("dev-3", "NS"), null);
        const ns = s.tree.getObject("dev-3")!.parentId!;
        expect(s.tree.getObject(s.tree.getObject("dev-2")!.parentId!)!.parentId).toBe(ns);
        const temp2 = s.leaf("Temp", "dev-2");
        const temp3 = s.leaf("Temp", "dev-3");
        const app = api(s);

        s.series.set(temp2, { _value: 1, _time: T1 });
        s.series.set(temp3, { _value: 10, _time: T1 });
        await request(app).post("/v1/objects/value").send({ elementIds: [ns], maxDepth: 0 });
        // dev-3's value and marker are kept; nothing of dev-2's.
        expect(lastValueRows(s.store)).toEqual([
            { element_id: s.leaf("Mode", "dev-3"), device_uuid: "dev-3", source: "empty" },
            { element_id: temp3, device_uuid: "dev-3", source: "influx" },
        ].sort((a, b) => a.element_id < b.element_id ? -1 : 1));
        expect(s.valueCache.getValue(ns)).toBeNull();

        s.series.set(temp2, { _value: 2, _time: T2 });
        const r = await request(app).post("/v1/objects/value").send({ elementIds: [ns], maxDepth: 0 });
        expect(r.body.results[0].result.components[temp2].value).toBe(2);
        expect(r.body.results[0].result.components[temp3].value).toBe(10);
        expect(s.queries).toHaveLength(2);
    });

    it("keeps nothing for a device that loses its hierarchy while InfluxDB is read", async () => {
        const s = setup();
        s.series.set(s.leaf("Speed"), { _value: 1, _time: T1 });
        const read = s.collectRows.getMockImplementation()!;
        s.collectRows.mockImplementation(async (q: string) => {
            const rows = await read(q);
            // Sync applies the change before the read finishes.
            s.tree.replaceDeviceSubtree(DEV, devInfoWithoutIsa95(), { name: "Device 1" });
            return rows;
        });
        const r = await request(api(s)).post("/v1/objects/value").send({ elementIds: [DEV], maxDepth: 0 });
        expect(r.body.results[0].success).toBe(true);
        expect(rowCount(s.store)).toBe(0);
    });

    it("keeps values for a device once it gains a hierarchy, from ConfigDB or from UNS", async () => {
        const s = setup();
        s.tree.addDevice("dev-2", plainDevInfo("dev-2"), null);
        s.tree.addDevice("dev-3", plainDevInfo("dev-3"), null);
        const app = api(s);
        s.series.set(s.leaf("Temp", "dev-2"), { _value: 1, _time: T1 });
        s.series.set(s.leaf("Temp", "dev-3"), { _value: 1, _time: T1 });
        const read = () => request(app).post("/v1/objects/value")
            .send({ elementIds: [s.leaf("Temp", "dev-2"), s.leaf("Temp", "dev-3")] });
        await read();
        expect(rowCount(s.store)).toBe(0);

        // dev-2's DeviceInformation gains a hierarchy.
        s.tree.replaceDeviceSubtree("dev-2", plainDevInfo("dev-2", "AMRC"), null);
        // dev-3 is published to UNS: its birth certificate has one.
        s.valueCache.onUnsMessage("UNS/v1/AMRC/Site/Edge/D3/Mode",
            Buffer.from(JSON.stringify({ timestamp: T1, value: "auto" })),
            { properties: { userProperties: { InstanceUUIDPath: "dev-3:", SchemaUUIDPath: "top:" } } });
        expect(s.tree.publishesToUns("dev-2")).toBe(true);
        expect(s.tree.publishesToUns("dev-3")).toBe(true);

        await read();
        expect(s.valueCache.getValue(s.leaf("Temp", "dev-2"))!.value).toBe(1);
        expect(s.valueCache.getValue(s.leaf("Temp", "dev-3"))!.value).toBe(1);
        await read();
        expect(s.queries).toHaveLength(2);
    });

    it("removeInfluxValues drops values and markers kept from InfluxDB, not UNS values", async () => {
        const s = setup();
        s.series.set(s.leaf("Speed"), { _value: 1, _time: T1 });
        await request(api(s)).post("/v1/objects/value").send({ elementIds: [DEV], maxDepth: 0 });
        uns(s.valueCache, ["Status"], "ok", "2026-10-05T12:00:00Z");
        s.valueCache.flush();
        expect(lastValueRows(s.store).map(r => r.source).sort())
            .toEqual(["empty", "influx", "uns"]);

        s.valueCache.removeInfluxValues(DEV);
        expect(lastValueRows(s.store)).toEqual([
            { element_id: s.leaf("Status"), device_uuid: DEV, source: "uns" },
        ]);
    });
});

describe("Flux concurrency", () => {
    it("History never has more than influxConcurrency queries in flight, across callers", async () => {
        const s = setup({ influxConcurrency: 2 });
        let active = 0, max = 0;
        (s.history as any).queryApi = {
            collectRows: async () => {
                active++; max = Math.max(max, active);
                await sleep(10);
                active--;
                return [];
            },
        };
        const speed = s.leaf("Speed");
        await Promise.all([
            ...Array.from({ length: 6 }, () => s.history.getCurrentValue(speed)),
            ...Array.from({ length: 6 }, () => s.history.queryHistory(speed, "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z")),
            s.history.getValues([DEV], 0),
        ]);
        expect(max).toBe(2);
    });

    it("the semaphore runs callers in order and releases on error", async () => {
        const sem = new Semaphore(1);
        const order: number[] = [];
        const runs = [1, 2, 3].map(i => sem.run(async () => {
            order.push(i);
            await sleep(5);
            if (i === 2) throw new Error("boom");
            return i;
        }));
        const settled = await Promise.allSettled(runs);
        expect(order).toEqual([1, 2, 3]);
        expect(settled.map(r => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
        expect(sem.running).toBe(0);
        expect(sem.waiting).toBe(0);
        expect(() => new Semaphore(0)).toThrow(RangeError);
    });
});

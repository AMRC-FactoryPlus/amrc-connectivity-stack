/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * Catching up stored values from InfluxDB after a restart or an MQTT
 * reconnect, instead of clearing them. These use the real ObjectTree,
 * ValueCache, History and APIv1 over one store; only InfluxDB and MQTT
 * are faked. A restart is a new ValueCache and History over the same
 * store, as a new process over the same database file would be.
 */

import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";

import { ObjectTree } from "../lib/object-tree.js";
import { ValueCache } from "../lib/value-cache.js";
import { History } from "../lib/history.js";
import { APIv1 } from "../lib/api-v1.js";
import { I3xStore } from "../lib/store.js";

const HIERARCHY = "84ac3397-f3a2-440a-99e5-5bb9f6a75091";
const DEV = "dev-1";
const MARGIN = 20;

function devInfo(uuid: string = DEV) {
    return {
        schema: "top",
        sparkplugName: "Dev",
        originMap: {
            Schema_UUID: "top",
            Instance_UUID: uuid,
            Device_Information: {
                Schema_UUID: "di",
                ISA95_Hierarchy: { Schema_UUID: HIERARCHY, Enterprise: { Value: "AMRC" } },
            },
            Status: { Schema_UUID: "m", Sparkplug_Type: "String" },
            Speed: { Schema_UUID: "m", Sparkplug_Type: "Double" },
            Axis: {
                Schema_UUID: "axis",
                Instance_UUID: `axis-${uuid}`,
                Position: { Schema_UUID: "m", Sparkplug_Type: "FloatLE" },
            },
        },
    };
}

/** InfluxDB: one row per series, as last() returns, honouring a
 * range(start:) given as a time. Shared by every run, like the real
 * InfluxDB across an i3X restart. */
function fakeInflux(tree: ObjectTree) {
    const queries: string[] = [];
    const series = new Map<string, { _value: unknown; _time: string }>();
    let fail: ((q: string) => boolean) | null = null;
    const collectRows = jest.fn(async (q: string) => {
        queries.push(q);
        if (fail?.(q)) throw new Error("InfluxDB is down");
        const m = /range\(start: ([^)]+)\)/.exec(q)!;
        const since = m[1].startsWith("-") ? -Infinity : Date.parse(m[1]);
        const rows: any[] = [];
        for (const dev of tree.deviceUuidPage("", 1000)) {
            for (const leaf of tree.getDescendantLeafIds(dev, 0)) {
                const meta = tree.getMetricMeta(leaf);
                const s = series.get(leaf);
                if (!meta || !s || Date.parse(s._time) < since) continue;
                rows.push({ _measurement: `${meta.metricName}:${meta.typeSuffix}`,
                    topLevelInstance: meta.topLevelInstanceUuid, path: meta.metricPath || undefined, ...s });
            }
        }
        return rows;
    });
    return {
        queries, series, collectRows,
        /** Fail the queries `when` matches, until called again. */
        failing(when: ((q: string) => boolean) | null) { fail = when; },
    };
}

/** A fake MQTT client whose events the test fires. */
function fakeMqtt() {
    const handlers = new Map<string, Function>();
    const mqtt = { subscribe: jest.fn(), on: (ev: string, fn: Function) => handlers.set(ev, fn) };
    return {
        fplus: { mqtt_client: async () => mqtt, debug: { bound: () => () => {} } },
        connect: () => handlers.get("connect")!(),
        close: () => handlers.get("close")!(),
        message: (...a: any[]) => handlers.get("message")!(...a),
    };
}

const isCatchUp = (q: string) => !/range\(start: -/.test(q);

function world() {
    const store = new I3xStore();
    const tree = new ObjectTree({ namespaceName: "NS", namespaceUri: "urn:ns", store });
    tree.addDevice(DEV, devInfo(), { name: "Device 1" });
    tree.setReady();
    const influx = fakeInflux(tree);
    const leaf = (name: string, under: string = DEV) =>
        tree.getChildElementIds(under).find(id => tree.getObject(id)!.displayName === name)!;
    return { store, tree, influx, leaf };
}

type World = ReturnType<typeof world>;

/** One i3X process over the world's store. */
async function run(w: World, opts: Record<string, unknown> = {}) {
    const valueCache = new ValueCache({
        objectTree: w.tree, store: w.store, staleThreshold: 60_000, flushInterval: 10,
        catchUpMargin: MARGIN, catchUpRetryDelays: [5, 5], currentInterval: 10,
        ...opts,
    } as any);
    const history = new History({
        influxUrl: "http://influx.invalid", influxToken: "", influxOrg: "o", influxBucket: "b",
        objectTree: w.tree, valueCache,
    });
    (history as any).queryApi = { collectRows: w.influx.collectRows };
    const mqtt = fakeMqtt();
    await (valueCache as any).init(mqtt.fplus, history);
    const v1 = new APIv1({ objectTree: w.tree, valueCache, history, subscriptions: {} as any });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as any).auth = "p@R"; next(); });
    app.use("/v1", v1.routes);
    return { valueCache, history, mqtt, app };
}

function uns(vc: ValueCache, path: string[], value: unknown, ts: string, dev: string = DEV) {
    vc.onUnsMessage(["UNS", "v1", "AMRC", "Edge", "Dev", ...path].join("/"),
        Buffer.from(JSON.stringify({ timestamp: ts, value })),
        { properties: { userProperties: { InstanceUUIDPath: `${dev}:`, SchemaUUIDPath: "top:" } } });
}

const rows = (store: I3xStore) =>
    store.prepare("select element_id id, value_json v, source from last_value order by id").all() as any[];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const iso = (ms: number) => new Date(ms).toISOString();

/** Wait until the catch-up has run (or, on code without one, as long). */
async function caughtUp(vc: ValueCache) {
    for (let i = 0; i < 100; i++) {
        await sleep(10);
        if (!(vc as any).catchingUp?.() && i * 10 > MARGIN * 3) return;
    }
}

/**
 * A first run that stores Speed and Status from the UNS and Position
 * from InfluxDB, then stops. Every value is older than the shutdown.
 */
async function firstRun(w: World) {
    const old = iso(Date.now() - 3600_000);
    w.influx.series.set(w.leaf("Position", `axis-${DEV}`), { _value: 2, _time: old });
    const r = await run(w);
    r.mqtt.connect();
    uns(r.valueCache, ["Speed"], 1, old);
    uns(r.valueCache, ["Status"], "ok", old);
    const read = await request(r.app).post("/v1/objects/value")
        .send({ elementIds: [w.leaf("Position", `axis-${DEV}`)] });
    expect(read.body.results[0].result.value).toBe(2);
    r.valueCache.flush();
    await sleep(30);
    r.mqtt.close();
    return r;
}

let errors: ReturnType<typeof jest.spyOn>;
beforeEach(() => { errors = jest.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => errors.mockRestore());

describe("after a restart", () => {
    it("with no changes in the gap keeps every value and serves it once caught up", async () => {
        const w = world();
        await firstRun(w);
        const before = rows(w.store);
        expect(before).toHaveLength(3);

        const r = await run(w);
        r.mqtt.connect();
        await caughtUp(r.valueCache);
        expect(rows(w.store)).toEqual(before);
        expect(r.valueCache.size()).toBe(3);

        /* Served locally: no further InfluxDB query. */
        const n = w.influx.queries.length;
        const res = await request(r.app).post("/v1/objects/value")
            .send({ elementIds: [w.leaf("Speed"), w.leaf("Status"), w.leaf("Position", `axis-${DEV}`)] });
        expect(res.body.results.map((x: any) => x.result.value)).toEqual([1, "ok", 2]);
        expect(w.influx.queries.length).toBe(n);
        /* The catch-up asked only for points since the shutdown. */
        expect(w.influx.queries.filter(isCatchUp)).toHaveLength(1);
    });

    it("updates a value that changed during the gap", async () => {
        const w = world();
        await firstRun(w);
        w.influx.series.set(w.leaf("Speed"), { _value: 9, _time: iso(Date.now()) });

        const r = await run(w);
        r.mqtt.connect();
        await caughtUp(r.valueCache);
        expect(r.valueCache.getValue(w.leaf("Speed"))!.value).toBe(9);
        expect(r.valueCache.getValue(w.leaf("Status"))!.value).toBe("ok");
        expect(r.valueCache.size()).toBe(3);
    });

    it("replaces a no-data marker with a leaf's first data during the gap", async () => {
        const w = world();
        const first = await run(w);
        first.mqtt.connect();
        w.influx.series.set(w.leaf("Speed"), { _value: 1, _time: iso(Date.now() - 3600_000) });
        /* A composition read whole: Status and Position get markers. */
        const res = await request(first.app).post("/v1/objects/value").send({ elementIds: [DEV], maxDepth: 0 });
        expect(Object.keys(res.body.results[0].result.components)).toEqual([w.leaf("Speed")]);
        expect(rows(w.store).filter(x => x.source === "empty")).toHaveLength(2);
        await sleep(30);
        first.mqtt.close();

        w.influx.series.set(w.leaf("Status"), { _value: "new", _time: iso(Date.now()) });
        const r = await run(w);
        r.mqtt.connect();
        await caughtUp(r.valueCache);
        expect(r.valueCache.getValue(w.leaf("Status"))!.value).toBe("new");
        /* Still complete, and answered from the cache. */
        const n = w.influx.queries.length;
        const again = await request(r.app).post("/v1/objects/value").send({ elementIds: [DEV], maxDepth: 0 });
        expect(Object.keys(again.body.results[0].result.components).sort())
            .toEqual([w.leaf("Speed"), w.leaf("Status")].sort());
        expect(w.influx.queries.length).toBe(n);
    });

    it("reads InfluxDB until the catch-up is done, as after a clear", async () => {
        const w = world();
        await firstRun(w);
        /* InfluxDB has the newer value; the stored row is older. */
        w.influx.series.set(w.leaf("Speed"), { _value: 5, _time: iso(Date.now() - 60_000) });

        const r = await run(w, { catchUpMargin: 60_000 });
        r.mqtt.connect();
        expect((r.valueCache as any).catchingUp()).toBe(true);
        expect(r.valueCache.getValue(w.leaf("Speed"))).toBeNull();
        expect(r.valueCache.getValue(DEV)).toBeNull();
        expect(r.valueCache.size()).toBe(0);

        const n = w.influx.queries.length;
        const res = await request(r.app).get(`/v1/objects/${w.leaf("Speed")}/value`);
        expect(res.body.result.value).toBe(5);
        expect(w.influx.queries.length).toBe(n + 1);
        /* As after a clear, the value read is kept and served next. */
        const again = await request(r.app).get(`/v1/objects/${w.leaf("Speed")}/value`);
        expect(again.body.result.value).toBe(5);
        expect(w.influx.queries.length).toBe(n + 1);
        /* A stored value the read did not replace stays hidden. */
        expect(r.valueCache.getValue(w.leaf("Status"))).toBeNull();
    });

    it("keeps a UNS value that came during the catch-up over an older InfluxDB point", async () => {
        const w = world();
        await firstRun(w);
        const gapTime = Date.now();
        w.influx.series.set(w.leaf("Speed"), { _value: 5, _time: iso(gapTime) });

        const r = await run(w, { catchUpMargin: 60 });
        r.mqtt.connect();
        uns(r.valueCache, ["Speed"], 7, iso(gapTime + 1000));
        /* Served at once, before the catch-up. */
        expect(r.valueCache.getValue(w.leaf("Speed"))!.value).toBe(7);
        await caughtUp(r.valueCache);
        await sleep(100);
        expect(w.influx.queries.filter(isCatchUp).length).toBeGreaterThan(0);
        expect(r.valueCache.getValue(w.leaf("Speed"))!.value).toBe(7);
        expect(r.valueCache.getValue(w.leaf("Status"))!.value).toBe("ok");
    });

    it("clears when the gap is longer than the limit", async () => {
        const w = world();
        await firstRun(w);
        w.store.setMeta("values_current_until", String(Date.now() - 2 * 3600_000));
        const r = await run(w, { catchUpMaxGap: 3600_000 });
        expect(rows(w.store)).toEqual([]);
        r.mqtt.connect();
        await sleep(MARGIN * 3);
        expect(w.influx.queries.filter(isCatchUp)).toEqual([]);
    });

    it("clears when there is no record of when the values were current", async () => {
        const w = world();
        await firstRun(w);
        w.store.setMeta("values_current_until", null);
        await run(w);
        expect(rows(w.store)).toEqual([]);
    });

    it("clears when the catch-up query keeps failing, after retrying", async () => {
        const w = world();
        await firstRun(w);
        w.influx.failing(isCatchUp);
        const r = await run(w);
        r.mqtt.connect();
        await caughtUp(r.valueCache);
        await sleep(50);
        expect(w.influx.queries.filter(isCatchUp)).toHaveLength(3);
        expect(rows(w.store)).toEqual([]);
        expect((r.valueCache as any).catchingUp()).toBe(false);
        /* And values come and are served as usual afterwards. */
        uns(r.valueCache, ["Speed"], 3, iso(Date.now()));
        expect(r.valueCache.getValue(w.leaf("Speed"))!.value).toBe(3);
    });

    it("catches up when a failed query succeeds on a retry", async () => {
        const w = world();
        await firstRun(w);
        w.influx.series.set(w.leaf("Speed"), { _value: 9, _time: iso(Date.now()) });
        let failures = 1;
        w.influx.failing(q => isCatchUp(q) && failures-- > 0);
        const r = await run(w);
        r.mqtt.connect();
        await caughtUp(r.valueCache);
        await sleep(50);
        expect(r.valueCache.getValue(w.leaf("Speed"))!.value).toBe(9);
        expect(r.valueCache.size()).toBe(3);
    });

    it("clears when more values changed than the limit", async () => {
        const w = world();
        await firstRun(w);
        w.influx.series.set(w.leaf("Speed"), { _value: 9, _time: iso(Date.now()) });
        w.influx.series.set(w.leaf("Status"), { _value: "x", _time: iso(Date.now()) });
        const r = await run(w, { catchUpMaxRows: 1 });
        r.mqtt.connect();
        await caughtUp(r.valueCache);
        await sleep(30);
        expect(rows(w.store)).toEqual([]);
    });

    it("does not bring back the values of a device removed during the catch-up", async () => {
        const w = world();
        w.tree.addDevice("dev-2", devInfo("dev-2"), { name: "Device 2" });
        const first = await run(w);
        first.mqtt.connect();
        uns(first.valueCache, ["Speed"], 1, iso(Date.now() - 3600_000), "dev-2");
        first.valueCache.flush();
        await sleep(30);
        first.mqtt.close();
        w.influx.series.set(w.leaf("Speed", "dev-2"), { _value: 9, _time: iso(Date.now()) });

        const r = await run(w, { catchUpMargin: 60 });
        r.mqtt.connect();
        /* The leaf ids the catch-up will look up are read after the
         * margin; remove the device just as its query is answered. */
        const collect = w.influx.collectRows.getMockImplementation()!;
        w.influx.collectRows.mockImplementation(async (q: string) => {
            const out = await collect(q);
            if (isCatchUp(q)) r.valueCache.removeDevice("dev-2");
            return out;
        });
        await caughtUp(r.valueCache);
        await sleep(100);
        expect(w.influx.queries.filter(isCatchUp).length).toBeGreaterThan(0);
        expect(rows(w.store)).toEqual([]);
    });

    it("drops values InfluxDB cannot vouch for, and keeps their markers", async () => {
        const w = world();
        const first = await run(w);
        first.mqtt.connect();
        /* A metric not in the device's schema: no MetricMeta. */
        uns(first.valueCache, ["Extra"], 1, iso(Date.now() - 3600_000));
        const extra = w.leaf("Extra");
        expect(w.tree.getMetricMeta(extra)).toBeUndefined();
        first.valueCache.recordInfluxEmpty([{ elementId: "no-meta", device: DEV, anchor: DEV }]);
        first.valueCache.flush();
        await sleep(30);
        first.mqtt.close();

        const r = await run(w);
        r.mqtt.connect();
        await caughtUp(r.valueCache);
        expect(rows(w.store).map(x => [x.id, x.source])).toEqual([["no-meta", "empty"]]);
    });

    it("records when the values were current only while caught up and connected", async () => {
        const w = world();
        await firstRun(w);
        const until = w.store.getMeta("values_current_until");
        expect(Number(until)).toBeGreaterThan(Date.now() - 10_000);

        /* Stuck in the catch-up: the record must not move, or a crash
         * now would skip the gap on the next start. */
        w.influx.failing(isCatchUp);
        const r = await run(w, { catchUpRetryDelays: [10_000] });
        r.mqtt.connect();
        await sleep(MARGIN * 4);
        expect((r.valueCache as any).catchingUp()).toBe(true);
        expect(w.store.getMeta("values_current_until")).toBe(until);
        (r.valueCache as any).catchUpGen++;
    });
});

describe("after an MQTT reconnect", () => {
    it("catches up instead of clearing", async () => {
        const w = world();
        const r = await run(w);
        r.mqtt.connect();
        const old = iso(Date.now() - 3600_000);
        uns(r.valueCache, ["Speed"], 1, old);
        uns(r.valueCache, ["Status"], "ok", old);
        r.valueCache.flush();
        await sleep(30);
        r.mqtt.close();
        /* Sent while we were away, so only InfluxDB has it. */
        w.influx.series.set(w.leaf("Speed"), { _value: 9, _time: iso(Date.now()) });

        r.mqtt.connect();
        expect(r.valueCache.getValue(w.leaf("Speed"))).toBeNull();
        await caughtUp(r.valueCache);
        expect(r.valueCache.getValue(w.leaf("Speed"))!.value).toBe(9);
        expect(r.valueCache.getValue(w.leaf("Status"))!.value).toBe("ok");
        expect(w.influx.queries.filter(isCatchUp)).toHaveLength(1);
    });

    it("a reconnect during a catch-up starts it again, from the same time", async () => {
        const w = world();
        await firstRun(w);
        const until = w.store.getMeta("values_current_until");
        const r = await run(w, { catchUpMargin: 50 });
        r.mqtt.connect();
        r.mqtt.close();
        r.mqtt.connect();
        await caughtUp(r.valueCache);
        await sleep(100);
        const catchUps = w.influx.queries.filter(isCatchUp);
        expect(catchUps).toHaveLength(1);
        expect(catchUps[0]).toContain(iso(Number(until) - 50));
        expect(r.valueCache.size()).toBe(3);
    });
});

describe("a failed group commit", () => {
    it("still clears, and ends a catch-up", async () => {
        const w = world();
        await firstRun(w);
        const r = await run(w, { catchUpMargin: 60_000 });
        r.mqtt.connect();
        expect((r.valueCache as any).catchingUp()).toBe(true);
        (r.valueCache as any).safeClear("after a failed commit");
        expect(rows(w.store)).toEqual([]);
        expect((r.valueCache as any).catchingUp()).toBe(false);
    });
});

describe("values kept from InfluxDB, while connected", () => {
    /* A device that does not publish to the UNS: its values are only
     * ever read from InfluxDB, so only the refresh replaces them. */
    async function influxOnly(opts: Record<string, unknown> = {}) {
        const w = world();
        w.influx.series.set(w.leaf("Speed"), { _value: 1, _time: iso(Date.now() - 3600_000) });
        const r = await run(w, { refreshInterval: 40, ...opts });
        r.mqtt.connect();
        const res = await request(r.app).post("/v1/objects/value").send({ elementIds: [DEV], maxDepth: 0 });
        expect(Object.keys(res.body.results[0].result.components)).toEqual([w.leaf("Speed")]);
        return { w, r };
    }

    it("are refreshed with the points written since the last refresh", async () => {
        const { w, r } = await influxOnly();
        w.influx.series.set(w.leaf("Speed"), { _value: 2, _time: iso(Date.now()) });
        w.influx.series.set(w.leaf("Status"), { _value: "first", _time: iso(Date.now()) });
        await sleep(150);
        const reads = () => w.influx.queries.filter(q => !isCatchUp(q)).length;
        const n = reads();
        /* Answered from the cache, with the new value and the leaf
         * whose marker was replaced. */
        const res = await request(r.app).post("/v1/objects/value").send({ elementIds: [DEV], maxDepth: 0 });
        const c = res.body.results[0].result.components;
        expect(c[w.leaf("Speed")].value).toBe(2);
        expect(c[w.leaf("Status")].value).toBe("first");
        expect(reads()).toBe(n);
        /* Each refresh reads only the time since the one before. */
        const starts = w.influx.queries.filter(isCatchUp)
            .map(q => Date.parse(/range\(start: ([^)]+)\)/.exec(q)![1]));
        expect(starts.length).toBeGreaterThan(1);
        for (let i = 1; i < starts.length; i++) expect(starts[i]).toBeGreaterThan(starts[i - 1]);
        (r.valueCache as any).live = false;
    });

    it("cover the same time again after a failed refresh", async () => {
        const { w, r } = await influxOnly();
        w.influx.failing(isCatchUp);
        await sleep(150);
        const failed = w.influx.queries.filter(isCatchUp);
        expect(failed.length).toBeGreaterThan(1);
        expect(new Set(failed.map(q => /range\(start: ([^)]+)\)/.exec(q)![1])).size).toBe(1);
        w.influx.series.set(w.leaf("Speed"), { _value: 3, _time: iso(Date.now()) });
        w.influx.failing(null);
        await sleep(100);
        expect(r.valueCache.getValue(w.leaf("Speed"))!.value).toBe(3);
        (r.valueCache as any).live = false;
    });

    it("are dropped, to be read again, when the last refresh is older than the limit", async () => {
        const { w, r } = await influxOnly({ catchUpMaxGap: 3600_000 });
        (r.valueCache as any).live = false;
        (r.valueCache as any).refreshFrom = Date.now() - 2 * 3600_000;
        uns(r.valueCache, ["Status"], "uns", iso(Date.now()));
        r.valueCache.flush();
        (r.valueCache as any).refresh();
        expect(rows(w.store).map(x => [x.id, x.source])).toEqual([[w.leaf("Status"), "uns"]]);
    });

    it("are not refreshed while disconnected or catching up", async () => {
        const { w, r } = await influxOnly();
        r.mqtt.close();
        const n = w.influx.queries.length;
        await sleep(150);
        expect(w.influx.queries.length).toBe(n);
    });
});

/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

/* Differential test for the data dispatch in Translator.runDevices.
 * The same random sequence of driver data messages goes to the old
 * dispatch (every device gets every message, copied below from before
 * the change) and to the new one (only the owners of an address do).
 * Every device must see the same _handleData calls in the same order,
 * and the Sparkplug output must be identical. */

import { EventEmitter } from "events";

import { Device } from "../../lib/device";
import { Translator } from "../../lib/translator";

const ADDRS = ["a", "b", "c", "d", "e", "f", "g", "h", ""];
const UNKNOWN = ["x", "y", "constructor", "__proto__"];

/* Small deterministic PRNG so a failure is reproducible. */
function rng (seed: number) {
    return () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 2 ** 32;
    };
}

function metric (name: string, address: string, path: string) {
    return {
        name, type: "Int32", value: 0,
        properties: {
            method: { type: "String", value: "GET" },
            address: { type: "String", value: address },
            path: { type: "String", value: path },
        },
    };
}

/* Random device configs. Devices share addresses, some have none and
 * some use the "" address. */
function makeConfs (rand: () => number, n: number) {
    return Array.from({ length: n }, (_, i) => {
        const metrics: any[] = [];
        const count = Math.floor(rand() * 4);
        for (let m = 0; m < count; m++) {
            const addr = ADDRS[Math.floor(rand() * ADDRS.length)];
            const path = rand() < 0.4 ? "v" : "";
            metrics.push(metric(`m${m}`, addr, path));
        }
        return {
            deviceId: `dev${i}`, pollInt: 100, pubInterval: 0,
            templates: [], metrics, payloadFormat: "JSON",
        };
    });
}

function makeMessage (rand: () => number) {
    const obj: any = {};
    const keys = 1 + Math.floor(rand() * 4);
    for (let k = 0; k < keys; k++) {
        const pool = rand() < 0.15 ? UNKNOWN : ADDRS;
        const addr = pool[Math.floor(rand() * pool.length)];
        const v = Math.floor(rand() * 5);
        obj[addr] = rand() < 0.5 ? JSON.stringify({ v }) : JSON.stringify(v);
    }
    return obj;
}

/* Sparkplug node stub that records output, minus wall-clock times. */
function stubSparkplug (log: any[]) {
    const strip = (ms: any[]) => ms.map(m => {
        const { timestamp, timestampNs, ...rest } = m;
        return rest;
    });
    return {
        publishDBirth: (name: string, ms: any[]) => {
            log.push(["DBIRTH", name, strip(ms)]);
            return Promise.resolve();
        },
        publishDData: (name: string, ms: any[]) => {
            log.push(["DDATA", name, strip(ms)]);
        },
        publishDDeath: (name: string) => log.push(["DDEATH", name]),
    } as any;
}

class FakeConn extends EventEmitter {
    _type = "fake";
    open () {}
    startSubscription () {}
    stopSubscription () {}
}

/* The dispatch as it was on main. */
function legacyRun (confs: any[], devices: any, conn: FakeConn) {
    conn.on("data", (obj: any, parseVals = true) => {
        confs.forEach(c => devices[c.deviceId]?._handleData(obj, parseVals));
    });
}

function spyOn (devices: any, calls: any[]) {
    for (const [id, dev] of Object.entries<any>(devices)) {
        const orig = dev._handleData.bind(dev);
        dev._handleData = (obj: any, parse: boolean) => {
            calls.push([id, JSON.stringify(obj), parse]);
            return orig(obj, parse);
        };
    }
}

async function runCase (seed: number, nDevices: number, nMessages: number) {
    const rand = rng(seed);
    const confs = makeConfs(rand, nDevices);
    const messages = Array.from({ length: nMessages },
        () => ({ obj: makeMessage(rand), parse: rand() < 0.8 }));

    const oldLog: any[] = [], newLog: any[] = [];
    const oldCalls: any[] = [], newCalls: any[] = [];

    /* Old */
    const oldConn = new FakeConn();
    const oldSp = stubSparkplug(oldLog);
    const oldDevs: any = {};
    /* Devices mutate the metrics they are given, so each side needs its own copy. */
    const copy = () => JSON.parse(JSON.stringify(confs));
    for (const c of copy()) oldDevs[c.deviceId] = new Device(oldSp, oldConn as any, c as any);
    spyOn(oldDevs, oldCalls);
    legacyRun(confs, oldDevs, oldConn);
    Object.values<any>(oldDevs).forEach(d => d._deviceConnected());

    /* New */
    const newConn = new FakeConn();
    const tr = new Translator({} as any, 100, {} as any);
    tr.sparkplugNode = stubSparkplug(newLog);
    tr.runDevices({ name: "test", devices: copy() }, newConn as any);
    spyOn(tr.devices, newCalls);
    newConn.emit("open");

    await Promise.resolve();
    for (const { obj, parse } of messages) {
        oldConn.emit("data", obj, parse);
        newConn.emit("data", obj, parse);
    }

    /* The old dispatch calls every device; the new one only the
     * owners. The calls an owner receives must match, in order. */
    const perDev = (calls: any[]) => {
        const out: Record<string, any[]> = {};
        for (const [id, ...rest] of calls) (out[id] ??= []).push(rest);
        return out;
    };
    const oldPer = perDev(oldCalls), newPer = perDev(newCalls);
    for (const c of confs) {
        const owned = new Set(
            c.metrics.map((m: any) => m.properties.address.value));
        const expected = (oldPer[c.deviceId] ?? []).filter(
            ([json]: any[]) => Object.keys(JSON.parse(json))
                .some(k => owned.has(k)));
        expect(newPer[c.deviceId] ?? []).toEqual(expected);
    }

    /* Everything that reaches Sparkplug is identical, in order. */
    expect(newLog).toEqual(oldLog);
    return { oldCalls: oldCalls.length, newCalls: newCalls.length, out: newLog.length };
}

/* Each Device starts a ready timer that only stops once it connects.
 * These devices never connect, so unref the timers to let jest exit. */
const realSetInterval = global.setInterval;
beforeAll(() => {
    jest.spyOn(global, "setInterval").mockImplementation(
        ((fn: any, ms?: number, ...args: any[]) =>
            realSetInterval(fn, ms, ...args).unref()) as any);
});
afterAll(() => jest.restoreAllMocks());

describe("translator data dispatch", () => {
    it.each([1, 2, 3, 4, 5, 6, 7, 8])(
        "matches the old dispatch for random messages (seed %i)",
        async seed => {
            const r = await runCase(seed, 20, 300);
            expect(r.out).toBeGreaterThan(20);
            expect(r.newCalls).toBeLessThan(r.oldCalls);
        });

    it("matches the old dispatch for a small config", async () => {
        const r = await runCase(99, 3, 100);
        expect(r.out).toBeGreaterThan(0);
    });

    it("sends the whole message to each owner exactly once", () => {
        const confs = [
            { deviceId: "d0", metrics: [metric("m", "a", ""), metric("n", "b", "")] },
            { deviceId: "d1", metrics: [metric("m", "b", "")] },
            { deviceId: "d2", metrics: [metric("m", "c", "")] },
        ].map(c => ({ pollInt: 1, pubInterval: 0, templates: [], payloadFormat: "JSON", ...c }));
        const conn = new FakeConn();
        const tr = new Translator({} as any, 100, {} as any);
        tr.sparkplugNode = stubSparkplug([]);
        tr.runDevices({ name: "t", devices: confs }, conn as any);
        const calls: any[] = [];
        spyOn(tr.devices, calls);
        const obj = { b: "1", a: "2", zz: "3" };
        conn.emit("data", obj, true);
        expect(calls.map(c => c[0])).toEqual(["d0", "d1"]);
        expect(calls.map(c => c[1])).toEqual([JSON.stringify(obj), JSON.stringify(obj)]);
    });

    it("follows a replaced device and its new addresses", () => {
        const mk = (id: string, addr: string) => ({
            deviceId: id, pollInt: 1, pubInterval: 0, templates: [],
            payloadFormat: "JSON", metrics: [metric("m", addr, "")],
        });
        const conn = new FakeConn();
        const tr = new Translator({} as any, 100, {} as any);
        tr.sparkplugNode = stubSparkplug([]);
        const confs = [mk("d0", "a")];
        tr.runDevices({ name: "t", devices: confs }, conn as any);
        const calls: any[] = [];
        spyOn(tr.devices, calls);
        conn.emit("data", { a: "1" }, true);
        expect(calls.length).toBe(1);

        /* Same ID, new address (a second connection reusing the ID). */
        tr.runDevices({ name: "u", devices: [mk("d0", "b")] }, new FakeConn() as any);
        const calls2: any[] = [];
        spyOn(tr.devices, calls2);
        conn.emit("data", { a: "1" }, true);
        conn.emit("data", { b: "1" }, true);
        expect(calls2.length).toBe(1);
        expect(JSON.parse(calls2[0][1])).toEqual({ b: "1" });
    });
});

/*
 * ACS Edge Agent
 * Fixes from the split-drivers code review of the Edge Agent core
 * (ACS-51): writes a cmd-only driver can't read, null commands, every
 * driver connection closed on stop, addresses named like Object
 * properties, and the device ready timer
 * Copyright 2026 University of Sheffield
 */

import { reHashConf } from "../../utils/FormatConfig";
import { Device } from "../../lib/device";
import { DriverConnection } from "../../lib/devices/driver";
import { DriverBroker } from "../../lib/driverBroker";
import { Translator } from "../../lib/translator";
import {
    Metrics, sparkplugDataType as T, sparkplugMetric,
    writeValToBuffer, writeValToJSON,
} from "../../lib/helpers/typeHandler";

const ID = "drv";

/* Records what a DriverConnection publishes and delivers driver
 * messages to it. confirms_writes is left out, so writes go to the
 * driver as they do to one that only reads cmd/. */
class FakeBroker {
    sent: any[] = [];
    listeners: ((m: any) => void)[] = [];
    on (_ev: string, l: (m: any) => void) { this.listeners.push(l); }
    off (_ev: string, l: (m: any) => void) {
        this.listeners = this.listeners.filter(x => x !== l);
    }
    publish (p: any) { this.sent.push(p); }
    deliver (id: string, msg: string, data: string | undefined, payload: string) {
        for (const l of [...this.listeners])
            l({ id, msg, data, payload: Buffer.from(payload) });
    }
    of (msg: string) { return this.sent.filter(p => p.msg == msg); }
}

function metric (type: T, value: any, address = "a"): sparkplugMetric {
    return { name: `m-${type}`, type, value, properties: {
        method:  { type: T.string, value: "GET/SET" },
        address: { type: T.string, value: address },
        path:    { type: T.string, value: "" },
    } } as sparkplugMetric;
}

/* A device connection that only needs to be stopped. */
const idle_conn = () => ({ stopSubscription: (_d: string, cb: Function) => cb() }) as any;

afterEach(() => jest.restoreAllMocks());

async function open_driver (broker: FakeBroker, addresses: string[], id = ID) {
    const conn = new DriverConnection("Driver", {}, id, broker as any);
    conn.open();
    await conn.startSubscription({ addresses } as any, "JSON" as any, "",
        3_600_000, "dev", () => {});
    broker.deliver(id, "status", undefined, "READY");
    broker.deliver(id, "status", undefined, "UP");
    return conn;
}

/* Finding 2 */
describe("a write a cmd-only driver can't read", () => {
    it("is an error, and nothing is sent", async () => {
        const broker = new FakeBroker();
        const conn = await open_driver(broker, ["a"]);
        let err: Error | undefined;
        conn.writeMetrics(new Metrics([metric(T.dateTime, 1763380800123)]),
            (e: Error) => err = e, "JSON" as any);
        expect(err?.message).toMatch(/m-DateTime.*a.*cmd/);
        expect(broker.of("cmd")).toEqual([]);
        expect(broker.of("write")).toEqual([]);
        await conn.stopSubscription("dev", () => {});
        conn.close();
    });

    it("does not stop the other metrics in the same write", async () => {
        const broker = new FakeBroker();
        const conn = await open_driver(broker, ["a", "b"]);
        let err: Error | undefined;
        conn.writeMetrics(new Metrics([
            metric(T.dateTime, 5, "a"), metric(T.int16, 7, "b"),
        ]), (e: Error) => err = e, "JSON" as any);
        expect(err).toBeDefined();
        expect(broker.of("cmd").map(c => c.data)).toEqual(["b"]);
        await conn.stopSubscription("dev", () => {});
        conn.close();
    });
});

/* Finding 3 */
describe("a null command value", () => {
    const TYPES = [T.boolean, T.int8, T.int16, T.int32, T.int64, T.uInt8,
        T.uInt16, T.uInt32, T.uInt64, T.float, T.double, T.string, T.text,
        T.uuid, T.dateTime];

    it.each(TYPES)("is refused for %s, not written as 0, false or empty", (type) => {
        for (const v of [null, undefined]) {
            expect(() => writeValToJSON(metric(type, v))).toThrow(/no value/);
            if (type != T.dateTime)
                expect(() => writeValToBuffer(metric(type, v))).toThrow(/no value/);
        }
    });

    it("reaches the device as an error, and nothing is sent to the driver", async () => {
        const broker = new FakeBroker();
        const conn = await open_driver(broker, ["a"]);
        let err: Error | undefined;
        conn.writeMetrics(new Metrics([metric(T.int32, null)]),
            (e: Error) => err = e, "JSON" as any);
        expect(err?.message).toMatch(/no value/);
        expect(broker.of("cmd")).toEqual([]);
        expect(broker.of("write")).toEqual([]);
        await conn.stopSubscription("dev", () => {});
        conn.close();
    });
});

/* Finding 4 */
describe("several split-driver connections on one agent", () => {
    function driver_conn (name: string) {
        return {
            connType: "Driver", name, DriverDetails: {},
            devices: [{
                deviceId: `dev-${name}`, pollInt: 3_600_000, pubInterval: 0,
                templates: [], payloadFormat: "JSON",
                tags: [{ Name: "m", type: "Double", method: "GET",
                    address: `${name}/x`, value: null, recordToDB: true }],
            }],
        };
    }

    async function start (broker: FakeBroker, names: string[]) {
        const tr = new Translator({} as any, 100, broker as any);
        tr.sparkplugNode = {
            publishDBirth: () => Promise.resolve(),
            publishDData: () => {}, publishDDeath: () => {},
            stop: async () => {},
        } as any;
        (tr as any).broker.stop = async () => {};
        const conf = reHashConf({ deviceConnections: names.map(driver_conn) });
        for (const c of conf.deviceConnections)
            await tr.setupConnection(c);
        return tr;
    }

    it("closes every one on stop, so each driver is told OFFLINE", async () => {
        jest.spyOn(console, "log").mockImplementation(() => {});
        const broker = new FakeBroker();
        const tr = await start(broker, ["one", "two", "three"]);
        expect(broker.listeners).toHaveLength(3);

        await tr.stop();

        const offline = broker.of("active")
            .filter(p => p.payload.toString() == "OFFLINE")
            .map(p => p.id).sort();
        expect(offline).toEqual(["one", "three", "two"]);
        expect(broker.listeners).toHaveLength(0);
    });

    it("leaves no connection of the old config behind after a reload", async () => {
        jest.spyOn(console, "log").mockImplementation(() => {});
        const broker = new FakeBroker();
        const first = await start(broker, ["one", "two"]);
        await first.stop();
        const second = await start(broker, ["one", "two"]);

        /* Only the new config's two connections hear the driver. */
        expect(broker.listeners).toHaveLength(2);
        await second.stop();
        expect(broker.listeners).toHaveLength(0);
    });
});

/* Finding 5 */
describe("addresses and names that are Object property names", () => {
    const NAMES = ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"];

    it.each(NAMES)("%s works as an address, a path and a metric name", (n) => {
        const metrics = new Metrics([
            { name: n, type: T.double, value: null, properties: {
                method: { type: T.string, value: "GET" },
                address: { type: T.string, value: n },
                path: { type: T.string, value: n },
            } } as sparkplugMetric,
            { name: "plain", type: T.double, value: null, properties: {
                method: { type: T.string, value: "GET" },
                address: { type: T.string, value: "plain" },
                path: { type: T.string, value: "" },
            } } as sparkplugMetric,
        ]);
        expect(metrics.addresses.sort()).toEqual([n, "plain"].sort());
        expect(metrics.getPathsForAddr(n)).toEqual([n]);
        expect(metrics.getByAddrPath(n, n).name).toBe(n);
        expect(metrics.getByAddress(n).map(m => m.name)).toEqual([n]);
        expect(metrics.getByName(n).name).toBe(n);
        expect(metrics.getPathsForAddr("toLocaleString")).toEqual([]);
    });

    it.each(NAMES)("a device with address %s publishes its data", (n) => {
        const conf = reHashConf({ deviceConnections: [{
            name: "c", connType: "MQTT", payloadFormat: "JSON",
            devices: [{ deviceId: "D", pubInterval: 0, payloadFormat: "JSON",
                templates: [], tags: [
                    { Name: n, type: "Double", method: "GET", address: n,
                        path: "$.v", value: null, recordToDB: true },
                    { Name: "plain", type: "Double", method: "GET",
                        address: "plain", path: "$.v", value: null, recordToDB: true },
                ] }],
        }] });
        const published: any[] = [];
        jest.useFakeTimers("modern");
        try {
            const dev = new Device({} as any, idle_conn(), {
                deviceId: "D", pollInt: 1e9, pubInterval: 0, templates: [],
                metrics: conf.deviceConnections[0].devices[0].metrics,
                payloadFormat: "JSON",
            } as any);
            (dev as any)._publishDData = (ms: any[]) =>
                published.push(...ms.map(m => [m.name, m.value]));
            dev._handleData({ [n]: Buffer.from('{"v": 1}') }, true);
            dev._handleData({ plain: Buffer.from('{"v": 2}') }, true);
            dev.stop();
        }
        finally {
            jest.clearAllTimers();
            jest.useRealTimers();
        }
        expect(published).toEqual([[n, 1], ["plain", 2]]);
    });
});

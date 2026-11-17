/*
 * ACS Edge Agent
 * A payload that is valid JSON but not an object or array never takes
 * the agent down, and JSON (Batched) does not read it as a value
 * Copyright 2026 University of Sheffield
 *
 * JSON (Batched) reads a JSON object exactly as plain JSON does, so a
 * device can take object topics and array topics. Anything else that
 * parses (null, 0, false, "", a bare number or string) is not a batch
 * and not an object, so it is logged and dropped, as it was before the
 * object fallback. A payload that makes a reader throw is logged and
 * skipped: the device's other addresses, the other devices and the
 * process carry on.
 */

import { reHashConf } from "../../utils/FormatConfig";
import { Device } from "../../lib/device";
import { DriverConnection } from "../../lib/devices/driver";
import { DriverBroker } from "../../lib/driverBroker";
import { Translator } from "../../lib/translator";

const BARE = [null, 0, false, "", 5, "text"];
const bare_name = (v: any) => JSON.stringify(v);

function tags (address: string) {
    return [
        { Name: `${address}_path`, type: "Double", method: "GET",
            address, path: "$.v", value: null, recordToDB: true },
        { Name: `${address}_nopath`, type: "Double", method: "GET",
            address, value: null, recordToDB: true },
    ];
}

function make_device (format: string, addrs: string[]) {
    const conf = reHashConf({ deviceConnections: [{
        name: "c", connType: "MQTT", payloadFormat: format,
        devices: [{ deviceId: "D", pubInterval: 0, payloadFormat: format,
            templates: [], tags: addrs.flatMap(tags) }],
    }] });
    const published: { name: string, value: any }[] = [];
    const dev = new Device({} as any, {} as any, {
        deviceId: "D", pollInt: 1e9, pubInterval: 0, templates: [],
        metrics: conf.deviceConnections[0].devices[0].metrics,
        payloadFormat: format,
    } as any);
    (dev as any)._publishDData = (ms: any[]) =>
        published.push(...ms.map(m => ({ name: m.name, value: m.value })));
    return { dev, published };
}

const logs: string[] = [];
beforeAll(() => {
    jest.useFakeTimers("modern");
    jest.spyOn(console, "log").mockImplementation((...a: any[]) => { logs.push(a.join(" ")); });
});
afterAll(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
});
beforeEach(() => { logs.length = 0; });

describe("JSON (Batched) with a payload that is neither an array nor an object", () => {
    test.each(BARE.map(v => [bare_name(v), v]))("%s publishes nothing and does not throw", (_, v) => {
        const { dev, published } = make_device("JSON (Batched)", ["a"]);
        expect(() => dev._handleData({ a: Buffer.from(JSON.stringify(v)) }, true))
            .not.toThrow();
        expect(published).toEqual([]);
    });

    test("an object is still read as plain JSON, and an array as a batch", () => {
        const { dev, published } = make_device("JSON (Batched)", ["a"]);
        dev._handleData({ a: Buffer.from(JSON.stringify({ v: 1.5 })) }, true);
        dev._handleData({ a: Buffer.from(JSON.stringify([{ v: 2.5 }, { v: 3.5 }])) }, true);
        expect(published).toEqual([
            { name: "a_path", value: 1.5 },
            { name: "a_path", value: 2.5 },
            { name: "a_path", value: 3.5 },
        ]);
    });
});

describe("plain JSON with a bare payload", () => {
    test.each(BARE.map(v => [bare_name(v), v]))("%s does not throw", (_, v) => {
        const { dev } = make_device("JSON", ["a"]);
        expect(() => dev._handleData({ a: Buffer.from(JSON.stringify(v)) }, true))
            .not.toThrow();
    });

    test("a null payload on one address does not stop the others", () => {
        const { dev, published } = make_device("JSON", ["a", "b"]);
        dev._handleData({
            a: Buffer.from("null"),
            b: Buffer.from(JSON.stringify({ v: 7 })),
        }, true);
        expect(published).toEqual([{ name: "b_path", value: 7 }]);
        expect(logs.some(l => /D.*address a/.test(l))).toBe(true);
    });

    test("the same failure is logged once, not on every message", () => {
        const { dev } = make_device("JSON", ["a"]);
        for (let i = 0; i < 5; i++)
            dev._handleData({ a: Buffer.from("null") }, true);
        expect(logs.filter(l => /address a/.test(l))).toHaveLength(1);
    });
});

/* The split-driver path: a DriverConnection gathers data and hands it
 * to the devices from a setImmediate, where a throw is uncaught and
 * ends the process. */
describe("a bare payload from a split driver", () => {
    const ID = "drv";

    class FakeBroker {
        listener?: (m: any) => void;
        on (_ev: string, l: (m: any) => void) { this.listener = l; }
        off () { this.listener = undefined; }
        publish () {}
        send (msg: string, data: string | undefined, payload: string) {
            this.listener?.({ id: ID, msg, data, payload: Buffer.from(payload) });
        }
    }

    function metric (name: string, address: string, path = "") {
        return { name, type: "Double", value: null, properties: {
            method:  { type: "String", value: "GET" },
            address: { type: "String", value: address },
            path:    { type: "String", value: path },
        } };
    }

    async function setup (format: string) {
        jest.useRealTimers();
        const broker = new FakeBroker();
        const ddata: { device: string, name: string, value: any }[] = [];
        const tr = new Translator({} as any, 100, {} as any);
        tr.sparkplugNode = {
            publishDBirth: () => Promise.resolve(),
            publishDData: (device: string, ms: any[]) =>
                ddata.push(...ms.map(m => ({ device, name: m.name, value: m.value }))),
            publishDDeath: () => {},
        } as any;
        const devices = [
            { deviceId: "Bad", pollInt: 3_600_000, pubInterval: 0, templates: [],
                payloadFormat: format, metrics: [
                    metric("bad_nopath", "bad"), metric("bad_path", "bad", "$.v"),
                    metric("ok_nopath", "ok")] },
            { deviceId: "Good", pollInt: 3_600_000, pubInterval: 0, templates: [],
                payloadFormat: format, metrics: [metric("good", "good")] },
        ];
        const conn = new DriverConnection("Driver", {}, ID, broker as unknown as DriverBroker);
        tr.runDevices({ name: ID, devices }, conn);
        for (const d of devices)
            await conn.startSubscription(
                { addresses: d.metrics.map(m => m.properties.address.value) } as any,
                format as any, "", 3_600_000, d.deviceId, () => {});
        broker.send("status", undefined, "READY");
        broker.send("status", undefined, "UP");
        await new Promise(r => setImmediate(r));
        const send = (addr: string, payload: string) =>
            broker.send("data", conn.topics.get(addr), payload);
        return { conn, ddata, send, devices: tr.devices };
    }

    for (const format of ["JSON", "JSON (Batched)"]) {
        test.each(BARE.map(v => [bare_name(v), v]))(`${format}: %s on one address leaves the rest of the group and the other devices working`, async (_, v) => {
            const t = await setup(format);
            const thrown: any[] = [];
            const catcher = (e: any) => thrown.push(e);
            process.on("uncaughtException", catcher);
            try {
                t.send("bad", JSON.stringify(v));
                t.send("ok", JSON.stringify({ value: 1.25 }));
                t.send("good", JSON.stringify({ value: 2.5 }));
                await new Promise(r => setImmediate(r));
                await new Promise(r => setImmediate(r));
            }
            finally {
                process.off("uncaughtException", catcher);
                t.conn.close();
                Object.values(t.devices).forEach((d: any) => d.stop());
            }
            expect(thrown).toEqual([]);
            expect(t.ddata).toEqual(expect.arrayContaining([
                { device: "Bad", name: "ok_nopath", value: 1.25 },
                { device: "Good", name: "good", value: 2.5 },
            ]));
            if (format == "JSON (Batched)")
                expect(t.ddata.filter(d => d.name.startsWith("bad_"))).toEqual([]);
        });
    }
});

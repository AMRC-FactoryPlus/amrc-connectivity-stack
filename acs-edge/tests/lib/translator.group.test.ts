/*
 * ACS Edge Agent
 * A split driver's values that arrive together give one DDATA per
 * device, through the real Translator dispatch
 * Copyright 2026 University of Sheffield
 */

import { DriverConnection } from "../../lib/devices/driver";
import { DriverBroker } from "../../lib/driverBroker";
import { Translator } from "../../lib/translator";

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

function metric (name: string, address: string) {
    return {
        name, type: "Double", value: null,
        properties: {
            method:     { type: "String", value: "GET" },
            address:    { type: "String", value: address },
            /* No path: a split driver sends {"value", "timestamp"}. */
            path:       { type: "String", value: "" },
        },
    };
}

function device (id: string, addrs: string[]) {
    return {
        deviceId: id, pollInt: 3_600_000, pubInterval: 0, templates: [],
        payloadFormat: "JSON", metrics: addrs.map(a => metric(`m_${a}`, a)),
    };
}

const range = (p: string, n: number) => Array.from({ length: n }, (_, i) => `${p}${i}`);
const turn = () => new Promise(r => setImmediate(r));
/* Past the agent's 10 ms gathering wait. */
const gathered = () => new Promise(r => setTimeout(r, 30));

/* Each Device starts a ready timer; unref them so jest can exit. */
const realSetInterval = global.setInterval;
beforeAll(() => {
    jest.spyOn(global, "setInterval").mockImplementation(
        ((fn: any, ms?: number, ...args: any[]) =>
            realSetInterval(fn, ms, ...args).unref()) as any);
    jest.spyOn(console, "log").mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

/* A Translator running `devices` on one driver connection, UP, with
 * every address in the driver's map. */
async function setup (devices: any[]) {
    const broker = new FakeBroker();
    const ddata: { device: string, metrics: { name: string, value: any }[] }[] = [];
    const tr = new Translator({} as any, 100, {} as any);
    tr.sparkplugNode = {
        publishDBirth: () => Promise.resolve(),
        publishDData: (device: string, ms: any[]) =>
            ddata.push({ device, metrics: ms.map(m => ({ name: m.name, value: m.value })) }),
        publishDDeath: () => {},
    } as any;
    const conn = new DriverConnection("Driver", {}, ID, broker as unknown as DriverBroker);
    tr.runDevices({ name: ID, devices }, conn);
    for (const d of devices)
        await conn.startSubscription({ addresses: d.metrics.map((m: any) => m.properties.address.value) } as any,
            "JSON" as any, "", 3_600_000, d.deviceId, () => {});
    broker.send("status", undefined, "READY");
    broker.send("status", undefined, "UP");
    await turn();
    /* Send a value to an address, as the driver does. */
    const send = (addr: string, value: number) =>
        broker.send("data", conn.topics.get(addr), JSON.stringify({ value }));
    return { conn, ddata, send, close: () => conn.close() };
}

describe("Values a split driver sends together", () => {
    it("give one DDATA for a burst of 100 values on one device", async () => {
        const addrs = range("n", 100);
        const t = await setup([device("Dev", addrs)]);
        addrs.forEach((a, i) => t.send(a, i + 0.5));
        await gathered();

        expect(t.ddata).toHaveLength(1);
        expect(t.ddata[0].device).toBe("Dev");
        expect(t.ddata[0].metrics).toEqual(addrs.map((a, i) => ({ name: `m_${a}`, value: i + 0.5 })));
        t.close();
    });

    it("give one value per DDATA when each comes after the wait", async () => {
        const addrs = range("n", 5);
        const t = await setup([device("Dev", addrs)]);
        for (const [i, a] of addrs.entries()) {
            t.send(a, i);
            await gathered();
        }
        expect(t.ddata.map(d => d.metrics.length)).toEqual([1, 1, 1, 1, 1]);
        t.close();
    });

    it("give one value per DDATA when each comes in its own turn, with DRIVER_DATA_WAIT_MS=0", async () => {
        process.env.DRIVER_DATA_WAIT_MS = "0";
        try {
            const addrs = range("n", 5);
            const t = await setup([device("Dev", addrs)]);
            for (const [i, a] of addrs.entries()) {
                t.send(a, i);
                await turn();
            }
            expect(t.ddata.map(d => d.metrics.length)).toEqual([1, 1, 1, 1, 1]);
            t.close();
        }
        finally {
            delete process.env.DRIVER_DATA_WAIT_MS;
        }
    });

    it("give each device on the connection its own DDATA", async () => {
        const a = range("a", 10), b = range("b", 10);
        const t = await setup([device("A", a), device("B", b)]);
        /* Interleaved, as a driver serving both might send them. */
        for (let i = 0; i < 10; i++) {
            t.send(b[i], 100 + i);
            t.send(a[i], i);
        }
        await gathered();

        expect(t.ddata.map(d => [d.device, d.metrics.length])).toEqual([["A", 10], ["B", 10]]);
        expect(t.ddata[0].metrics).toEqual(a.map((x, i) => ({ name: `m_${x}`, value: i })));
        expect(t.ddata[1].metrics).toEqual(b.map((x, i) => ({ name: `m_${x}`, value: 100 + i })));
        t.close();
    });

    it("publish every value of an address that comes twice, in order", async () => {
        const t = await setup([device("Dev", ["x", "y"])]);
        t.send("x", 1);
        t.send("y", 1);
        t.send("x", 2);
        t.send("y", 2);
        t.send("x", 3);
        await gathered();

        expect(t.ddata.map(d => d.metrics.map(m => `${m.name}=${m.value}`))).toEqual([
            ["m_x=1", "m_y=1"],
            ["m_x=2", "m_y=2"],
            ["m_x=3"],
        ]);
        t.close();
    });
});

/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/* Confirmed writes. A driver that subscribes to its write/# answers
 * each write on result/<id>, and the agent reports the new value only
 * when the answer says it was written. A driver that only takes cmd/#
 * can't answer, so it gets exactly the old behaviour. See "Write
 * results" in docs/edge-split.md. */

import fs from "fs";
import net from "net";
import os from "os";
import path from "path";

import * as mqtt from "mqtt";

import { Device } from "../../../lib/device";
import { DriverConnection } from "../../../lib/devices/driver";
import { DriverBroker } from "../../../lib/driverBroker";
import {
    Metrics, serialisationType, sparkplugDataType as T, sparkplugMetric,
} from "../../../lib/helpers/typeHandler";

const ID = "drv";

function metric (type: T, value: any, address = "a", name = `m-${address}`): sparkplugMetric {
    return {
        name, type, value,
        properties: {
            method:     { type: T.string, value: "GET/SET" },
            address:    { type: T.string, value: address },
            path:       { type: T.string, value: "" },
        },
    } as sparkplugMetric;
}

class FakeBroker {
    sent: any[] = [];
    listener?: (m: any) => void;

    constructor (public confirms: boolean) {}

    on (ev: string, l: (m: any) => void) { this.listener = l; }
    off () {}
    publish (p: any) { this.sent.push(p); }
    confirms_writes (id: string) { return this.confirms && id == ID; }

    deliver (msg: string, data: string | undefined, payload: string) {
        this.listener!({ id: ID, msg, data, payload: Buffer.from(payload) });
    }
    of (msg: string) { return this.sent.filter(p => p.msg == msg); }
    /* The typed writes sent, as parsed JSON with the address. */
    writes () {
        return this.of("write").map(w => ({
            addr: w.data, ...JSON.parse(w.payload.toString()),
        }));
    }
}

function sleep (ms: number) {
    return new Promise(r => setTimeout(r, ms));
}

/* Capture console.log while fn runs. */
async function quietly<T> (fn: () => T | Promise<T>): Promise<[T, string]> {
    const lines: string[] = [];
    const spy = jest.spyOn(console, "log")
        .mockImplementation((...a) => { lines.push(a.join(" ")); });
    try {
        return [await fn(), lines.join("\n")];
    }
    finally {
        spy.mockRestore();
    }
}

describe("DriverConnection confirmed writes", () => {
    const conns: DriverConnection[] = [];
    let broker: FakeBroker;

    beforeEach(() => { broker = new FakeBroker(true); });
    afterEach(async () => {
        delete process.env.DRIVER_WRITE_TIMEOUT;
        for (const c of conns.splice(0)) {
            await c.stopSubscription("dev", () => {});
            c.close();
        }
    });

    async function open (addresses: string[]) {
        const conn = new DriverConnection("Driver", {}, ID, broker as any);
        conns.push(conn);
        conn.open();
        await conn.startSubscription({ addresses } as any, "JSON" as any, "",
            3_600_000, "dev", () => {});
        broker.deliver("status", undefined, "READY");
        broker.deliver("status", undefined, "UP");
        return conn;
    }

    type Call = { err?: Error, written?: sparkplugMetric[] };

    /* Write, and collect every call of the callback. */
    function write (conn: DriverConnection, metrics: sparkplugMetric[], calls: Call[] = []) {
        conn.writeMetrics(new Metrics(metrics),
            (err?: Error, written?: sparkplugMetric[]) => calls.push({ err, written }),
            "JSON" as any);
        return calls;
    }

    it("reports a value only when the driver confirms it", async () => {
        const conn = await open(["plant/speed"]);
        const m = metric(T.int16, -2, "plant/speed");
        const calls = write(conn, [m]);

        /* Both forms go out, and the typed one carries an id. The raw
         * bytes are what they always were. */
        expect(broker.of("cmd").map(c => [c.data, c.payload]))
            .toEqual([["plant/speed", Buffer.from([0xff, 0xfe])]]);
        const [w] = broker.writes();
        expect(w).toEqual({ addr: "plant/speed", type: "Int16", value: -2, id: expect.any(String) });
        expect(w.id).toMatch(/^\w+$/);
        expect(calls).toEqual([]);

        broker.deliver("result", w.id, "");
        expect(calls).toEqual([{ err: undefined, written: [m] }]);
    });

    it("doesn't report a value the driver refuses", async () => {
        const conn = await open(["a"]);
        const calls = write(conn, [metric(T.int16, 1, "a")]);
        const [w] = broker.writes();

        broker.deliver("result", w.id, "RO\nBadNotWritable");
        expect(calls).toHaveLength(1);
        expect(calls[0].written).toEqual([]);
        expect(calls[0].err?.message).toBe(
            "Write of m-a to a failed: the driver refused it: RO BadNotWritable. "
            + "The value was not reported.");
    });

    it("gives up on a write with no answer", async () => {
        process.env.DRIVER_WRITE_TIMEOUT = "30";
        const conn = await open(["a"]);
        const calls = write(conn, [metric(T.int16, 1, "a")]);
        const [w] = broker.writes();

        await sleep(60);
        expect(calls).toHaveLength(1);
        expect(calls[0].written).toEqual([]);
        expect(calls[0].err?.message).toMatch(/didn't answer within 30 ms/);

        /* A late answer changes nothing, and is logged. */
        const [, logged] = await quietly(() => broker.deliver("result", w.id, ""));
        expect(calls).toHaveLength(1);
        expect(logged).toMatch(new RegExp(`answer to unknown write ${w.id} ignored`));
    });

    it("matches each answer to its write when several are in flight", async () => {
        const conn = await open(["a", "b"]);
        const a1 = metric(T.int16, 1, "a");
        const a2 = metric(T.int16, 2, "a");
        const b = metric(T.int16, 3, "b");
        const calls = write(conn, [a1, b]);
        write(conn, [a2], calls);

        const ids = broker.writes().map(w => w.id);
        expect(new Set(ids).size).toBe(3);
        expect(broker.writes().map(w => [w.addr, w.value]))
            .toEqual([["a", 1], ["b", 3], ["a", 2]]);

        /* Answers in another order from the writes. Each value is
         * reported when its own answer arrives, so the last one
         * written by the driver is the one reported last. */
        broker.deliver("result", ids[2], "");
        broker.deliver("result", ids[1], "ERR\ndevice busy");
        broker.deliver("result", ids[0], "");
        expect(calls.map(c => c.written)).toEqual([[a2], [], [a1]]);

        /* Only an empty answer means written. */
        const odd = write(conn, [metric(T.int16, 4, "a")]);
        broker.deliver("result", broker.writes()[3].id, " \n");
        expect(odd[0].written).toEqual([]);
        expect(odd[0].err?.message).toMatch(/refused it: no reason given/);
        expect(calls[1].err?.message).toMatch(/m-b to b failed: the driver refused it: ERR device busy/);
    });

    it("still writes the rest of a batch when one address is bad", async () => {
        const conn = await open(["a"]);
        const good = metric(T.int16, 1, "a");
        const calls = write(conn, [metric(T.int16, 1, "nowhere"), good,
            metric(T.bytes, null, "a", "blob")]);

        /* The unknown address and the value with no typed form fail
         * straight away. */
        expect(calls.map(c => c.err?.message)).toEqual([
            expect.stringMatching(/m-nowhere to nowhere failed: the address is not in the address map/),
            expect.stringMatching(/blob to a failed: it can't be sent as a typed write/),
        ]);
        expect(broker.writes().map(w => w.value)).toEqual([1]);

        broker.deliver("result", broker.writes()[0].id, "");
        expect(calls[2]).toEqual({ err: undefined, written: [good] });
    });

    it("drops waiting writes on close", async () => {
        process.env.DRIVER_WRITE_TIMEOUT = "30";
        const conn = await open(["a"]);
        const calls = write(conn, [metric(T.int16, 1, "a")]);
        conn.close();
        await sleep(60);
        expect(calls).toEqual([]);
    });

    it("gives ids that differ between connections", async () => {
        const one = await open(["a"]);
        write(one, [metric(T.int16, 1, "a")]);
        const two = await open(["a"]);
        write(two, [metric(T.int16, 1, "a")]);
        const [x, y] = broker.writes().map(w => w.id);
        expect(x).not.toBe(y);
    });
});

/* A driver that only takes cmd/# gets the writes as it always has: the
 * callback runs straight away with one argument, and the messages are
 * the same bytes. */
describe("DriverConnection writes to a driver that can't confirm", () => {
    it.each([
        ["a broker that says so", new FakeBroker(false)],
        ["a broker from before confirmations", Object.assign(new FakeBroker(false),
            { confirms_writes: undefined })],
    ])("behaves as before with %s", async (_, broker) => {
        const conn = new DriverConnection("Driver", {}, ID, broker as any);
        conn.open();
        await conn.startSubscription({ addresses: ["a", "b"] } as any, "JSON" as any, "",
            3_600_000, "dev", () => {});
        broker.deliver("status", undefined, "READY");

        const args: any[][] = [];
        conn.writeMetrics(new Metrics([metric(T.int16, -2, "a"), metric(T.uInt8, 7, "b")]),
            (...a: any[]) => args.push(a), "JSON" as any);
        conn.writeMetrics(new Metrics([metric(T.int16, 1, "nowhere")]),
            (...a: any[]) => args.push(a), "JSON" as any);

        expect(args).toEqual([[undefined], [new Error("Address nowhere not found")]]);
        expect(broker.sent.filter(p => p.msg == "cmd" || p.msg == "write")
            .map(p => [p.msg, p.data, p.payload.toString("hex")]))
            .toEqual([
                ["cmd", "a", "fffe"],
                ["write", "a", Buffer.from('{"type":"Int16","value":-2}').toString("hex")],
                ["cmd", "b", "07"],
                ["write", "b", Buffer.from('{"type":"UInt8","value":7}').toString("hex")],
            ]);

        await conn.stopSubscription("dev", () => {});
        conn.close();
    });
});

/* The device reports what the connection says was written. */
describe("Device with confirmed writes", () => {
    function rig (confirms: boolean) {
        const broker = new FakeBroker(confirms);
        const conn = new DriverConnection("Driver", {}, ID, broker as any);
        const ddata: Array<{ name: string, value: any, timestamp: any }[]> = [];
        const sp: any = {
            publishDBirth: async () => {},
            publishDData: (dev: string, ms: sparkplugMetric[]) =>
                ddata.push(ms.map(m => ({ name: m.name!, value: m.value, timestamp: m.timestamp }))),
            publishDDeath: () => {},
        };
        const device = new Device(sp, conn, {
            deviceId: "dev",
            pollInt: 3_600_000,
            pubInterval: 0,
            templates: [],
            metrics: [metric(T.int16, 1, "plant/speed", "speed")],
            payloadFormat: serialisationType.JSON,
        } as any);
        return { broker, conn, device, ddata };
    }

    async function connect ({ broker, conn, device }: ReturnType<typeof rig>) {
        conn.open();
        broker.deliver("status", undefined, "READY");
        broker.deliver("status", undefined, "UP");
        device._deviceConnected();
        /* Let DBIRTH resolve and the ready timer subscribe. */
        await sleep(150);
    }

    async function finish ({ conn, device }: ReturnType<typeof rig>) {
        device.stop();
        conn.close();
    }

    const dcmd = (value: number) => ({ metrics: [{ name: "speed", value }] } as any);
    const speed = (device: Device) => device._metrics.getByName("speed");

    it("publishes the value once confirmed, with the time of the confirmation", async () => {
        const r = rig(true);
        await connect(r);
        try {
            const [, logged] = await quietly(() => r.device._handleDCmd(dcmd(5)));
            expect(logged).toBe("");
            expect(r.ddata).toEqual([]);
            expect(speed(r.device).value).toBe(1);

            await sleep(20);
            const before = Date.now();
            r.broker.deliver("result", r.broker.writes()[0].id, "");
            const after = Date.now();

            expect(r.ddata).toHaveLength(1);
            expect(r.ddata[0]).toEqual([{ name: "speed", value: 5, timestamp: expect.any(Number) }]);
            expect(r.ddata[0][0].timestamp).toBeGreaterThanOrEqual(before);
            expect(r.ddata[0][0].timestamp).toBeLessThanOrEqual(after);
            expect(speed(r.device).value).toBe(5);
        }
        finally {
            await finish(r);
        }
    });

    it("keeps the old value and logs why when a write fails", async () => {
        process.env.DRIVER_WRITE_TIMEOUT = "30";
        const r = rig(true);
        await connect(r);
        try {
            r.device._handleDCmd(dcmd(5));
            r.device._handleDCmd(dcmd(6));
            const [, logged] = await quietly(async () => {
                r.broker.deliver("result", r.broker.writes()[0].id, "CMD\nBadTypeMismatch");
                await sleep(60);
            });
            expect(r.ddata).toEqual([]);
            expect(speed(r.device).value).toBe(1);
            expect(logged).toMatch(/^dev: Write of speed to plant\/speed failed: the driver refused it: CMD BadTypeMismatch\. The value was not reported\.$/m);
            expect(logged).toMatch(/^dev: Write of speed to plant\/speed failed: the driver didn't answer within 30 ms\. The value was not reported\.$/m);
        }
        finally {
            delete process.env.DRIVER_WRITE_TIMEOUT;
            await finish(r);
        }
    });

    it("publishes straight away for a driver that can't confirm, as before", async () => {
        const r = rig(false);
        await connect(r);
        try {
            const before = Date.now();
            r.device._handleDCmd(dcmd(5));
            expect(r.ddata).toEqual([[{ name: "speed", value: 5, timestamp: expect.any(Number) }]]);
            expect(r.ddata[0][0].timestamp).toBeGreaterThanOrEqual(before);
            expect(r.broker.writes()).toEqual([{ addr: "plant/speed", type: "Int16", value: 5 }]);
        }
        finally {
            await finish(r);
        }
    });
});

/* Over a real broker, as a driver sees it. */
describe("DriverBroker write results", () => {
    let passwords: string;
    let broker: DriverBroker;
    let port: number;
    const clients: mqtt.MqttClient[] = [];

    function freePort (): Promise<number> {
        return new Promise((resolve, reject) => {
            const srv = net.createServer();
            srv.once("error", reject);
            srv.listen(0, "localhost", () => {
                const { port } = srv.address() as net.AddressInfo;
                srv.close(() => resolve(port));
            });
        });
    }

    async function client (id: string): Promise<mqtt.MqttClient> {
        const c = mqtt.connect(`mqtt://localhost:${port}`, {
            clientId: id, username: id, password: "secret",
            reconnectPeriod: 0,
        });
        clients.push(c);
        await new Promise<void>((resolve, reject) => {
            c.once("connect", () => resolve());
            c.once("error", reject);
        });
        return c;
    }

    async function until (cond: () => boolean, what: string) {
        const end = Date.now() + 5_000;
        while (!cond()) {
            if (Date.now() > end)
                throw new Error(`Timed out waiting for ${what}`);
            await sleep(5);
        }
    }

    beforeAll(() => {
        passwords = fs.mkdtempSync(path.join(os.tmpdir(), "driver-pw-"));
        fs.writeFileSync(path.join(passwords, ID), "secret");
        fs.writeFileSync(path.join(passwords, "debug"), "secret");
    });
    afterAll(() => {
        fs.rmSync(passwords, { recursive: true, force: true });
    });

    beforeEach(async () => {
        port = await freePort();
        broker = new DriverBroker({
            EDGE_MQTT: `mqtt://localhost:${port}`,
            EDGE_PASSWORDS: passwords,
            EDGE_DEBUG_USER: "debug",
        });
        await broker.start();
    });
    afterEach(async () => {
        for (const c of clients.splice(0))
            await new Promise(r => c.end(true, {}, r));
        await broker.stop();
    });

    it("learns which drivers confirm from their subscriptions", async () => {
        const watcher = await client("debug");
        await watcher.subscribeAsync(`fpEdge1/${ID}/write/#`);
        expect(broker.confirms_writes(ID)).toBe(false);

        const old = await client(ID);
        await old.subscribeAsync(`fpEdge1/${ID}/cmd/#`);
        expect(broker.confirms_writes(ID)).toBe(false);
        await new Promise(r => old.end(true, {}, r));

        const drv = await client(ID);
        await drv.subscribeAsync(`fpEdge1/${ID}/write/#`);
        expect(broker.confirms_writes(ID)).toBe(true);
        expect(broker.confirms_writes("other")).toBe(false);

        await drv.unsubscribeAsync(`fpEdge1/${ID}/write/#`);
        await until(() => !broker.confirms_writes(ID), "unsubscribe");

        await drv.subscribeAsync(`fpEdge1/${ID}/write/#`);
        expect(broker.confirms_writes(ID)).toBe(true);
        await new Promise(r => drv.end(true, {}, r));
        await until(() => !broker.confirms_writes(ID), "disconnect");
    });

    it("lets a driver publish a result but nothing else new", async () => {
        await client(ID);
        const acl = broker.acl.get(ID)!;
        expect(acl.publish.test(`fpEdge1/${ID}/result/9f3a1c02_7`)).toBe(true);
        expect(acl.publish.test(`fpEdge1/${ID}/result/a/b`)).toBe(false);
        expect(acl.publish.test(`fpEdge1/other/result/1`)).toBe(false);
    });

    it("reports a value once a real driver confirms it", async () => {
        const drv = await client(ID);
        await drv.subscribeAsync(`fpEdge1/${ID}/write/#`);
        drv.on("message", (topic, payload) => {
            const { id, value } = JSON.parse(payload.toString());
            drv.publish(`fpEdge1/${ID}/result/${id}`, value == 13 ? "RO\nnope" : "");
        });

        const conn = new DriverConnection("Driver", {}, ID, broker);
        conn.open();
        await conn.startSubscription({ addresses: ["plant/line1/speed"] } as any,
            "JSON" as any, "", 3_600_000, "dev", () => {});

        const calls: Array<[Error | undefined, sparkplugMetric[] | undefined]> = [];
        const ok = metric(T.uInt16, 7, "plant/line1/speed");
        const bad = metric(T.uInt16, 13, "plant/line1/speed");
        conn.writeMetrics(new Metrics([ok, bad]),
            (e?: Error, w?: sparkplugMetric[]) => calls.push([e, w]), "JSON" as any);
        expect(calls).toEqual([]);

        try {
            await until(() => calls.length == 2, "both answers");
            expect(calls[0]).toEqual([undefined, [ok]]);
            expect(calls[1][1]).toEqual([]);
            expect(calls[1][0]?.message).toMatch(/refused it: RO nope/);
        }
        finally {
            await conn.stopSubscription("dev", () => {});
            conn.close();
        }
    });
});

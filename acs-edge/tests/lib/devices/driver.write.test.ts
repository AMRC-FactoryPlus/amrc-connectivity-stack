/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/* Typed writes to a split driver. The agent sends every write twice:
 * the value as raw bytes on cmd/<address>, as drivers have always had
 * it, and JSON with the Sparkplug type on write/<address>. A driver
 * subscribes to one of them. See docs/edge-split.md. */

import fs from "fs";
import net from "net";
import os from "os";
import path from "path";

import * as mqtt from "mqtt";
import Long from "long";

import { DriverConnection } from "../../../lib/devices/driver";
import { DriverBroker } from "../../../lib/driverBroker";
import {
    byteOrder, Metrics, sparkplugDataType as T, sparkplugMetric,
    writeValToBuffer, writeValToJSON,
} from "../../../lib/helpers/typeHandler";

const ID = "drv";

function metric (type: T, value: any, address = "a", endianness?: byteOrder): sparkplugMetric {
    const properties: any = {
        method:     { type: T.string, value: "GET/SET" },
        address:    { type: T.string, value: address },
        path:       { type: T.string, value: "" },
    };
    if (endianness)
        properties.endianness = { type: T.uInt32, value: endianness };
    return { name: `m-${type}`, type, value, properties } as sparkplugMetric;
}

const hex = (s: string) => Buffer.from(s.replace(/ /g, ""), "hex");

/* Every scalar Sparkplug type. `bytes` is the cmd payload, which for
 * every type but Int64 and UInt64 is what the agent sent before typed
 * writes existed: big-endian at the natural width, Boolean as one
 * byte, strings as UTF-8. `json` is the value in the write payload.
 * DateTime has no cmd form. */
const SCALARS: Array<{ type: T, value: any, bytes?: Buffer, json: any }> = [
    { type: T.boolean,  value: true,        bytes: hex("01"),       json: true },
    { type: T.boolean,  value: false,       bytes: hex("00"),       json: false },
    { type: T.int8,     value: -5,          bytes: hex("fb"),       json: -5 },
    { type: T.int16,    value: -2,          bytes: hex("fffe"),     json: -2 },
    { type: T.int32,    value: 305419896,   bytes: hex("12345678"), json: 305419896 },
    { type: T.int64,    value: -2,          bytes: hex("ffff ffff ffff fffe"), json: "-2" },
    { type: T.uInt8,    value: 200,         bytes: hex("c8"),       json: 200 },
    { type: T.uInt16,   value: 65535,       bytes: hex("ffff"),     json: 65535 },
    { type: T.uInt32,   value: 4294967295,  bytes: hex("ffffffff"), json: 4294967295 },
    { type: T.uInt64,   value: 2 ** 53,     bytes: hex("0020 0000 0000 0000"), json: "9007199254740992" },
    { type: T.float,    value: 1.5,         bytes: hex("3fc00000"), json: 1.5 },
    { type: T.double,   value: -0.25,       bytes: hex("bfd0 0000 0000 0000"), json: -0.25 },
    { type: T.string,   value: "héllo/1",   bytes: Buffer.from("héllo/1"), json: "héllo/1" },
    { type: T.text,     value: "line 1\nline 2", bytes: Buffer.from("line 1\nline 2"), json: "line 1\nline 2" },
    { type: T.uuid,     value: "2f0d6a0a-58e1-4f5a-9b0c-0d1e2f3a4b5c",
        bytes: Buffer.from("2f0d6a0a-58e1-4f5a-9b0c-0d1e2f3a4b5c"),
        json: "2f0d6a0a-58e1-4f5a-9b0c-0d1e2f3a4b5c" },
    { type: T.dateTime, value: 1763380800123, json: 1763380800123 },
];

class FakeBroker {
    sent: any[] = [];
    listener?: (m: any) => void;

    on (ev: string, l: (m: any) => void) { this.listener = l; }
    off () {}
    publish (p: any) { this.sent.push(p); }

    deliver (msg: string, data: string | undefined, payload: string) {
        this.listener!({ id: ID, msg, data, payload: Buffer.from(payload) });
    }
    of (msg: string) { return this.sent.filter(p => p.msg == msg); }
}

describe("typed write encoding", () => {
    it.each(SCALARS)("$type $value", ({ type, value, json }) => {
        const got = JSON.parse(writeValToJSON(metric(type, value)).toString());
        expect(got).toEqual({ type, value: json });
    });

    it.each(SCALARS.filter(s => s.bytes))("$type $value as raw bytes", ({ type, value, bytes }) => {
        expect(writeValToBuffer(metric(type, value))).toEqual(bytes);
    });

    it("keeps little-endian raw bytes", () => {
        const le = byteOrder.littleEndian;
        expect(writeValToBuffer(metric(T.int16, -2, "a", le))).toEqual(hex("feff"));
        expect(writeValToBuffer(metric(T.int64, 1, "a", le))).toEqual(hex("0100 0000 0000 0000"));
        expect(writeValToBuffer(metric(T.uInt64, 1, "a", le))).toEqual(hex("0100 0000 0000 0000"));
        /* The typed form is the value, so byte order doesn't apply. */
        expect(JSON.parse(writeValToJSON(metric(T.int16, -2, "a", le)).toString()))
            .toEqual({ type: T.int16, value: -2 });
    });

    /* A DCMD value reaches the agent as a Long. The device turns it
     * into a number before writing, but a Long, a BigInt or a decimal
     * string must also work. */
    it("writes 64-bit integers from any form of the value", () => {
        const max = "9223372036854775807";
        for (const v of [BigInt(max), Long.fromString(max), max]) {
            expect(writeValToBuffer(metric(T.int64, v))).toEqual(hex("7fff ffff ffff ffff"));
            expect(JSON.parse(writeValToJSON(metric(T.int64, v)).toString()).value).toBe(max);
        }
        const umax = "18446744073709551615";
        expect(writeValToBuffer(metric(T.uInt64, BigInt(umax)))).toEqual(hex("ffff ffff ffff ffff"));
        expect(JSON.parse(writeValToJSON(metric(T.uInt64, umax)).toString()).value).toBe(umax);
    });

    it("refuses values that don't fit the type", () => {
        expect(() => writeValToBuffer(metric(T.uInt64, -1))).toThrow(/out of range/);
        expect(() => writeValToBuffer(metric(T.int64, 2n ** 63n))).toThrow(/out of range/);
        expect(() => writeValToBuffer(metric(T.int64, NaN))).toThrow();
        expect(() => writeValToBuffer(metric(T.int16, 40000))).toThrow();
        expect(() => writeValToJSON(metric(T.int16, 40000))).toThrow(/out of range/);
        expect(() => writeValToJSON(metric(T.uInt8, -1))).toThrow(/out of range/);
        expect(() => writeValToJSON(metric(T.int32, "abc"))).toThrow(/out of range/);
        expect(() => writeValToJSON(metric(T.dateTime, "soon"))).toThrow(/DateTime/);
    });

    it("sends non-finite floats as strings", () => {
        const val = (v: number) =>
            JSON.parse(writeValToJSON(metric(T.double, v)).toString()).value;
        expect(val(NaN)).toBe("NaN");
        expect(val(Infinity)).toBe("Infinity");
        expect(val(-Infinity)).toBe("-Infinity");
    });

    it("refuses types with no scalar value", () => {
        for (const type of [T.bytes, T.dataSet, T.template, T.file]) {
            expect(() => writeValToJSON(metric(type, null))).toThrow(/not supported/);
            expect(() => writeValToBuffer(metric(type, null))).toThrow(/not supported/);
        }
        expect(() => writeValToBuffer(metric(T.dateTime, 1))).toThrow(/not supported/);
    });
});

describe("DriverConnection writes", () => {
    const conns: DriverConnection[] = [];
    let broker: FakeBroker;

    beforeEach(() => { broker = new FakeBroker(); });
    afterEach(async () => {
        for (const c of conns.splice(0))
            await c.stopSubscription("dev", () => {});
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

    function write (conn: DriverConnection, metrics: sparkplugMetric[]) {
        let err: Error | undefined;
        conn.writeMetrics(new Metrics(metrics), (e: Error) => err = e, "JSON" as any);
        return err;
    }

    it("sends every scalar type in both forms", async () => {
        const addrs = SCALARS.map((s, i) => `plant/${i}`);
        const conn = await open(addrs);
        const err = write(conn, SCALARS.map((s, i) => metric(s.type, s.value, addrs[i])));
        expect(err).toBeUndefined();

        const cmds = broker.of("cmd");
        const writes = broker.of("write");
        expect(writes.map(w => w.data)).toEqual(addrs);
        expect(writes.map(w => JSON.parse(w.payload.toString())))
            .toEqual(SCALARS.map(s => ({ type: s.type, value: s.json })));

        /* The cmd form is unchanged for drivers that only read bytes.
         * DateTime has none, as before typed writes. */
        const withBytes = SCALARS.map((s, i) => [s, addrs[i]] as const)
            .filter(([s]) => s.bytes);
        expect(cmds.map(c => c.data)).toEqual(withBytes.map(([, a]) => a));
        expect(cmds.map(c => c.payload)).toEqual(withBytes.map(([s]) => s.bytes));
    });

    it("sends cmd before write for each metric", async () => {
        const conn = await open(["a", "b"]);
        write(conn, [metric(T.int16, 1, "a"), metric(T.int16, 2, "b")]);
        expect(broker.sent.filter(p => p.msg == "cmd" || p.msg == "write")
            .map(p => `${p.msg} ${p.data}`))
            .toEqual(["cmd a", "write a", "cmd b", "write b"]);
    });

    it("fails only when neither form can carry the value", async () => {
        const conn = await open(["a", "b"]);
        const spy = jest.spyOn(console, "log").mockImplementation(() => {});
        try {
            expect(write(conn, [metric(T.dateTime, 5, "a")])).toBeUndefined();
            expect(write(conn, [metric(T.int16, 99999, "b")])?.message)
                .toMatch(/Can't write .* to b/);
        }
        finally {
            spy.mockRestore();
        }
        expect(broker.of("write").map(w => w.data)).toEqual(["a"]);
        expect(broker.of("cmd")).toEqual([]);
    });

    it("logs a write error the driver reports", async () => {
        const conn = await open(["ns=2;s=Speed"]);
        const topic = conn.topics.get("ns=2;s=Speed")!;
        const lines: string[] = [];
        const spy = jest.spyOn(console, "log")
            .mockImplementation((...a) => { lines.push(a.join(" ")); });
        try {
            broker.deliver("err", topic, "RO\nBadNotWritable");
            broker.deliver("err", topic, "CMD");
            broker.deliver("err", "999999", "ERR\nlost");
        }
        finally {
            spy.mockRestore();
        }
        const logged = lines.join("\n");
        expect(logged).toMatch(/error RO on ns=2;s=Speed: BadNotWritable/);
        expect(logged).toMatch(/error CMD on ns=2;s=Speed$/m);
        expect(logged).toMatch(/error ERR on data topic 999999: lost/);
        expect(logged).not.toMatch(/Unexpected/);
    });
});

/* Over a real broker, as a driver sees it. */
describe("DriverBroker typed writes", () => {
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

    async function driver (): Promise<mqtt.MqttClient> {
        const c = mqtt.connect(`mqtt://localhost:${port}`, {
            clientId: ID, username: ID, password: "secret",
            reconnectPeriod: 0,
        });
        clients.push(c);
        await new Promise<void>((resolve, reject) => {
            c.once("connect", () => resolve());
            c.once("error", reject);
        });
        return c;
    }

    beforeAll(() => {
        passwords = fs.mkdtempSync(path.join(os.tmpdir(), "driver-pw-"));
        fs.writeFileSync(path.join(passwords, ID), "secret");
    });
    afterAll(() => {
        fs.rmSync(passwords, { recursive: true, force: true });
    });

    beforeEach(async () => {
        port = await freePort();
        broker = new DriverBroker({
            EDGE_MQTT: `mqtt://localhost:${port}`,
            EDGE_PASSWORDS: passwords,
        });
        await broker.start();
    });
    afterEach(async () => {
        for (const c of clients.splice(0))
            await new Promise(r => c.end(true, {}, r));
        await broker.stop();
    });

    /* Send one write the way DriverConnection does, and collect what a
     * driver subscribed to `filter` receives. */
    async function deliver (filter: string) {
        const c = await driver();
        await c.subscribeAsync(`fpEdge1/${ID}/${filter}`);
        const got: Array<[string, Buffer]> = [];
        c.on("message", (t, p) => got.push([t, p]));

        const conn = new DriverConnection("Driver", {}, ID, broker);
        await conn.startSubscription({ addresses: ["plant/line1/speed"] } as any,
            "JSON" as any, "", 3_600_000, "dev", () => {});
        conn.writeMetrics(new Metrics([metric(T.uInt16, 7, "plant/line1/speed")]),
            () => {}, "JSON" as any);
        await conn.stopSubscription("dev", () => {});
        /* A write/# driver is expected to answer. Stop waiting. */
        conn.close();

        /* Both publishes are queued before this one, so once it
         * arrives the writes have too. */
        await c.subscribeAsync(`fpEdge1/${ID}/poll`);
        await broker.publish({ id: ID, msg: "poll", payload: Buffer.from("end") });
        await new Promise<void>(resolve => {
            const check = () => got.some(([t]) => t.endsWith("/poll"))
                ? resolve() : setTimeout(check, 5);
            check();
        });
        return got.filter(([t]) => !t.endsWith("/poll"));
    }

    it("gives a cmd/# driver only the raw bytes, as before", async () => {
        expect(await deliver("cmd/#")).toEqual([
            [`fpEdge1/${ID}/cmd/plant/line1/speed`, Buffer.from([0, 7])],
        ]);
    });

    it("gives a write/# driver only the typed write", async () => {
        const got = await deliver("write/#");
        expect(got.map(([t]) => t)).toEqual([`fpEdge1/${ID}/write/plant/line1/speed`]);
        /* The id asks the driver to answer; see driver.confirm.test.ts. */
        expect(JSON.parse(got[0][1].toString()))
            .toEqual({ type: "UInt16", value: 7, id: expect.stringMatching(/^\w+$/) });
    });

    it("lets a driver subscribe to write/# but not publish there", async () => {
        await driver();
        const acl = broker.acl.get(ID)!;
        expect(acl.subscribe.test(`fpEdge1/${ID}/write/#`)).toBe(true);
        expect(acl.subscribe.test(`fpEdge1/other/write/#`)).toBe(false);
        expect(acl.publish.test(`fpEdge1/${ID}/write/a`)).toBe(false);
        expect(acl.publish.test(`fpEdge1/${ID}/err/123`)).toBe(true);
    });
});

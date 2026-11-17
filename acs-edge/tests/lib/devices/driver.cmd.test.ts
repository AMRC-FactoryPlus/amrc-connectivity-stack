/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/* Writes to a split driver. The agent publishes each write to
 * cmd/<address>, and every published driver library takes the address
 * from the topic, so the address must arrive whole even when it
 * contains "/". See docs/edge-split.md. */

import fs from "fs";
import net from "net";
import os from "os";
import path from "path";

import * as mqtt from "mqtt";

import { DriverConnection, cmd_addressable } from "../../../lib/devices/driver";
import { DriverBroker } from "../../../lib/driverBroker";
import { Metrics, sparkplugDataType, sparkplugMetric } from "../../../lib/helpers/typeHandler";

const ID = "drv";

function metric (name: string, address: string, value: number, path = ""): sparkplugMetric {
    return {
        name, value,
        type: sparkplugDataType.uInt16,
        properties: {
            method:     { type: sparkplugDataType.string, value: "GET/SET" },
            address:    { type: sparkplugDataType.string, value: address },
            path:       { type: sparkplugDataType.string, value: path },
        },
    } as sparkplugMetric;
}

class FakeBroker {
    sent: any[] = [];
    listener?: (m: any) => void;

    on (ev: string, l: (m: any) => void) { this.listener = l; }
    off () {}
    publish (p: any) { this.sent.push(p); }

    status (st: string) {
        this.listener!({ id: ID, msg: "status", payload: Buffer.from(st) });
    }
    of (msg: string) { return this.sent.filter(p => p.msg == msg); }
}

async function connection (broker: any, addresses: string[]) {
    const conn = new DriverConnection("Driver", {}, ID, broker as DriverBroker);
    conn.open();
    await conn.startSubscription({ addresses } as any, "JSON" as any, "",
        3_600_000, "dev", () => {});
    return conn;
}

function write (conn: DriverConnection, metrics: sparkplugMetric[]): Error | undefined {
    let err: Error | undefined;
    conn.writeMetrics(new Metrics(metrics), (e: Error) => err = e, "JSON" as any);
    return err;
}

describe("DriverConnection cmd", () => {
    const conns: DriverConnection[] = [];
    let broker: FakeBroker;

    beforeEach(() => { broker = new FakeBroker(); });
    afterEach(async () => {
        for (const c of conns.splice(0))
            await c.stopSubscription("dev", () => {});
    });

    async function open (addresses: string[]) {
        const conn = await connection(broker, addresses);
        conns.push(conn);
        broker.status("READY");
        broker.status("UP");
        return conn;
    }

    it("sends the address, not the data topic", async () => {
        const conn = await open(["40001"]);
        const err = write(conn, [metric("a", "40001", 7)]);

        expect(err).toBeUndefined();
        const cmds = broker.of("cmd");
        expect(cmds.map(c => c.data)).toEqual(["40001"]);
        expect(conn.topics.get("40001")).not.toBe("40001");
        expect(cmds[0].payload).toEqual(Buffer.from([0, 7]));
    });

    it("sends an address containing / whole", async () => {
        const conn = await open(["plant/line1/speed", "ns=2;s=Motor.Speed"]);
        const err = write(conn, [
            metric("a", "plant/line1/speed", 1),
            metric("b", "ns=2;s=Motor.Speed", 2),
        ]);

        expect(err).toBeUndefined();
        expect(broker.of("cmd").map(c => c.data))
            .toEqual(["plant/line1/speed", "ns=2;s=Motor.Speed"]);
    });

    it("sends one cmd per metric written", async () => {
        const conn = await open(["40001", "40002"]);
        write(conn, [metric("a", "40001", 1), metric("b", "40002", 2)]);
        expect(broker.of("cmd").length).toBe(2);
    });

    it("refuses an address with an MQTT wildcard", async () => {
        const conn = await open(["a/+/b", "c#", "ok"]);
        const err = write(conn, [
            metric("a", "a/+/b", 1),
            metric("b", "c#", 2),
            metric("c", "ok", 3),
        ]);

        expect(err?.message).toMatch(/can't be written/);
        expect(broker.of("cmd").map(c => c.data)).toEqual(["ok"]);
    });

    it("refuses an address that is not subscribed", async () => {
        const conn = await open(["40001"]);
        const err = write(conn, [metric("a", "40009", 1)]);

        expect(err?.message).toMatch(/not found/);
        expect(broker.of("cmd")).toEqual([]);
    });

    it("knows which addresses can be topics", () => {
        expect(cmd_addressable("a/b/c")).toBe(true);
        expect(cmd_addressable("/leading")).toBe(true);
        expect(cmd_addressable("ns=2;s=x.y")).toBe(true);
        expect(cmd_addressable("a+b")).toBe(false);
        expect(cmd_addressable("a#")).toBe(false);
        expect(cmd_addressable("a\0b")).toBe(false);
    });
});

/* Over a real broker, as a driver sees it. */
describe("DriverBroker cmd", () => {
    let passwords: string;
    let port: number;
    let broker: DriverBroker;
    let client: mqtt.MqttClient;

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
        client = mqtt.connect(`mqtt://localhost:${port}`, {
            clientId: ID, username: ID, password: "secret",
            reconnectPeriod: 0,
        });
        await new Promise<void>((resolve, reject) => {
            client.once("connect", () => resolve());
            client.once("error", reject);
        });
    });

    afterEach(async () => {
        await new Promise(r => client.end(true, {}, r));
        await broker.stop();
    });

    it("delivers cmd/<address> with / in it to a cmd/# subscriber", async () => {
        await client.subscribeAsync(`fpEdge1/${ID}/cmd/#`);
        const got = new Promise<string>(resolve =>
            client.once("message", t => resolve(t)));

        const looped: any[] = [];
        broker.on("message", m => looped.push(m));
        const logs: string[] = [];
        const spy = jest.spyOn(console, "log")
            .mockImplementation((...a) => { logs.push(a.join(" ")); });

        try {
            await broker.publish({ id: ID, msg: "cmd",
                data: "plant/line1/speed", payload: Buffer.from([1]) });
            expect(await got).toBe(`fpEdge1/${ID}/cmd/plant/line1/speed`);
        }
        finally {
            spy.mockRestore();
        }

        /* The agent hears its own cmd and parses the address back
         * whole, rather than logging an unknown topic. */
        expect(looped).toEqual([expect.objectContaining({
            id: ID, msg: "cmd", data: "plant/line1/speed" })]);
        expect(logs.filter(l => /unknown topic/.test(l))).toEqual([]);
    });

    it("still keeps drivers to \\w+ data topics", () => {
        /* Widening the topic parser must not widen what a driver may
         * publish. The ACL is set when the driver authenticates. */
        const acl = broker.acl.get(ID)!;
        expect(acl.publish.test(`fpEdge1/${ID}/data/123`)).toBe(true);
        expect(acl.publish.test(`fpEdge1/${ID}/data/a/b`)).toBe(false);
        expect(acl.subscribe.test(`fpEdge1/${ID}/cmd/#`)).toBe(true);
    });
});

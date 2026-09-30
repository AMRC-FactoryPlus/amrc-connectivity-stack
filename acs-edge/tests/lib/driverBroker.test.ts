/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import fs from "fs";
import net from "net";
import os from "os";
import path from "path";

import * as mqtt from "mqtt";

import { DriverBroker } from "../../lib/driverBroker";

/* Enough queued driver messages to overflow the stack if the broker
 * drains them recursively. A live edge node with 7,302 devices
 * overflowed; one with 2,120 did not. */
const QUEUED = 10_000;

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

function tick (): Promise<void> {
    return new Promise(resolve => setImmediate(resolve));
}

async function until (cond: () => boolean, what: string, ms = 10_000) {
    const end = Date.now() + ms;
    while (!cond()) {
        if (Date.now() > end)
            throw new Error(`Timed out waiting for ${what}`);
        await new Promise(r => setTimeout(r, 5));
    }
}

function publishPacket (topic: string, payload: Buffer) {
    return {
        cmd: "publish" as const, qos: 0 as const,
        dup: false, retain: false, topic, payload,
    };
}

describe("DriverBroker", () => {
    let passwords: string;
    let port: number;
    const brokers: DriverBroker[] = [];
    const clients: mqtt.MqttClient[] = [];

    function env () {
        return {
            EDGE_MQTT: `mqtt://localhost:${port}`,
            EDGE_PASSWORDS: passwords,
        };
    }

    function broker () {
        const br = new DriverBroker(env());
        brokers.push(br);
        return br;
    }

    function driver (id: string, opts: mqtt.IClientOptions = {}) {
        const c = mqtt.connect(`mqtt://localhost:${port}`, {
            clientId: id, username: id, password: "secret",
            reconnectPeriod: 0, ...opts,
        });
        clients.push(c);
        return c;
    }

    beforeAll(() => {
        passwords = fs.mkdtempSync(path.join(os.tmpdir(), "driver-pw-"));
        fs.writeFileSync(path.join(passwords, "drv"), "secret");
    });

    afterAll(() => {
        fs.rmSync(passwords, { recursive: true, force: true });
    });

    beforeEach(async () => {
        port = await freePort();
    });

    afterEach(async () => {
        await Promise.all(clients.splice(0)
            .map(c => new Promise(r => c.end(true, {}, r))));
        await Promise.all(brokers.splice(0).map(b => b.stop()));
    });

    describe("queued driver messages", () => {
        /* Aedes' mqemitter allows 100 messages in flight. Beyond that
         * it queues, and each listener callback releases the next
         * queued message. Live, the in-flight slots were held by
         * agent-to-driver deliveries waiting for a busy socket to
         * drain, while the driver published data for every device. */
        it(`processes ${QUEUED} queued messages in order without overflowing the stack`, async () => {
            const br = broker();
            const mq = (br.broker as any).mq;

            const seen: string[] = [];
            br.on("message", m => seen.push(m.data));

            /* Hold every in-flight slot with a listener that has not
             * called back yet, as a backpressured client delivery
             * does. */
            const held: Array<() => void> = [];
            br.broker.subscribe("hold/#", (_p, cb) => held.push(cb), () => {});
            for (let i = 0; i < mq.concurrency; i++)
                br.broker.publish(publishPacket("hold/x", Buffer.from("")), () => {});
            await tick();
            expect(held).toHaveLength(mq.concurrency);

            for (let i = 0; i < QUEUED; i++)
                br.broker.publish(publishPacket(`fpEdge1/drv/data/d${i}`,
                    Buffer.from(`${i}`)), () => {});
            expect(mq.length).toBe(QUEUED);

            /* Releasing one slot lets the queue drain. */
            let error: unknown;
            try {
                for (const cb of held.splice(0)) cb();
            }
            catch (e) {
                error = e;
            }
            expect(error).toBeUndefined();

            await until(() => seen.length == QUEUED && mq.length == 0,
                "queue to drain");
            expect(seen).toEqual(
                Array.from({ length: QUEUED }, (_, i) => `d${i}`));
        });

        it(`delivers ${QUEUED} driver publishes over MQTT, in order, while the broker's writes to the driver are backpressured`, async () => {
            const br = broker();
            await br.start();
            const mq = (br.broker as any).mq;

            const seen: string[] = [];
            br.on("message", m => { if (m.msg == "data") seen.push(m.data); });

            const drv = driver("drv");
            await new Promise<void>((resolve, reject) => {
                drv.once("connect", () => resolve());
                drv.once("error", reject);
            });
            await drv.subscribeAsync("fpEdge1/drv/poll");

            /* Stop reading on the driver's side so the broker's writes
             * to it back up, as they did live with thousands of
             * devices' worth of addr/poll traffic. */
            (drv as any).stream.pause();
            const big = Buffer.alloc(256 * 1024);
            for (let i = 0; i < mq.concurrency + 50; i++)
                br.publish({ id: "drv", msg: "poll", payload: big });
            await until(() => mq.current >= mq.concurrency,
                "in-flight slots to fill");

            /* Aedes stops reading from a client while its packets
             * wait in the queue, so only the first read's worth
             * queues here; the rest follows as the queue drains. */
            for (let i = 0; i < QUEUED; i++)
                drv.publish(`fpEdge1/drv/data/d${i}`, `${i}`, { qos: 0 });
            await until(() => mq.length > mq.concurrency,
                "driver data to queue");

            const errors: unknown[] = [];
            const onErr = (e: unknown) => errors.push(e);
            process.on("uncaughtException", onErr);
            try {
                (drv as any).stream.resume();
                await until(() => seen.length == QUEUED || errors.length > 0,
                    "driver data to be processed", 30_000);
            }
            finally {
                process.off("uncaughtException", onErr);
            }

            expect(errors).toEqual([]);
            expect(seen).toEqual(
                Array.from({ length: QUEUED }, (_, i) => `d${i}`));
        }, 60_000);
    });

    describe("restart on the same port", () => {
        it("releases the port on stop so a new broker can listen on it", async () => {
            const first = broker();
            await first.start();

            /* A connected driver holds a socket open on the server. */
            const drv = driver("drv");
            await new Promise<void>((resolve, reject) => {
                drv.once("connect", () => resolve());
                drv.once("error", reject);
            });

            await first.stop();

            const second = broker();
            await expect(second.start()).resolves.toBeUndefined();

            /* The new broker serves drivers. */
            const seen: string[] = [];
            second.on("message", m => seen.push(`${m.msg}:${m.payload}`));
            const again = driver("drv");
            await new Promise<void>((resolve, reject) => {
                again.once("connect", () => resolve());
                again.once("error", reject);
            });
            again.publish("fpEdge1/drv/status", "READY");
            await until(() => seen.length > 0, "status from driver");
            expect(seen).toEqual(["status:READY"]);
        });

        it("can be stopped more than once", async () => {
            const br = broker();
            await br.start();
            await br.stop();
            await expect(br.stop()).resolves.toBeUndefined();
        });
    });
});

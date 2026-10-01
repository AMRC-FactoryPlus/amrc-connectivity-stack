/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

/* The address map a DriverConnection sends to its driver. Every device
 * calls startSubscription, and the map is sent whole. Sending it once
 * per device made startup quadratic: 7,302 devices sent 7,303 maps,
 * about 1.2 GB in all, and the agent was OOMKilled. */

import { DriverConnection } from "../../../lib/devices/driver";
import { DriverBroker } from "../../../lib/driverBroker";

const ID = "drv";
const DEVICES = 7_302;
const TAGS = 5;

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

function tick (): Promise<void> {
    return new Promise(resolve => setImmediate(resolve));
}

/* The map main sends last, built from the connection's final state. */
function expectedAddrs (conn: DriverConnection) {
    return {
        version: 1,
        addrs:  Object.fromEntries(conn.addrs),
        groups: Object.fromEntries(
            [...conn.groups.entries()]
            .map(([n, i]) => [n, { poll: i.poll, addrs: [...i.addrs] }])),
    };
}

describe("DriverConnection address map", () => {
    let broker: FakeBroker;
    let conn: DriverConnection;
    const subs: string[] = [];

    beforeEach(() => {
        broker = new FakeBroker();
        conn = new DriverConnection("Driver", { a: 1 }, ID,
            broker as unknown as DriverBroker);
        conn.open();
    });

    afterEach(async () => {
        for (const d of subs.splice(0))
            await conn.stopSubscription(d, () => {});
    });

    async function subscribe (n: number) {
        const started: Promise<void>[] = [];
        for (let i = 0; i < n; i++) {
            const addresses = Array.from({ length: TAGS },
                (_, t) => `dev${i}/tag${t}`);
            subs.push(`dev${i}`);
            started.push(conn.startSubscription(
                { addresses } as any, "JSON" as any, "", 3_600_000,
                `dev${i}`, () => {}));
        }
        await Promise.all(started);
    }

    it(`sends one map for a burst of ${DEVICES} subscriptions`, async () => {
        broker.status("READY");
        await tick();
        broker.status("UP");
        expect(broker.of("addr").length).toBe(1);

        await subscribe(DEVICES);
        await tick();

        /* The last map is the one main sends last. */
        const addrs = broker.of("addr");
        const last = JSON.parse(addrs[addrs.length - 1].payload.toString());
        expect(last).toEqual(expectedAddrs(conn));
        expect(Object.keys(last.groups)).toHaveLength(DEVICES);
        expect(Object.keys(last.addrs)).toHaveLength(DEVICES * TAGS);

        /* One for READY, one for the burst. Main sends 1 + DEVICES. */
        expect(addrs.length).toBe(2);
    }, 120_000);

    it("sends conf before the map on READY", async () => {
        await subscribe(3);
        expect(broker.of("addr").length).toBe(0);

        broker.status("READY");
        await tick();

        const msgs = broker.sent.map(p => p.msg);
        expect(msgs).toEqual(["active", "conf", "addr"]);
        expect(JSON.parse(broker.of("addr")[0].payload.toString()))
            .toEqual(expectedAddrs(conn));
    });

    it("sends the map again on a later READY", async () => {
        broker.status("READY");
        await subscribe(3);
        await tick();
        /* One with READY's conf, one for the burst. */
        expect(broker.of("addr").length).toBe(2);

        broker.status("READY");
        await tick();
        expect(broker.of("conf").length).toBe(2);
        expect(broker.of("addr").length).toBe(3);
        expect(broker.sent.slice(-2).map(p => p.msg))
            .toEqual(["conf", "addr"]);
    });

    it("sends the map on READY without waiting a turn", () => {
        broker.status("READY");
        expect(broker.sent.map(p => p.msg)).toEqual(["active", "conf", "addr"]);
    });

    it("sends a pending map before a poll", async () => {
        broker.status("READY");
        broker.status("UP");
        await subscribe(3);
        const before = broker.of("addr").length;

        conn.readMetrics({ addresses: ["dev0/tag0"] } as any);
        const msgs = broker.sent.slice(-2).map(p => p.msg);
        expect(msgs).toEqual(["addr", "poll"]);
        expect(broker.of("addr").length).toBe(before + 1);
        expect(JSON.parse(broker.of("addr").at(-1).payload.toString()))
            .toEqual(expectedAddrs(conn));

        /* The flush replaced the pending send. */
        await tick();
        expect(broker.of("addr").length).toBe(before + 1);
    });

    it("sends a pending map before a cmd", async () => {
        broker.status("READY");
        broker.status("UP");
        await subscribe(1);
        const before = broker.of("addr").length;

        conn.writeMetrics({ array: [] } as any, () => {}, "JSON" as any);
        expect(broker.of("addr").length).toBe(before + 1);
        expect(broker.sent.at(-1).msg).toBe("addr");
    });

    it("drops a pending map if the driver goes DOWN", async () => {
        broker.status("READY");
        await tick();
        await subscribe(3);
        broker.status("DOWN");
        await tick();
        expect(broker.of("addr").length).toBe(1);
    });

    it("drops a pending map when the connection closes", async () => {
        broker.status("READY");
        await tick();
        await subscribe(3);
        conn.close();
        await tick();
        expect(broker.of("addr").length).toBe(1);
        expect(broker.sent[broker.sent.length - 1].msg).toBe("active");
    });
});

/* A device with no addresses has nothing to read. Each device runs its
 * own poll timer, so 7,302 such devices sent about 7,300 empty polls a
 * second through the in-process broker. */
describe("DriverConnection polls", () => {
    let broker: FakeBroker;
    let conn: DriverConnection;

    beforeEach(() => {
        jest.useFakeTimers();
        broker = new FakeBroker();
        conn = new DriverConnection("Driver", { a: 1 }, ID,
            broker as unknown as DriverBroker);
        conn.open();
        broker.status("READY");
        broker.status("UP");
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    async function start (device: string, addresses: string[]) {
        const started = jest.fn();
        await conn.startSubscription({ addresses } as any, "JSON" as any,
            "", 1000, device, started);
        return started;
    }

    it("sends no poll for a device with no addresses", async () => {
        await start("empty", []);
        jest.advanceTimersByTime(5000);
        expect(broker.of("poll")).toHaveLength(0);
    });

    it("sends no poll from readMetrics with no addresses", () => {
        conn.readMetrics({ addresses: [] } as any);
        expect(broker.of("poll")).toHaveLength(0);
    });

    it("leaves the pending map to its own timer on an empty poll", async () => {
        await start("empty", []);
        const before = broker.of("addr").length;
        conn.readMetrics({ addresses: [] } as any);
        expect(broker.of("addr").length).toBe(before);
        jest.advanceTimersByTime(1);
        expect(broker.of("addr").length).toBe(before + 1);
    });

    it("polls a device with addresses on every interval", async () => {
        await start("full", ["a", "b"]);
        jest.advanceTimersByTime(3000);
        const polls = broker.of("poll");
        expect(polls).toHaveLength(3);
        const topics = [...conn.topics.values()].join("\n");
        for (const p of polls)
            expect(p.payload.toString()).toBe(topics);
    });

    it("polls only the devices that have addresses", async () => {
        await start("empty", []);
        await start("full", ["a"]);
        jest.advanceTimersByTime(2000);
        expect(broker.of("poll")).toHaveLength(2);
    });

    it("calls the start callback for both", async () => {
        const e = await start("empty", []);
        const f = await start("full", ["a"]);
        expect(e).toHaveBeenCalledTimes(1);
        expect(f).toHaveBeenCalledTimes(1);
    });

    it("still registers an empty device in the address map", async () => {
        await start("empty", []);
        expect(conn.groups.get("empty")).toEqual({ poll: 1000, addrs: new Set() });
    });

    it("stops both kinds of subscription", async () => {
        await start("empty", []);
        await start("full", ["a"]);
        const e = jest.fn(), f = jest.fn();
        await conn.stopSubscription("empty", e);
        await conn.stopSubscription("full", f);
        expect(e).toHaveBeenCalledTimes(1);
        expect(f).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(5000);
        expect(broker.of("poll")).toHaveLength(0);
    });
});

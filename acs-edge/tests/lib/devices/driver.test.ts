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
        expect(broker.of("addr").length).toBe(1);

        broker.status("READY");
        await tick();
        expect(broker.of("conf").length).toBe(2);
        expect(broker.of("addr").length).toBe(2);
        expect(broker.sent.slice(-2).map(p => p.msg))
            .toEqual(["conf", "addr"]);
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

/*
 * ACS Edge Agent
 * A split driver connection's part in Edge Scout: the features key,
 * found messages that don't split data groups, and the cancel that
 * goes ahead of a new conf
 * Copyright 2026 University of Sheffield
 */

import { DriverConnection } from "../../../lib/devices/driver";
import { DriverBroker } from "../../../lib/driverBroker";
import { ScoutManager } from "../../../lib/scout";

import { FakeServices, schemas, TIMING, until } from "../scout/harness";

const ID = "drv";

class FakeBroker {
    listeners: ((m: any) => void)[] = [];
    sent: any[] = [];
    subscribed = new Set<string>();
    on (ev: string, l: (m: any) => void) { if (ev == "message") this.listeners.push(l); }
    off (ev: string, l: (m: any) => void) {
        this.listeners = this.listeners.filter(x => x !== l);
    }
    async publish (p: any) { this.sent.push(p); }
    scouts (id: string) { return this.subscribed.has(id); }
    send (msg: string, data: string | undefined, payload: Buffer | string) {
        for (const l of this.listeners)
            l({ id: ID, msg, data, payload: Buffer.from(payload) });
    }
    of (msg: string) { return this.sent.filter(p => p.msg == msg); }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe("DriverConnection and Edge Scout", () => {
    let broker: FakeBroker;
    let conn: DriverConnection;

    beforeEach(() => {
        broker = new FakeBroker();
        conn = new DriverConnection("Driver", { a: 1 }, ID, broker as unknown as DriverBroker);
        conn.open();
        conn.addrs.set("1", "x");
        conn.topics.set("x", "1");
        conn.addrs.set("2", "y");
        conn.topics.set("y", "2");
    });
    afterEach(() => conn.close());

    it("advertises the scout feature in every addr", () => {
        broker.send("status", undefined, "READY");
        const addr = JSON.parse(broker.of("addr")[0].payload.toString());
        expect(addr.features).toEqual({ scout: 1 });
        expect(schemas.check("addr", addr)).toBeNull();
    });

    it("hands found messages on without splitting a group of data", async () => {
        const data: any[] = [];
        const found: any[] = [];
        conn.on("data", obj => data.push(Object.keys(obj)));
        conn.on("found", (id, payload) => found.push([id, payload.toString()]));

        broker.send("data", "1", "1");
        broker.send("found", "abc", "{\"seq\":0}");
        broker.send("data", "2", "2");
        expect(data).toEqual([]);
        expect(found).toEqual([["abc", "{\"seq\":0}"]]);
        await sleep(40);
        /* One group, as if the found message wasn't there. */
        expect(data).toEqual([["x", "y"]]);
    });

    it("doesn't log its own scout messages as unexpected", () => {
        const log = jest.spyOn(console, "log").mockImplementation(() => {});
        process.env.DEBUG = "true";
        try {
            broker.send("scout", undefined, "{\"op\":\"hello\"}");
            expect(log.mock.calls.flat().join(" ")).not.toMatch(/Unexpected scout/);
        }
        finally {
            delete process.env.DEBUG;
            log.mockRestore();
        }
    });

    it("tracks when the driver went UP", () => {
        expect(conn.up_since).toBeNull();
        broker.send("status", undefined, "UP");
        expect(conn.up_since).toBeGreaterThan(Date.now() - 1000);
        broker.send("status", undefined, "CONN");
        expect(conn.up_since).toBeNull();
    });

    it("cancels a running scan before it sends a new conf", async () => {
        const svc = new FakeServices();
        const quiet = jest.spyOn(console, "error").mockImplementation(() => {});
        const mgr = new ScoutManager({
            fplus: svc.fplus(), broker: broker as unknown as DriverBroker,
            node: "11111111-2222-4333-8444-555555555555", env: {}, timing: TIMING, schemas,
        });
        try {
            const uuid = "00000000-0000-4000-8000-000000000001";
            mgr.add_connection(uuid, conn);
            await mgr.init();
            broker.send("status", undefined, "UP");
            broker.subscribed.add(ID);
            broker.send("found", "hello", JSON.stringify({ seq: 0, type: "hello", versions: [1], supported: true }));
            mgr.request({ version: 1, op: "start", connection: uuid,
                request: "00000000-0000-4000-9000-000000000001" });
            await until(() => broker.of("scout").length > 0, "start");
            const start = JSON.parse(broker.of("scout")[0].payload.toString());
            expect(start.op).toBe("start");

            broker.sent = [];
            broker.send("status", undefined, "READY");
            expect(broker.sent.map(p => p.msg)).toEqual(["scout", "conf", "addr"]);
            expect(JSON.parse(broker.sent[0].payload.toString())).toEqual({ op: "cancel", id: start.id });
            await until(() => svc.status(uuid)?.state == "failed", "interrupted");
            expect(svc.status(uuid).code).toBe("INTERRUPTED");
        }
        finally {
            await mgr.stop();
            quiet.mockRestore();
        }
    });
});

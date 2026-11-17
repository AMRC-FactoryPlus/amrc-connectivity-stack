/*
 * ACS Edge Agent
 * Data from a split driver reaches the devices for every address,
 * including the empty one the UDP connection uses, and messages that
 * arrive together reach them as one data event
 * Copyright 2026 University of Sheffield
 */

import { DriverConnection } from "../../../lib/devices/driver";
import { DriverBroker } from "../../../lib/driverBroker";

const ID = "udp";

class FakeBroker {
    listener?: (m: any) => void;
    sent: any[] = [];
    on (_ev: string, l: (m: any) => void) { this.listener = l; }
    off (_ev: string, l: (m: any) => void) {
        if (this.listener === l) this.listener = undefined;
    }
    publish (p: any) { this.sent.push(p); }
    send (msg: string, data: string | undefined, payload: Buffer | string) {
        this.listener?.({ id: ID, msg, data, payload: Buffer.from(payload) });
    }
}

/* The end of this turn of the event loop. */
const turn = () => new Promise(r => setImmediate(r));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/* A data event as plain values, for comparing. */
const plain = (obj: any) => Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k, (v as Buffer).toString()]));

describe("DriverConnection data", () => {
    let broker: FakeBroker;
    let conn: DriverConnection;
    let got: any[];
    let groups: any[];
    let events: string[];

    function connect () {
        broker = new FakeBroker();
        conn = new DriverConnection("Driver", {}, ID, broker as unknown as DriverBroker);
        conn.open();
        got = [];
        groups = [];
        events = [];
        conn.on("data", (obj, parseVals, group) => {
            got.push(plain(obj));
            groups.push(group);
            events.push("data");
            expect(parseVals).toBe(true);
        });
        conn.on("open", () => events.push("open"));
        conn.on("close", () => events.push("close"));
        for (const [topic, addr] of [["17", ""], ["18", "a/b"], ["19", "c"], ["20", "d"]]) {
            conn.addrs.set(topic, addr);
            conn.topics.set(addr, topic);
        }
    }

    beforeEach(connect);
    afterEach(() => {
        delete process.env.DRIVER_DATA_WAIT_MS;
        conn.close();
    });

    it("delivers data for the empty address", async () => {
        broker.send("data", "17", "datagram");
        await turn();
        expect(got).toEqual([{ "": "datagram" }]);
    });

    it("delivers data for other addresses", async () => {
        broker.send("data", "18", "x");
        await turn();
        expect(got).toEqual([{ "a/b": "x" }]);
    });

    it("drops data for a topic not in the map", async () => {
        broker.send("data", "99", "x");
        await turn();
        expect(got).toEqual([]);
    });

    it("hands a burst on to the devices as one event, in arrival order", async () => {
        broker.send("data", "19", "1");
        broker.send("data", "17", "2");
        broker.send("data", "18", "3");
        expect(got).toEqual([]);
        await turn();
        expect(got).toEqual([{ "c": "1", "": "2", "a/b": "3" }]);
        expect(Object.keys(got[0])).toEqual(["c", "", "a/b"]);
    });

    it("says when each message of a group arrived", async () => {
        const before = Date.now();
        broker.send("data", "19", "1");
        await sleep(15);
        broker.send("data", "20", "2");
        const after = Date.now();
        await turn();

        /* Nothing waited past the turn, so 15 ms apart is two groups. */
        expect(got).toEqual([{ c: "1" }, { d: "2" }]);
        const [c] = Object.values(groups[0].received) as any[];
        const [d] = Object.values(groups[1].received) as any[];
        expect(c.ms).toBeGreaterThanOrEqual(before);
        expect(d.ms).toBeLessThanOrEqual(after);
        expect(d.ms - c.ms).toBeGreaterThanOrEqual(14);
        expect(Number(d.ns - c.ns) / 1e6).toBeGreaterThanOrEqual(14);
    });

    it("sends the group first when an address comes again, so no value is lost", async () => {
        broker.send("data", "19", "1");
        broker.send("data", "20", "1");
        broker.send("data", "19", "2");
        /* The repeat sent the first group at once. */
        expect(got).toEqual([{ c: "1", d: "1" }]);
        broker.send("data", "19", "3");
        expect(got).toEqual([{ c: "1", d: "1" }, { c: "2" }]);
        await turn();
        expect(got).toEqual([{ c: "1", d: "1" }, { c: "2" }, { c: "3" }]);
    });

    it("hands data on before a status change that follows it", async () => {
        broker.send("status", undefined, "READY");
        broker.send("status", undefined, "UP");
        broker.send("data", "19", "1");
        broker.send("status", undefined, "DOWN");
        expect(events).toEqual(["open", "data", "close"]);
    });

    it("hands data on before a write result that follows it", async () => {
        const order: string[] = [];
        conn.on("data", () => order.push("data"));
        broker.send("data", "19", "1");
        const log = jest.spyOn(console, "log").mockImplementation((...a) => {
            order.push(String(a[0]).includes("unknown write") ? "result" : "log");
        });
        try {
            broker.send("result", "nope_1", "");
        }
        finally {
            log.mockRestore();
        }
        expect(order).toEqual(["data", "result"]);
    });

    it("hands data on before a write the agent sends", async () => {
        broker.send("data", "19", "1");
        conn.writeMetrics({ array: [] } as any, () => events.push("written"), "JSON" as any);
        expect(events).toEqual(["data", "written"]);
    });

    it("hands a lone value on at the end of the turn by default", async () => {
        const t0 = process.hrtime.bigint();
        let at = 0n;
        conn.on("data", () => at = process.hrtime.bigint());
        broker.send("data", "19", "1");
        await turn();
        expect(got).toEqual([{ c: "1" }]);
        /* Well under a millisecond on any machine; 20 ms allows for a
         * busy CI runner. */
        expect(Number(at - t0) / 1e6).toBeLessThan(20);
    });

    it("waits at most DRIVER_DATA_WAIT_MS when it is set", async () => {
        process.env.DRIVER_DATA_WAIT_MS = "30";
        connect();
        broker.send("data", "19", "1");
        await sleep(10);
        broker.send("data", "20", "2");
        await turn();
        expect(got).toEqual([]);
        await sleep(40);
        /* Both in one group, sent 30 ms after the first arrived. */
        expect(got).toEqual([{ c: "1", d: "2" }]);
    });

    it("caps DRIVER_DATA_WAIT_MS at 100 ms", async () => {
        process.env.DRIVER_DATA_WAIT_MS = "100000";
        connect();
        broker.send("data", "19", "1");
        await sleep(150);
        expect(got).toEqual([{ c: "1" }]);
    });

    it("drops waiting data on close and leaves no timer running", async () => {
        jest.useFakeTimers("modern");
        try {
            for (const wait of ["0", "30"]) {
                process.env.DRIVER_DATA_WAIT_MS = wait;
                connect();
                broker.send("data", "19", "1");
                expect(jest.getTimerCount()).toBe(1);
                conn.close();
                expect(jest.getTimerCount()).toBe(0);
                jest.runAllTimers();
                expect(got).toEqual([]);

                /* And the connection hears nothing more. */
                broker.send("data", "19", "2");
                expect(jest.getTimerCount()).toBe(0);
            }
        }
        finally {
            jest.useRealTimers();
        }
    });
});

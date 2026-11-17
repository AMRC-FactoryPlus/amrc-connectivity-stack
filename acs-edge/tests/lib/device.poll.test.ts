/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/* When a connection polls its devices. A device polls at its poll
 * interval, and a device with no interval doesn't poll at all: an
 * undefined interval used to make setInterval read every millisecond,
 * which for a split driver meant a poll message each time. */

import { DeviceConnection } from "../../lib/device";
import { DriverConnection } from "../../lib/devices/driver";
import { DriverBroker } from "../../lib/driverBroker";
import { Metrics, serialisationType } from "../../lib/helpers/typeHandler";

const ID = "drv";

/* A connection that counts its reads. */
class Counting extends DeviceConnection {
    reads = 0;
    readMetrics () { this.reads++; }
}

class FakeBroker {
    sent: any[] = [];
    listener?: (m: any) => void;
    on (_ev: string, l: (m: any) => void) { this.listener = l; }
    off () {}
    publish (p: any) { this.sent.push(p); }
    status (st: string) {
        this.listener!({ id: ID, msg: "status", payload: Buffer.from(st) });
    }
    polls () { return this.sent.filter(p => p.msg == "poll"); }
}

const metrics = (addresses: string[]) => ({ addresses } as unknown as Metrics);
const FORMAT = serialisationType.JSON;

async function start (conn: DeviceConnection, interval: any, device = "dev") {
    await conn.startSubscription(metrics(["a/1", "a/2"]), FORMAT, "",
        interval, device, () => {});
}
const stop = (conn: DeviceConnection, device = "dev") =>
    conn.stopSubscription(device, () => {});

async function driver () {
    const broker = new FakeBroker();
    const conn = new DriverConnection("Driver", {}, ID, broker as unknown as DriverBroker);
    conn.open();
    broker.status("READY");
    return { broker, conn };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("DeviceConnection polling", () => {
    test.each([
        ["undefined", undefined],
        ["null", null],
        ["zero", 0],
        ["negative", -5],
        ["not a number", NaN],
    ])("a device with an interval of %s doesn't poll", async (_name, interval) => {
        const conn = new Counting("Test");
        await start(conn, interval);
        jest.advanceTimersByTime(5000);
        expect(conn.reads).toBe(0);
        expect(jest.getTimerCount()).toBe(0);
    });

    test("a device with an interval polls at that interval", async () => {
        const conn = new Counting("Test");
        await start(conn, 250);
        jest.advanceTimersByTime(1000);
        expect(conn.reads).toBe(4);
    });

    test("stopping a subscription leaves no timer", async () => {
        const conn = new Counting("Test");
        await start(conn, 250, "a");
        await start(conn, undefined, "b");
        expect(jest.getTimerCount()).toBe(1);
        await stop(conn, "a");
        await stop(conn, "b");
        expect(jest.getTimerCount()).toBe(0);
        jest.advanceTimersByTime(1000);
        expect(conn.reads).toBe(0);
    });
});

describe("DriverConnection polling", () => {
    test("no poll is sent for a device with no interval", async () => {
        const { broker, conn } = await driver();
        await start(conn, undefined);
        jest.advanceTimersByTime(5000);
        expect(broker.polls()).toEqual([]);
    });

    test("a polled device sends one poll per interval", async () => {
        const { broker, conn } = await driver();
        await start(conn, 500);
        jest.advanceTimersByTime(2000);
        expect(broker.polls().length).toBe(4);
        const [poll] = broker.polls();
        expect(poll.id).toBe(ID);
        expect(String(poll.payload).split("\n").length).toBe(2);
    });

    test("stopping a polled device stops its polls", async () => {
        const { broker, conn } = await driver();
        await start(conn, 500);
        jest.advanceTimersByTime(1000);
        await stop(conn);
        const sent = broker.polls().length;
        jest.advanceTimersByTime(5000);
        expect(broker.polls().length).toBe(sent);
        expect(jest.getTimerCount()).toBe(0);
    });
});

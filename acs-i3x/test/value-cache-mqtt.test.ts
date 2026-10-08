/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * The ValueCache's MQTT handling: it subscribes to the UNS itself on
 * every connect (the client is created with resubscribe off), checks
 * each SUBACK, and exits through its watchdogs when UNS data stops or
 * the client stays without a granted subscription.
 */

import { EventEmitter } from "node:events";
import { jest, describe, it, expect, afterEach } from "@jest/globals";
import { ValueCache } from "../lib/value-cache.js";
import { I3xStore } from "../lib/store.js";

/** The meta key ValueCache records the time values were current in.
 * It is written only while live. */
const CURRENT_UNTIL = "values_current_until";

type SubackCb = (err: any, granted: any) => void;

/** A fake MQTT client. Events are fired by the test; every SUBSCRIBE
 * is recorded with its callback, so the test can answer it. */
function fakeMqtt() {
    const mqtt = Object.assign(new EventEmitter(), {
        connected: false,
        subscribes: [] as { topic: string; cb: SubackCb }[],
        subscribe(topic: string, cb: SubackCb) {
            this.subscribes.push({ topic, cb });
        },
    });
    const mqtt_client = jest.fn(async (_opts?: any) => mqtt);
    return {
        mqtt,
        mqtt_client,
        fplus: { mqtt_client, debug: { bound: () => () => {} } },
        connect() {
            mqtt.connected = true;
            mqtt.emit("connect", {});
        },
        close() {
            mqtt.connected = false;
            mqtt.emit("close");
        },
        /** Answer the most recent SUBSCRIBE. */
        suback(err: any, granted: any) {
            mqtt.subscribes[mqtt.subscribes.length - 1].cb(err, granted);
        },
        message(topic = "UNS/v1/Ent/Edge/dev/Temp") {
            mqtt.emit("message", topic, Buffer.from("{}"), {});
        },
        /** A packet that is not a message, such as a ping response. */
        ping() {
            mqtt.emit("packetreceive", { cmd: "pingresp" });
        },
    };
}

function mockTree() {
    return {
        addCompositionFromUns: () => null,
        getObject: () => undefined,
        getChildElementIds: () => [],
        isReady: () => true,
    };
}

const GRANTED = [{ topic: "UNS/v1/#", qos: 0 }];

async function setup(opts: { stallTimeout?: number; connectTimeout?: number } = {}) {
    const fatal = jest.fn<(msg: string) => void>();
    const store = new I3xStore();
    const cache = new ValueCache({
        objectTree: mockTree() as any,
        staleThreshold: 300_000,
        store,
        fatal,
        subscribeRetry: 5_000,
        currentInterval: 1_000,
        ...opts,
    });
    const f = fakeMqtt();
    await cache.init(f.fplus);
    /** True once the cache has recorded its values as current, which
     * it does only while live. */
    const recordedCurrent = () => store.getMeta(CURRENT_UNTIL) !== undefined;
    return { cache, fatal, store, recordedCurrent, ...f };
}

afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});

describe("ValueCache MQTT subscription", () => {
    it("creates the MQTT client with resubscribe off", async () => {
        const { mqtt_client } = await setup();
        expect(mqtt_client).toHaveBeenCalledWith(expect.objectContaining({ resubscribe: false }));
    });

    it("does not subscribe before the client connects", async () => {
        const { mqtt } = await setup();
        expect(mqtt.subscribes).toEqual([]);
    });

    it("subscribes to UNS/v1/# with a SUBACK callback on every connect", async () => {
        /* The failure this guards against: after a broker restart the
         * client reconnected, but the subscription was not
         * re-established and no UNS message arrived again. */
        const f = await setup();
        f.connect();
        f.suback(null, GRANTED);
        f.close();
        f.connect();
        f.suback(null, GRANTED);
        f.close();
        f.connect();
        expect(f.mqtt.subscribes.map(s => s.topic))
            .toEqual(["UNS/v1/#", "UNS/v1/#", "UNS/v1/#"]);
        for (const s of f.mqtt.subscribes)
            expect(typeof s.cb).toBe("function");
        expect(f.fatal).not.toHaveBeenCalled();
    });

    it("skips the subscribe if the connection has already dropped", async () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        const f = await setup();
        f.mqtt.connected = false;
        f.mqtt.emit("connect", {});
        expect(f.mqtt.subscribes).toEqual([]);
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/before subscribing/));
    });

    it("exits when the broker refuses the subscription (reason code on the error)", async () => {
        const f = await setup();
        f.connect();
        f.suback(Object.assign(new Error("Subscribe error: Not authorized"), { code: 0x87 }), GRANTED);
        expect(f.fatal).toHaveBeenCalledTimes(1);
        expect(f.fatal.mock.calls[0][0]).toMatch(/refused the UNS subscription.*0x87/);
    });

    it("exits when the broker refuses the subscription (ErrorWithSubackPacket)", async () => {
        /* Newer MQTT.js 5 releases put the reason codes in the SUBACK
         * packet and set no `code`. */
        const f = await setup();
        f.connect();
        f.suback(Object.assign(new Error("Subscribe error: Not authorized"),
            { packet: { cmd: "suback", granted: [0x87] } }), GRANTED);
        expect(f.fatal).toHaveBeenCalledTimes(1);
        expect(f.fatal.mock.calls[0][0]).toMatch(/0x87/);
    });

    it("exits when the granted list holds a failure code", async () => {
        const f = await setup();
        f.connect();
        f.suback(null, [{ topic: "UNS/v1/#", qos: 0x80 }]);
        expect(f.fatal).toHaveBeenCalledTimes(1);
        expect(f.fatal.mock.calls[0][0]).toMatch(/0x80/);
    });

    it("logs an empty SUBACK as unconfirmed and does not exit", async () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        const f = await setup();
        f.connect();
        f.suback(null, []);
        expect(f.fatal).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith(
            expect.stringMatching(/not confirmed/), "no SUBACK entries returned", 5);
    });

    it("logs a connection closed before the SUBACK as unconfirmed", async () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        const f = await setup();
        f.connect();
        f.suback(new Error("Connection closed"), undefined);
        expect(f.fatal).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/not confirmed/), "Connection closed", 5);
    });

    it("subscribes again on the same connection after an unconfirmed SUBACK", async () => {
        jest.useFakeTimers();
        jest.spyOn(console, "warn").mockImplementation(() => {});
        const f = await setup();
        f.connect();
        f.suback(null, []);
        expect(f.mqtt.subscribes).toHaveLength(1);
        jest.advanceTimersByTime(4_999);
        expect(f.mqtt.subscribes).toHaveLength(1);
        jest.advanceTimersByTime(1);
        expect(f.mqtt.subscribes).toHaveLength(2);
        f.suback(null, GRANTED);
        expect(f.recordedCurrent()).toBe(true);
    });

    it("does not retry on a connection that has since closed", async () => {
        jest.useFakeTimers();
        jest.spyOn(console, "warn").mockImplementation(() => {});
        const f = await setup();
        f.connect();
        f.suback(null, []);
        f.close();
        jest.advanceTimersByTime(60_000);
        expect(f.mqtt.subscribes).toHaveLength(1);
        /* The next connect subscribes. */
        f.connect();
        expect(f.mqtt.subscribes).toHaveLength(2);
    });
});

describe("ValueCache goes live only on a granted SUBACK", () => {
    it("is not live after connect alone", async () => {
        jest.useFakeTimers();
        const f = await setup();
        f.connect();
        jest.advanceTimersByTime(10_000);
        expect(f.recordedCurrent()).toBe(false);
        f.suback(null, GRANTED);
        expect(f.recordedCurrent()).toBe(true);
    });

    it("is not live after an unconfirmed SUBACK", async () => {
        jest.useFakeTimers();
        jest.spyOn(console, "warn").mockImplementation(() => {});
        const f = await setup();
        f.connect();
        f.suback(null, []);
        jest.advanceTimersByTime(4_000);
        expect(f.recordedCurrent()).toBe(false);
    });

    it("is not live after a refused SUBACK", async () => {
        jest.useFakeTimers();
        const f = await setup();
        f.connect();
        f.suback(Object.assign(new Error("Not authorized"), { code: 0x87 }), GRANTED);
        jest.advanceTimersByTime(10_000);
        expect(f.recordedCurrent()).toBe(false);
    });

    it("ignores a granted SUBACK from an earlier connection", async () => {
        jest.useFakeTimers();
        const f = await setup();
        f.connect();
        const first = f.mqtt.subscribes[0];
        f.close();
        f.connect();
        first.cb(null, GRANTED);
        jest.advanceTimersByTime(10_000);
        expect(f.recordedCurrent()).toBe(false);
        f.suback(null, GRANTED);
        expect(f.recordedCurrent()).toBe(true);
    });
});

describe("ValueCache stall watchdog", () => {
    it("never fires on a site with no UNS traffic", async () => {
        jest.useFakeTimers();
        const f = await setup({ stallTimeout: 10_000 });
        f.connect();
        f.suback(null, GRANTED);
        jest.advanceTimersByTime(10 * 60_000);
        expect(f.fatal).not.toHaveBeenCalled();
    });

    it("does not fire while UNS messages keep arriving", async () => {
        jest.useFakeTimers();
        const f = await setup({ stallTimeout: 10_000 });
        f.connect();
        f.suback(null, GRANTED);
        for (let n = 0; n < 30; n++) {
            f.message();
            jest.advanceTimersByTime(5_000);
        }
        expect(f.fatal).not.toHaveBeenCalled();
    });

    it("arms on the first message and fires once UNS messages stop", async () => {
        jest.useFakeTimers();
        const f = await setup({ stallTimeout: 10_000 });
        f.connect();
        f.suback(null, GRANTED);
        /* A long quiet start does not count. */
        jest.advanceTimersByTime(60_000);
        f.message();
        jest.advanceTimersByTime(5_000);
        f.message();
        jest.advanceTimersByTime(9_000);
        expect(f.fatal).not.toHaveBeenCalled();
        jest.advanceTimersByTime(2_000);
        expect(f.fatal).toHaveBeenCalledTimes(1);
        expect(f.fatal.mock.calls[0][0]).toMatch(/No UNS messages received.*STALL_TIMEOUT 10s/);
        /* Once only. */
        jest.advanceTimersByTime(60_000);
        expect(f.fatal).toHaveBeenCalledTimes(1);
    });

    it("records the values as current only up to the last UNS message", async () => {
        /* Ping responses keep the link looking alive while no UNS
         * message arrives. The catch-up after the restart must cover
         * that silent period. */
        jest.useFakeTimers();
        const f = await setup({ stallTimeout: 10_000 });
        f.connect();
        f.suback(null, GRANTED);
        f.message();
        const lastMessage = Date.now();
        for (let n = 0; n < 15; n++) {
            jest.advanceTimersByTime(1_000);
            f.ping();
        }
        expect(f.fatal).toHaveBeenCalledTimes(1);
        expect(Number(f.store.getMeta(CURRENT_UNTIL))).toBeLessThanOrEqual(lastMessage);
        /* Not moved on again afterwards. */
        jest.advanceTimersByTime(5_000);
        f.ping();
        jest.advanceTimersByTime(5_000);
        expect(Number(f.store.getMeta(CURRENT_UNTIL))).toBeLessThanOrEqual(lastMessage);
    });

    it("is off by default", async () => {
        jest.useFakeTimers();
        const f = await setup();
        f.connect();
        f.message();
        jest.advanceTimersByTime(24 * 3600_000);
        expect(f.fatal).not.toHaveBeenCalled();
    });
});

describe("ValueCache connection watchdog", () => {
    it("fires if the client never connects", async () => {
        jest.useFakeTimers();
        const f = await setup({ connectTimeout: 10_000 });
        jest.advanceTimersByTime(12_000);
        expect(f.fatal).toHaveBeenCalledTimes(1);
        expect(f.fatal.mock.calls[0][0]).toMatch(/no MQTT connection with a granted UNS subscription/);
    });

    it("fires if connected but the subscription is never granted", async () => {
        jest.useFakeTimers();
        jest.spyOn(console, "warn").mockImplementation(() => {});
        const f = await setup({ connectTimeout: 10_000 });
        f.connect();
        f.suback(null, []);
        jest.advanceTimersByTime(12_000);
        expect(f.fatal).toHaveBeenCalledTimes(1);
        expect(f.fatal.mock.calls[0][0]).toMatch(/no MQTT connection with a granted UNS subscription/);
    });

    it("fires if a connection stays open with unconfirmed SUBACKs", async () => {
        jest.useFakeTimers();
        jest.spyOn(console, "warn").mockImplementation(() => {});
        const f = await setup({ connectTimeout: 10_000 });
        f.connect();
        for (let n = 0; n < 3; n++) {
            f.suback(null, []);
            jest.advanceTimersByTime(5_000);
        }
        expect(f.mqtt.subscribes.length).toBeGreaterThan(1);
        expect(f.fatal).toHaveBeenCalledTimes(1);
    });

    it("counts the client as disconnected on offline", async () => {
        jest.useFakeTimers();
        jest.spyOn(console, "warn").mockImplementation(() => {});
        const f = await setup({ connectTimeout: 10_000 });
        f.connect();
        f.suback(null, GRANTED);
        f.mqtt.emit("offline");
        jest.advanceTimersByTime(12_000);
        expect(f.fatal).toHaveBeenCalledTimes(1);
    });

    it("counts the client as disconnected on end", async () => {
        jest.useFakeTimers();
        jest.spyOn(console, "warn").mockImplementation(() => {});
        const f = await setup({ connectTimeout: 10_000 });
        f.connect();
        f.suback(null, GRANTED);
        f.mqtt.emit("end");
        jest.advanceTimersByTime(12_000);
        expect(f.fatal).toHaveBeenCalledTimes(1);
    });

    it("does not fire while connected and subscribed, however quiet", async () => {
        jest.useFakeTimers();
        const f = await setup({ connectTimeout: 10_000 });
        f.connect();
        f.suback(null, GRANTED);
        jest.advanceTimersByTime(60 * 60_000);
        expect(f.fatal).not.toHaveBeenCalled();
    });

    it("fires if a reconnect does not get the subscription back", async () => {
        jest.useFakeTimers();
        jest.spyOn(console, "warn").mockImplementation(() => {});
        const f = await setup({ connectTimeout: 10_000 });
        f.connect();
        f.suback(null, GRANTED);
        jest.advanceTimersByTime(60_000);
        f.close();
        f.connect();
        /* No SUBACK on the new connection. */
        jest.advanceTimersByTime(12_000);
        expect(f.fatal).toHaveBeenCalledTimes(1);
    });

    it("ignores a SUBACK from an earlier connection", async () => {
        jest.useFakeTimers();
        jest.spyOn(console, "warn").mockImplementation(() => {});
        const f = await setup({ connectTimeout: 10_000 });
        f.connect();
        const first = f.mqtt.subscribes[0];
        f.close();
        f.connect();
        first.cb(null, GRANTED);
        jest.advanceTimersByTime(12_000);
        expect(f.fatal).toHaveBeenCalledTimes(1);
    });

    it("recovers when a reconnect is subscribed again in time", async () => {
        jest.useFakeTimers();
        jest.spyOn(console, "warn").mockImplementation(() => {});
        const f = await setup({ connectTimeout: 10_000 });
        f.connect();
        f.suback(null, GRANTED);
        f.close();
        jest.advanceTimersByTime(5_000);
        f.connect();
        f.suback(null, GRANTED);
        jest.advanceTimersByTime(60_000);
        expect(f.fatal).not.toHaveBeenCalled();
    });
});

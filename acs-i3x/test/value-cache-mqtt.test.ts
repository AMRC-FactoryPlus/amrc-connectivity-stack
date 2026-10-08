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
    const cache = new ValueCache({
        objectTree: mockTree() as any,
        staleThreshold: 300_000,
        fatal,
        ...opts,
    });
    const f = fakeMqtt();
    await cache.init(f.fplus);
    return { cache, fatal, ...f };
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
            expect.stringMatching(/not confirmed/), "no SUBACK entries returned");
    });

    it("logs a connection closed before the SUBACK as unconfirmed", async () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        const f = await setup();
        f.connect();
        f.suback(new Error("Connection closed"), undefined);
        expect(f.fatal).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/not confirmed/), "Connection closed");
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
        expect(f.fatal.mock.calls[0][0]).toMatch(/not connected to the MQTT broker/);
    });

    it("fires if connected but the subscription is never granted", async () => {
        jest.useFakeTimers();
        jest.spyOn(console, "warn").mockImplementation(() => {});
        const f = await setup({ connectTimeout: 10_000 });
        f.connect();
        f.suback(null, []);
        jest.advanceTimersByTime(12_000);
        expect(f.fatal).toHaveBeenCalledTimes(1);
        expect(f.fatal.mock.calls[0][0]).toMatch(/no subscription has been granted/);
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

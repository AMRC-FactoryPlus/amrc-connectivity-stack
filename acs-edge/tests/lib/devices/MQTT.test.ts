/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

/* The built-in MQTT connection, with the mqtt library mocked. These
 * tests were written for an older connection that connected in open()
 * and emitted asyncData. It now connects in the constructor and emits
 * data keyed by topic. They pin the behaviour the MQTT split driver has
 * to match. */

import {MQTTConnection} from "../../../lib/devices/MQTT";
import mqttConnDetails from "../../../lib/devices/MQTT";
jest.mock('mqtt');
import * as mqtt from "mqtt";
import { EventEmitter } from "events";
import * as log from '../../../lib/helpers/log';
import {Metrics, serialisationType, sparkplugDataType} from "../../../lib/helpers/typeHandler";

class Client extends EventEmitter {
    subscribeAsync = jest.fn(async (topics: string[]) =>
        topics.map(topic => ({ topic, qos: 0 })));
    unsubscribeAsync = jest.fn(async () => {});
    publish = jest.fn();
    end = jest.fn();
}

const type = "MQTT";
const connectionDetails: mqttConnDetails = {
    clientId: "id",
    protocol: "mqtt",
    host: "host",
    port: 1883,
    cleanSession: true,
    keepAlive: 12
};

function setup (details: Partial<mqttConnDetails> = {}) {
    const client = new Client();
    const connect = mqtt.connect as jest.Mock;
    connect.mockImplementation(() => client);
    const conn = new MQTTConnection(type, { ...connectionDetails, ...details });
    return { client, conn, connect };
}

function metric (name: string, address: string, value: any) {
    return {
        name, type: sparkplugDataType.int32, value,
        properties: {
            method: { type: sparkplugDataType.string, value: "GET" },
            address: { type: sparkplugDataType.string, value: address },
            path: { type: sparkplugDataType.string, value: "$.v" },
        },
    };
}

afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
});

describe("MQTTConnection", () => {

    describe("constructor", () => {
        it("connects to protocol://host:port with the connection's options", () => {
            const { connect } = setup({ username: "u", password: "p" });
            expect(connect).toHaveBeenCalledTimes(1);
            const [url, opts] = connect.mock.calls[0];
            expect(url).toBe("mqtt://host:1883");
            expect(opts).toMatchObject({
                clientId: "id", username: "u", password: "p",
                clean: true, keepalive: 12,
                connectTimeout: 5000, reconnectPeriod: 10000,
            });
        });

        it("sends no credentials without a username", () => {
            const { connect } = setup({ password: "p" });
            const [, opts] = connect.mock.calls[0];
            expect(opts.username).toBeUndefined();
            expect(opts.password).toBeUndefined();
        });

        it("makes up a client ID when there is none", () => {
            const { connect } = setup({ clientId: "" });
            expect(connect.mock.calls[0][1].clientId).toMatch(/^NO-ID-/);
        });
    });

    describe("events", () => {
        it("Should emit open when the client connects", () => {
            const logSpy = jest.spyOn(log, 'log');
            const { client, conn } = setup();
            const callback = jest.fn();
            conn.on("open", callback);
            client.emit("connect");
            expect(callback).toBeCalledTimes( 1 );
            expect(logSpy).toBeCalledWith(expect.stringContaining("connected (mqtt://host:1883)"));
        });

        it("should emit data keyed by topic for each message", () => {
            const { client, conn } = setup();
            const data = jest.fn();
            conn.on("data", data);
            const msg = Buffer.alloc(10);
            client.emit("message", "test", msg);
            expect(data).toHaveBeenCalledWith({ test: msg });
        });

        it("should log an error, not throw", () => {
            const logSpy = jest.spyOn(log, 'log');
            const { client } = setup();
            client.emit("error", new Error("test"));
            expect(logSpy).toBeCalledWith(expect.stringContaining("test"));
        });
    });

    describe("readMetrics()", () => {
        it("emits empty data to keep the devices alive", () => {
            const { conn } = setup();
            const data = jest.fn();
            conn.on("data", data);
            conn.readMetrics(new Metrics([]));
            expect(data).toHaveBeenCalledWith({});
        });
    });

    describe("subscribe()", () => {
        it("subscribes to the non-empty topics and returns them", async () => {
            const { client, conn } = setup();
            expect(await conn.subscribe(["a", "", "b/#"])).toEqual(["a", "b/#"]);
            expect(client.subscribeAsync).toHaveBeenCalledWith(["a", "b/#"]);
        });

        it("leaves out and logs topics the broker refused", async () => {
            const logSpy = jest.spyOn(log, 'log');
            const { client, conn } = setup();
            client.subscribeAsync.mockResolvedValueOnce([
                { topic: "a", qos: 0 }, { topic: "b", qos: 128 },
            ]);
            expect(await conn.subscribe(["a", "b"])).toEqual(["a"]);
            expect(logSpy).toBeCalledWith(expect.stringContaining("b"));
        });

        it("unsubscribe takes what subscribe returned", async () => {
            const { client, conn } = setup();
            const handle = await conn.subscribe(["a"]);
            await conn.unsubscribe(handle);
            expect(client.unsubscribeAsync).toHaveBeenCalledWith(["a"]);
        });
    });

    describe("writeMetrics()", () => {
        it("publishes one payload per address and calls back with no error", () => {
            const { client, conn } = setup();
            const done = jest.fn();
            conn.writeMetrics(new Metrics([
                metric("a", "t/a", 1), metric("b", "t/b", 2),
            ] as any), done, serialisationType.JSON);

            expect(client.publish.mock.calls).toEqual([
                ["t/a", JSON.stringify({ v: 1 })],
                ["t/b", JSON.stringify({ v: 2 })],
            ]);
            expect(done).toHaveBeenCalledWith(null);
        });

        it("calls back with an error when a value can't be written", () => {
            jest.spyOn(console, "log").mockImplementation(() => {});
            const { client, conn } = setup();
            const done = jest.fn();
            conn.writeMetrics(new Metrics([metric("a", "t/a", 1)] as any),
                done, serialisationType.XML);
            expect(client.publish).not.toHaveBeenCalled();
            expect(done.mock.calls[0][0]).toBeInstanceOf(Error);
        });
    });

    describe("scoutAddresses()", () => {
        it.each([
            [{ topic: "#", duration: 0 }, /duration/],
            [{ topic: " ", duration: 10 }, /topic/],
        ])("rejects invalid details %o", async (details, msg) => {
            const { conn } = setup();
            await expect(conn.scoutAddresses(details as any)).rejects.toThrow(msg);
        });
    });

    describe('close()', () => {
        it('Should call client.end', async () => {
            const { client, conn } = setup();
            await conn.close();
            expect(client.end).toBeCalledTimes( 1 );
        });
    });
});

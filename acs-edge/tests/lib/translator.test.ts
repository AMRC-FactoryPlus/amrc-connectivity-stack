/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

/* Translator start and stop against fake services. These tests were
 * written for an older Translator that took its config in the
 * constructor; it now fetches its identity and config itself. */

import { EventEmitter } from "events";

import { DriverConnection } from "../../lib/devices/driver";
import { Translator } from "../../lib/translator";

const UUID = "11111111-2222-4333-8444-555555555555";

class FakeClient extends EventEmitter {
    stopped = 0;
    connect () {}
    stop () { this.stopped++; }
    publishNodeBirth () {}
}

class FakeBroker extends EventEmitter {
    started = 0;
    stopped = 0;
    async start () { this.started++; }
    async stop () { this.stopped++; }
    async publish () {}
}

function setup (opts: { config?: any, mqtt?: () => Promise<any> } = {}) {
    const client = new FakeClient();
    const config = opts.config ?? {
        sparkplug: {},
        deviceConnections: [{
            name: "api", connType: "Driver",
            DriverDetails: { baseURL: "http://localhost" },
        }],
    };
    const fplus: any = {
        Auth: {
            find_principal: async () => ({ uuid: UUID, sparkplug: { group: "G", node: "N" } }),
        },
        ConfigDB: {
            get_config_with_etag: async () => [JSON.parse(JSON.stringify(config)), "etag"],
        },
        MQTT: {
            basic_sparkplug_node: opts.mqtt ?? (async () => client),
        },
    };
    const broker = new FakeBroker();
    const translator = new Translator(fplus, 1, broker as any);
    return { translator, broker, client };
}

afterEach(() => jest.restoreAllMocks());

describe("start()", () => {
    test("creates the Sparkplug node, starts the broker and sets up each connection", async () => {
        const { translator, broker } = setup();
        const stop = jest.spyOn(translator, "stop");

        await translator.start();

        expect(translator.sparkplugNode).toBeDefined();
        expect(broker.started).toBe(1);
        expect(translator.connections.Driver).toBeInstanceOf(DriverConnection);
        expect(stop).not.toHaveBeenCalled();
    });

    test("stops the translator if it can't start", async () => {
        jest.spyOn(console, "error").mockImplementation(() => {});
        const { translator } = setup({
            mqtt: async () => { throw new Error("no broker"); },
        });
        const stop = jest.spyOn(translator, "stop");
        const stopped = jest.fn();
        translator.on("stopped", stopped);

        await translator.start();

        expect(stop).toHaveBeenCalledTimes(1);
        expect(stopped).toHaveBeenCalledWith(false);
    });

    test("an empty config starts with no connections", async () => {
        const { translator, broker } = setup({ config: { sparkplug: {}, deviceConnections: [] } });
        await translator.start();
        expect(broker.started).toBe(1);
        expect(translator.connections).toEqual({});
    });
});

describe("stop()", () => {
    test("closes connections, stops the broker and the Sparkplug node, and says so", async () => {
        const { translator, broker, client } = setup();
        await translator.start();
        const close = jest.spyOn(translator.connections.Driver, "close");
        const stopped = jest.fn();
        translator.on("stopped", stopped);

        await translator.stop(true);

        expect(close).toHaveBeenCalledTimes(1);
        expect(broker.stopped).toBe(1);
        expect(client.stopped).toBe(1);
        expect(translator.abort.signal.aborted).toBe(true);
        expect(stopped).toHaveBeenCalledWith(true);
    });

    test("a reload request from the Sparkplug node stops the translator", async () => {
        const { translator, client } = setup();
        await translator.start();
        const stop = jest.spyOn(translator, "stop");

        client.emit("ncmd", { metrics: [{ name: "Node Control/Reload Edge Agent Config", value: true }] });
        await new Promise(r => setImmediate(r));

        expect(stop).toHaveBeenCalledTimes(1);
    });
});

/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

/* End-to-end check of the in-process config reload in app.ts. The
 * agent runs for real (translator, driver broker, driver connection)
 * against a stub ServiceClient, and a real MQTT driver connects to it.
 * Receiving "Node Control/Reload Edge Agent Config" must restart the
 * agent on the same driver port with the new config. */

import fs from "fs";
import net from "net";
import os from "os";
import path from "path";

import * as mqtt from "mqtt";

/* Shared with the jest.mock factories below, which may only reference
 * variables prefixed with "mock". */
const mockState = {
    configs: [] as any[],
    fetches: 0,
    nodes: [] as any[],
};

jest.mock("@amrc-factoryplus/utilities", () => {
    const { EventEmitter } = require("events");
    class StubSparkplugNode extends EventEmitter {
        stopped = false;
        connect () {}
        stop () { this.stopped = true; }
    }
    class ServiceClient {
        async init () { return this; }
        Auth = {
            find_principal: async () => ({
                uuid: "11111111-1111-4111-8111-111111111111",
                sparkplug: { group: "G", node: "N", toString: () => "G/N" },
            }),
        };
        ConfigDB = {
            get_config_with_etag: async () => {
                const i = Math.min(mockState.fetches++, mockState.configs.length - 1);
                return [JSON.parse(JSON.stringify(mockState.configs[i])), `etag-${i}`];
            },
        };
        MQTT = {
            basic_sparkplug_node: async () => {
                const node = new StubSparkplugNode();
                mockState.nodes.push(node);
                return node;
            },
        };
    }
    return { ServiceClient };
});

function driverConfig (marker: string) {
    return {
        sparkplug: {},
        deviceConnections: [{
            connType: "Driver",
            name: "drv",
            DriverDetails: { marker },
            devices: [],
        }],
    };
}

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

async function until (cond: () => boolean, what: string, ms = 10_000) {
    const end = Date.now() + ms;
    while (!cond()) {
        if (Date.now() > end)
            throw new Error(`Timed out waiting for ${what}`);
        await new Promise(r => setTimeout(r, 10));
    }
}

describe("config reload", () => {
    let passwords: string;
    let drv: mqtt.MqttClient | undefined;

    beforeAll(() => {
        passwords = fs.mkdtempSync(path.join(os.tmpdir(), "driver-pw-"));
        fs.writeFileSync(path.join(passwords, "drv"), "secret");
    });

    afterAll(async () => {
        await new Promise(r => drv ? drv.end(true, {}, r) : r(undefined));
        fs.rmSync(passwords, { recursive: true, force: true });
    });

    it("restarts in-process on the same driver port with the new config", async () => {
        const port = await freePort();
        process.env.EDGE_MQTT = `mqtt://localhost:${port}`;
        process.env.EDGE_PASSWORDS = passwords;
        mockState.configs = [driverConfig("v1"), driverConfig("v2")];

        const uncaught: unknown[] = [];
        const onUncaught = (e: unknown) => uncaught.push(e);
        process.on("uncaughtException", onUncaught);
        let sigterm = 0;
        let terminated = false;

        try {
            jest.isolateModules(() => { require("../app"); });
            await until(() => mockState.nodes.length == 1, "agent to start");
            /* Loading the agent's modules registers other SIGTERM
             * listeners too; only the count's growth matters. */
            sigterm = process.listenerCount("SIGTERM");

            /* A driver connects and asks for its config. It
             * re-announces itself on every (re)connect, as real
             * drivers do. */
            const confs: string[] = [];
            drv = mqtt.connect(`mqtt://localhost:${port}`, {
                clientId: "drv", username: "drv", password: "secret",
                reconnectPeriod: 100,
            });
            drv.on("message", (_t, p) => confs.push(JSON.parse(p.toString()).marker));
            drv.on("connect", () => {
                drv!.subscribe("fpEdge1/drv/conf", () =>
                    drv!.publish("fpEdge1/drv/status", "READY"));
            });
            await until(() => confs.length == 1, "first config");
            expect(confs).toEqual(["v1"]);

            /* acs-monitor sends this when the config changes. */
            mockState.nodes[0].emit("ncmd", { metrics: [{
                name: "Node Control/Reload Edge Agent Config", value: true,
            }] });

            await until(() => confs.length == 2, "config after reload");
            expect(confs).toEqual(["v1", "v2"]);
            expect(mockState.fetches).toBe(2);
            expect(mockState.nodes).toHaveLength(2);
            expect(mockState.nodes[0].stopped).toBe(true);
            expect(uncaught).toEqual([]);

            /* One SIGTERM handler, for the current agent, which
             * shuts down without restarting and frees the port. */
            expect(process.listenerCount("SIGTERM")).toBe(sigterm);
            await new Promise(r => drv!.end(true, {}, r));
            drv = undefined;
            terminated = true;
            process.emit("SIGTERM" as any);
            await until(() => mockState.nodes[1].stopped, "agent to stop");

            const probe = net.createServer();
            await new Promise<void>((resolve, reject) => {
                probe.once("error", reject);
                probe.listen(port, "localhost", () => resolve());
            });
            await new Promise(r => probe.close(r));
            expect(mockState.fetches).toBe(2);
            expect(uncaught).toEqual([]);
        }
        finally {
            if (!terminated) process.emit("SIGTERM" as any);
            process.off("uncaughtException", onUncaught);
        }
    }, 30_000);

    it("loads the config once a missing secret is mounted", async () => {
        const port = await freePort();
        const secrets = fs.mkdtempSync(path.join(os.tmpdir(), "fpsi-"));
        const token = "__FPSI__" + "0123456789abcdef0123456789abcdef";
        process.env.EDGE_MQTT = `mqtt://localhost:${port}`;
        process.env.EDGE_PASSWORDS = passwords;
        process.env.SECRETS_PATH = secrets;
        mockState.configs = [driverConfig(token)];
        mockState.fetches = 0;
        mockState.nodes = [];

        const uncaught: unknown[] = [];
        const onUncaught = (e: unknown) => uncaught.push(e);
        process.on("uncaughtException", onUncaught);
        const errors = jest.spyOn(console, "error").mockImplementation(() => {});
        let terminated = false;

        try {
            jest.isolateModules(() => { require("../app"); });
            await until(() => mockState.nodes.length == 1, "agent to start");

            const confs: string[] = [];
            drv = mqtt.connect(`mqtt://localhost:${port}`, {
                clientId: "drv", username: "drv", password: "secret",
                reconnectPeriod: 100,
            });
            drv.on("message", (_t, p) => confs.push(JSON.parse(p.toString()).marker));
            drv.on("connect", () => {
                drv!.subscribe("fpEdge1/drv/conf", () =>
                    drv!.publish("fpEdge1/drv/status", "READY"));
            });

            /* The secret is not there, so the agent runs with no
             * connections and the driver gets no config. */
            await new Promise(r => setTimeout(r, 500));
            expect(confs).toEqual([]);
            expect(mockState.fetches).toBe(1);

            /* Flux applies the SealedSecret and the kubelet mounts it. */
            fs.writeFileSync(path.join(secrets, token), "filled");

            await until(() => confs.length == 1, "config once the secret is mounted");
            expect(confs).toEqual(["filled"]);
            expect(mockState.fetches).toBe(2);
            expect(mockState.nodes).toHaveLength(2);
            expect(mockState.nodes[0].stopped).toBe(true);
            expect(uncaught).toEqual([]);

            await new Promise(r => drv!.end(true, {}, r));
            drv = undefined;
            terminated = true;
            process.emit("SIGTERM" as any);
            await until(() => mockState.nodes[1].stopped, "agent to stop");
            expect(mockState.fetches).toBe(2);
        }
        finally {
            if (!terminated) process.emit("SIGTERM" as any);
            process.off("uncaughtException", onUncaught);
            errors.mockRestore();
            delete process.env.SECRETS_PATH;
            fs.rmSync(secrets, { recursive: true, force: true });
        }
    }, 30_000);
});

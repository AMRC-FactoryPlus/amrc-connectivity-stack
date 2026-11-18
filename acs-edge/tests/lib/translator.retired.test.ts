/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/* A connection whose type the Edge Agent no longer has must not stop
 * the agent or its other connections, and must say why its devices
 * publish nothing, whether or not DEBUG is set. Since ACS 7 that
 * includes the four types that moved to split drivers. */

import { EventEmitter } from "events";

import { DriverConnection } from "../../lib/devices/driver";
import {
    connectionAlertName, MOVED_CONN_TYPES, RETIRED_CONN_TYPES, Translator,
} from "../../lib/translator";
import * as UUIDs from "../../lib/uuids";

class FakeBroker extends EventEmitter {
    async start () {}
    async stop () {}
    async publish () {}
}

function setup () {
    const errors: string[] = [];
    jest.spyOn(console, "error").mockImplementation((m: any) => { errors.push(String(m)); });
    const translator = new Translator({} as any, 1000, new FakeBroker() as any);
    return { translator, errors };
}

afterEach(() => jest.restoreAllMocks());

test.each(RETIRED_CONN_TYPES)("a %s connection logs a clear error and is not started", async (type) => {
    const { translator, errors } = setup();

    await translator.setupConnection({
        connType: type, name: "line 3",
        devices: [{ deviceId: "press" }, { deviceId: "oven" }],
    });

    expect(translator.connections[type]).toBeUndefined();
    expect(translator.devices).toEqual({});
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^ERROR: Connection 'line 3' was not started/);
    expect(errors[0]).toContain("devices: press, oven");
    expect(errors[0]).toContain(`The ${type} connection type has been removed`);
});

test("the four retired types are the ones named in the release note", () => {
    expect([...RETIRED_CONN_TYPES].sort())
        .toEqual(["EtherNet/IP", "MTConnect", "S7", "Websocket"]);
});

/* Service-setup moves these to their split drivers on upgrade, so one
 * left in the config is a connection the move skipped. */
test.each(MOVED_CONN_TYPES)("a built-in %s connection says to look at service-setup", async (type) => {
    const { translator, errors } = setup();

    await translator.setupConnection({
        connType: type, name: "cell 2",
        devices: [{ deviceId: "robot" }],
    });

    expect(translator.connections[type]).toBeUndefined();
    expect(translator.devices).toEqual({});
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^ERROR: Connection 'cell 2' was not started/);
    expect(errors[0]).toContain("devices: robot");
    expect(errors[0]).toContain(`since ACS 7 they run on the ${type} split driver`);
    expect(errors[0]).toContain("Service-setup moves them when ACS is upgraded");
});

test("the four moved types are REST, MQTT, OPC UA and UDP", () => {
    expect([...MOVED_CONN_TYPES].sort()).toEqual(["MQTT", "OPC UA", "REST", "UDP"]);
});

test("an unknown type gets an error naming the type", async () => {
    const { translator, errors } = setup();

    await translator.setupConnection({ connType: "Carrier pigeon", name: "loft" });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Connection 'loft' was not started");
    expect(errors[0]).toContain("devices: none");
    expect(errors[0]).toContain("does not know the connection type 'Carrier pigeon'");
});

test("the error is printed with DEBUG unset", async () => {
    const debug = process.env.DEBUG;
    delete process.env.DEBUG;
    try {
        const { translator, errors } = setup();
        await translator.setupConnection({ connType: "S7", name: "plc" });
        expect(errors).toHaveLength(1);
    }
    finally {
        if (debug !== undefined) process.env.DEBUG = debug;
    }
});

test("connections after one that can't start are still set up", async () => {
    const { translator, errors } = setup();
    const conns = [
        { connType: "MTConnect", name: "mill", devices: [{ deviceId: "m1" }] },
        { connType: "UDP", name: "robot", UDPConnDetails: { port: 5000 } },
        { connType: "Driver", name: "api", DriverDetails: {} },
    ];

    /* The same loop Translator.start runs. */
    conns.forEach(c => translator.setupConnection(c));
    await new Promise(r => setImmediate(r));

    expect(errors).toHaveLength(2);
    expect(translator.connections.MTConnect).toBeUndefined();
    expect(translator.connections.UDP).toBeUndefined();
    expect(translator.connections.Driver).toBeInstanceOf(DriverConnection);
});

test("alert names keep only letters, digits and underscores", () => {
    expect(connectionAlertName({ name: "Robot cell 2 (UDP)" })).toBe("Robot_cell_2__UDP_");
    expect(connectionAlertName({ name: "api.example.org" })).toBe("api_example_org");
    expect(connectionAlertName({})).toBe("unnamed");
});

/* The Node raises Alerts/Connection/<name> for each connection it could
 * not start, so the problem shows in the Node's metrics. */
test("a connection that can't start raises a Connection alert on the Node", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    const births: any[] = [];
    const client = Object.assign(new EventEmitter(), {
        connect () { setImmediate(() => client.emit("birth")); },
        stop () {},
        publishNodeBirth (p: any) { births.push(p); },
        publishDeviceBirth () {},
        publishDeviceData () {},
        publishDeviceDeath () {},
    });
    const config = {
        deviceConnections: [
            { connType: "OPC UA", name: "press line", devices: [] },
            { connType: "Driver", name: "api", DriverDetails: {}, devices: [] },
        ],
    };
    const fplus: any = {
        Auth: {
            find_principal: async () => ({
                uuid: "11111111-2222-4333-8444-555555555555",
                sparkplug: { group: "G", node: "N" },
            }),
        },
        ConfigDB: { get_config_with_etag: async () => [config, "etag"] },
        MQTT: { basic_sparkplug_node: async () => client },
    };
    const translator = new Translator(fplus, 1, new FakeBroker() as any);

    await translator.start();
    await new Promise(r => setImmediate(r));
    await translator.stop();

    const metrics = Object.fromEntries(births[0].metrics.map((m: any) => [m.name, m]));
    expect(metrics["Alerts/Connection/press_line/Active"].value).toBe(true);
    expect(metrics["Alerts/Connection/press_line/Type"].value).toBe(UUIDs.Alert.Connection);
    expect(metrics["Alerts/Connection/api/Active"]).toBeUndefined();
    expect(metrics["Alerts/Config_Invalid/Active"].value).toBe(false);
});

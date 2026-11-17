/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/* A connection whose type the Edge Agent no longer has must not stop
 * the agent or its other connections, and must say why its devices
 * publish nothing, whether or not DEBUG is set. */

import { RestConnection } from "../../lib/devices/REST";
import { RETIRED_CONN_TYPES, Translator } from "../../lib/translator";

function setup () {
    const errors: string[] = [];
    jest.spyOn(console, "error").mockImplementation((m: any) => { errors.push(String(m)); });
    const translator = new Translator({} as any, 1000, {} as any);
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

test("the five retired types are the ones named in the release note", () => {
    expect([...RETIRED_CONN_TYPES].sort())
        .toEqual(["EtherNet/IP", "MTConnect", "S7", "UDP", "Websocket"]);
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

test("connections after a retired one are still set up", async () => {
    const { translator, errors } = setup();
    const conns = [
        { connType: "MTConnect", name: "mill", devices: [{ deviceId: "m1" }] },
        { connType: "REST", name: "api", RESTConnDetails: { baseURL: "http://localhost" } },
    ];

    /* The same loop Translator.start runs. */
    conns.forEach(c => translator.setupConnection(c));
    await new Promise(r => setImmediate(r));

    expect(errors).toHaveLength(1);
    expect(translator.connections.MTConnect).toBeUndefined();
    expect(translator.connections.REST).toBeInstanceOf(RestConnection);
});

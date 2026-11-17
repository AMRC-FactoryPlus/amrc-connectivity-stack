/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

/* The built-in UDP connection. The first tests use a fake dgram
 * socket; the last sends a real datagram over loopback. These pin the
 * behaviour the UDP split driver has to match. Restored with the UDP
 * connection by ACS-36, and rewritten for the current class (the old
 * suite imported a UDPDevice that no longer exists). */

import { EventEmitter } from "events";
import dgram from "dgram";

import { UDPConnection } from "../../../lib/devices/UDP";
import { Metrics } from "../../../lib/helpers/typeHandler";

class FakeSocket extends EventEmitter {
    bind = jest.fn();
    close = jest.fn();
    address = jest.fn(() => ({ address: "0.0.0.0", port: 50205 }));
}

const type = "UDP";

function setup (port = 50205) {
    const socket = new FakeSocket();
    const create = jest.spyOn(dgram, "createSocket").mockReturnValue(socket as any);
    const conn = new UDPConnection(type, { port });
    return { socket, create, conn };
}

afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});

describe("UDPConnection", () => {
    it("creates an IPv4 socket", () => {
        const { create } = setup();
        expect(create).toHaveBeenCalledWith("udp4");
    });

    describe("open()", () => {
        it("binds the port and then emits open", () => {
            jest.useFakeTimers();
            const { socket, conn } = setup();
            const open = jest.fn();
            conn.on("open", open);

            conn.open();

            expect(socket.bind).toHaveBeenCalledWith(50205);
            expect(open).not.toHaveBeenCalled();
            jest.advanceTimersByTime(10);
            expect(open).toHaveBeenCalledTimes(1);
        });
    });

    describe("messages", () => {
        it("emits each datagram as data under the address \"\"", () => {
            const { socket, conn } = setup();
            const data = jest.fn();
            conn.on("data", data);
            const msg = Buffer.from([1, 2, 3]);

            socket.emit("message", msg, { address: "10.0.0.1", port: 1234 });

            expect(data).toHaveBeenCalledWith({ "": msg });
        });

        it("closes the socket on a socket error", () => {
            const { socket } = setup();
            socket.emit("error", new Error("EADDRINUSE"));
            expect(socket.close).toHaveBeenCalledTimes(1);
        });
    });

    describe("readMetrics() and writeMetrics()", () => {
        it("read nothing and write nothing: UDP only receives", () => {
            const { conn } = setup();
            expect(conn.readMetrics(new Metrics([]))).toEqual([]);
            expect(conn.writeMetrics(new Metrics([]))).toBeUndefined();
        });
    });

    describe("close()", () => {
        it("should call server.close()", async () => {
            const { socket, conn } = setup();
            await conn.close();
            expect(socket.close).toHaveBeenCalledTimes(1);
        });

        it("logs rather than throws if the socket is already closed", async () => {
            const log = jest.spyOn(console, "log").mockImplementation(() => {});
            const { socket, conn } = setup();
            socket.close.mockImplementation(() => { throw new Error("Not running"); });
            await expect(conn.close()).resolves.toBeUndefined();
            expect(log).toHaveBeenCalledWith(new Error("Not running"));
        });
    });
});

describe("UDPConnection over loopback", () => {
    it("receives a real datagram", async () => {
        /* Find a free port, then let the connection bind it. */
        const probe = dgram.createSocket("udp4");
        await new Promise<void>(r => probe.bind(0, "127.0.0.1", () => r()));
        const port = probe.address().port;
        await new Promise<void>(r => probe.close(() => r()));

        const conn = new UDPConnection(type, { port });
        const got = new Promise<any>(r => conn.on("data", r));
        await new Promise(r => { conn.on("open", r); conn.open(); });

        const sender = dgram.createSocket("udp4");
        sender.send(Buffer.from("robot"), port, "127.0.0.1");

        const obj = await got;
        expect(Object.keys(obj)).toEqual([""]);
        expect(obj[""].toString()).toBe("robot");

        sender.close();
        await conn.close();
    });
});

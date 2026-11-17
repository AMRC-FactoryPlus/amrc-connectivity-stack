/*
 * ACS Edge Agent
 * Golden-output harness: the interface every fake device implements
 * Copyright 2026 University of Sheffield
 */

import net from "net";
import dgram from "dgram";

import type { Fixture } from "../../fixtures/drivers/fixture.js";

export interface DeviceOpts {
    /* Fixture time runs this many times faster than real time. */
    speed:  number,
}

/* A fake device replays a fixture's device input to whichever
 * connection is pointed at it. One kind of fake device per kind of
 * fixture event. To add a kind, write a class implementing this and
 * add it to `Kinds` in index.ts. */
export interface FakeDevice {
    /* Start listening. Called once, before the agent starts. */
    start (): Promise<void>,

    /* The connection entry with its details pointed at this device.
     * The same rewrite is applied before both runs, so it must not
     * depend on anything but the fixture and the device's address. */
    connection (conn: any): any,

    /* Resolves once the device has delivered all of its input and the
     * agent has had time to handle it. */
    finished (): Promise<void>,

    /* Stop the device and release its ports. */
    stop (): Promise<void>,

    /* Date.now() when the device first delivered fixture time 0. DDATA
     * timestamps are compared as offsets from this. */
    t0?: number,

    /* How many messages or responses the device has delivered. */
    delivered: number,

    /* The distinct credentials the connection sent, where the device
     * can see them (the HTTP stub's Authorization headers). */
    credentials?: Set<string>,
}

export type DeviceFactory = (fixture: Fixture, opts: DeviceOpts) => FakeDevice;

/* A TCP port nobody is listening on right now. */
export function free_port (): Promise<number> {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.on("error", reject);
        srv.listen(0, "127.0.0.1", () => {
            const { port } = srv.address() as net.AddressInfo;
            srv.close(() => resolve(port));
        });
    });
}

/* A UDP port nobody is bound to right now. */
export function free_udp_port (): Promise<number> {
    return new Promise((resolve, reject) => {
        const sock = dgram.createSocket("udp4");
        sock.on("error", reject);
        sock.bind(0, "127.0.0.1", () => {
            const { port } = sock.address();
            sock.close(() => resolve(port));
        });
    });
}

export const sleep = (ms: number) =>
    new Promise<void>(resolve => setTimeout(resolve, ms));

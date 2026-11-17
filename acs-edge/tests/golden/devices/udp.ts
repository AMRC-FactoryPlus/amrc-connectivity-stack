/*
 * ACS Edge Agent
 * Golden-output harness: a UDP sender replaying recorded datagrams
 * Copyright 2026 University of Sheffield
 */

import dgram from "dgram";

import type { Fixture, UdpEvent } from "../../fixtures/drivers/fixture.js";
import { DeviceOpts, FakeDevice, free_udp_port, sleep } from "./device.js";

/* Is something bound to this UDP port on localhost? */
function bound (port: number): Promise<boolean> {
    return new Promise(resolve => {
        const sock = dgram.createSocket("udp4");
        sock.once("error", () => { sock.close(); resolve(true); });
        sock.bind(port, () => sock.close(() => resolve(false)));
    });
}

/* Sends each recorded datagram to the port the connection listens on,
 * at its time scaled by the speed. The connection listens rather than
 * connects, so the sender waits until the port is bound before it
 * starts. The connection details are `{ port }`, as the built-in UDP
 * connection had them. */
export class UdpDevice implements FakeDevice {
    fixture:    Fixture
    opts:       DeviceOpts
    events:     UdpEvent[]
    port = 0
    sock?:      dgram.Socket
    delivered = 0
    t0?:        number
    #replay?:   Promise<void>
    #stopped = false

    constructor (fixture: Fixture, opts: DeviceOpts) {
        this.fixture = fixture;
        this.opts = opts;
        this.events = (fixture.events as any[])
            .filter((e): e is UdpEvent => e.type == "udp")
            .sort((a, b) => a.t - b.t);
    }

    async start () {
        this.port = await free_udp_port();
        this.sock = dgram.createSocket("udp4");
        this.#replay = this.replay();
    }

    /* The built-in's `UDPConnDetails`, or a split driver's
     * `DriverDetails` after service-setup's move. */
    connection (conn: any) {
        const key = Object.keys(conn).find(k => /^(UDPConn|Driver)Details$/.test(k)) ?? "UDPConnDetails";
        return { ...conn, [key]: { ...conn[key], port: this.port } };
    }

    send (ev: UdpEvent) {
        const buf = Buffer.from(ev.payload, ev.encoding == "base64" ? "base64" : "utf8");
        return new Promise<void>((resolve, reject) =>
            this.sock!.send(buf, this.port, "127.0.0.1",
                err => err ? reject(err) : resolve()));
    }

    async replay () {
        while (!this.#stopped && !await bound(this.port))
            await sleep(20);
        /* Let the connection report itself open. */
        await sleep(100);
        const start = Date.now();
        this.t0 = start;
        for (const ev of this.events) {
            if (this.#stopped) return;
            const wait = start + ev.t / this.opts.speed - Date.now();
            if (wait > 0) await sleep(wait);
            await this.send(ev);
            this.delivered++;
        }
    }

    async finished () {
        await this.#replay;
        await sleep(250);
    }

    async stop () {
        this.#stopped = true;
        await new Promise<void>(r => this.sock ? this.sock.close(() => r()) : r());
        this.sock = undefined;
    }
}

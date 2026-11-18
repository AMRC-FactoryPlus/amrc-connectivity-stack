/*
 * ACS Edge Agent
 * Split-driver cluster rig: a UDP sender
 * Copyright 2026 University of Sheffield
 */

import dgram from "dgram";

import type { Fixture, UdpEvent } from "../../fixtures/drivers/fixture.js";
import type { RigConnection } from "../rig.js";
import { Looper, Mock, MockStatus } from "./mock.js";

/* Sends the fixture's datagrams to `target`, at the connection's port,
 * in a loop. A UDP connection listens rather than connects, so the
 * sender needs to know where the connection is: on a cluster that is
 * the address of the edge host, from outside the cluster, which is
 * what a real device does. */
export class UdpMock implements Mock {
    conn:       RigConnection
    fixture:    Fixture
    looper:     Looper<UdpEvent>
    target:     string
    sock?:      dgram.Socket
    delivered = 0
    errors = 0

    constructor (conn: RigConnection, fixture: Fixture, opts: { target?: string } = {}) {
        this.conn = conn;
        this.fixture = fixture;
        this.target = opts.target ?? "127.0.0.1";
        this.looper = new Looper(fixture, (fixture.events as any[])
            .filter((e): e is UdpEvent => e.type == "udp"));
    }

    async start () {
        if (this.sock) return;
        this.sock = dgram.createSocket("udp4");
        this.sock.on("error", () => this.errors++);
        this.looper.start(ev => this.send(ev));
    }

    send (ev: UdpEvent) {
        const sock = this.sock;
        if (!sock) return;
        const buf = Buffer.from(ev.payload, ev.encoding == "base64" ? "base64" : "utf8");
        sock.send(buf, this.conn.port, this.target, err => {
            if (err) this.errors++;
            else this.delivered++;
        });
    }

    async stop () {
        await this.looper.stop();
        const sock = this.sock;
        this.sock = undefined;
        if (sock) await new Promise<void>(r => sock.close(() => r()));
    }

    status (): MockStatus {
        return {
            id: this.conn.id, protocol: this.conn.protocol,
            name: this.conn.name, port: this.conn.port,
            running: !!this.sock, delivered: this.delivered,
            refused: this.errors,
        };
    }
}

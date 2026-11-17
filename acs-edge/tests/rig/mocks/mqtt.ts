/*
 * ACS Edge Agent
 * Split-driver cluster rig: a mock MQTT broker and publisher
 * Copyright 2026 University of Sheffield
 */

import net from "net";

import Aedes from "aedes";

import type { Fixture, MqttEvent } from "../../fixtures/drivers/fixture.js";
import type { RigConnection } from "../rig.js";
import { Looper, Mock, MockStatus, record_write } from "./mock.js";

/* A synthetic `{"value": v}` payload as a source that batches sends
 * it: a JSON array of `{value, timestamp}` items, here one item with
 * the time it was sent. */
export function as_array (payload: string): Buffer {
    const { value } = JSON.parse(payload);
    return Buffer.from(JSON.stringify([{ value, timestamp: Date.now() }]));
}

/* A broker of its own for one connection, with a publisher sending
 * the fixture's messages on their topics at their times, in a loop.
 *
 * The fixture keeps the source's topics and payload shapes, so a
 * device reading array payloads on one topic and object payloads on
 * another gets both, at the rates the fixture was made with. Like a
 * real broker it publishes whether or not anyone is subscribed, so a
 * connection that is down misses messages. Messages are not retained.
 *
 * A connection made with `--batched` has topics whose metrics read
 * `$.value`; those are sent as arrays (`as_array`).
 *
 * A connection with a username must log in with the rig's credentials.
 * A publish from a client (a write) is recorded. */
export class MqttMock implements Mock {
    conn:       RigConnection
    fixture:    Fixture
    looper:     Looper<MqttEvent>
    broker?:    Aedes
    server?:    net.Server
    sockets:    Set<net.Socket> = new Set()
    delivered = 0
    refused = 0
    writes:     NonNullable<MockStatus["writes"]> = []
    /* Topics sent as arrays. */
    arrays:     Set<string>

    constructor (conn: RigConnection, fixture: Fixture) {
        this.conn = conn;
        this.fixture = fixture;
        this.arrays = new Set(conn.array_topics ?? []);
        this.looper = new Looper(fixture, fixture.events
            .filter((e): e is MqttEvent => e.type == "mqtt"));
    }

    async start () {
        if (this.server) return;
        const broker = new Aedes({
            authenticate: (client, username, password, done) => {
                if (!this.conn.username) return done(null, true);
                const ok = username == this.conn.username
                    && password?.toString() == this.conn.password;
                if (!ok) this.refused++;
                done(null, ok);
            },
        });
        broker.on("publish", (packet, client) => {
            if (client) record_write(this.writes, packet.topic,
                packet.payload.toString());
        });
        const srv = net.createServer(broker.handle as any);
        srv.on("connection", sock => {
            this.sockets.add(sock);
            sock.once("close", () => this.sockets.delete(sock));
        });
        await new Promise<void>((resolve, reject) => {
            srv.once("error", reject);
            srv.listen(this.conn.port, () => resolve());
        });
        this.broker = broker;
        this.server = srv;
        this.looper.start(ev => this.publish(ev));
    }

    publish (ev: MqttEvent) {
        const broker = this.broker;
        if (!broker) return;
        const payload = this.arrays.has(ev.topic)
            ? as_array(ev.payload)
            : Buffer.from(ev.payload, ev.encoding == "base64" ? "base64" : "utf8");
        return new Promise<void>((resolve, reject) =>
            broker.publish({
                cmd: "publish", qos: 0, dup: false, retain: false,
                topic: ev.topic, payload,
            }, err => {
                if (err) return reject(err);
                this.delivered++;
                resolve();
            }));
    }

    async stop () {
        await this.looper.stop();
        const { broker, server } = this;
        this.broker = undefined;
        this.server = undefined;
        for (const s of this.sockets) s.destroy();
        if (broker) await new Promise<void>(r => broker.close(() => r()));
        if (server) await new Promise<void>(r => server.close(() => r()));
    }

    status (): MockStatus {
        return {
            id: this.conn.id, protocol: this.conn.protocol,
            name: this.conn.name, port: this.conn.port,
            running: !!this.server, delivered: this.delivered,
            clients: this.sockets.size, refused: this.refused,
            writes: this.writes,
        };
    }
}

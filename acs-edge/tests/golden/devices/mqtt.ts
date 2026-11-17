/*
 * ACS Edge Agent
 * Golden-output harness: an MQTT broker replaying recorded messages
 * Copyright 2026 University of Sheffield
 */

import net from "net";

import Aedes from "aedes";

import type { Fixture, MqttEvent } from "../../fixtures/drivers/fixture.js";
import { DeviceOpts, FakeDevice, sleep } from "./device.js";

/* Does an MQTT topic filter match a topic? */
export function topic_matches (filter: string, topic: string) {
    const f = filter.split("/");
    const t = topic.split("/");
    for (let i = 0; i < f.length; i++) {
        if (f[i] == "#") return true;
        if (i >= t.length) return false;
        if (f[i] != "+" && f[i] != t[i]) return false;
    }
    return f.length == t.length;
}

/* A broker the connection subscribes to. Once every topic in the
 * fixture has a subscriber, it publishes each recorded message at its
 * time, scaled by the speed. Messages go out in fixture order, and the
 * broker delivers them to a subscriber in that order, so both runs see
 * the same sequence on every topic. */
export class MqttDevice implements FakeDevice {
    fixture:    Fixture
    opts:       DeviceOpts
    broker:     Aedes
    server?:    net.Server
    sockets:    Set<net.Socket> = new Set()
    port = 0
    events:     MqttEvent[]
    filters:    Set<string> = new Set()
    delivered = 0
    t0?:        number
    #replay?:   Promise<void>
    #subscribed!: () => void
    #ready:     Promise<void>
    #stopped = false

    constructor (fixture: Fixture, opts: DeviceOpts) {
        this.fixture = fixture;
        this.opts = opts;
        this.events = fixture.events
            .filter((e): e is MqttEvent => e.type == "mqtt")
            .sort((a, b) => a.t - b.t);

        this.broker = new Aedes();
        this.#ready = new Promise(r => this.#subscribed = r);
        const topics = [...new Set(this.events.map(e => e.topic))];
        this.broker.on("subscribe", subs => {
            for (const s of subs) this.filters.add(s.topic);
            if (topics.every(t => [...this.filters].some(f => topic_matches(f, t))))
                this.#subscribed();
        });
    }

    async start () {
        const srv = this.server = net.createServer(this.broker.handle);
        srv.on("connection", sock => {
            this.sockets.add(sock);
            sock.once("close", () => this.sockets.delete(sock));
        });
        await new Promise<void>(r => srv.listen(0, "127.0.0.1", () => r()));
        this.port = (srv.address() as net.AddressInfo).port;
        this.#replay = this.#ready.then(() => this.replay());
    }

    connection (conn: any) {
        return {
            ...conn,
            MQTTConnDetails: {
                ...conn.MQTTConnDetails,
                protocol:   "mqtt",
                host:       "127.0.0.1",
                port:       this.port,
                useSSL:     false,
                username:   "",
            },
        };
    }

    publish (ev: MqttEvent) {
        const payload = Buffer.from(ev.payload,
            ev.encoding == "base64" ? "base64" : "utf8");
        return new Promise<void>((resolve, reject) =>
            this.broker.publish({
                cmd: "publish", qos: 0, dup: false, retain: false,
                topic: ev.topic, payload,
            }, err => err ? reject(err) : resolve()));
    }

    async replay () {
        /* Let the SUBACK reach the client. */
        await sleep(50);
        const start = Date.now();
        this.t0 = start;
        for (const ev of this.events) {
            if (this.#stopped) return;
            const wait = start + ev.t / this.opts.speed - Date.now();
            if (wait > 0) await sleep(wait);
            await this.publish(ev);
            this.delivered++;
        }
    }

    async finished () {
        await this.#ready;
        await this.#replay;
        await sleep(250);
    }

    async stop () {
        this.#stopped = true;
        await new Promise<void>(r => this.broker.close(() => r()));
        const srv = this.server;
        if (!srv) return;
        this.server = undefined;
        for (const s of this.sockets) s.destroy();
        await new Promise<void>(r => srv.close(() => r()));
    }
}

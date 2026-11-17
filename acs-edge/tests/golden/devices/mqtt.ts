/*
 * ACS Edge Agent
 * Golden-output harness: an MQTT broker replaying recorded messages
 * Copyright 2026 University of Sheffield
 */

import { execFileSync } from "child_process";
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import tls from "tls";

import Aedes from "aedes";

import type { Fixture, MqttEvent } from "../../fixtures/drivers/fixture.js";
import { DeviceOpts, FakeDevice, sleep } from "./device.js";

/* Node 22.19 and later can change the CA certificates TLS trusts by
 * default; @types/node here is older. */
const node_tls = tls as typeof tls & {
    getCACertificates?: (type: string) => string[],
    setDefaultCACertificates?: (certs: string[]) => void,
};

/* Protocols the connection details can name that use TLS. A WebSocket
 * connection is served over plain MQTT, which only the broker sees. */
const TLS_PROTOCOLS = ["mqtts", "tls", "wss"];

/* A CA and a server certificate for 127.0.0.1 signed by it, made with
 * openssl once per test process. */
let test_ca: { dir: string, ca: string, key: string, cert: string } | undefined;
export function tls_files () {
    if (test_ca) return test_ca;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "golden-tls-"));
    const f = (n: string) => path.join(dir, n);
    const openssl = (...args: string[]) =>
        execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
    const key = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes"];
    openssl("req", "-x509", ...key, "-keyout", "ca.key", "-out", "ca.pem",
        "-days", "2", "-subj", "/CN=golden-harness-ca",
        "-addext", "basicConstraints=critical,CA:TRUE",
        "-addext", "keyUsage=critical,keyCertSign,cRLSign");
    openssl("req", "-new", ...key, "-keyout", "server.key", "-out", "server.csr",
        "-subj", "/CN=127.0.0.1");
    fs.writeFileSync(f("server.ext"), "subjectAltName=IP:127.0.0.1\n"
        + "basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\n"
        + "extendedKeyUsage=serverAuth\n");
    openssl("x509", "-req", "-in", "server.csr", "-CA", "ca.pem", "-CAkey", "ca.key",
        "-set_serial", "1", "-days", "2", "-extfile", "server.ext", "-out", "server.pem");
    return test_ca = {
        dir, ca: f("ca.pem"), key: f("server.key"), cert: f("server.pem"),
    };
}

/* What a client connected with, as one line: client id, credentials,
 * keep-alive, clean session and TLS. A made-up client id
 * (NO-ID-<uuid>) is new on every connection, so it is shown as
 * NO-ID-*. */
function session (packet: any, tls: boolean) {
    const id = /^NO-ID-/.test(packet.clientId) ? "NO-ID-*" : packet.clientId;
    const creds = packet.username === undefined ? "no credentials"
        : `username ${packet.username} password ${packet.password?.toString() ?? "(none)"}`;
    return `MQTT client ${id}, ${creds}, keepalive ${packet.keepalive}, `
        + `clean ${packet.clean}, ${tls ? "TLS" : "plain"}`;
}

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
 * the same sequence on every topic.
 *
 * A connection whose protocol uses TLS is served over TLS, with a
 * certificate from a test CA that the agent and a spawned driver are
 * told to trust while the device runs. The broker accepts any
 * credentials and records what each client connected with in
 * `credentials`. A `__NOW_MS-<ms>__` in a payload is replaced with the
 * time it is sent less <ms>, for payloads that carry timestamps. */
export class MqttDevice implements FakeDevice {
    fixture:    Fixture
    opts:       DeviceOpts
    broker:     Aedes
    server?:    net.Server
    tls_server?: tls.Server
    sockets:    Set<net.Socket> = new Set()
    port = 0
    tls_port = 0
    credentials: Set<string> = new Set()
    #saved_ca?: { node: string[], env?: string }
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
        this.broker.preConnect = (client: any, packet: any, done: any) => {
            this.credentials.add(session(packet, client.conn instanceof tls.TLSSocket));
            done(null, true);
        };
        this.#ready = new Promise(r => this.#subscribed = r);
        const topics = [...new Set(this.events.map(e => e.topic))];
        this.broker.on("subscribe", subs => {
            for (const s of subs) this.filters.add(s.topic);
            if (topics.every(t => [...this.filters].some(f => topic_matches(f, t))))
                this.#subscribed();
        });
    }

    async start () {
        const track = (srv: net.Server, event: string) => srv.on(event, (sock: net.Socket) => {
            this.sockets.add(sock);
            sock.once("close", () => this.sockets.delete(sock));
        });
        const listen = async (srv: net.Server) => {
            await new Promise<void>(r => srv.listen(0, "127.0.0.1", () => r()));
            return (srv.address() as net.AddressInfo).port;
        };

        const srv = this.server = net.createServer(this.broker.handle);
        track(srv, "connection");
        this.port = await listen(srv);

        const conn = this.opts.entry ?? this.fixture.connection;
        const details = conn.DriverDetails ?? conn.MQTTConnDetails;
        if (TLS_PROTOCOLS.includes(details?.protocol)) {
            const files = tls_files();
            const tsrv = this.tls_server = tls.createServer({
                key: fs.readFileSync(files.key), cert: fs.readFileSync(files.cert),
            }, this.broker.handle);
            track(tsrv, "secureConnection");
            this.tls_port = await listen(tsrv);
            this.trust(files.ca);
        }
        this.#replay = this.#ready.then(() => this.replay());
    }

    /* Make the agent (Node's default CA list) and a driver started
     * after this (SSL_CERT_FILE) trust the test CA, until stop(). */
    trust (ca: string) {
        const { getCACertificates, setDefaultCACertificates } = node_tls;
        if (!getCACertificates || !setDefaultCACertificates)
            throw new Error("A TLS connection needs Node 22.19 or later "
                + "(tls.setDefaultCACertificates)");
        this.#saved_ca = {
            node: getCACertificates("default"),
            env: process.env.SSL_CERT_FILE,
        };
        setDefaultCACertificates([...this.#saved_ca.node, fs.readFileSync(ca, "utf8")]);
        process.env.SSL_CERT_FILE = ca;
    }

    /* The details are under MQTTConnDetails for the built-in
     * connection and DriverDetails once moved. */
    connection (conn: any) {
        const key = conn.connType == "Driver" ? "DriverDetails" : "MQTTConnDetails";
        const details = conn[key] ?? {};
        const secure = TLS_PROTOCOLS.includes(details.protocol);
        if (secure && !this.tls_server)
            throw new Error("This device was started for a connection without TLS");
        return {
            ...conn,
            [key]: {
                ...details,
                protocol:   secure ? "mqtts" : "mqtt",
                host:       "127.0.0.1",
                port:       secure ? this.tls_port : this.port,
            },
        };
    }

    publish (ev: MqttEvent) {
        const now = Date.now();
        const payload = ev.encoding == "base64"
            ? Buffer.from(ev.payload, "base64")
            : Buffer.from(ev.payload.replace(/__NOW_MS-(\d+)__/g,
                (_, ms) => String(now - Number(ms))), "utf8");
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
        const saved = this.#saved_ca;
        if (saved) {
            this.#saved_ca = undefined;
            node_tls.setDefaultCACertificates!(saved.node);
            if (saved.env === undefined) delete process.env.SSL_CERT_FILE;
            else process.env.SSL_CERT_FILE = saved.env;
        }
        await new Promise<void>(r => this.broker.close(() => r()));
        const servers = [this.server, this.tls_server]
            .filter((s): s is net.Server => s != undefined);
        this.server = this.tls_server = undefined;
        for (const s of this.sockets) s.destroy();
        await Promise.all(servers.map(srv =>
            new Promise<void>(r => srv.close(() => r()))));
    }
}

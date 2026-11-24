/*
 * ACS Edge Agent
 * Edge Scout end to end inside the agent: the real Translator,
 * DriverBroker, DriverConnection and ScoutManager, with a fake driver
 * over real MQTT and fake ConfigDB, Files and Sparkplug
 * Copyright 2026 University of Sheffield
 */

import { EventEmitter } from "events";
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";

import * as mqtt from "mqtt";

import { DriverBroker } from "../../lib/driverBroker";
import { connection_hash } from "../../lib/scout";
import { Translator } from "../../lib/translator";

import { check_snapshot, FakeServices, item, sleep, until } from "../lib/scout/harness";

const NODE = "11111111-2222-4333-8444-555555555555";
const CONN = "00000000-0000-4000-8000-0000000000c1";
const ID = "drv";
const SECRET = "__FPSI__0123456789abcdef0123456789abcdef";
const DETAILS = { host: "plc", password: SECRET };

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

class StubNode extends EventEmitter {
    connect () {}
    stop () {}
    publishNodeBirth () {}
    publishDeviceBirth () {}
    publishDeviceData () {}
    publishDeviceDeath () {}
}

/* A driver on the protocol of the Scouting section, or (scouts false)
 * one built before it, which never subscribes to scout. */
class FakeDriver {
    client!: mqtt.MqttClient
    seen_features = false
    scout_msgs: any[] = []
    subscribed_scout = 0

    constructor (public port: number, public opts: { scouts: boolean, items?: any[] }) {}

    async connect () {
        const c = this.client = mqtt.connect(`mqtt://localhost:${this.port}`, {
            clientId: ID, username: ID, password: "secret", reconnectPeriod: 0,
        });
        const t = (s: string) => `fpEdge1/${ID}/${s}`;
        c.on("connect", async () => {
            /* Forget the feature on every connect. */
            this.seen_features = false;
            await c.subscribeAsync([t("active"), t("conf"), t("addr"), t("poll")]);
            c.publish(t("status"), "READY");
        });
        c.on("message", (topic, payload) => {
            const msg = topic.slice(`fpEdge1/${ID}/`.length);
            if (msg == "conf")
                return;
            if (msg == "addr") {
                const addr = JSON.parse(payload.toString());
                if (this.opts.scouts && addr.features?.scout == 1 && !this.seen_features) {
                    this.seen_features = true;
                    this.subscribed_scout++;
                    c.subscribe(t("scout"));
                }
                c.publish(t("status"), "UP");
                return;
            }
            if (msg == "scout")
                return this.on_scout(JSON.parse(payload.toString()));
        });
        await new Promise<void>((resolve, reject) => {
            c.once("connect", () => resolve());
            c.once("error", reject);
        });
    }

    on_scout (m: any) {
        this.scout_msgs.push(m);
        const send = (id: string, body: any) =>
            this.client.publish(`fpEdge1/${ID}/found/${id}`, JSON.stringify(body));
        if (m.op == "hello")
            return send("hello", { seq: 0, type: "hello", versions: [1], supported: true,
                library: "fake-driver 1.0.0" });
        if (m.op == "start" && this.opts.items) {
            send(m.id, { seq: 0, type: "accept" });
            send(m.id, { seq: 1, type: "items", items: this.opts.items });
            send(m.id, { seq: 2, type: "progress", visited: 3, found: this.opts.items.length });
            send(m.id, { seq: 3, type: "end", exhaustive: true, truncated: false, reason: null });
        }
        if (m.op == "cancel")
            send(m.id, { seq: 1, type: "end", error: { code: "CANCELLED", message: "Stopped" } });
    }

    end () {
        return new Promise(r => this.client.end(true, {}, r));
    }
}

describe("Edge Scout in the agent", () => {
    let passwords: string;
    let port: number;
    let svc: FakeServices;
    let node: StubNode;
    let translator: Translator | undefined;
    let drv: FakeDriver | undefined;
    let quiet: jest.SpyInstance[];

    beforeAll(() => {
        passwords = fs.mkdtempSync(path.join(os.tmpdir(), "driver-pw-"));
        fs.writeFileSync(path.join(passwords, ID), "secret");
        fs.writeFileSync(path.join(passwords, SECRET), "hunter2");
    });
    afterAll(() => fs.rmSync(passwords, { recursive: true, force: true }));

    beforeEach(async () => {
        port = await freePort();
        quiet = [jest.spyOn(console, "log").mockImplementation(() => {}),
            jest.spyOn(console, "error").mockImplementation(() => {})];
    });
    afterEach(async () => {
        await drv?.end();
        drv = undefined;
        await translator?.stop(true);
        translator = undefined;
        quiet.forEach(q => q.mockRestore());
    });

    async function start_agent () {
        svc = new FakeServices();
        node = new StubNode();
        const fplus: any = svc.fplus();
        fplus.Auth = {
            find_principal: async () => ({ uuid: NODE,
                sparkplug: { group: "G", node: "N", toString: () => "G/N" } }),
        };
        fplus.ConfigDB.get_config_with_etag = async () => [{
            sparkplug: {},
            deviceConnections: [{
                uuid: CONN, connType: "Driver", name: ID,
                DriverDetails: { ...DETAILS },
                devices: [],
            }],
        }, "etag"];
        fplus.MQTT = { basic_sparkplug_node: async () => node };

        const broker = new DriverBroker({
            EDGE_MQTT: `mqtt://localhost:${port}`, EDGE_PASSWORDS: passwords,
        });
        translator = new Translator(fplus, 1, broker);
        process.env.SECRETS_PATH = passwords;
        await translator.start();
        delete process.env.SECRETS_PATH;
        expect(translator.scout).toBeDefined();
    }

    function ncmd (req: any) {
        node.emit("ncmd", { metrics: [{ name: "Node Control/Scout",
            value: JSON.stringify({ version: 1, connection: CONN, ...req }) }] });
    }

    const status = () => svc.status(CONN);

    it("runs a scan with a driver over MQTT and stores the snapshot", async () => {
        await start_agent();
        const items = [
            { id: "f", parent: null, name: "F", kind: "folder" },
            item("f/a", "f"), item("f/b", "f"),
        ];
        drv = new FakeDriver(port, { scouts: true, items });
        await drv.connect();
        await until(() => status()?.supported === true, "hello");
        expect(drv.subscribed_scout).toBe(1);

        ncmd({ op: "start", request: "00000000-0000-4000-9000-000000000001",
            options: { units: true } });
        await until(() => status()?.state == "done", "scan done");

        const st = status();
        expect(st).toMatchObject({ node: NODE, supported: true, code: null,
            current: { items: 3, exhaustive: true, truncated: false } });
        /* The hash covers the placeholder, not the secret. */
        expect(st.config_hash).toBe(connection_hash({
            uuid: CONN, connType: "Driver", name: ID, DriverDetails: DETAILS }));
        expect(translator!.configHashes.get(CONN)).toBe(st.config_hash);
        const lines = svc.snapshot(st.current.file);
        expect(check_snapshot(lines)).toEqual([]);
        expect(lines[0]).toMatchObject({ connection: CONN, driver: "fake-driver 1.0.0",
            options: { units: true } });
    }, 20_000);

    it("records a driver built before scouting, and refuses its scans with LIBRARY", async () => {
        await start_agent();
        drv = new FakeDriver(port, { scouts: false });
        await drv.connect();
        await until(() => status()?.supported == "library", "library", 15_000);
        ncmd({ op: "start", request: "00000000-0000-4000-9000-000000000002" });
        await until(() => status()?.last_request, "refusal");
        expect(status().last_request.code).toBe("LIBRARY");
        expect(drv.scout_msgs).toEqual([]);
    }, 20_000);

    it("cancels a running scan and records it as interrupted when the agent stops", async () => {
        await start_agent();
        drv = new FakeDriver(port, { scouts: true });
        await drv.connect();
        await until(() => status()?.supported === true, "hello");
        ncmd({ op: "start", request: "00000000-0000-4000-9000-000000000003" });
        await until(() => status()?.state == "running", "running");

        await translator!.stop(true);
        translator = undefined;
        expect(status()).toMatchObject({ state: "failed", code: "INTERRUPTED" });
        await until(() => drv!.scout_msgs.some(m => m.op == "cancel"), "cancel at the driver");
        await sleep(20);
        expect([...svc.objects]).toEqual([]);
    }, 20_000);

    it("sends a new hello when the driver reconnects, and subscribes once per session", async () => {
        await start_agent();
        drv = new FakeDriver(port, { scouts: true });
        await drv.connect();
        await until(() => drv!.scout_msgs.length == 1, "first hello");
        await drv.end();
        drv = new FakeDriver(port, { scouts: true });
        await drv.connect();
        await until(() => drv!.scout_msgs.length == 1, "second hello");
        expect(drv.scout_msgs).toEqual([{ op: "hello", version: 1 }]);
        /* An unchanged answer writes nothing new. */
        await sleep(50);
        expect(svc.puts.filter(p => p.entry.supported === true)).toHaveLength(1);
    }, 20_000);
});

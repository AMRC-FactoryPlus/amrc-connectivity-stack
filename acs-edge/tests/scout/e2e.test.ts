/*
 * ACS Edge Agent
 * Edge Scout end to end: the Edge Agent as its own process with the
 * real split drivers, mosquitto and a node-opcua server, and the
 * central services over HTTP
 * Copyright 2026 University of Sheffield
 *
 * Skipped unless SCOUT_E2E=1. It then needs the drivers built
 * (cargo build --release in edge-opcua, edge-mqtt and edge-test-rs),
 * edge-test's node_modules (npm ci --install-links), mosquitto on
 * PATH and acs-edge's node_modules for the OPC UA server. The load
 * case runs the agent under SCOUT_E2E_AGENT_WRAP, a command such as
 * limit.sh that holds it to the edge-agent chart's 100m CPU and
 * 200Mi. When every case has passed it writes "all cases passed" to
 * SCOUT_E2E_MARKER, which CI checks, so a skipped run can't pass.
 */

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";

import * as mqtt from "mqtt";

import type { RunningDriver } from "../golden/driver";
import { check_snapshot } from "../lib/scout/harness";

import { AgentKind, CURRENT, PRE_680, PRE_SCOUT, StandInAgent } from "./e2e/old-agent";
import {
    AgentProcess, build_agent, DriverBins, free_port, missing_drivers, Mosquitto,
    OpcuaServer, sleep, start_driver, until,
} from "./e2e/processes";
import { AGENT, FakeAcs, load_agent } from "./e2e/services";
import { SparkplugWatch } from "./e2e/sparkplug";

const RUN = process.env.SCOUT_E2E == "1";
const e2e = RUN ? describe : describe.skip;

/* The cases that must pass for the marker to be written. */
const CASES = [
    "nbirth", "hello", "opcua full", "opcua branch", "mqtt rescan",
    "cancel and busy", "unsupported", "library", "restart sigterm",
    "restart sigkill", "acl test_js", "acl test_rs", "acl opcua", "acl mqtt",
    "size cap", "item cap", "load",
];
const passed: Set<string> = new Set();

/* The load scan leaves pace_ms to the agent's default, as the Admin
 * UI does, unless SCOUT_E2E_LOAD_PACE_MS sets it. */
const LOAD_PACE = process.env.SCOUT_E2E_LOAD_PACE_MS
    ? { pace_ms: Number(process.env.SCOUT_E2E_LOAD_PACE_MS) } : {};
const report: any = {};

afterAll(() => {
    const marker = process.env.SCOUT_E2E_MARKER;
    if (!RUN || !marker) return;
    const missing = CASES.filter(c => !passed.has(c));
    const lines = [
        ...[...passed].map(c => `passed ${c}`),
        ...missing.map(c => `missing ${c}`),
        `load ${JSON.stringify(report.load ?? null)}`,
        ...(missing.length ? [] : ["all cases passed"]),
    ];
    fs.writeFileSync(marker, lines.join("\n") + "\n");
});

const uuid = () => crypto.randomUUID();
const conn_uuid = (n: number) => `00000000-0000-4000-8000-00000000c${String(n).padStart(3, "0")}`;

/* A Driver connection entry with one device, as the Admin UI saves
 * it. A scan needs a device on the connection, because the Admin UI
 * leaves a connection with none out of the agent config. */
function connection (n: number, name: string, details: any, tag: any, format = "JSON") {
    return {
        uuid: conn_uuid(n), name, connType: "Driver",
        pollInt: 1000, payloadFormat: format,
        DriverDetails: details,
        devices: [{
            deviceId: `${name.replace(/-/g, "_")}_Device`,
            pollInt: 1000, pubInterval: 0, payloadFormat: format,
            templates: [],
            tags: [{ method: "GET", value: null, recordToDB: true, ...tag }],
        }],
    };
}

/* A driver built on a library from before scouting: it never
 * subscribes to scout, whatever addr says. */
class OldLibraryDriver {
    client!: mqtt.MqttClient

    constructor (public id: string, public port: number, public password: string) {}

    async start () {
        const t = (s: string) => `fpEdge1/${this.id}/${s}`;
        const c = this.client = mqtt.connect(`mqtt://127.0.0.1:${this.port}`, {
            clientId: this.id, username: this.id, password: this.password,
            reconnectPeriod: 500,
        });
        c.on("connect", async () => {
            await c.subscribeAsync([t("active"), t("conf"), t("addr"), t("poll")]);
            c.publish(t("status"), "READY");
        });
        c.on("message", topic => {
            if (topic == t("addr")) c.publish(t("status"), "UP");
        });
        return this;
    }

    stop () { return this.client?.endAsync(true); }
}

/* What a running test shares. */
interface World {
    acs:        FakeAcs,
    mqtt:       Mosquitto,
    sp:         SparkplugWatch,
    passwords:  string,
    edge_port:  number,
    agent?:     AgentProcess,
    drivers:    RunningDriver[],
}

async function world (): Promise<World> {
    const acs = await new FakeAcs().start();
    const mqtt = await new Mosquitto().start();
    const sp = await new SparkplugWatch().start(mqtt.url);
    return {
        acs, mqtt, sp,
        passwords: fs.mkdtempSync(path.join(os.tmpdir(), "scout-e2e-pw-")),
        edge_port: await free_port(),
        drivers: [],
    };
}

async function end_world (w: World | undefined) {
    if (!w) return;
    for (const d of w.drivers) await d.stop().catch(() => {});
    await w.agent?.stop();
    await w.sp.stop();
    await w.mqtt.stop();
    await w.acs.stop();
    fs.rmSync(w.passwords, { recursive: true, force: true });
}

function start_agent (w: World, env: Record<string, string> = {}, wrap?: string[]) {
    w.agent = new AgentProcess({ acs: w.acs, mqtt: w.mqtt, edge_port: w.edge_port,
        passwords: w.passwords, env, wrap });
    return w.agent.start();
}

/* Send a scan request and wait until the agent has accepted or
 * refused it. A driver that has only just come back to a restarted
 * agent is refused NODRIVER for a few seconds, as the Admin UI would
 * see it, so with `ready` that refusal is tried again. */
async function request_scan (w: World, conn: string, req: any = {}, ready = true) {
    const end = Date.now() + 30_000;
    for (;;) {
        const request = uuid();
        w.sp.scout({ version: 1, op: "start", request, connection: conn, ...req });
        await until(() => w.acs.status(conn)?.last_request?.request == request,
            `scan request ${request} on ${conn} to be answered`);
        const code = w.acs.status(conn).last_request.code;
        if (ready && code == "NODRIVER" && Date.now() < end) {
            await sleep(500);
            continue;
        }
        return request;
    }
}

/* Send a scan request and wait until the agent has finished with it:
 * refused, or accepted and then done, failed or cancelled. */
async function scan (w: World, conn: string, req: any = {}, ms = 120_000, ready = true) {
    const request = await request_scan(w, conn, req, ready);
    await until(() => {
        const st = w.acs.status(conn);
        if (st.last_request.code) return true;
        return st.request == request && ["done", "failed", "cancelled"].includes(st.state);
    }, `scan request ${request} on ${conn} to finish`, ms);
    return { request, status: w.acs.status(conn) };
}

function cancel (w: World, conn: string) {
    const request = uuid();
    w.sp.scout({ version: 1, op: "cancel", request, connection: conn });
    return request;
}

function items_of (lines: any[]) {
    return lines.slice(1, -1);
}

function ids_of (lines: any[]): Set<string> {
    return new Set(items_of(lines).map(i => i.id));
}

const pct = (xs: number[], p: number) => {
    if (!xs.length) return NaN;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))];
};

function check_ready () {
    const missing = missing_drivers();
    if (missing.length)
        throw new Error(`SCOUT_E2E=1 but these are missing: ${missing.join(", ")}`);
}

e2e("Edge Scout end to end", () => {
    beforeAll(() => {
        check_ready();
        build_agent();
    }, 180_000);

    describe("one agent with OPC UA, MQTT and JS drivers", () => {
        let w: World;
        let opcua: OpcuaServer;
        let old: OldLibraryDriver;
        const OPCUA = conn_uuid(1), MQTT = conn_uuid(2), TEST = conn_uuid(3);
        const UNSUP = conn_uuid(4), OLD = conn_uuid(5);
        const mqtt_scan = { options: { filters: ["plant/#"], seconds: 2 } };

        async function retain (topic: string, payload: string) {
            await w.sp.client.publishAsync(topic, payload, { retain: true, qos: 1 });
        }

        async function start_drivers () {
            const opts = { passwords: w.passwords, edge_port: w.edge_port };
            w.drivers.push(
                await start_driver("opcua", "scout-opcua", opts),
                await start_driver("mqtt", "scout-mqtt", opts),
                await start_driver("test_js", "scout-test", opts),
                await start_driver("test_js", "scout-unsupported",
                    { ...opts, env: { SCOUT_UNSUPPORTED: "1" } }),
            );
            fs.writeFileSync(path.join(w.passwords, "scout-oldlib"), "pw-old");
            old = await new OldLibraryDriver("scout-oldlib", w.edge_port, "pw-old").start();
        }

        async function all_hellos () {
            await until(() => [OPCUA, MQTT, TEST].every(c => w.acs.status(c)?.supported === true)
                && w.acs.status(UNSUP)?.supported === false,
            "every driver's hello to be recorded", 60_000);
        }

        beforeAll(async () => {
            w = await world();
            opcua = await new OpcuaServer().start();
            await retain("plant/line1/temp", JSON.stringify({ v: 21.5, unit: "C" }));
            await retain("plant/line1/speed", "1450");
            await retain("plant/line2/state", "running");
            load_agent(w.acs, {
                sparkplug: {},
                deviceConnections: [
                    connection(1, "scout-opcua", { endpoint: opcua.url, securityMode: "None",
                        securityPolicy: "None", useCredentials: false },
                    { Name: "Counter", type: "UInt32", address: "ns=1;s=T/Counter" }),
                    connection(2, "scout-mqtt", { protocol: "mqtt", host: "127.0.0.1",
                        port: w.mqtt.port, clientId: "scout-e2e-device", cleanSession: true,
                        keepAlive: 30 },
                    { Name: "Temp", type: "Double", address: "plant/line1/temp", path: "$.v" }),
                    connection(3, "scout-test", {},
                        { Name: "Wave", type: "DoubleBE", address: "sin:1000:1:bd", path: "0" },
                        "Buffer"),
                    connection(4, "scout-unsupported", {},
                        { Name: "Wave", type: "DoubleBE", address: "sin:1000:1:bd", path: "0" },
                        "Buffer"),
                    connection(5, "scout-oldlib", {},
                        { Name: "Wave", type: "Double", address: "x", path: "$" }),
                ],
            });
            await start_agent(w);
            await start_drivers();
            await all_hellos();
        }, 180_000);

        afterAll(async () => {
            await old?.stop();
            await opcua?.stop();
            await end_world(w);
        }, 60_000);

        it("advertises Node Control/Scout in its NBIRTH", async () => {
            await until(() => w.sp.births().length > 0, "an NBIRTH");
            const birth = w.sp.births().pop()!;
            const metric = birth.payload.metrics.find((m: any) => m.name == "Node Control/Scout");
            expect(metric).toBeDefined();
            expect(metric.type).toBe("String");
            passed.add("nbirth");
        });

        it("records each driver's hello once", async () => {
            for (const c of [OPCUA, MQTT, TEST])
                expect(w.acs.status(c)).toMatchObject({ version: 1, node: AGENT.uuid, supported: true });
            expect(w.acs.status(UNSUP).supported).toBe(false);
            /* An unchanged answer is never written again. */
            const writes = w.acs.status_writes.filter(s => s.obj == OPCUA);
            expect(writes).toHaveLength(1);
            passed.add("hello");
        });

        let opcua_full: any[] = [];

        it("scans the OPC UA server and stores a valid snapshot", async () => {
            /* The upload meets an expired token once, so the agent's
             * client sends the same body again. */
            w.acs.expire_next_upload = true;
            const t0 = Date.now();
            const { status } = await scan(w, OPCUA, { options: {},
                limits: { items: 20000, depth: 8, seconds: 120, pace_ms: 0 } });
            const ms = Date.now() - t0;

            expect(status).toMatchObject({ state: "done", code: null, supported: true,
                current: { exhaustive: true, truncated: false } });
            expect(w.acs.states(OPCUA)).toEqual(["queued", "running", "done"]);
            expect(w.acs.uploads_retried).toBe(1);

            const lines = opcua_full = w.acs.snapshot(status.current.file);
            expect(check_snapshot(lines)).toEqual([]);
            expect(lines[0]).toMatchObject({ version: 1, connection: OPCUA, root: null, folder_id: null });
            expect(lines[0].driver).toMatch(/^rs-edge-driver /);
            const ids = ids_of(lines);
            for (const id of ["ns=1;s=Scout", "ns=1;s=Scout/Tree/0/0/0/0/v0",
                "ns=1;s=Scout/Big/2499", "ns=1;s=T/Counter"])
                expect(ids.has(id)).toBe(true);
            expect([...ids].some(id => id.startsWith("i=2253"))).toBe(false);
            expect(status.current.excluded).toEqual(
                [{ id: "i=2253", reason: "skipped", prefixes: ["i="] }]);
            expect(status.current.items).toBe(lines.length - 2);
            /* The File object and its content are the only ones. */
            expect(w.acs.scout_objects()).toEqual([status.current.file]);

            report.opcua_full = { items: status.current.items, bytes_gz: status.current.bytes_gz, ms };
            passed.add("opcua full");
        }, 180_000);

        it("merges a branch scan of an OPC UA folder into the snapshot", async () => {
            const base = w.acs.status(OPCUA).current;
            const folder = items_of(opcua_full).find(i => i.id == "ns=1;s=Scout/Tree/1");
            expect(folder).toBeDefined();
            const { status } = await scan(w, OPCUA, {
                root: folder.root ?? folder.id, folder_id: folder.id, options: {},
                limits: { items: 20000, depth: 8, seconds: 120, pace_ms: 0 },
            });
            expect(status).toMatchObject({ state: "done", code: null, folder_id: folder.id });
            expect(status.current.file).not.toBe(base.file);
            expect(status.previous.file).toBe(base.file);
            expect(status.current.branches.map((b: any) => b.folder_id)).toEqual([folder.id]);

            const merged = w.acs.snapshot(status.current.file);
            expect(check_snapshot(merged)).toEqual([]);
            expect(merged[0]).toMatchObject({ root: null, folder_id: folder.id });
            /* Nothing changed on the server, so the merge gives back
             * the full scan: every id under the same parent. */
            const parents = (ls: any[]) => new Map(items_of(ls).map(i => [i.id, i.parent]));
            expect(parents(merged)).toEqual(parents(opcua_full));
            passed.add("opcua branch");
        }, 180_000);

        it("lists MQTT topics, shows what changed on a re-scan and keeps two snapshots", async () => {
            const first = (await scan(w, MQTT, mqtt_scan)).status;
            expect(first).toMatchObject({ state: "done", code: null,
                current: { exhaustive: false } });
            const l1 = w.acs.snapshot(first.current.file);
            expect(check_snapshot(l1)).toEqual([]);
            const ids1 = ids_of(l1);
            for (const id of ["plant/", "plant/line1/", "plant/line1/temp",
                "plant/line1/speed", "plant/line2/state"])
                expect(ids1.has(id)).toBe(true);
            /* A JSON leaf: the topic, NUL, then its JSONPath. */
            expect(items_of(l1).find(i => i.id == "plant/line1/temp\u0000$.v"))
                .toMatchObject({ kind: "value", address: "plant/line1/temp", path: "$.v", type: "Double" });

            await retain("plant/line3/new", "7");
            await retain("plant/line2/state", "");
            const second = (await scan(w, MQTT, mqtt_scan)).status;
            expect(second.previous.file).toBe(first.current.file);
            const ids2 = ids_of(w.acs.snapshot(second.current.file));
            const added = [...ids2].filter(i => !ids1.has(i)).sort();
            const gone = [...ids1].filter(i => !ids2.has(i)).sort();
            expect(added).toEqual(["plant/line3/", "plant/line3/new"]);
            expect(gone).toEqual(["plant/line2/", "plant/line2/state"]);

            /* A third scan drops the first snapshot from Files and
             * ConfigDB, and keeps the other two. */
            const third = (await scan(w, MQTT, mqtt_scan)).status;
            expect(third.previous.file).toBe(second.current.file);
            await until(() => !w.acs.objects.has(first.current.file), "the first snapshot to go");
            expect(w.acs.files.has(first.current.file)).toBe(false);
            expect(w.acs.objects.has(first.current.file)).toBe(false);
            for (const f of [third.current.file, third.previous.file]) {
                expect(w.acs.files.has(f)).toBe(true);
                expect(w.acs.objects.has(f)).toBe(true);
            }
            /* Files content goes before the ConfigDB object. */
            const del = w.acs.calls.filter(c => c.includes(first.current.file) && c.startsWith("DELETE"));
            expect(del.map(c => c.split(" ")[1].split("/")[2])).toEqual(["file", "object"]);
            passed.add("mqtt rescan");
        }, 120_000);

        it("refuses a second scan with BUSY and stops a scan on cancel", async () => {
            const done = (await scan(w, TEST, { options: { size: 50 } })).status;
            expect(done.state).toBe("done");
            const kept = done.current.file;

            const slow = await request_scan(w, TEST,
                { options: { size: 5000, depth: 2, delay_ms: 500 } });
            await until(() => w.acs.status(TEST)?.request == slow
                && w.acs.status(TEST).state == "running", "the slow scan to run");
            const running = w.acs.status(TEST).scan;

            const busy = await scan(w, TEST, { options: { size: 10 } }, 10_000, false);
            expect(busy.status.last_request).toMatchObject({ request: busy.request, code: "BUSY" });
            expect(busy.status).toMatchObject({ scan: running, request: slow, state: "running" });

            const stop = cancel(w, TEST);
            await until(() => w.acs.status(TEST).state == "cancelled", "the cancel", 15_000);
            expect(w.acs.status(TEST)).toMatchObject({ scan: running, code: "CANCELLED",
                current: { file: kept }, last_request: { request: stop, code: null } });
            await until(() => !w.acs.objects.has(running), "the cancelled scan's object to go");
            expect(w.acs.files.has(running)).toBe(false);

            /* Nothing left to cancel. */
            const again = cancel(w, TEST);
            await until(() => w.acs.status(TEST).last_request?.request == again, "the second cancel");
            expect(w.acs.status(TEST).last_request.code).toBe("NOTRUNNING");
            passed.add("cancel and busy");
        }, 120_000);

        it("records UNSUPPORTED from a driver that can't scan", async () => {
            const { status } = await scan(w, UNSUP);
            expect(status).toMatchObject({ supported: false, state: "failed", code: "UNSUPPORTED" });
            expect(w.acs.scout_objects()).not.toContain(status.scan);
            passed.add("unsupported");
        }, 60_000);

        it("refuses a scan with LIBRARY on a driver from before scouting", async () => {
            await until(() => w.acs.status(OLD)?.supported == "library", "library", 30_000);
            const { request, status } = await scan(w, OLD, {}, 10_000, false);
            expect(status.last_request).toMatchObject({ request, code: "LIBRARY" });
            expect(status.scan ?? null).toBeNull();
            passed.add("library");
        }, 60_000);

        async function restart_mid_scan (signal: NodeJS.Signals) {
            const slow = await request_scan(w, TEST,
                { options: { size: 5000, depth: 2, delay_ms: 1000 } });
            await until(() => w.acs.status(TEST)?.request == slow
                && w.acs.status(TEST).state == "running", "the slow scan to run", 20_000);
            const lost = w.acs.status(TEST).scan;
            const kept = w.acs.status(TEST).current.file;
            expect(w.acs.objects.has(lost)).toBe(true);

            await w.agent!.stop(signal);
            if (signal == "SIGKILL")
                expect(w.acs.status(TEST).state).toBe("running");
            await start_agent(w);

            expect(w.acs.status(TEST)).toMatchObject({ scan: lost, state: "failed",
                code: "INTERRUPTED", current: { file: kept } });
            expect(w.acs.objects.has(lost)).toBe(false);
            expect(w.acs.files.has(lost)).toBe(false);

            /* The drivers come back to the new agent, and the next
             * scan works. */
            await until(() => w.acs.status(TEST).supported === true, "the hello");
            const after = (await scan(w, TEST, { options: { size: 20 } })).status;
            expect(after).toMatchObject({ state: "done", previous: { file: kept } });
        }

        it("records a scan the agent stopped during as INTERRUPTED (SIGTERM)", async () => {
            await restart_mid_scan("SIGTERM");
            passed.add("restart sigterm");
        }, 120_000);

        it("records a scan the agent was killed during as INTERRUPTED on restart (SIGKILL)", async () => {
            await restart_mid_scan("SIGKILL");
            passed.add("restart sigkill");
        }, 120_000);
    });

    /* A driver of this release must work with an older agent. An
     * older agent's ACL closes the connection of a driver that
     * subscribes outside it, and its addr has no features, so the
     * driver must never subscribe to scout there. Against this
     * release it subscribes and answers the hello, and after a
     * rollback to the release before it stops again.
     *
     * The oldest agent each driver can run with is the one tried
     * first. edge-test and edge-test-rs use cmd/# and run with an
     * agent from before v6.8.0. edge-opcua and edge-mqtt answer typed
     * writes on write/#, which agents only allow since ACS 7.0.0,
     * where those drivers first shipped, so they start on the ACS 7
     * agent from before scouting. */
    describe("drivers against agents of other releases", () => {
        let mosq: Mosquitto;
        let opcua: OpcuaServer;

        beforeAll(async () => {
            mosq = await new Mosquitto().start();
            opcua = await new OpcuaServer().start();
        }, 120_000);
        afterAll(async () => {
            await opcua?.stop();
            await mosq?.stop();
        });

        const cases: [keyof typeof DriverBins, AgentKind, () => [any, string[]]][] = [
            ["test_js", PRE_680, () => [{}, ["sin:1000:1:bd"]]],
            ["test_rs", PRE_680, () => [{}, ["sin:1000:1:bd"]]],
            ["opcua", PRE_SCOUT, () => [{ endpoint: opcua.url, securityMode: "None",
                securityPolicy: "None", useCredentials: false }, ["ns=1;s=T/Counter"]]],
            ["mqtt", PRE_SCOUT, () => [{ protocol: "mqtt", host: "127.0.0.1", port: mosq.port,
                clientId: "scout-e2e-acl", cleanSession: true, keepAlive: 30 }, ["acl/t"]]],
        ];

        let quiet: jest.SpyInstance;
        beforeEach(() => quiet = jest.spyOn(console, "log").mockImplementation(() => {}));
        afterEach(() => quiet.mockRestore());

        for (const [kind, oldest, setup] of cases) {
            it(`${kind}: works with the ${oldest.name} agent, this release, and after a rollback`, async () => {
                const [conf, addrs] = setup();
                const id = `acl-${kind.replace("_", "-")}`;
                const port = await free_port();
                const pw = `pw-${id}`;
                let agent: StandInAgent | undefined;
                let drv: RunningDriver | undefined;
                const pub = kind == "mqtt" ? setInterval(() => mosq && mqtt_pub(mosq.url, "acl/t", "1"), 200) : undefined;
                try {
                    /* 1. The oldest agent the driver can run with. */
                    agent = await new StandInAgent(oldest, port, id, conf, addrs).start(pw);
                    drv = await start_driver(kind, id, { passwords: agent.passwords, edge_port: port });
                    await agent.up();
                    await until(() => agent!.data > 0, `${id} data on the old agent`, 20_000);
                    await sleep(2000);
                    expect(agent.connects).toBe(1);
                    expect(agent.disconnects).toBe(0);
                    expect(agent.subscribed.some(t => t.endsWith("/scout"))).toBe(false);
                    await drv.stop();
                    await agent.stop();
                    agent.cleanup();

                    /* 2. This release, then a rollback on the same port. */
                    agent = await new StandInAgent(CURRENT, port, id, conf, addrs).start(pw);
                    drv = await start_driver(kind, id, { passwords: agent.passwords, edge_port: port });
                    await agent.up();
                    await until(() => agent!.broker.scouts(id), `${id} to subscribe to scout`);
                    await agent.hello();
                    await until(() => agent!.found.some(f => f.data == "hello"), `${id} hello`);
                    expect(agent.found.find(f => f.data == "hello")!.payload)
                        .toMatchObject({ seq: 0, type: "hello", versions: [1], supported: true });
                    expect(agent.disconnects).toBe(0);
                    const passwords = agent.passwords;
                    await agent.stop();

                    const rolled = new StandInAgent(PRE_SCOUT, port, id, conf, addrs);
                    rolled.passwords = passwords;
                    agent = await rolled.start(pw);
                    await agent.up();
                    await until(() => agent!.data > 0, `${id} data after the rollback`, 20_000);
                    await sleep(2000);
                    expect(agent.connects).toBe(1);
                    expect(agent.disconnects).toBe(0);
                    expect(agent.subscribed.some(t => t.endsWith("/scout"))).toBe(false);
                    passed.add(`acl ${kind}`);
                }
                catch (e) {
                    console.error(`${id} driver output:\n${drv?.output().slice(-4000)}`);
                    throw e;
                }
                finally {
                    clearInterval(pub);
                    await drv?.stop();
                    await agent?.stop();
                    agent?.cleanup();
                }
            }, 120_000);
        }
    });

    describe("caps", () => {
        let w: World;
        const SCOUT = conn_uuid(10);

        beforeAll(async () => {
            w = await world();
            load_agent(w.acs, {
                sparkplug: {},
                deviceConnections: [
                    connection(10, "cap-scout", {},
                        { Name: "Wave", type: "DoubleBE", address: "sin:1000:1:bd", path: "0" },
                        "Buffer"),
                ],
            });
            /* 256 KiB of snapshot, before gzip. */
            await start_agent(w, { SCOUT_MAX_BYTES: String(256 * 1024) });
            w.drivers.push(await start_driver("test_rs", "cap-scout",
                { passwords: w.passwords, edge_port: w.edge_port }));
            await until(() => w.acs.status(SCOUT)?.supported === true, "the hello", 30_000);
        }, 120_000);
        afterAll(() => end_world(w), 60_000);

        it("stops at the agent's size cap and keeps what it found", async () => {
            const { status } = await scan(w, SCOUT, { options: { size: 20000, depth: 2 },
                limits: { items: 50000 } });
            expect(status).toMatchObject({ state: "done", code: null,
                current: { truncated: true, reason: "size", exhaustive: false } });
            const lines = w.acs.snapshot(status.current.file);
            expect(check_snapshot(lines)).toEqual([]);
            const raw = zlib_size(w.acs.files.get(status.current.file)!);
            /* The cap holds back items. The end line always goes in. */
            const end = Buffer.byteLength(JSON.stringify(lines[lines.length - 1]) + "\n");
            expect(raw - end).toBeLessThanOrEqual(256 * 1024);
            expect(status.current.items).toBeGreaterThan(100);
            expect(status.current.items).toBeLessThan(20000);
            report.size_cap = { items: status.current.items, raw_bytes: raw };
            passed.add("size cap");
        }, 120_000);

        it("stops at the requested item cap", async () => {
            const { status } = await scan(w, SCOUT, { options: { size: 5000, depth: 2 },
                limits: { items: 1000 } });
            expect(status).toMatchObject({ state: "done",
                current: { truncated: true, reason: "items", items: 1000 } });
            expect(check_snapshot(w.acs.snapshot(status.current.file))).toEqual([]);
            passed.add("item cap");
        }, 120_000);
    });

    /* A 49,950-item scan on edge-test-rs while edge-mqtt delivers a
     * value every 50 ms, with the agent held to the chart's limits
     * when SCOUT_E2E_AGENT_WRAP gives a way to. Latency is from the
     * test publishing a value to the device broker to the DDATA
     * carrying it reaching the Sparkplug broker, so it covers the
     * driver, the agent's driver broker and the agent's own work. */
    describe("load", () => {
        let w: World;
        const SCOUT = conn_uuid(20), DATA = conn_uuid(21);
        const DEVICE = "load_data_Device";

        beforeAll(async () => {
            w = await world();
            load_agent(w.acs, {
                sparkplug: {},
                deviceConnections: [
                    connection(20, "load-scout", {},
                        { Name: "Wave", type: "DoubleBE", address: "sin:1000:1:bd", path: "0" },
                        "Buffer"),
                    connection(21, "load-data", { protocol: "mqtt", host: "127.0.0.1",
                        port: w.mqtt.port, clientId: "scout-e2e-load", cleanSession: true,
                        keepAlive: 30 },
                    { Name: "Seq", type: "Double", address: "load/seq", path: "$.n" }),
                ],
            });
            const wrap = process.env.SCOUT_E2E_AGENT_WRAP?.split(/\s+/).filter(s => s);
            await start_agent(w, {}, wrap);
            const opts = { passwords: w.passwords, edge_port: w.edge_port };
            w.drivers.push(await start_driver("test_rs", "load-scout", opts),
                await start_driver("mqtt", "load-data", opts));
            await until(() => w.acs.status(SCOUT)?.supported === true, "the hello", 60_000);
        }, 120_000);
        afterAll(() => end_world(w), 60_000);

        it("keeps DDATA flowing and stays inside 200Mi during a 49,950-item scan", async () => {
            const sent: Map<number, number> = new Map();
            let n = 0;
            const pub = setInterval(() => {
                n++;
                sent.set(n, Date.now());
                w.sp.client.publish("load/seq", JSON.stringify({ n }));
            }, 50);
            const latencies = (from: number, to: number) => w.sp.values(DEVICE, "Seq")
                .filter(v => v.at >= from && v.at <= to && sent.has(v.value))
                .map(v => v.at - sent.get(v.value)!);
            const gaps = (from: number, to: number) => {
                const at = w.sp.values(DEVICE, "Seq").filter(v => v.at >= from && v.at <= to).map(v => v.at);
                return at.slice(1).map((t, i) => t - at[i]);
            };
            try {
                await until(() => w.sp.values(DEVICE, "Seq").length > 20, "data", 30_000);
                const b0 = Date.now();
                await sleep(15_000);
                const b1 = Date.now();
                const rss_before = w.agent!.peak_rss();

                const s0 = Date.now();
                const { status } = await scan(w, SCOUT, {
                    options: { size: 45000, depth: 2 },
                    limits: { items: 50000, depth: 8, seconds: 300, ...LOAD_PACE },
                }, 400_000);
                const s1 = Date.now();
                await sleep(1000);

                const base = latencies(b0, b1), during = latencies(s0, s1);
                const peak = w.agent!.peak_rss(s0);
                /* The share of one CPU the agent used between two times. */
                const share = (from: number, to: number) => {
                    const u = w.agent!.usage.filter(x => x.at >= from && x.at <= to);
                    if (u.length < 2) return NaN;
                    return (u[u.length - 1].cpu_us - u[0].cpu_us) / 1000 / (u[u.length - 1].at - u[0].at);
                };
                const result = {
                    limited: !!process.env.SCOUT_E2E_AGENT_WRAP,
                    pace_ms: status.current ? (LOAD_PACE as any).pace_ms ?? "default" : null,
                    scan_ms: s1 - s0,
                    items: status.current?.items,
                    bytes_gz: status.current?.bytes_gz,
                    baseline: { n: base.length, p50_ms: pct(base, 50), p95_ms: pct(base, 95),
                        max_ms: Math.max(...base), p95_gap_ms: pct(gaps(b0, b1), 95) },
                    during: { n: during.length, p50_ms: pct(during, 50), p95_ms: pct(during, 95),
                        max_ms: Math.max(...during), p95_gap_ms: pct(gaps(s0, s1), 95) },
                    rss_before_mib: +(rss_before / 2 ** 20).toFixed(1),
                    peak_rss_mib: +(peak / 2 ** 20).toFixed(1),
                    cpu_share_baseline: +share(b0, b1).toFixed(3),
                    cpu_share_during: +share(s0, s1).toFixed(3),
                };
                report.load = result;
                console.log(`scout-e2e load: ${JSON.stringify(result)}`);
                if (process.env.SCOUT_E2E_DUMP)
                    fs.writeFileSync(process.env.SCOUT_E2E_DUMP, JSON.stringify({
                        b0, b1, s0, s1, usage: w.agent!.usage, out: w.agent!.out,
                        values: w.sp.values(DEVICE, "Seq").filter(v => sent.has(v.value))
                            .map(v => [sent.get(v.value), v.at]),
                    }));
                if (process.env.SCOUT_E2E_REPORT)
                    fs.writeFileSync(process.env.SCOUT_E2E_REPORT, JSON.stringify(report, null, 2) + "\n");

                expect(status).toMatchObject({ state: "done", code: null,
                    current: { items: 49950, truncated: false } });
                expect(check_snapshot(w.acs.snapshot(status.current.file))).toEqual([]);
                expect(w.agent!.alive).toBe(true);
                expect(during.length).toBeGreaterThan(0.5 * (s1 - s0) / 50);
                /* The spec's rule is that p95 latency must not double,
                 * with a floor of 100 ms. The baseline p95 on a shared
                 * runner varies from about 15 ms to several hundred
                 * between runs, so a bare doubling fails at random.
                 * 100 ms is two publish intervals of the test value,
                 * and still catches a scan that starves the agent
                 * (772 ms before flow control). */
                expect(result.during.p95_ms).toBeLessThanOrEqual(Math.max(2 * result.baseline.p95_ms, 100));
                expect(peak).toBeLessThan(180 * 2 ** 20);
                passed.add("load");
            }
            finally {
                clearInterval(pub);
            }
        }, 600_000);
    });
});

/* The size of a gzipped buffer once unzipped. */
function zlib_size (gz: Buffer): number {
    return zlib.gunzipSync(gz).length;
}

/* Publish one message to a broker with a short-lived client. */
let pub_client: mqtt.MqttClient | undefined;
function mqtt_pub (url: string, topic: string, payload: string) {
    pub_client ??= mqtt.connect(url, { clientId: `scout-e2e-pub-${process.pid}` });
    pub_client.publish(topic, payload);
}
afterAll(() => pub_client?.end(true));

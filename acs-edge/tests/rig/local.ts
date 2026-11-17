/*
 * ACS Edge Agent
 * Split-driver cluster rig: run part of a rig on one machine
 * Copyright 2026 University of Sheffield
 *
 *   local --rig <rig.json> --only <id,...> --seconds <n> --out <file>
 *       [--label <name>] [--split <PROTO>=<driver>,...]
 *       [--outage <id>:<from s>:<length s>] [--broker-port <n>]
 *       [--write <id>:<device>:<metric>:<value>:<at s>]
 *
 * Runs the mocks of the chosen connections, one real Edge Agent
 * (`Translator`) per rig node they belong to, and a local MQTT broker
 * the agents publish their Sparkplug output to, then records that
 * output with `check record` for <n> seconds and writes the summary.
 * Compare two summaries with `check compare`, which is the cluster
 * test on one machine.
 *
 * Each connection is moved to its split driver as service-setup moves
 * it (`move_entry` and the protocol's payload format map) and the
 * driver binary from --split is started against the agent's driver
 * broker, as the Edge Agent chart starts a sidecar. PROTO is OPCUA,
 * MQTT, REST or UDP. Every chosen connection's protocol needs one: the
 * Edge Agent has no built-in connections since ACS 7. For a run with
 * the built-in connections, build the rig from a tree that still has
 * them (see docs/development/split-driver-cluster-test.md).
 *
 * --outage stops one mock for a while during the recording, to check
 * the device goes offline and comes back.
 *
 * --write sends one DCMD for a metric to the agent, as the Command
 * Escalation service would, and the mock's status at the end shows
 * whether the write reached the device.
 */

import { ChildProcess, spawn } from "child_process";
import crypto from "crypto";
import { EventEmitter } from "events";
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";

import Aedes from "aedes";
import mqtt from "mqtt";
import * as sparkplug from "sparkplug-payload";
import {
    driver_id, move_entry, move_payload_format, set_driver_ids,
} from "@amrc-factoryplus/service-client";

import { DriverBroker } from "../../lib/driverBroker.js";
import { Translator } from "../../lib/translator.js";

import { record } from "./check.js";
import { sleep } from "./mocks/mock.js";
import type { Mock } from "./mocks/mock.js";
import {
    Protocol, Rig, RigConnection, read_rig, rig_entry, sparkplug_type,
} from "./rig.js";
import { make_mock } from "./mocks/index.js";

const SpB = sparkplug.get("spBv1.0")!;

/* `SplitDrivers[*].payloadFormat` in acs-service-setup/lib/split-drivers.js,
 * and the setting's name for each protocol. */
const Split: { [name: string]: { proto: Protocol, map: { [f: string]: string } } } = {
    REST:   { proto: "REST",    map: {} },
    MQTT:   { proto: "MQTT",    map: {} },
    OPCUA:  { proto: "OPC UA",  map: { "Defined by Protocol": "JSON" } },
    UDP:    { proto: "UDP",     map: {} },
};

/* Stands in for the client `fplus.MQTT.basic_sparkplug_node()` gives
 * the agent's SparkplugNode, publishing what the agent sends to a
 * local broker with the Sparkplug B encoder the real client uses. */
class LocalSparkplugClient extends EventEmitter {
    mq?:    mqtt.MqttClient
    seq = 0
    url:    string
    base:   string

    constructor (url: string, group: string, node: string) {
        super();
        this.url = url;
        this.base = `spBv1.0/${group}`;
        this.node = node;
    }
    node: string

    connect () {
        this.mq = mqtt.connect(this.url);
        this.mq.on("connect", () => {
            this.mq!.subscribe(`${this.base}/DCMD/${this.node}/+`);
            this.emit("connect");
            this.emit("birth");
        });
        /* Commands reach the agent as the real client gives them. */
        this.mq.on("message", (topic, msg) => {
            const device = topic.split("/")[4];
            this.emit("dcmd", device, SpB.decodePayload(msg));
        });
    }

    stop () {
        const kind = "NDEATH";
        this.mq?.publish(`${this.base}/${kind}/${this.node}`,
            Buffer.from(SpB.encodePayload({ timestamp: Date.now(), metrics: [] })));
        this.mq?.end();
    }

    #publish (kind: string, device: string | undefined, payload: any) {
        payload.seq = this.seq;
        this.seq = this.seq < 255 ? this.seq + 1 : 0;
        const topic = `${this.base}/${kind}/${this.node}${device ? `/${device}` : ""}`;
        this.mq?.publish(topic, Buffer.from(SpB.encodePayload(payload)));
    }

    publishNodeBirth (p: any) { this.seq = 0; this.#publish("NBIRTH", undefined, p); }
    publishDeviceBirth (d: string, p: any) { this.#publish("DBIRTH", d, p); }
    publishNodeData (p: any) { this.#publish("NDATA", undefined, p); }
    publishDeviceData (d: string, p: any) { this.#publish("DDATA", d, p); }
    publishDeviceDeath (d: string, p: any) { this.#publish("DDEATH", d, p); }
}

function fake_fplus (config: any, client: LocalSparkplugClient, uuid: string) {
    const sparkplug = {
        group: "Rig", node: client.node,
        toString () { return `Rig/${client.node}`; },
    };
    return {
        Auth: { find_principal: async () => ({ uuid, sparkplug }) },
        ConfigDB: { get_config_with_etag: async () => [config, `"${uuid}"`] },
        MQTT: { basic_sparkplug_node: async () => client },
    } as any;
}

/* The entry as service-setup leaves it after the move. */
function moved (entry: any, map: { [f: string]: string }) {
    const def = { name: "Split driver (local)" };
    return move_entry(entry, def, (f: string) => move_payload_format(f, map, true));
}

interface Agent {
    translator: Translator,
    drivers:    ChildProcess[],
    dir:        string,
}

async function start_agent (rig: Rig, node: string, conns: RigConnection[],
    broker_url: string, split: Map<Protocol, string>): Promise<Agent>
{
    let entries = conns.map(c => {
        const e = rig_entry(c, { host: "127.0.0.1", password: c => c.password });
        const s = Object.values(Split).find(s => s.proto == c.protocol)!;
        return split.has(c.protocol) ? moved(e, s.map) : e;
    });
    entries = set_driver_ids(entries);
    const config = { sparkplug: {}, deviceConnections: entries };

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rig-local-"));
    const client = new LocalSparkplugClient(broker_url, "Rig", node);
    const fplus = fake_fplus(JSON.parse(JSON.stringify(config)), client,
        crypto.randomUUID());
    const broker = new DriverBroker({ EDGE_MQTT: "mqtt://127.0.0.1:0", EDGE_PASSWORDS: dir });
    const translator = new Translator(fplus, 1, broker);
    await translator.start();

    const drivers: ChildProcess[] = [];
    for (const [i, e] of entries.entries()) {
        if (e.connType != "Driver") continue;
        const bin = split.get(conns[i].protocol)!;
        const id = driver_id(e);
        const password = crypto.randomBytes(16).toString("hex");
        fs.writeFileSync(path.join(dir, id), password);
        const { port } = translator.broker.server!.address() as net.AddressInfo;
        const child = spawn(bin, [], {
            env: {
                ...process.env,
                EDGE_MQTT: `mqtt://127.0.0.1:${port}`,
                EDGE_USERNAME: id, EDGE_PASSWORD: password,
                /* Each sidecar has a filesystem of its own on a
                 * cluster. Here they share one, so give edge-opcua a
                 * certificate folder each. */
                OPCUA_PKI_DIR: path.join(dir, `pki-${id}`),
            },
            stdio: ["ignore", "inherit", "inherit"],
        });
        drivers.push(child);
        console.log("Started %s for %s as driver %s", bin, e.name, id);
    }
    return { translator, drivers, dir };
}

function parse_args (argv: string[]) {
    const args: { [k: string]: string } = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith("--")) throw new Error(`Unexpected argument ${a}`);
        args[a.slice(2)] = argv[++i];
    }
    return args;
}

async function main () {
    const args = parse_args(process.argv.slice(2));
    if (!args.rig || !args.only || !args.out) {
        console.error("Usage: local --rig <rig.json> --only <id,...> --seconds <n> --out <file> "
            + "[--label name] [--split PROTO=driver,...] [--outage id:from:length] [--broker-port n]");
        process.exit(2);
    }
    const rig = read_rig(args.rig);
    const only = args.only.split(",");
    const conns = rig.connections.filter(c => only.includes(c.id));
    const missing = only.filter(id => !conns.some(c => c.id == id));
    if (missing.length) throw new Error(`Not in the rig: ${missing.join(", ")}`);

    const split = new Map<Protocol, string>();
    for (const s of (args.split ?? "").split(",").filter(x => x)) {
        const [name, bin] = s.split("=");
        if (!Split[name]) throw new Error(`Unknown protocol ${name}`);
        split.set(Split[name].proto, bin);
    }
    const unsplit = [...new Set(conns.map(c => c.protocol)
        .filter(p => !split.has(p)))];
    if (unsplit.length)
        throw new Error(`No --split driver for ${unsplit.join(", ")}. The Edge `
            + `Agent has no built-in connections since ACS 7, so every chosen `
            + `connection needs its split driver. For a built-in run, build the `
            + `rig from a tree that still has them.`);

    /* The rig only has the chosen connections and their nodes, so the
     * summary only covers them. */
    const nodes = new Set(conns.map(c => c.node));
    const part: Rig = {
        ...rig,
        nodes: rig.nodes.filter(n => nodes.has(n.name)),
        connections: conns,
    };

    const port = Number(args["broker-port"] ?? 1884);
    const aedes = new Aedes();
    const server = net.createServer(aedes.handle as any);
    await new Promise<void>(r => server.listen(port, "127.0.0.1", () => r()));
    const url = `mqtt://127.0.0.1:${port}`;

    const mocks: Mock[] = [];
    for (const c of conns) {
        const m = make_mock(rig, c, { advertise: "127.0.0.1", udp_target: "127.0.0.1" });
        await m.start();
        mocks.push(m);
        console.log("Mock %s (%s %s) on port %d", c.id, c.protocol, c.name, c.port);
    }

    /* Start recording before the agents, so their births are seen. */
    const recording = record(part, {
        seconds: args.seconds ?? "120", label: args.label ?? "local", "mqtt-url": url,
    });
    await sleep(500);

    const agents: Agent[] = [];
    for (const node of nodes)
        agents.push(await start_agent(rig, node,
            conns.filter(c => c.node == node), url, split));

    if (args.outage) {
        const [id, from, len] = args.outage.split(":");
        const mock = mocks.find(m => m.conn.id == id);
        if (!mock) throw new Error(`No mock ${id}`);
        setTimeout(async () => {
            console.log("Outage: stopping %s for %s s", id, len);
            await mock.stop();
            await sleep(Number(len) * 1000);
            console.log("Outage: starting %s again", id);
            await mock.start();
        }, Number(from) * 1000);
    }

    if (args.write) {
        const [id, device, metric, value, at] = args.write.split(":");
        const c = conns.find(c => c.id == id);
        const tag = c?.connection.devices?.find((d: any) => d.deviceId == device)
            ?.tags?.find((t: any) => t.Name == metric);
        if (!c || !tag) throw new Error(`No metric ${metric} on ${id}/${device}`);
        const type = sparkplug_type(tag.type);
        const v = type == "Boolean" ? value == "true"
            : /Int|Float|Double/.test(type) ? Number(value) : value;
        setTimeout(() => {
            console.log("Write: %s/%s %s = %o", c.node, device, metric, v);
            const mq = mqtt.connect(url);
            mq.on("connect", () => {
                mq.publish(`spBv1.0/Rig/DCMD/${c.node}/${device}`,
                    Buffer.from(SpB.encodePayload({
                        timestamp: Date.now(),
                        metrics: [{ name: metric, type: type as any, value: v }],
                    })), () => mq.end());
            });
        }, Number(at ?? 30) * 1000);
    }

    const summary = await recording;
    fs.writeFileSync(args.out, JSON.stringify(summary, null, 1) + "\n");
    const { print_summary } = await import("./summary.js");
    print_summary(summary);
    for (const m of mocks) console.log("Mock %s: %o", m.conn.id, m.status());

    /* Translator.stop() doesn't wait for its devices (noted in the
     * golden harness). The recording is saved, so let shutdown errors
     * pass. */
    process.on("unhandledRejection", e => console.log("At shutdown: %s", e));
    process.on("uncaughtException", e => console.log("At shutdown: %s", e));
    for (const a of agents) {
        for (const d of a.drivers) d.kill("SIGTERM");
        await a.translator.stop().catch(() => {});
        fs.rmSync(a.dir, { recursive: true, force: true });
    }
    await Promise.all(mocks.map(m => m.stop().catch(() => {})));
    console.log("Saved to %s", args.out);
    process.exit(0);
}

await main();

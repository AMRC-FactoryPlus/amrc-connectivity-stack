/*
 * ACS Edge Agent
 * Split-driver cluster rig: watch the rig's Sparkplug output
 * Copyright 2026 University of Sheffield
 *
 *   check record --rig <rig.json> --seconds <n> --out <file.json>
 *       [--label <name>] [--mqtt-url <url>] [--rebirth]
 *       [--watch <node>/<device>/<metric>]
 *   check compare <before.json> <after.json> [--rig <rig.json>]
 *
 * `record` subscribes to the Sparkplug topics of the rig's Edge Agents
 * for a while and writes a summary per connection and device: the
 * metrics and types each device was born with, which metrics got
 * values and which changed, DDATA messages per second, births, deaths,
 * and the longest time a device went without data. It only reads,
 * unless --rebirth is given, which asks each rig Edge Agent to rebirth
 * once at the start, as the Manager's Rebirth button does, so a
 * recording that starts while the agents are already running learns
 * metric names (DDATA carries only aliases).
 *
 * --watch also prints every value one metric was published with, and
 * its device's births and deaths, for the reconnect checks. It names
 * the rig Edge Agent, the device id and the Sparkplug metric name.
 *
 * It connects as a service client (DIRECTORY_URL, SERVICE_USERNAME,
 * SERVICE_PASSWORD), or straight to a broker with --mqtt-url, which is
 * how the local runner uses it.
 *
 * `compare` sets two summaries side by side: see summary.ts.
 */

import fs from "fs";

import { Address, ServiceClient, UUIDs } from "@amrc-factoryplus/service-client";
import mqtt from "mqtt";

import type { Captured, Kind } from "../golden/capture.js";
import { Rig, read_rig } from "./rig.js";
import {
    Summary, compare_summaries, print_comparison, print_summary, print_watch,
    summarise, watch,
} from "./summary.js";

const KINDS = ["NBIRTH", "NDEATH", "DBIRTH", "DDEATH", "DDATA", "NDATA"];

/* Topic -> who sent it. spBv1.0/<group>/<type>/<node>[/<device>] */
function parse_topic (topic: string) {
    const [ns, group, type, node, device] = topic.split("/");
    if (ns != "spBv1.0" || !KINDS.includes(type)) return;
    return { group, type: type as Kind, node, device };
}

async function connect (args: Args): Promise<{ client: mqtt.MqttClient, fplus?: any }> {
    if (args["mqtt-url"])
        return { client: mqtt.connect(args["mqtt-url"] as string, { reconnectPeriod: 2000 }) };
    if (!process.env.DIRECTORY_URL)
        throw new Error("Set DIRECTORY_URL, SERVICE_USERNAME and SERVICE_PASSWORD, or give --mqtt-url");
    const fplus = new ServiceClient({ env: process.env });
    const client = await fplus.MQTT.mqtt_client({});
    return { client, fplus };
}

/* Ask each rig node to rebirth, as the Manager's button does. */
async function rebirth (fplus: any, rig: Rig) {
    const addrs: Map<string, any> = await fplus.ConfigDB.get_all_configs(
        (UUIDs as any).App.SparkplugAddress);
    const want = new Set(rig.nodes.map(n => n.name));
    for (const addr of addrs.values()) {
        if (!want.has(addr?.node_id) || addr.device_id) continue;
        try {
            await fplus.CmdEsc.rebirth(new Address(addr.group_id, addr.node_id));
            console.log("Asked %s/%s to rebirth", addr.group_id, addr.node_id);
        }
        catch (e: any) {
            console.log("Rebirth of %s failed: %s", addr.node_id, e.message ?? e);
        }
    }
}

type Args = { [k: string]: string | boolean };

function parse_args (argv: string[]) {
    const pos: string[] = [];
    const args: Args = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a == "--rebirth") args.rebirth = true;
        else if (a.startsWith("--")) args[a.slice(2)] = argv[++i];
        else pos.push(a);
    }
    return { pos, args };
}

export async function record (rig: Rig, args: Args): Promise<Summary> {
    const seconds = Number(args.seconds ?? 300);
    const { client, fplus } = await connect(args);
    const by_node = new Map<string, Captured[]>();
    const names = new Set(rig.nodes.map(n => n.name));

    client.on("message", (topic, payload) => {
        const t = parse_topic(topic);
        if (!t || !names.has(t.node)) return;
        const list = by_node.get(t.node) ?? [];
        list.push({ kind: t.type, device: t.device, at: Date.now(), bytes: payload });
        by_node.set(t.node, list);
    });
    await new Promise<void>((resolve, reject) => {
        if (client.connected) return resolve();
        client.once("connect", () => resolve());
        client.once("error", reject);
    });
    const topics = rig.nodes.flatMap(n => [`spBv1.0/+/+/${n.name}`, `spBv1.0/+/+/${n.name}/+`]);
    await client.subscribeAsync(topics);
    const started = Date.now();
    console.log("Recording %d Edge Agents for %d s", rig.nodes.length, seconds);
    if (args.rebirth && fplus) await rebirth(fplus, rig);

    const tick = setInterval(() => {
        const n = [...by_node.values()].reduce((s, l) => s + l.length, 0);
        console.log("%d s: %d messages", Math.round((Date.now() - started) / 1000), n);
    }, 60_000);
    await new Promise(r => setTimeout(r, seconds * 1000));
    clearInterval(tick);
    const ended = Date.now();
    await client.endAsync();

    if (typeof args.watch == "string") {
        const [node, device, ...metric] = args.watch.split("/");
        const lines = watch(by_node.get(node) ?? [], device, metric.join("/"), started);
        print_watch(device, metric.join("/"), lines);
    }
    return summarise(rig, String(args.label ?? "recording"), started, ended, by_node);
}

async function main () {
    const { pos, args } = parse_args(process.argv.slice(2));
    const [cmd, ...files] = pos;
    if (cmd == "record" && typeof args.rig == "string" && typeof args.out == "string") {
        const s = await record(read_rig(args.rig), args);
        fs.writeFileSync(args.out, JSON.stringify(s, null, 1) + "\n");
        print_summary(s);
        console.log("\nSaved to %s", args.out);
    }
    else if (cmd == "compare" && files.length == 2) {
        const [a, b] = files.map(f => JSON.parse(fs.readFileSync(f, "utf8")) as Summary);
        const problems = compare_summaries(a, b);
        print_comparison(a, b, problems);
        process.exit(problems.some(p => p.level == "FAIL") ? 1 : 0);
    }
    else {
        console.error("Usage: check record --rig <rig.json> --seconds <n> --out <file> "
            + "[--label name] [--mqtt-url url] [--rebirth] [--watch node/device/metric]\n"
            + "       check compare <before.json> <after.json>");
        process.exit(2);
    }
    process.exit(0);
}

if (process.argv[1]?.match(/check\.[jt]s$/))
    await main();

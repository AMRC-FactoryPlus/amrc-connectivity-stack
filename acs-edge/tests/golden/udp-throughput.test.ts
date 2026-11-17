/*
 * ACS Edge Agent
 * UDP throughput: the built-in connection against a split driver
 * Copyright 2026 University of Sheffield
 */

/* Sends numbered datagrams at fixed rates to the real Edge Agent, once
 * through the built-in UDP connection and once through a split driver,
 * and reports for each run how many datagrams reached the agent's
 * Sparkplug output, whether they stayed in order, and the CPU and
 * memory the agent and the driver used.
 *
 * It takes minutes, so it only runs when asked:
 *
 *   UDP_THROUGHPUT=1 GOLDEN_DRIVER=<edge-udp binary> npx jest tests/golden/udp-throughput
 *
 * UDP_THROUGHPUT_RATES (datagrams a second, comma separated),
 * UDP_THROUGHPUT_SECONDS (how long each rate is sent for, default 5),
 * UDP_THROUGHPUT_CASES (payload cases by name) and UDP_THROUGHPUT_OUT
 * (a file for the results as JSON) change what runs. The CPU and
 * memory figures come from /proc, so run it on Linux.
 *
 * The datagrams are made up: a sequence number and twelve doubles, as
 * a robot might send its joint positions, as a 100-byte Buffer, as
 * JSON, or as a Buffer padded to 1,400 bytes. Every value changes in
 * every datagram, so each datagram makes one DDATA of 13 metrics. */

import { ChildProcess, spawn } from "child_process";
import crypto from "crypto";
import { EventEmitter } from "events";
import type { AddressInfo } from "net";
import fs from "fs";
import os from "os";
import path from "path";

import * as sparkplug from "sparkplug-payload";

import { DriverBroker } from "../../lib/driverBroker.js";
import { Translator } from "../../lib/translator.js";

import { fake_fplus } from "./capture.js";
import { free_udp_port, sleep } from "./devices/device.js";
import { to_split } from "./migrate.js";

const SpB = sparkplug.get("spBv1.0")!;

const ENABLED = !!process.env.UDP_THROUGHPUT;
const DRIVER = process.env.GOLDEN_DRIVER?.trim();
const RATES = (process.env.UDP_THROUGHPUT_RATES ?? "100,1000,10000")
    .split(",").map(Number).filter(n => n > 0);
const SECONDS = Number(process.env.UDP_THROUGHPUT_SECONDS) || 5;

/* Sequence numbers at or above this are readiness probes, sent before
 * the run starts and left out of the results. */
const PROBE_BASE = 0xffff0000;

interface Case {
    name:   string,
    format: "Buffer" | "JSON",
    /* Bytes per datagram, for a Buffer case. */
    size?:  number,
}

const CASES: Case[] = ([
    { name: "buffer-100B", format: "Buffer", size: 100 },
    { name: "json", format: "JSON" },
    { name: "buffer-1400B", format: "Buffer", size: 1400 },
] as Case[]).filter(c => !process.env.UDP_THROUGHPUT_CASES
    || process.env.UDP_THROUGHPUT_CASES.split(",").includes(c.name));

/* The connection the agent runs: one device reading the sequence
 * number and twelve doubles from every datagram. */
function connection (c: Case, port: number) {
    const tag = (name: string, type: string, p: string) => ({
        Name: name, type, method: "GET", address: "", path: p,
        value: null, recordToDB: false,
    });
    const tags = c.format == "Buffer"
        ? [tag("seq", "UInt32BE", "0"),
            ...Array.from({ length: 12 }, (_, i) =>
                tag(`v${i}`, "DoubleBE", String(4 + 8 * i)))]
        : [tag("seq", "UInt32", "$.seq"),
            ...Array.from({ length: 12 }, (_, i) =>
                tag(`v${i}`, "Double", `$.v[${i}]`))];
    return {
        name: "udp-throughput",
        uuid: "00000000-0000-4000-8000-000000000002",
        connType: "UDP",
        payloadFormat: c.format,
        pollInt: 1000,
        devices: [{
            deviceId: "Robot",
            deviceType: "00000000-0000-4000-8000-000000000001",
            pollInt: 1000,
            pubInterval: 0,
            payloadFormat: c.format,
            templates: [],
            tags,
        }],
        UDPConnDetails: { port },
    };
}

/* The sender, as a child process so its CPU is not counted as the
 * agent's. It sends `count` datagrams at `rate` a second, or probes
 * when count is 0, and reports when it has finished. */
const SENDER = `
const dgram = require("dgram");
const [port, rate, count, format, size] = process.argv.slice(1).map((v, i) => i == 3 ? v : Number(v));
const sock = dgram.createSocket("udp4");
function payload (seq) {
    const vals = Array.from({ length: 12 }, (_, i) => Math.sin(seq / 100 + i) * 100 + seq);
    if (format == "JSON") return Buffer.from(JSON.stringify({ seq, v: vals }));
    const b = Buffer.alloc(size);
    b.writeUInt32BE(seq >>> 0, 0);
    vals.forEach((v, i) => b.writeDoubleBE(v, 4 + 8 * i));
    return b;
}
function send (seq) { sock.send(payload(seq), port, "127.0.0.1"); }
process.on("message", m => {
    if (m.probe != null) { send(m.probe); return; }
});
if (count > 0) {
    let sent = 0;
    const start = process.hrtime.bigint();
    const tick = () => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        const due = Math.min(count, Math.floor(ms * rate / 1000) + 1);
        while (sent < due) send(++sent);
        if (sent < count) setImmediate(tick);
        else {
            const secs = Number(process.hrtime.bigint() - start) / 1e9;
            setTimeout(() => process.send({ done: sent, secs }, () => process.exit(0)), 50);
        }
    };
    process.on("message", m => { if (m.go) tick(); });
}
process.send({ ready: true });
`;

function sender (args: (string | number)[]): ChildProcess {
    return spawn(process.execPath, ["-e", SENDER, ...args.map(String)],
        { stdio: ["ignore", "inherit", "inherit", "ipc"] });
}

function next_message (child: ChildProcess, key: string): Promise<any> {
    return new Promise(resolve => {
        const on = (m: any) => {
            if (m[key] === undefined) return;
            child.off("message", on);
            resolve(m);
        };
        child.on("message", on);
    });
}

/* A Sparkplug client that encodes what the agent publishes, as the
 * real one does, and keeps only the sequence numbers. */
class SeqClient extends EventEmitter {
    seqs: number[] = []
    born = false
    connect () { setImmediate(() => { this.emit("connect"); this.emit("birth"); }); }
    #seq_alias?: string
    publishNodeBirth (p: any) { SpB.encodePayload(p); }
    publishNodeData (p: any) { SpB.encodePayload(p); }
    publishDeviceDeath (_d: string, p: any) { SpB.encodePayload(p); }
    publishDeviceBirth (_d: string, p: any) {
        SpB.encodePayload(p);
        const m = (p.metrics ?? []).find((m: any) => m.name == "seq");
        this.#seq_alias = m?.alias?.toString();
        this.born = true;
    }
    publishDeviceData (_d: string, p: any) {
        SpB.encodePayload(p);
        for (const m of p.metrics ?? [])
            if (m.name == "seq" || m.alias?.toString() == this.#seq_alias)
                this.seqs.push(Number(m.value));
    }
}

/* CPU microseconds and memory of a process, from /proc. */
function proc_stats (pid: number) {
    try {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
        const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
        const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
        const kb = (k: string) => Number(new RegExp(`${k}:\\s+(\\d+)`).exec(status)?.[1] ?? 0);
        return {
            cpu_us: (Number(f[11]) + Number(f[12])) * 10_000,
            rss_kb: kb("VmRSS"),
            hwm_kb: kb("VmHWM"),
        };
    }
    catch { return undefined; }
}

/* Datagrams the kernel dropped on 0.0.0.0:port. */
function kernel_drops (port: number): number | undefined {
    try {
        const local = `00000000:${port.toString(16).toUpperCase().padStart(4, "0")}`;
        const line = fs.readFileSync("/proc/net/udp", "utf8").split("\n")
            .find(l => l.trim().split(/\s+/)[1] == local);
        return line ? Number(line.trim().split(/\s+/).pop()) : undefined;
    }
    catch { return undefined; }
}

export interface Result {
    case:       string,
    path:       "built-in" | "split",
    rate:       number,
    sent:       number,
    /* The rate the sender achieved. */
    sent_rate:  number,
    received:   number,
    lost:       number,
    /* Dropped by the kernel because the socket's reader fell behind. */
    kernel_lost?: number,
    in_order:   boolean,
    /* Share of one CPU, from the first datagram to the last output. */
    agent_cpu:  number,
    agent_rss_mb: number,
    agent_rss_growth_mb: number,
    driver_cpu?: number,
    driver_rss_mb?: number,
    driver_peak_mb?: number,
    /* Seconds from the first datagram to the last output. */
    window_s:   number,
}

async function run (c: Case, rate: number, split: boolean): Promise<Result> {
    const port = await free_udp_port();
    let entry: any = connection(c, port);
    if (split) entry = to_split(entry, "UDP");
    const client = new SeqClient();
    const fplus = fake_fplus({ deviceConnections: [entry] }, client as any);
    const pwdir = fs.mkdtempSync(path.join(os.tmpdir(), "udp-throughput-"));
    const saved = { log: console.log, info: console.info, error: console.error };
    const lines: string[] = [];
    if (!process.env.GOLDEN_VERBOSE)
        console.log = console.info = console.error =
            (...a: any[]) => { lines.push(a.join(" ")); if (lines.length > 200) lines.shift(); };

    let translator: Translator | undefined;
    let driver: ChildProcess | undefined;
    const count = rate * SECONDS;
    const tx = sender([port, rate, count, c.format, c.size ?? 0]);
    try {
        await next_message(tx, "ready");
        translator = new Translator(fplus, 1,
            new DriverBroker({ EDGE_MQTT: "mqtt://127.0.0.1:0", EDGE_PASSWORDS: pwdir }));
        await translator.start();
        if (split) {
            const password = crypto.randomBytes(16).toString("hex");
            /* The id the chart gives the sidecar, as in harness.ts. */
            const id = entry.driverId ?? entry.name;
            fs.writeFileSync(path.join(pwdir, id), password);
            const { port: mport } = translator.broker.server!.address() as AddressInfo;
            const [cmd, ...args] = DRIVER!.split(/\s+/);
            driver = spawn(cmd, args, {
                env: { ...process.env, EDGE_MQTT: `mqtt://127.0.0.1:${mport}`,
                    EDGE_USERNAME: id, EDGE_PASSWORD: password },
                stdio: ["ignore", "pipe", "pipe"],
            });
            const keep = (b: Buffer) => {
                lines.push(b.toString().trimEnd());
                if (process.env.GOLDEN_VERBOSE)
                    process.stderr.write(`[${c.name} ${rate}] ${b}`);
            };
            driver.stdout!.on("data", keep);
            driver.stderr!.on("data", keep);
        }

        /* Ready when a probe comes out the other side. */
        for (let i = 0; !client.seqs.some(s => s >= PROBE_BASE); i++) {
            if (i > 400) throw new Error("The connection never delivered a probe");
            if (client.born) tx.send({ probe: PROBE_BASE + i });
            await sleep(50);
        }
        await sleep(200);
        client.seqs = [];

        const a0 = process.cpuUsage();
        const d0 = driver ? proc_stats(driver.pid!) : undefined;
        const rss0 = process.memoryUsage().rss;
        let rss_peak = rss0;
        let drss_peak = 0;
        const sampler = setInterval(() => {
            rss_peak = Math.max(rss_peak, process.memoryUsage().rss);
            if (driver) drss_peak = Math.max(drss_peak, proc_stats(driver.pid!)?.rss_kb ?? 0);
        }, 100);
        const t0 = Date.now();
        const done = next_message(tx, "done");
        tx.send({ go: true });
        const sent = await done;

        /* Wait for the output to stop: nothing new for a second, or
         * everything arrived. */
        let last_n = -1, last_change = Date.now(), last_out = Date.now();
        while (client.seqs.length < sent.done && Date.now() - last_change < 1000
            && Date.now() - t0 < SECONDS * 1000 + 60_000) {
            if (client.seqs.length != last_n) {
                last_n = client.seqs.length;
                last_change = last_out = Date.now();
            }
            await sleep(20);
        }
        if (client.seqs.length != last_n) last_out = Date.now();
        clearInterval(sampler);
        const a1 = process.cpuUsage(a0);
        const d1 = driver ? proc_stats(driver.pid!) : undefined;
        const window_s = Math.max(0.001, (last_out - t0) / 1000);

        const seqs = client.seqs.filter(s => s < PROBE_BASE);
        const in_order = seqs.every((s, i) => i == 0 || s > seqs[i - 1]);
        const received = new Set(seqs).size;
        return {
            case: c.name, path: split ? "split" : "built-in", rate,
            sent: sent.done, sent_rate: Math.round(sent.done / sent.secs),
            received, lost: sent.done - received,
            kernel_lost: kernel_drops(port),
            in_order,
            agent_cpu: (a1.user + a1.system) / 1e6 / window_s,
            agent_rss_mb: rss_peak / 2 ** 20,
            agent_rss_growth_mb: (rss_peak - rss0) / 2 ** 20,
            driver_cpu: d0 && d1 ? (d1.cpu_us - d0.cpu_us) / 1e6 / window_s : undefined,
            driver_rss_mb: drss_peak ? drss_peak / 1024 : undefined,
            driver_peak_mb: d1 ? d1.hwm_kb / 1024 : undefined,
            window_s,
        };
    }
    catch (e: any) {
        e.message += `\n\nOutput:\n${lines.join("\n")}`;
        throw e;
    }
    finally {
        tx.kill();
        if (driver) {
            driver.kill("SIGTERM");
            await new Promise(r => driver!.exitCode != null ? r(null) : driver!.once("exit", r));
        }
        await translator?.stop().catch(() => {});
        await sleep(100);
        Object.assign(console, saved);
        fs.rmSync(pwdir, { recursive: true, force: true });
    }
}

function table (rs: Result[]): string {
    const pct = (x?: number) => x == undefined ? "-" : `${Math.round(x * 100)}%`;
    const mb = (x?: number) => x == undefined ? "-" : x.toFixed(1);
    const rows = rs.map(r => [
        r.case, r.path, r.rate, r.sent_rate, r.sent, r.received,
        r.lost ? `${r.lost} (${(100 * r.lost / r.sent).toFixed(1)}%)` : "0",
        r.kernel_lost ?? "-", r.in_order ? "yes" : "NO",
        pct(r.agent_cpu), mb(r.agent_rss_growth_mb),
        pct(r.driver_cpu), mb(r.driver_peak_mb),
    ].join(" | "));
    return [
        "case | path | rate/s | sent/s | sent | received | lost | kernel drops | in order | agent CPU | agent RSS growth MB | driver CPU | driver peak RSS MB",
        "---|---|---|---|---|---|---|---|---|---|---|---|---",
        ...rows.map(r => r),
    ].join("\n");
}

(ENABLED ? describe : describe.skip)("UDP throughput", () => {
    jest.setTimeout(3_600_000);

    it("reports loss, order, CPU and memory for built-in and split", async () => {
        if (!DRIVER) throw new Error("Set GOLDEN_DRIVER to the edge-udp binary");
        const results: Result[] = [];
        for (const c of CASES)
            for (const rate of RATES)
                for (const split of [false, true]) {
                    const r = await run(c, rate, split);
                    results.push(r);
                    process.stdout.write(`${JSON.stringify(r)}\n`);
                }
        const sysctl = (k: string) => {
            try { return fs.readFileSync(`/proc/sys/net/core/${k}`, "utf8").trim(); }
            catch { return "?"; }
        };
        process.stdout.write(`\n${os.arch()}, ${os.cpus().length} CPUs, `
            + `net.core.rmem_default ${sysctl("rmem_default")}, `
            + `rmem_max ${sysctl("rmem_max")}, `
            + `driver UDP_RECV_BUFFER ${process.env.UDP_RECV_BUFFER ?? "default"}\n`);
        process.stdout.write(`\n${table(results)}\n`);
        if (process.env.UDP_THROUGHPUT_OUT)
            fs.writeFileSync(process.env.UDP_THROUGHPUT_OUT,
                JSON.stringify(results, null, 2) + "\n");
        /* Order must hold at every rate on both paths. Loss is
         * reported, not asserted: it depends on the machine. */
        expect(results.filter(r => !r.in_order)).toEqual([]);
    });
});

/*
 * ACS Edge Agent
 * Golden-output harness: run the Edge Agent against a fixture
 * Copyright 2026 University of Sheffield
 */

import crypto from "crypto";
import type { AddressInfo } from "net";
import fs from "fs";
import os from "os";
import path from "path";

import { DriverBroker } from "../../lib/driverBroker.js";
import { Translator } from "../../lib/translator.js";

import type { Fixture } from "../fixtures/drivers/fixture.js";
import { CaptureClient, decode, fake_fplus, Metric, Output } from "./capture.js";
import { compare, Comparison, DEFAULT_TIME_ALLOWANCE_MS, report } from "./compare.js";
import { sleep } from "./devices/device.js";
import { make_device } from "./devices/index.js";
import type { DriverSpec, RunningDriver } from "./driver.js";
import { to_split, without_unread_paths } from "./migrate.js";

/* The poll or publish interval a run uses in real time, unless
 * GOLDEN_INTERVAL_MS says otherwise. Fixture time is sped up so that
 * the fixture's interval takes this long. CI runners are slower and
 * run other suites alongside, so CI (which sets CI=true) uses a
 * slower rate. */
export const DEFAULT_INTERVAL_MS = process.env.CI ? 400 : 200;

export interface RunOpts {
    /* Leave out for the built-in connection. With a driver, the
     * connection is switched to `Driver` and this driver serves it. */
    driver?:    DriverSpec,
    /* The connection entry to run, if not the fixture's. It must have
     * the fixture's devices. An entry that is already `Driver`, as
     * service-setup left it, is run as it is; any other is moved to
     * the split driver when there is a driver. */
    entry?:     any,
    /* The connection's name, if not the fixture's. */
    connection_name?: string,
    /* Secrets for the agent to fill `__FPSI__` placeholders from, as
     * the chart mounts them, keyed by placeholder. */
    secrets?:   { [placeholder: string]: string },
    /* Keep the connection's security and credentials, where the fake
     * device can check them (see DeviceOpts). */
    secure?:    boolean,
    /* Sparkplug commands to send the agent, each at its fixture time
     * after the device first delivers input. */
    commands?:  Command[],
    /* Give up after this long. */
    timeout_ms?: number,
}

/* A DCMD setting one metric of one device. */
export interface Command {
    t:          number,
    device:     string,
    metric:     string,
    type:       string,
    value:      any,
}

/* CPU time in microseconds, split at the moment the fake device first
 * delivers input. Startup is the agent (and driver) coming up; the
 * rest is the work done per message, which is what to compare. */
export interface CpuUse {
    /* This process from the first input to the end of input: the
     * agent, plus the fake device and the capture, which do the same
     * work in every run. */
    agent_us:           number,
    agent_startup_us:   number,
    /* A spawned driver process, if there is one. Resolution is 10 ms. */
    driver_us?:         number,
    driver_startup_us?: number,
}

export interface RunResult {
    label:      string,
    /* The driver that served the connection, if not the built-in. */
    driver?:    string,
    output:     Output,
    t0:         number,
    /* Messages or responses the fake device delivered. */
    delivered:  number,
    ddata:      number,
    cpu:        CpuUse,
    wall_ms:    number,
    /* The share of one CPU this process used from the first input to
     * the end. Near 1, the agent cannot keep up at this speed. */
    busy:       number,
    /* What the agent and driver printed, for a failure report. */
    log:        string,
    /* The credentials the device saw, sorted. */
    credentials: string[],
    /* The values written to the device, in order. */
    writes:     string[],
    timed_out:  boolean,
}

/* How much faster than real time to run a fixture. */
export function speed_for (fixture: Fixture): number {
    const target = Number(process.env.GOLDEN_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
    return Math.max(1, fixture.meta.interval_ms / target);
}

/* The connection with its poll interval sped up. The Edge Agent copies
 * the connection's interval to each device (reHashConf). */
function scale (conn: any, speed: number) {
    const out = JSON.parse(JSON.stringify(conn));
    if (typeof out.pollInt == "number")
        out.pollInt = Math.max(10, Math.round(out.pollInt / speed));
    for (const d of out.devices ?? [])
        if (typeof d.pollInt == "number")
            d.pollInt = Math.max(10, Math.round(d.pollInt / speed));
    return out;
}

/* Hold console output while the agent runs, so a passing test prints
 * only its summary. GOLDEN_VERBOSE=1 lets it through. */
function hold_console () {
    const lines: string[] = [];
    if (process.env.GOLDEN_VERBOSE) return { lines, restore: () => {} };
    const saved = { log: console.log, info: console.info, error: console.error };
    const keep = (...a: any[]) => {
        lines.push(a.map(String).join(" "));
        if (lines.length > 400) lines.splice(0, lines.length - 300);
    };
    console.log = console.info = console.error = keep;
    return { lines, restore: () => Object.assign(console, saved) };
}

/* Translator.stop() does not wait for its devices to stop, so the
 * built-in MQTT connection closes its client while each device's
 * unsubscribe is still pending, and a device that shares a topic with
 * another gets an empty handle that mqtt.js refuses. Both reject with
 * nobody listening, which jest reports as a test failure. This is a
 * shutdown problem in the agent, not part of what is compared, so the
 * harness catches those rejections. */
function quiet_shutdown (translator: Translator) {
    for (const conn of Object.values(translator.connections ?? {})) {
        const unsub = conn.unsubscribe?.bind(conn);
        if (!unsub) continue;
        conn.unsubscribe = (h: any) => Promise.resolve()
            .then(() => unsub(h)).catch(() => {});
    }
}

/* Run the Edge Agent once against a fixture and capture its output. */
export async function run_agent (fixture: Fixture, opts: RunOpts = {}): Promise<RunResult> {
    const speed = speed_for(fixture);
    const label = opts.driver ? `split (${opts.driver.name})` : "built-in";
    const timeout = opts.timeout_ms
        ?? 30_000 + 3 * fixture.meta.duration_ms / speed;

    const device = make_device(fixture, { speed, secure: opts.secure });
    const held = hold_console();
    const pwdir = fs.mkdtempSync(path.join(os.tmpdir(), "golden-"));
    const secrets = fs.mkdtempSync(path.join(os.tmpdir(), "golden-secrets-"));
    const saved_secrets_path = process.env.SECRETS_PATH;
    let translator: Translator | undefined;
    let driver: RunningDriver | undefined;
    let timed_out = false;
    let result: RunResult | undefined;
    let failed: any;

    try {
        await device.start();
        let entry = without_unread_paths(
            scale(device.connection(opts.entry ?? fixture.connection), speed));
        if (opts.connection_name)
            entry.name = opts.connection_name;
        if (opts.driver && entry.connType != "Driver")
            entry = to_split(entry, fixture.meta.protocol);
        if (!opts.driver && entry.connType == "Driver")
            throw new Error("A Driver connection needs a driver to run it");
        if (opts.secrets) {
            for (const [name, value] of Object.entries(opts.secrets))
                fs.writeFileSync(path.join(secrets, name), value);
            process.env.SECRETS_PATH = secrets;
        }
        const config = { deviceConnections: [entry] };

        /* Port 0: the broker takes whatever port is free, and the
         * driver is told the port it got. */
        const env = {
            EDGE_MQTT:      "mqtt://127.0.0.1:0",
            EDGE_PASSWORDS: pwdir,
        };
        const client = new CaptureClient();
        /* reHashConf changes the config it is given. */
        const fplus = fake_fplus(JSON.parse(JSON.stringify(config)), client);

        const cpu0 = process.cpuUsage();
        const start = Date.now();
        translator = new Translator(fplus, 1, new DriverBroker(env));
        await translator.start();
        if (!translator.sparkplugNode)
            throw new Error("The Edge Agent did not start");

        if (opts.driver) {
            const password = crypto.randomBytes(16).toString("hex");
            /* The id the chart gives the sidecar: see driver_id in
             * lib/js-service-client/lib/edge-connection.js. */
            const id = entry.driverId ?? entry.name;
            fs.writeFileSync(path.join(pwdir, id), password);
            const { port } = translator.broker.server!.address() as AddressInfo;
            driver = await opts.driver.start({
                EDGE_MQTT:      `mqtt://127.0.0.1:${port}`,
                EDGE_USERNAME:  id,
                EDGE_PASSWORD:  password,
            });
        }

        /* Take CPU readings when the first input is delivered. */
        let done = false;
        const first = (async () => {
            while (device.t0 == undefined && !done) await sleep(2);
            return { agent: process.cpuUsage(), driver: await driver?.cpu_us() };
        })();

        /* Commands go to the agent as its Sparkplug client would hand
         * them over. */
        const commands = (async () => {
            await first;
            for (const c of [...opts.commands ?? []].sort((x, y) => x.t - y.t)) {
                const wait = device.t0! + c.t / speed - Date.now();
                if (wait > 0) await sleep(wait);
                if (done) return;
                client.emit("dcmd", c.device,
                    { metrics: [{ name: c.metric, type: c.type, value: c.value }] });
            }
        })();

        let timer: NodeJS.Timeout | undefined;
        await Promise.race([
            device.finished(),
            new Promise<void>(r => timer = setTimeout(() => {
                timed_out = true;
                r();
            }, timeout)),
        ]);
        clearTimeout(timer);
        done = true;

        const at_t0 = await first;
        await commands;
        const cpu_end = process.cpuUsage();
        const driver_end = await driver?.cpu_us();
        const end = Date.now();
        const wall_ms = end - start;
        client.stop();

        const used = (a: NodeJS.CpuUsage, b: NodeJS.CpuUsage) =>
            (a.user - b.user) + (a.system - b.system);
        const less = (a?: number, b?: number) =>
            a == undefined || b == undefined ? undefined : a - b;
        const cpu: CpuUse = {
            agent_us:           used(cpu_end, at_t0.agent),
            agent_startup_us:   used(at_t0.agent, cpu0),
            driver_us:          less(driver_end, at_t0.driver),
            driver_startup_us:  at_t0.driver,
        };

        const output = decode(client.messages);
        const ddata = client.messages.filter(m => m.kind == "DDATA").length;
        result = {
            label, driver: opts.driver?.name, output, t0: device.t0 ?? start,
            delivered: device.delivered, ddata,
            cpu,
            wall_ms, log: "", timed_out,
            credentials: [...device.credentials ?? []].sort(),
            writes: [...device.writes ?? []],
            busy: device.t0 ? cpu.agent_us / 1000 / Math.max(1, end - device.t0) : 0,
        };
        return result;
    }
    catch (e: any) {
        failed = e;
        throw e;
    }
    finally {
        await driver?.stop().catch(() => {});
        if (translator) quiet_shutdown(translator);
        await translator?.stop().catch(() => {});
        await device.stop().catch(() => {});
        /* Let the agent's closing messages and timers drain. */
        await sleep(50);
        held.restore();
        if (opts.secrets) {
            if (saved_secrets_path === undefined) delete process.env.SECRETS_PATH;
            else process.env.SECRETS_PATH = saved_secrets_path;
        }
        fs.rmSync(pwdir, { recursive: true, force: true });
        fs.rmSync(secrets, { recursive: true, force: true });
        const log = [...held.lines, ...(driver ? [driver.output()] : [])].join("\n");
        if (result) result.log = log;
        if (failed) failed.message += `\n\nAgent and driver output:\n${log}`;
    }
}

export interface GoldenResult {
    a:          RunResult,
    b:          RunResult,
    comparison: Comparison,
    /* The comparison and CPU use as text. */
    summary:    string,
}

function us_per (us: number | undefined, n: number) {
    if (us == undefined) return "-";
    return n ? `${Math.round(us / n)} us` : "-";
}

/* CPU use of each run as a line of text. */
export function cpu_line (r: RunResult) {
    const c = r.cpu;
    const ms = (us: number) => `${(us / 1000).toFixed(1)} ms`;
    const parts = [
        `${r.label}: agent ${ms(c.agent_us)} CPU`
            + ` (${us_per(c.agent_us, r.delivered)} per input message,`
            + ` ${us_per(c.agent_us, r.ddata)} per DDATA)`,
    ];
    if (c.driver_us != undefined)
        parts.push(`driver ${ms(c.driver_us)} CPU`
            + ` (${us_per(c.driver_us, r.delivered)} per input message)`);
    parts.push(`${r.delivered} input messages, ${r.ddata} DDATA`);
    parts.push(`startup: agent ${ms(c.agent_startup_us)}`
        + (c.driver_startup_us != undefined ? `, driver ${ms(c.driver_startup_us)}` : ""));
    return parts.join("; ");
}

/* DDATA messages per device in each run, as a line of text. How
 * values are grouped into messages is not compared, but a split driver
 * that made the agent send many more messages than the built-in
 * connection would load the central broker and everything subscribed,
 * so the report shows the counts side by side. */
export function ddata_counts (a: RunResult, b: RunResult) {
    const per = (r: RunResult) => new Map([...r.output.counts]
        .filter(([k]) => k.startsWith("DDATA "))
        .map(([k, n]) => [k.slice(6), n]));
    const x = per(a), y = per(b);
    const devs = [...new Set([...x.keys(), ...y.keys()])].sort();
    return devs.map(d => ({ device: d, a: x.get(d) ?? 0, b: y.get(d) ?? 0 }));
}

/* One difference for each device `b` sent more DDATA messages for
 * than `a` did. */
export function ddata_excess (a: RunResult, b: RunResult) {
    return ddata_counts(a, b).filter(r => r.b > r.a)
        .map(r => `DDATA ${r.device}: ${r.b} message(s) from ${b.label}, `
            + `more than the ${r.a} from ${a.label}`);
}

export function ddata_line (a: RunResult, b: RunResult) {
    const rows = ddata_counts(a, b);
    if (!rows.length) return `DDATA per device: none`;
    return `DDATA per device (${a.label} / ${b.label}): `
        + rows.map(r => `${r.device} ${r.a} / ${r.b}`).join(", ");
}

/* Run a fixture twice and compare: `a` is the reference, `b` the run
 * under test. Each defaults to the built-in connection. */
export async function golden (fixtures: { a: Fixture, b?: Fixture },
    opts: { a?: RunOpts, b?: RunOpts, allowance_ms?: number } = {},
): Promise<GoldenResult> {
    const a = await run_agent(fixtures.a, opts.a);
    const b = await run_agent(fixtures.b ?? fixtures.a, opts.b);
    return compare_runs(a, b, opts.allowance_ms);
}

/* Compare two runs already made: `a` is the reference. */
export function compare_runs (a: RunResult, b: RunResult, allowance?: number): GoldenResult {
    const base_ms = allowance
        ?? (Number(process.env.GOLDEN_TIME_ALLOWANCE_MS) || DEFAULT_TIME_ALLOWANCE_MS);
    if (a.label == b.label) b.label += " (2)";

    /* The agent stamps each metric as it works through a message, so
     * one message's metrics are spread over the time the agent takes
     * to handle it. Add the larger run's CPU per input message to the
     * allowance: noticeable only for heavy payloads, such as large XML
     * documents read by many metrics. */
    const per_msg = (r: RunResult) => r.delivered ? r.cpu.agent_us / r.delivered / 1000 : 0;
    const allowance_ms = Math.round(base_ms + Math.max(per_msg(a), per_msg(b)));
    const comparison = compare(a, b, { allowance_ms });
    /* A split driver may make the agent send fewer DDATA messages than
     * the built-in connection, because the agent gathers the values a
     * driver sends together, but it should not send more: more loads
     * the central broker and every subscriber. The Rust drivers can't
     * meet that yet. Their MQTT client doesn't set TCP_NODELAY, so the
     * second and later values of a burst reach the agent about 40 ms
     * after the first (Nagle's algorithm waiting for a delayed ACK),
     * too late to join its group, and an OPC UA notification can come
     * out as two DDATA. So more is a warning, and a failure only with
     * GOLDEN_STRICT_DDATA set. */
    const more = b.driver && !a.driver ? ddata_excess(a, b) : [];
    if (more.length && process.env.GOLDEN_STRICT_DDATA) {
        comparison.ok = false;
        comparison.diffs.push(...more);
    }
    for (const r of [a, b])
        if (r.timed_out) {
            comparison.ok = false;
            comparison.diffs.unshift(`${r.label}: timed out before the fake device `
                + `delivered all its input (${r.delivered} delivered)`);
        }

    const slow = [a, b].filter(r => r.busy > 0.6);
    const hint = slow.length && !comparison.ok
        ? [`Note: the agent used ${slow.map(r => `${Math.round(r.busy * 100)}%`).join(" and ")}`
            + ` of a CPU in the ${slow.map(r => r.label).join(" and ")} run, so it may not`
            + ` keep up at this speed and timestamps drift. If only times differ, raise`
            + ` GOLDEN_INTERVAL_MS (now ${Number(process.env.GOLDEN_INTERVAL_MS) || DEFAULT_INTERVAL_MS}).`]
        : [];
    const summary = [
        ...hint,
        report(comparison, a.label, b.label),
        `Timing allowance: ${allowance_ms} ms (${base_ms} ms plus the agent's CPU per input message)`,
        `CPU: ${cpu_line(a)}`,
        `CPU: ${cpu_line(b)}`,
        ddata_line(a, b),
        ...(more.length && comparison.ok ? [`Warning: ${more.join("; ")}`] : []),
    ].join("\n");
    return { a, b, comparison, summary };
}

/* Several runs, one per device, as if they were one run: the reference
 * for a connection whose built-in run is wrong with several devices
 * (the built-in OPC UA connection). Each run's device has its own
 * messages, so they don't overlap. Timestamps are moved so that each
 * run's first input is at the first run's, and the node's own messages
 * are the first run's. */
export function merge_runs (runs: RunResult[], label: string): RunResult {
    const [first] = runs;
    const births = new Map(first.output.births);
    const data = new Map(first.output.data);
    const counts = new Map(first.output.counts);
    for (const r of runs.slice(1)) {
        const shift = BigInt(r.t0 - first.t0) * 1_000_000n;
        const moved = (ms: Metric[]) => ms.map(m => ({ ...m, ts_ns: m.ts_ns - shift }));
        for (const [k, v] of r.output.births)
            if (k != "NBIRTH") births.set(k, v.map(moved));
        for (const [k, v] of r.output.data) data.set(k, moved(v));
        for (const [k, v] of r.output.counts)
            if (k.includes(" ")) counts.set(k, v);
    }
    const sum = (f: (r: RunResult) => number) => runs.reduce((n, r) => n + f(r), 0);
    return {
        ...first,
        label,
        output:     { births, data, counts },
        delivered:  sum(r => r.delivered),
        ddata:      sum(r => r.ddata),
        log:        runs.map(r => r.log).join("\n"),
        credentials: [...new Set(runs.flatMap(r => r.credentials))].sort(),
        writes:     runs.flatMap(r => r.writes),
        timed_out:  runs.some(r => r.timed_out),
    };
}

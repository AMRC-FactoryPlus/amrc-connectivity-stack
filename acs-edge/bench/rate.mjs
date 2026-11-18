/*
 * ACS Edge Agent benchmark
 * DDATA rate and agent CPU with many values changing at a fixed rate
 * Copyright 2026 University of Sheffield
 *
 *   npm run bench:rate -- [--values 100,1000] [--hz 10] [--seconds 10]
 *       [--stub <driver binary>]
 *
 * One device has one metric per value, each on its own address, the
 * way an OPC UA connection reads one node per metric. Every value
 * changes `hz` times a second. Two ways in:
 *
 * - built-in: one connection `data` event per change holding every
 *   value, unparsed, as the built-in OPC UA connection emits a
 *   subscription notification.
 * - split: a stub driver in a child process publishes one message per
 *   value, back to back, through the agent's driver broker, as
 *   edge-opcua does. `--stub` runs a driver binary instead, such as
 *   lib/rs-edge-driver's `rate_stub` example, which does the same over
 *   the Rust driver library's link to the agent.
 *
 * For each it reports DDATA messages a second and the agent's CPU as a
 * share of one core. The stub's own CPU is not counted. For the split
 * runs it also reports how each burst reached the agent: how many
 * synchronous runs and event-loop turns it was spread over, and how
 * long it took from its first message to its last.
 */

import { fork, spawn } from "node:child_process";
import fs   from "node:fs";
import net  from "node:net";
import os   from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { BenchConnection, make_device, sparkplug_node } from "./harness.mjs";
import { DriverBroker }     from "../node_modules/.cache/edge-bench/lib/driverBroker.js";
import { DriverConnection } from "../node_modules/.cache/edge-bench/lib/devices/driver.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const { values: args } = parseArgs({ options: {
    values:     { type: "string", default: "100,1000" },
    hz:         { type: "string", default: "10" },
    seconds:    { type: "string", default: "10" },
    warmup:     { type: "string", default: "3" },
    modes:      { type: "string", default: "built-in,split" },
    stub:       { type: "string" },
} });
const HZ = Number(args.hz);
const SECONDS = Number(args.seconds);
const WARMUP = Number(args.warmup);

const quiet = console.log;
console.log = () => {};

const sleep = ms => new Promise(r => setTimeout(r, ms));

function bench_case (n, parsed) {
    const S = v => ({ value: v, type: "String" });
    return {
        name:           `rate-${n}`,
        payloadFormat:  parsed ? "JSON" : "Defined by Protocol",
        delimiter:      "",
        metrics: Array.from({ length: n }, (_, i) => ({
            name:       `m${i}`,
            type:       "Double",
            value:      null,
            timestamp:  0,
            properties: {
                method:     S("GET"),
                address:    S(`v${i}`),
                /* No path: a split driver sends each value as
                 * {"value", "timestamp"}, which the agent reads with
                 * no path. */
                path:       S(""),
            },
        })),
    };
}

async function free_port () {
    return new Promise(resolve => {
        const srv = net.createServer();
        srv.listen(0, "127.0.0.1", () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
    });
}

/* Count DDATA and CPU over the measured window. */
async function window (mqtt) {
    await sleep(WARMUP * 1000);
    const d0 = mqtt.ddata;
    const c0 = process.cpuUsage();
    const t0 = process.hrtime.bigint();
    await sleep(SECONDS * 1000);
    const cpu = process.cpuUsage(c0);
    const wall_s = Number(process.hrtime.bigint() - t0) / 1e9;
    return {
        ddata_per_s:    (mqtt.ddata - d0) / wall_s,
        cpu_pct:        (cpu.user + cpu.system) / 1e6 / wall_s * 100,
    };
}

async function run_builtin (n) {
    const { node, mqtt } = await sparkplug_node();
    const conn = new BenchConnection();
    const dev = make_device(node, conn, bench_case(n, false));
    dev._deviceConnected();
    await sleep(150);

    let tick = 0;
    const timer = setInterval(() => {
        tick++;
        const obj = {};
        for (let i = 0; i < n; i++) obj[`v${i}`] = i + tick * 0.5;
        conn.emit("data", obj, false);
    }, 1000 / HZ);

    const r = await window(mqtt);
    clearInterval(timer);
    dev._stopMetricSubscription();
    return r;
}

/* Watch how driver messages reach the agent. A synchronous run is
 * everything handled before the microtask queue next drains; a turn is
 * everything handled before the next setImmediate. A gap of more than
 * 20 ms starts a new burst: bursts are 1000/hz ms apart. */
function arrivals (broker) {
    const bursts = [];
    let cur = null;
    let sync = 0, turn = 0;
    let sync_open = false, turn_open = false;
    let last = 0n;
    broker.on("message", m => {
        if (m.msg != "data") return;
        if (!sync_open) {
            sync_open = true; sync++;
            queueMicrotask(() => sync_open = false);
        }
        if (!turn_open) {
            turn_open = true; turn++;
            setImmediate(() => turn_open = false);
        }
        const now = process.hrtime.bigint();
        if (!cur || now - last > 20_000_000n) {
            cur = { msgs: 0, syncs: new Set(), turns: new Set(), start: now, end: now };
            bursts.push(cur);
        }
        cur.msgs++;
        cur.syncs.add(sync);
        cur.turns.add(turn);
        cur.end = last = now;
    });
    return () => {
        /* Leave out the first and last burst, which the window cuts. */
        const b = bursts.slice(1, -1);
        if (!b.length) return undefined;
        const med = a => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
        const span = b.map(x => Number(x.end - x.start) / 1e6);
        return {
            bursts:         b.length,
            msgs:           med(b.map(x => x.msgs)),
            syncs:          med(b.map(x => x.syncs.size)),
            turns:          med(b.map(x => x.turns.size)),
            max_turns:      Math.max(...b.map(x => x.turns.size)),
            span_ms:        med(span),
            max_span_ms:    Math.max(...span),
        };
    };
}

async function run_split (n) {
    const { node, mqtt } = await sparkplug_node();
    const id = "rate";
    const password = "bench-password";
    const passwords = fs.mkdtempSync(path.join(os.tmpdir(), "acs-edge-rate-"));
    fs.writeFileSync(path.join(passwords, id), password);
    const url = `mqtt://127.0.0.1:${await free_port()}`;
    const broker = new DriverBroker({ EDGE_MQTT: url, EDGE_PASSWORDS: passwords });
    await broker.start();

    const conn = new DriverConnection("Driver", {}, id, broker);
    const dev = make_device(node, conn, bench_case(n, true));
    conn.on("open", () => dev._deviceConnected());

    let child, ready;
    if (args.stub) {
        /* A driver binary starts sending as soon as it has its
         * addresses, so it is ready when its first data arrives. */
        child = spawn(args.stub, [], {
            stdio: ["ignore", "inherit", "inherit"],
            env: { ...process.env, EDGE_MQTT: url, EDGE_USERNAME: id,
                EDGE_PASSWORD: password, RATE_HZ: String(HZ) },
        });
        ready = new Promise(r => {
            const first = m => {
                if (m.msg != "data") return;
                broker.off("message", first);
                r();
            };
            broker.on("message", first);
        });
    }
    else {
        child = fork(path.join(here, "rate-stub.mjs"),
            [url, id, password, String(n), String(HZ)],
            { stdio: ["ignore", "inherit", "inherit", "ipc"] });
        ready = new Promise(r => child.once("message", r));
    }
    conn.open();
    await ready;
    await sleep(150);

    const seen = arrivals(broker);
    if (!args.stub) child.send({ start: true });
    const r = await window(mqtt);
    const a = seen();

    const exited = new Promise(r => child.once("exit", r));
    if (args.stub) child.kill();
    else child.send({ exit: true });
    await exited;
    dev._stopMetricSubscription();
    conn.close();
    await broker.stop();
    fs.rmSync(passwords, { recursive: true, force: true });
    return { ...r, arrivals: a };
}

const out = [];
for (const n of args.values.split(",").map(Number)) {
    for (const mode of args.modes.split(",")) {
        const r = mode == "split" ? await run_split(n) : await run_builtin(n);
        out.push({ values: n, hz: HZ, mode, ...r });
        const a = r.arrivals;
        quiet(`${String(n).padStart(5)} values @ ${HZ} Hz  ${mode.padEnd(8)}  `
            + `${r.ddata_per_s.toFixed(1).padStart(8)} DDATA/s  `
            + `${r.cpu_pct.toFixed(1).padStart(5)}% CPU`
            + (a ? `  burst: ${a.msgs} msgs over ${a.syncs} sync run(s),`
                + ` ${a.turns} turn(s) (max ${a.max_turns}),`
                + ` ${a.span_ms.toFixed(2)} ms (max ${a.max_span_ms.toFixed(2)})` : ""));
    }
}
fs.writeFileSync(path.join(here, "results-rate.json"), JSON.stringify(out, null, 2) + "\n");
process.exit(0);

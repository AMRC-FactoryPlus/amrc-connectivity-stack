/*
 * ACS Edge Agent benchmark
 * One case in its own process: set up, warm up, then time rounds
 * Copyright 2026 University of Sheffield
 *
 *   (forked by run.mjs) worker.mjs <case> <modes> <round-ms> <warmup-ms>
 *
 * Each case runs in its own process so V8 compiles the parsing code
 * for that payload format alone, as it would in an agent whose
 * connections use one format. With every case in one process the
 * shared code saw every format, and the small cases came out up to
 * 40% slower in some runs and not others.
 *
 * Messages from run.mjs: { round: mode } times one round and replies
 * { result }, and { exit: true } closes everything and exits. Once set
 * up and warmed up the worker sends { ready: { mode: count } }.
 */

import { fork } from "node:child_process";
import fs   from "node:fs";
import net  from "node:net";
import os   from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { find_case, payloads, VARIANTS } from "./cases.mjs";
import {
    BenchConnection, make_device, sparkplug_node,
} from "./harness.mjs";
import { DriverBroker }     from "../node_modules/.cache/edge-bench/lib/driverBroker.js";
import { DriverConnection } from "../node_modules/.cache/edge-bench/lib/devices/driver.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const [case_name, modes, round_ms, warmup_ms] = process.argv.slice(2);
const c = find_case(case_name);
const MODES = modes.split(",");
const ROUND_MS = Number(round_ms);
const WARMUP_MS = Number(warmup_ms);

const TIMEOUT_MS = 60_000;
const MIN_MSGS = 3;
const MAX_MSGS = 50_000;

/* In-process mode yields to the event loop after this many messages,
 * so the async Sparkplug publishes run alongside the parsing rather
 * than all at the end. One socket read often holds many small MQTT
 * messages but only one large one, so small payloads go in chunks
 * and large ones one at a time. Yielding after every small message
 * would add more event-loop cost than the message itself costs. */
const CHUNK = c.metrics.length >= 100 ? 1 : 32;

const immediate = () => new Promise(r => setImmediate(r));
const sleep = ms => new Promise(r => setTimeout(r, ms));

function with_timeout (p, what) {
    let t;
    const timer = new Promise((_, reject) =>
        t = setTimeout(() => reject(new Error(`Timed out: ${what}`)), TIMEOUT_MS));
    return Promise.race([p, timer]).finally(() => clearTimeout(t));
}

/* The agent code logs to the console (DriverBroker logs every AUTH
 * and SUBSCRIBE), which would break up run.mjs's output. */
console.log = () => {};

/* Time `count` messages through `send`, which resolves once their
 * DDATA has been published. */
async function measure (send, count) {
    globalThis.gc?.();
    const cpu0 = process.cpuUsage();
    const t0 = process.hrtime.bigint();
    await send(count);
    const t1 = process.hrtime.bigint();
    const cpu = process.cpuUsage(cpu0);
    const wall_s = Number(t1 - t0) / 1e9;
    const cpu_s = (cpu.user + cpu.system) / 1e6;
    return {
        count,
        cpu_us_per_msg:     cpu_s / count * 1e6,
        msgs_per_s:         count / wall_s,
        wall_us_per_msg:    wall_s / count * 1e6,
    };
}

/* Warm up for about WARMUP_MS, then return how many messages make
 * about ROUND_MS of work. */
async function warm_up (send) {
    let wall = 0;
    let n = MIN_MSGS;
    const start = Date.now();
    while (Date.now() - start < WARMUP_MS) {
        wall = (await measure(send, n)).wall_us_per_msg;
        n = Math.min(n * 2, MAX_MSGS);
    }
    return Math.max(MIN_MSGS,
        Math.min(MAX_MSGS, Math.round(ROUND_MS * 1000 / wall)));
}

/* Each setup returns a `send(count)` that pushes `count` messages and
 * resolves once their DDATA is out, and a `close()`. */
async function setup_inproc (node, mqtt) {
    const conn = new BenchConnection();
    const dev = make_device(node, conn, c);
    dev._deviceConnected();
    /* Let the DBIRTH go out, or the first data becomes a DBIRTH. */
    await sleep(150);

    const bodies = payloads(c);
    let k = 0;
    const send = async count => {
        const target = mqtt.ddata + count;
        for (let i = 0; i < count; i++) {
            conn.emit("data", { [c.addr]: bodies[k++ % VARIANTS] });
            if (i % CHUNK == CHUNK - 1) await immediate();
        }
        await with_timeout(mqtt.until(target), `${c.name} inproc`);
    };
    const close = async () => dev._stopMetricSubscription();
    return { send, close };
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

async function setup_driver (node, mqtt) {
    const id = "bench";
    const password = "bench-password";
    const passwords = fs.mkdtempSync(path.join(os.tmpdir(), "acs-edge-bench-"));
    fs.writeFileSync(path.join(passwords, id), password);
    const url = `mqtt://127.0.0.1:${await free_port()}`;
    const broker = new DriverBroker({ EDGE_MQTT: url, EDGE_PASSWORDS: passwords });
    await broker.start();

    const conn = new DriverConnection("Driver", {}, id, broker);
    const dev = make_device(node, conn, c);
    conn.on("open", () => dev._deviceConnected());

    const child = fork(path.join(here, "driver-stub.mjs"),
        [url, id, password, c.name], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
    const replies = [];
    let wake = null;
    child.on("message", m => { replies.push(m); wake?.(); });
    const next = what => with_timeout((async () => {
        while (!replies.length)
            await new Promise(r => wake = r);
        return replies.shift();
    })(), what);

    conn.open();
    await next(`${c.name} driver ready`);
    await sleep(150);

    let k = 0;
    const send = async count => {
        const target = mqtt.ddata + count;
        child.send({ send: count, from: k });
        k += count;
        await next(`${c.name} driver sent`);
        await with_timeout(mqtt.until(target), `${c.name} driver data`);
    };
    const close = async () => {
        child.send({ exit: true });
        await new Promise(r => child.once("exit", r));
        dev._stopMetricSubscription();
        conn.close();
        await broker.stop();
        fs.rmSync(passwords, { recursive: true, force: true });
    };
    return { send, close };
}

const { node, mqtt } = await sparkplug_node();
const runs = {};
const counts = {};
for (const mode of MODES) {
    runs[mode] = mode == "driver"
        ? await setup_driver(node, mqtt)
        : await setup_inproc(node, mqtt);
    counts[mode] = await warm_up(runs[mode].send);
}
process.send({ ready: counts });

process.on("message", async m => {
    if (m.exit) {
        for (const r of Object.values(runs)) await r.close();
        process.exit(0);
    }
    const run = runs[m.round];
    const bytes0 = mqtt.bytes;
    const res = await measure(run.send, counts[m.round]);
    res.ddata_bytes_per_msg = (mqtt.bytes - bytes0) / res.count;
    process.send({ result: res });
});

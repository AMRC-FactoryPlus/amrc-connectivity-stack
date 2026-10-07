#!/usr/bin/env node
/*
 * Copyright (c) University of Sheffield AMRC 2026.
 *
 * Benchmark POST /v1/objects/value for one or more i3X builds.
 *
 *   node bench/run.mjs --build before=/path/to/old/dist --build after=./dist \
 *       --sizes 1,100,500,1000,2000 --runs 5 --warm 0,1 --out results.json
 *
 * A build may be given as label=dist:chunk:concurrency to set the new
 * History bulk chunk size and query concurrency, for tuning.
 *
 * For each build and cache state it starts bench/server.mjs as a child
 * process (stdout to a file, so writes are synchronous as they are on
 * a Linux pipe), then for each request size and run it records:
 *   - wall time of the request and its HTTP status (or client timeout)
 *   - Flux queries issued by the service
 *   - InfluxDB CPU seconds (cgroup usage_usec of the container)
 *   - i3X process CPU seconds (process.cpuUsage)
 *   - worst latency of GET /v1/namespaces, polled every 100 ms while
 *     the bulk request runs, and the server's max event-loop delay
 * Requests ask for the first N devices with maxDepth 0 (every leaf).
 * With --fields K they ask instead for the first K leaves of each of
 * the first N devices; pair it with --wide to model a request for a
 * few fields of devices with many tags.
 */

import { spawn, execFileSync } from "node:child_process";
import { openSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { deviceUuid } from "./dataset.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: a } = parseArgs({
    options: {
        build: { type: "string", multiple: true },
        sizes: { type: "string", default: "1,100,500,1000,2000" },
        runs: { type: "string", default: "5" },
        warm: { type: "string", default: "0,1" },
        devices: { type: "string", default: "2000" },
        bucket: { type: "string", default: "default" },
        influx: { type: "string", default: "http://127.0.0.1:58086" },
        container: { type: "string", default: "i3xbulk-influx" },
        port: { type: "string", default: "58110" },
        maxDepth: { type: "string", default: "0" },
        fields: { type: "string" },
        wide: { type: "string", default: "0" },
        cooldown: { type: "string", default: "35" },
        timeout: { type: "string", default: "120" },
        out: { type: "string", default: "bench-results.json" },
        logs: { type: "string", default: "bench-logs" },
        /* Run the server in a Linux container on this Docker network
         * (with InfluxDB reachable as --influx-in-docker), instead of
         * as a local process. This gives a direct Linux TCP path to
         * InfluxDB and a stdout pipe, as in a Kubernetes pod. */
        "docker-network": { type: "string" },
        "influx-in-docker": { type: "string", default: "http://i3xbulk-influx:8086" },
        "node-image": { type: "string", default: "node:18-alpine" },
    },
});

const sizes = a.sizes.split(",").map(Number);
const runs = Number(a.runs);
const port = Number(a.port);
const base = `http://127.0.0.1:${port}`;
mkdirSync(a.logs, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function influxCpuSeconds() {
    const out = execFileSync("docker", ["exec", a.container, "cat", "/sys/fs/cgroup/cpu.stat"]).toString();
    return Number(/usage_usec (\d+)/.exec(out)[1]) / 1e6;
}
async function stats() {
    /* The old build can leave the host short of sockets for a moment;
     * retry rather than lose the run. */
    for (let i = 0; ; i++) {
        try { return await (await fetch(`${base}/bench/stats`)).json(); }
        catch (e) { if (i >= 30) throw e; await sleep(1000); }
    }
}

const SERVER_CONTAINER = "i3xbulk-srv";

async function startServer(label, dist, warm, extra = []) {
    const log = path.join(a.logs, `${label}-warm${warm}.log`);
    const fd = openSync(log, "w");
    const args = ["--dist", dist, "--port", String(port), "--devices", a.devices,
        "--bucket", a.bucket, "--warm", String(warm), "--wide", a.wide, ...extra];
    let child;
    if (a["docker-network"]) {
        try { execFileSync("docker", ["rm", "-f", SERVER_CONTAINER], { stdio: "ignore" }); } catch {}
        /* Mount the benchmark and the build at their host paths so
         * node_modules symlinks resolve the same way. */
        const acs = path.resolve(here, "..");
        const mounts = [...new Set([path.resolve(acs, ".."), path.resolve(dist, "..", "..")])]
            .flatMap((m) => ["-v", `${m}:${m}:ro`]);
        child = spawn("docker", ["run", "--rm", "--name", SERVER_CONTAINER,
            "--network", a["docker-network"], "-p", `${port}:${port}`, ...mounts,
            "-w", acs, a["node-image"], "node", path.join(here, "server.mjs"),
            ...args, "--influx", a["influx-in-docker"]], { stdio: ["ignore", fd, fd] });
    } else {
        child = spawn(process.execPath, [path.join(here, "server.mjs"), ...args, "--influx", a.influx],
            { stdio: ["ignore", fd, fd] });
    }
    for (let i = 0; i < 100; i++) {
        try { await stats(); return child; } catch { await sleep(200); }
    }
    throw new Error(`server ${label} did not start; see ${log}`);
}

async function oneRun(n) {
    const ids = a.fields
        ? await (await fetch(`${base}/bench/leaves?devices=${n}&fields=${a.fields}`)).json()
        : Array.from({ length: n }, (_, i) => deviceUuid(i));
    const body = JSON.stringify({ elementIds: ids, maxDepth: Number(a.maxDepth) });

    await stats();
    await fetch(`${base}/bench/reset`, { method: "POST" });
    const s0 = await stats();
    const c0 = influxCpuSeconds();

    let probeMax = 0, probes = 0, done = false;
    const prober = (async () => {
        while (!done) {
            const t = performance.now();
            try { await (await fetch(`${base}/v1/namespaces`)).text(); } catch {}
            probeMax = Math.max(probeMax, performance.now() - t);
            probes++;
            await sleep(100);
        }
    })();

    const t0 = performance.now();
    let status, ok = 0, bytes = 0, error;
    try {
        const res = await fetch(`${base}/v1/objects/value`, {
            method: "POST",
            headers: { "content-type": "application/json", "accept-encoding": "gzip" },
            body,
            signal: AbortSignal.timeout(Number(a.timeout) * 1000),
        });
        status = res.status;
        const text = await res.text();
        bytes = text.length;
        const j = JSON.parse(text);
        ok = j.results ? j.results.filter((r) => r.success).length : 0;
        if (!j.results) error = j.error?.message;
    } catch (e) {
        status = "client-timeout";
        error = String(e.name ?? e);
    }
    const wall = performance.now() - t0;
    done = true;
    await prober;

    const c1 = influxCpuSeconds();
    const s1 = await stats();
    return {
        n, status, error, ok, bytes,
        wallMs: Math.round(wall),
        queries: s1.queries - s0.queries,
        influxCpuS: +(c1 - c0).toFixed(2),
        i3xCpuS: +(((s1.cpu.user + s1.cpu.system) - (s0.cpu.user + s0.cpu.system)) / 1e6).toFixed(2),
        probeMaxMs: Math.round(probeMax),
        probes,
        eldMaxMs: Math.round(s1.eldMaxMs),
    };
}

const results = [];
for (const spec of a.build) {
    const [label, rest] = spec.split("=");
    const [dist, chunk, conc] = rest.split(":");
    const extra = [...(chunk ? ["--chunk", chunk] : []), ...(conc ? ["--concurrency", conc] : [])];
    for (const warm of a.warm.split(",").map(Number)) {
        const child = await startServer(label, path.resolve(dist), warm, extra);
        try {
            for (const n of sizes) {
                for (let r = 0; r < runs; r++) {
                    const res = { build: label, warm, run: r + 1, ...(await oneRun(n)) };
                    results.push(res);
                    console.log(JSON.stringify(res));
                    writeFileSync(a.out, JSON.stringify(results, null, 1));
                    /* Let TIME_WAIT sockets and InfluxDB settle after a
                     * heavy run so runs do not bleed into each other. */
                    if (res.queries > 1000) await sleep(Number(a.cooldown) * 1000);
                }
            }
        } finally {
            child.kill();
            if (a["docker-network"]) {
                try { execFileSync("docker", ["rm", "-f", SERVER_CONTAINER], { stdio: "ignore" }); } catch {}
            }
            await sleep(1000);
        }
    }
}

/* ---- Summary table ---- */
const med = (xs) => { const s = [...xs].sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };
const fmt = (xs) => xs.length === 1 ? `${xs[0]}` : `${med(xs)} (${Math.min(...xs)}-${Math.max(...xs)})`;
console.log("\n| build | cache | devices | wall ms, median (min-max) | Flux queries | InfluxDB CPU s | i3X CPU s | worst /namespaces ms | OK / runs |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const spec of a.build) {
    const label = spec.split("=")[0];
    for (const warm of a.warm.split(",").map(Number)) {
        for (const n of sizes) {
            const rs = results.filter((r) => r.build === label && r.warm === warm && r.n === n);
            const good = rs.filter((r) => r.status === 200).length;
            console.log(`| ${label} | ${warm ? "warm" : "cold"} | ${n} | ${fmt(rs.map((r) => r.wallMs))} | ${fmt(rs.map((r) => r.queries))} | ${fmt(rs.map((r) => r.influxCpuS))} | ${fmt(rs.map((r) => r.i3xCpuS))} | ${fmt(rs.map((r) => r.probeMaxMs))} | ${good} / ${rs.length} |`);
        }
    }
}

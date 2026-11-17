/*
 * ACS Edge Agent benchmark
 * Measure Edge Agent CPU time per message for each payload format
 * Copyright 2026 University of Sheffield
 *
 *   npm run bench
 *   npm run bench -- --compare bench/baseline.json
 *   npm run bench -- --mode inproc --cases json-10,json-100 --rounds 7
 *
 * Two modes, both through the real Device._handleData and the real
 * Sparkplug encoder (see harness.mjs):
 *
 *   inproc  The payload goes straight into a connection "data" event,
 *           as a built-in connection such as MQTT delivers it.
 *   driver  The payload comes from a stub split driver in a child
 *           process, through the agent's in-process Aedes broker
 *           (DriverBroker) and DriverConnection, as a split driver
 *           delivers it.
 *
 * Each case runs in its own worker process (worker.mjs), which sets
 * up both modes, warms them up and sizes a round to about --round-ms
 * of work. This process then asks every worker for round 1, then
 * round 2, and so on, so a spell of load from something else on the
 * machine lands on one round of several cases, which the median
 * drops, rather than on every round of one case. CPU time is the
 * worker's user plus system time (process.cpuUsage), so the stub
 * driver's own CPU is not counted. Each figure is the median of the
 * rounds.
 */

import { execFileSync, fork } from "node:child_process";
import fs   from "node:fs";
import os   from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { Cases, payloads } from "./cases.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

const { values: args } = parseArgs({
    options: {
        mode:       { type: "string", default: "inproc,driver" },
        cases:      { type: "string" },
        rounds:     { type: "string", default: "7" },
        "round-ms": { type: "string", default: "500" },
        "warmup-ms":{ type: "string", default: "500" },
        out:        { type: "string", default: path.join(here, "results-latest.json") },
        compare:    { type: "string" },
    },
});

const MODES = args.mode.split(",");
const ROUNDS = Number(args.rounds);
const GC = process.execArgv.includes("--expose-gc");

const cases = args.cases
    ? args.cases.split(",").map(n => {
        const c = Cases.find(c => c.name == n);
        if (!c) throw new Error(`Unknown case ${n}`);
        return c;
    })
    : Cases;

const median = xs => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function summarise (rounds) {
    const cpus = rounds.map(r => r.cpu_us_per_msg);
    const med = median(cpus);
    return {
        msgs_per_round:         rounds[0].count,
        cpu_us_per_msg:         med,
        msgs_per_s:             median(rounds.map(r => r.msgs_per_s)),
        ddata_bytes_per_msg:    median(rounds.map(r => r.ddata_bytes_per_msg)),
        spread_pct:             (Math.max(...cpus) - Math.min(...cpus)) / med * 100,
        rounds,
    };
}

/* Start a worker for one case and wait until it has warmed up. */
async function start_worker (c) {
    const child = fork(path.join(here, "worker.mjs"),
        [c.name, MODES.join(","), args["round-ms"], args["warmup-ms"]],
        { execArgv: GC ? ["--expose-gc"] : [],
          stdio: ["ignore", "inherit", "inherit", "ipc"] });
    const replies = [];
    let wake = null;
    child.on("message", m => { replies.push(m); wake?.(); });
    child.on("exit", code => {
        if (code) {
            console.error("Worker for %s exited with code %s", c.name, code);
            process.exit(1);
        }
    });
    const next = async () => {
        while (!replies.length)
            await new Promise(r => wake = r);
        return replies.shift();
    };
    const { ready } = await next();
    const ask = async msg => { child.send(msg); return (await next()).result; };
    const stop = () => new Promise(r => { child.removeAllListeners("exit");
        child.once("exit", r); child.send({ exit: true }); });
    return { c, counts: ready, ask, stop, rounds: Object.fromEntries(MODES.map(m => [m, []])) };
}

function git (...a) {
    try { return execFileSync("git", a, { cwd: here }).toString().trim(); }
    catch { return null; }
}

function machine () {
    return {
        cpu:        os.cpus()[0]?.model,
        cores:      os.cpus().length,
        platform:   `${os.platform()} ${os.release()} ${os.arch()}`,
        node:       process.version,
    };
}

const fmt = (x, d = 0) => x.toLocaleString("en-GB",
    { minimumFractionDigits: d, maximumFractionDigits: d });

function table (results, baseline) {
    const key = r => `${r.case}/${r.mode}`;
    const base = new Map((baseline?.results ?? []).map(r => [key(r), r]));
    const head = ["case", "metrics", "mode", "CPU us/msg", "us/metric",
        "msg/s", "spread"];
    if (baseline) head.push("vs baseline");
    const rows = results.map(r => {
        const row = [r.case, fmt(r.metrics), r.mode, fmt(r.cpu_us_per_msg, 1),
            fmt(r.cpu_us_per_metric, 2), fmt(r.msgs_per_s),
            `${fmt(r.spread_pct, 1)}%`];
        if (baseline) {
            const b = base.get(key(r));
            row.push(b
                ? `${r.cpu_us_per_msg >= b.cpu_us_per_msg ? "+" : ""}`
                    + `${fmt((r.cpu_us_per_msg / b.cpu_us_per_msg - 1) * 100, 1)}%`
                : "n/a");
        }
        return row;
    });
    const widths = head.map((h, i) =>
        Math.max(h.length, ...rows.map(r => r[i].length)));
    const line = cells => cells
        .map((c, i) => i < 1 || i == 2 ? c.padEnd(widths[i]) : c.padStart(widths[i]))
        .join("  ");
    console.log(line(head));
    console.log(widths.map(w => "-".repeat(w)).join("  "));
    rows.forEach(r => console.log(line(r)));
}

async function main () {
    const started = Date.now();
    const baseline = args.compare
        ? JSON.parse(fs.readFileSync(args.compare, "utf8"))
        : null;

    const info = machine();
    console.log("Edge Agent benchmark: %s, %s cores, %s, Node %s",
        info.cpu, info.cores, info.platform, info.node);
    if (!GC)
        console.log("(run with --expose-gc for steadier numbers)");

    const workers = [];
    for (const c of cases) {
        process.stderr.write(`  warming up ${c.name}\n`);
        workers.push(await start_worker(c));
    }
    for (let round = 1; round <= ROUNDS; round++) {
        process.stderr.write(`  round ${round} of ${ROUNDS}\n`);
        for (const w of workers)
            for (const mode of MODES)
                w.rounds[mode].push(await w.ask({ round: mode }));
    }
    await Promise.all(workers.map(w => w.stop()));

    const results = workers.flatMap(({ c, rounds }) => MODES.map(mode => {
        const res = summarise(rounds[mode]);
        return {
            case:           c.name,
            description:    c.description,
            payloadFormat:  c.payloadFormat,
            metrics:        c.metrics.length,
            payload_bytes:  payloads(c)[0].length,
            mode,
            cpu_us_per_metric: res.cpu_us_per_msg / c.metrics.length,
            ...res,
        };
    }));

    const out = {
        version:    1,
        date:       new Date().toISOString(),
        git:        { commit: git("rev-parse", "--short", "HEAD"),
                      branch: git("rev-parse", "--abbrev-ref", "HEAD") },
        machine:    info,
        settings:   { rounds: ROUNDS, round_ms: Number(args["round-ms"]),
                      warmup_ms: Number(args["warmup-ms"]), gc_between_rounds: GC },
        results,
    };
    fs.writeFileSync(args.out, JSON.stringify(out, null, 2) + "\n");

    console.log("");
    table(results, baseline);

    if (MODES.includes("inproc") && MODES.includes("driver")) {
        console.log("\nBroker hop (driver minus inproc, CPU us/msg; only meaningful for small payloads):");
        for (const c of cases) {
            const i = results.find(r => r.case == c.name && r.mode == "inproc");
            const d = results.find(r => r.case == c.name && r.mode == "driver");
            console.log("  %s %s", c.name.padEnd(22),
                fmt(d.cpu_us_per_msg - i.cpu_us_per_msg, 1).padStart(8));
        }
    }
    console.log("\nWrote %s in %ss", path.relative(process.cwd(), args.out),
        fmt((Date.now() - started) / 1000, 1));

    process.exit(0);
}

await main();

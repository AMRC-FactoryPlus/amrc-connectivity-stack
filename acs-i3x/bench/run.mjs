/*
 * ACS i3X
 * Run refresh-burst.mjs several times per scenario and summarise
 * Copyright 2026 University of Sheffield
 */

/*
 *   npm run build
 *   node bench/run.mjs --runs 5 --scenario 2000@3 --scenario 2000@200
 *
 * --dist DIR tests another build (see refresh-burst.mjs).
 *
 * A scenario is DEVICES@WRITES_PER_SECOND. Each run is a fresh
 * process, so peak RSS is per run. Raw results go to stdout as JSON
 * lines (prefixed "run"), then a median [min-max] table per scenario.
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({ options: {
    runs:       { type: "string", default: "5" },
    scenario:   { type: "string", multiple: true, default: ["2000@3", "2000@200"] },
    dist:       { type: "string", default: "dist" },
} });

const bench = fileURLToPath(new URL("./refresh-burst.mjs", import.meta.url));

const FIELDS = [
    "rebuilds", "pipeline_runs", "cpu_s", "rebuild_s", "rebuild_max_ms",
    "settle_s", "lag_after_last_write_s", "heap_peak_mb",
    "heap_after_gc_mb", "max_rss_mb",
];

const median = xs => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

for (const sc of args.scenario) {
    const [devices, rate] = sc.split("@");
    const results = [];
    for (let i = 0; i < parseInt(args.runs); i++) {
        let out;
        try {
            out = execFileSync(process.execPath,
                ["--expose-gc", bench, "--devices", devices, "--rate", rate,
                    "--dist", args.dist],
                { encoding: "utf8", maxBuffer: 1 << 20 });
        }
        catch (e) {
            /* Non-zero exit: wrong final state or timeout. Keep it. */
            out = e.stdout;
        }
        const r = JSON.parse(out.trim().split("\n").pop());
        console.log("run", sc, JSON.stringify(r));
        results.push(r);
    }
    console.log(`\n${sc} (${args.dist}): devices=${devices} writes/s=${rate} runs=${results.length}`
        + ` nodes=${results[0].nodes}`
        + ` all_correct=${results.every(r => r.correct)}`
        + ` late_rebuilds=${results.map(r => r.late_rebuilds).join(",")}`);
    for (const f of FIELDS) {
        const xs = results.map(r => r[f]);
        console.log(`  ${f.padEnd(24)} ${+median(xs).toFixed(2)} [${Math.min(...xs)}-${Math.max(...xs)}]`);
    }
    console.log();
}

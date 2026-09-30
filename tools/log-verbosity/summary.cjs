/*
 * ACS log verbosity benchmark
 * Collects per-run results and prints the median table.
 * Copyright 2026 University of Sheffield
 *
 * `node summary.cjs row <code>` merges res.json (from bench.mjs) and
 * wc.txt (lines and bytes the run wrote to stdout) into one JSON line.
 * `node summary.cjs table` prints medians from results.jsonl.
 */

const fs = require("fs");

const [mode, code] = process.argv.slice(2);

if (mode == "row") {
    const r = JSON.parse(fs.readFileSync("res.json", "utf8"));
    const [lines, bytes] = fs.readFileSync("wc.txt", "utf8")
        .trim().split(/\s+/).map(Number);
    /* wc counts the warmup ops too; every op logs the same amount. */
    const n = r.ops + r.warmup;
    console.log(JSON.stringify({ code, ...r,
        log_lines_per_op: lines / n, log_bytes_per_op: bytes / n }));
}
else if (mode == "table") {
    const rows = fs.readFileSync("results.jsonl", "utf8")
        .trim().split("\n").map(l => JSON.parse(l));
    const med = a => {
        const s = [...a].sort((x, y) => x - y);
        return s[(s.length - 1) >> 1];
    };
    const groups = new Map();
    for (const r of rows) {
        const k = [r.scenario, r.code, r.verbose].join("|");
        groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    console.log("| scenario | lib code | VERBOSE | CPU us/op | wall us/op | ops/s | log lines/op | log bytes/op | runs |");
    console.log("|---|---|---|---:|---:|---:|---:|---:|---:|");
    for (const [k, rs] of groups) {
        const [scenario, c, verbose] = k.split("|");
        const m = f => med(rs.map(f));
        console.log(`| ${scenario} | ${c} | \`${verbose}\` `
            + `| ${m(r => r.cpu_us_per_op).toFixed(1)} `
            + `| ${m(r => r.wall_us_per_op).toFixed(1)} `
            + `| ${Math.round(m(r => r.ops_per_s))} `
            + `| ${m(r => r.log_lines_per_op).toFixed(1)} `
            + `| ${Math.round(m(r => r.log_bytes_per_op))} `
            + `| ${rs.length} |`);
    }
}

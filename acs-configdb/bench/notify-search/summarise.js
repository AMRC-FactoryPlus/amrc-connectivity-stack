/*
 * Summarise bench/notify-search/out/*.json: median and range per variant and scenario.
 * Usage: node bench/notify-search/summarise.js <outdir> [variant...]
 */
import fs from "fs";
import path from "path";

const [dir, ...want] = process.argv.slice(2);
const runs = new Map();
for (const f of fs.readdirSync(dir)) {
    const m = /^(.+)-(burst-reload|steady-reload|burst|steady)-(\d+)\.json$/.exec(f);
    if (!m || (want.length && !want.includes(m[1]))) continue;
    const key = `${m[1]} ${m[2]}`;
    if (!runs.has(key)) runs.set(key, []);
    runs.get(key).push(JSON.parse(fs.readFileSync(path.join(dir, f))));
}

const metrics = {
    "CPU s":            r => r.server.cpu_ms / 1000,
    "CPU ms/write":     r => r.cpu_ms_per_request,
    "full() calls":     r => r.server.full_calls,
    "msgs":             r => r.server.msgs,
    "MB sent":          r => r.server.bytes / 1e6,
    "full msgs":        r => r.server.full_msgs,
    "loop max ms":      r => r.server.eld_max_ms,
    "loop p99 ms":      r => r.server.eld_p99_ms,
    "writes/s":         r => r.writes_per_s,
    "import s":         r => r.write_ms / 1000,
    "last update lag ms": r => r.deliver_lag_ms,
    "reload ready s":   r => Math.max(...r.admin_ready_ms.slice(1), 0) / 1000,
    "peak RSS MB":      r => r.server.peak_rss / 1e6,
    "conn resets":      r => r.conn_resets ?? 0,
    "state ok":         r => r.final_map_matches_db ? 1 : 0,
};

const fmt = v => Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
for (const [key, rs] of [...runs].sort()) {
    console.log(`\n## ${key} (${rs.length} runs)`);
    for (const [name, f] of Object.entries(metrics)) {
        const v = rs.map(f).sort((a, b) => a - b);
        const med = v[Math.floor(v.length / 2)];
        console.log(`${name.padEnd(20)} median ${fmt(med).padStart(8)}  range ${fmt(v[0])} - ${fmt(v.at(-1))}`);
    }
}

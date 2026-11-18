/*
 * ACS Edge Agent
 * Golden-output harness: recorded runs of the built-in connections
 * Copyright 2026 University of Sheffield
 */

import fs from "fs";
import path from "path";

import type { Metric, Output } from "./capture.js";
import type { RunResult } from "./harness.js";

/* Where the recorded runs are kept. GOLDEN_SNAPSHOTS points elsewhere,
 * for runs of private fixtures, which must never be committed. */
export const RECORDED = path.join(__dirname, "recorded");

export function snapshot_dir () {
    return process.env.GOLDEN_SNAPSHOTS || RECORDED;
}

/* A metric as stored. `t` is fixture milliseconds after the fake
 * device first delivered input, so a run at any speed can be compared
 * with it. */
interface StoredMetric {
    name:   string,
    type:   string,
    value:  string,
    t:      number,
    props?: string,
}

/* A recorded run, as stored in recorded/<key>.json. */
export interface Snapshot {
    /* Where the run came from, for a person reading the file. */
    source:     string,
    /* The run's label, which reports print. */
    label:      string,
    /* The fixture this is a run of, and how much of it was played. */
    fixture:    string,
    duration_ms: number,
    /* Fixture time ran this many times faster than real time. */
    speed:      number,
    delivered:  number,
    ddata:      number,
    /* The agent's CPU per input message, which sets part of the
     * timing allowance (see compare_runs in harness.ts). */
    agent_us_per_input: number,
    credentials: string[],
    writes:     string[],
    births:     { [key: string]: StoredMetric[][] },
    repeated:   { [key: string]: number },
    data:       { [key: string]: StoredMetric[] },
    counts:     { [key: string]: number },
}

const round = (n: number) => Math.round(n * 100) / 100;

function store (m: Metric, t0: number, speed: number): StoredMetric {
    const t = round((Number(m.ts_ns) / 1e6 - t0) * speed);
    return {
        name: m.name,
        type: m.type, value: m.value, t,
        ...(m.props != undefined ? { props: m.props } : {}),
    };
}

function sorted<V> (m: Map<string, V> | undefined): { [k: string]: V } {
    return Object.fromEntries([...m ?? []].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

/* A run as a snapshot. */
export function to_snapshot (r: RunResult, opts: {
    fixture: string, duration_ms: number, speed: number, source: string,
}): Snapshot {
    const { speed } = opts;
    const births = new Map([...r.output.births].map(([k, v]) =>
        [k, v.map(list => list.map(m => store(m, r.t0, speed)))]));
    const data = new Map([...r.output.data].map(([k, v]) =>
        [k, v.map(m => store(m, r.t0, speed))]));
    return {
        source:     opts.source,
        label:      r.label,
        fixture:    opts.fixture,
        duration_ms: opts.duration_ms,
        speed,
        delivered:  r.delivered,
        ddata:      r.ddata,
        agent_us_per_input: r.delivered ? Math.round(r.cpu.agent_us / r.delivered) : 0,
        credentials: r.credentials,
        writes:     r.writes,
        births:     sorted(births),
        repeated:   sorted(r.output.repeated),
        data:       sorted(data),
        counts:     sorted(r.output.counts),
    };
}

/* A snapshot as a run, to compare a new run at the snapshot's speed
 * with. Its first input is at time 0. */
export function from_snapshot (s: Snapshot): RunResult {
    const { speed } = s;
    const ts = (t: number) => BigInt(Math.round(t / speed * 1e6));
    const load = (m: StoredMetric): Metric => ({
        name: m.name, type: m.type, value: m.value,
        ts_ns: ts(m.t), props: m.props,
    });
    const output: Output = {
        births: new Map(Object.entries(s.births).map(([k, v]) =>
            [k, v.map(list => list.map(load))])),
        repeated: new Map(Object.entries(s.repeated)),
        data: new Map(Object.entries(s.data).map(([k, v]) =>
            [k, v.map(load)])),
        counts: new Map(Object.entries(s.counts)),
    };
    return {
        label:      `recorded ${s.label}`,
        output,
        t0:         0,
        delivered:  s.delivered,
        ddata:      s.ddata,
        cpu:        { agent_us: s.agent_us_per_input * s.delivered, agent_startup_us: 0 },
        wall_ms:    0,
        busy:       0,
        log:        `(recorded: ${s.source})`,
        credentials: s.credentials,
        writes:     s.writes,
        timed_out:  false,
    };
}

export function snapshot_path (key: string, dir = snapshot_dir()) {
    return path.join(dir, `${key}.json`);
}

export function write_snapshot (key: string, s: Snapshot, dir = snapshot_dir()) {
    const file = snapshot_path(key, dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(s, null, 1) + "\n");
}

export function read_snapshot (key: string, dir = snapshot_dir()): Snapshot | undefined {
    const file = snapshot_path(key, dir);
    if (!fs.existsSync(file)) return;
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

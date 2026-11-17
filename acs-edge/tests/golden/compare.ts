/*
 * ACS Edge Agent
 * Golden-output harness: compare two runs' Sparkplug output
 * Copyright 2026 University of Sheffield
 */

import type { Metric, Output } from "./capture.js";

/* The base timing allowance. A DDATA metric's timestamp is when the
 * agent handled the value, which depends on when its poll fired and
 * how long the value took to come back, so it can never match to the
 * millisecond between two runs. Each timestamp is taken as an offset
 * from the moment the fake device first delivered input in that run,
 * and the two offsets may differ by at most the allowance. golden()
 * adds the agent's CPU per input message to this base (see there).
 * Everything else (names, types, values, properties, how many values
 * each metric gets and in what order) must match exactly. CI runners
 * are slower and busier, so CI gets more. Override with
 * GOLDEN_TIME_ALLOWANCE_MS. */
export const DEFAULT_TIME_ALLOWANCE_MS = process.env.CI ? 250 : 100;

/* Birth timestamps say when the agent sent the birth, which depends on
 * how long a driver takes to start and not on the data, so they are
 * not compared. */

export interface Run {
    label:  string,
    output: Output,
    /* Date.now() when the fake device first delivered input. */
    t0:     number,
}

export interface Comparison {
    ok:         boolean,
    /* One entry per problem, each naming the message and metric. */
    diffs:      string[],
    /* How many DDATA values were compared. */
    values:     number,
    /* The largest timestamp offset difference seen, in ms. */
    max_skew:   number,
}

const offset = (m: Metric, t0: number) =>
    Number(m.ts_ns - BigInt(t0) * 1_000_000n) / 1e6;

function fmt_ms (ms: number) {
    const r = Math.round(ms * 10) / 10;
    return `${r >= 0 ? "+" : ""}${r} ms`;
}

function pad (s: string, n: number) {
    return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function short (s: string | undefined, n = 40) {
    if (s == undefined) return "(none)";
    return s.length > n ? s.slice(0, n - 3) + "..." : s;
}

/* Compare the output of run `b` with run `a`. */
export function compare (a: Run, b: Run, opts: { allowance_ms?: number } = {}): Comparison {
    const allowance = opts.allowance_ms ?? DEFAULT_TIME_ALLOWANCE_MS;
    const diffs: string[] = [];
    let values = 0;
    let max_skew = 0;

    /* Births: the same metric set, in any order. */
    const bkeys = new Set([...a.output.births.keys(), ...b.output.births.keys()]);
    for (const key of [...bkeys].sort()) {
        const la = a.output.births.get(key) ?? [];
        const lb = b.output.births.get(key) ?? [];
        if (la.length != lb.length)
            diffs.push(`${key}: sent ${la.length} time(s) by ${a.label}, `
                + `${lb.length} time(s) by ${b.label}`);
        for (let i = 0; i < Math.min(la.length, lb.length); i++) {
            const ma = new Map(la[i].map(m => [m.name, m]));
            const mb = new Map(lb[i].map(m => [m.name, m]));
            const names = [...new Set([...ma.keys(), ...mb.keys()])].sort();
            for (const n of names) {
                const x = ma.get(n), y = mb.get(n);
                const where = `${key}${la.length > 1 ? ` #${i + 1}` : ""} metric "${n}"`;
                if (!x) { diffs.push(`${where}: only in ${b.label}`); continue; }
                if (!y) { diffs.push(`${where}: only in ${a.label}`); continue; }
                if (x.type != y.type)
                    diffs.push(`${where}: type ${x.type} in ${a.label}, ${y.type} in ${b.label}`);
                if (x.value != y.value)
                    diffs.push(`${where}: value ${short(x.value)} in ${a.label}, `
                        + `${short(y.value)} in ${b.label}`);
                if (x.props != y.props)
                    diffs.push(`${where}: properties differ\n`
                        + `    ${a.label}: ${short(x.props, 200)}\n`
                        + `    ${b.label}: ${short(y.props, 200)}`);
            }
        }
    }

    /* Other message counts that must match: deaths mean the device
     * went away mid-run. DDATA counts are not compared, because how
     * values are grouped into messages depends on which response
     * arrives first; the values themselves are compared below. */
    const ckeys = new Set([...a.output.counts.keys(), ...b.output.counts.keys()]);
    for (const key of [...ckeys].sort()) {
        if (!/^(DDEATH|NDATA)/.test(key)) continue;
        const x = a.output.counts.get(key) ?? 0, y = b.output.counts.get(key) ?? 0;
        if (x != y)
            diffs.push(`${key}: ${x} message(s) from ${a.label}, ${y} from ${b.label}`);
    }

    /* DDATA: each metric's values, in order. */
    const dkeys = new Set([...a.output.data.keys(), ...b.output.data.keys()]);
    for (const key of [...dkeys].sort()) {
        const la = a.output.data.get(key) ?? [];
        const lb = b.output.data.get(key) ?? [];
        const rows: string[] = [];
        let bad = false;
        const n = Math.max(la.length, lb.length);
        for (let i = 0; i < n; i++) {
            const x = la[i], y = lb[i];
            const problems: string[] = [];
            if (!x || !y) problems.push(x ? `missing in ${b.label}` : `extra in ${b.label}`);
            else {
                values++;
                if (x.type != y.type) problems.push("type");
                if (x.value != y.value) problems.push("value");
                if (x.props != y.props) problems.push("properties");
                const skew = Math.abs(offset(x, a.t0) - offset(y, b.t0));
                max_skew = Math.max(max_skew, skew);
                if (skew > allowance)
                    problems.push(`time (${Math.round(skew)} ms apart, allowance ${allowance} ms)`);
            }
            if (problems.length) bad = true;
            const cell = (m?: Metric, t0 = 0) => m
                ? `${short(m.value, 28)} @ ${fmt_ms(offset(m, t0))}` : "-";
            rows.push(`    ${pad(String(i), 4)} ${pad(cell(x, a.t0), 40)} `
                + `${pad(cell(y, b.t0), 40)}${problems.length ? ` <-- ${problems.join(", ")}` : ""}`);
        }
        if (!bad) continue;

        const type = la[0]?.type ?? lb[0]?.type;
        const head = `DDATA ${key} (${type}): `
            + (la.length != lb.length
                ? `${la.length} value(s) from ${a.label}, ${lb.length} from ${b.label}`
                : "values differ");
        /* Show the rows that differ, with one row of context each side,
         * and never more than 20 rows. */
        const keep = new Set<number>();
        rows.forEach((r, i) => {
            if (r.includes("<--"))
                for (const j of [i - 1, i, i + 1])
                    if (j >= 0 && j < rows.length) keep.add(j);
        });
        const shown = [...keep].sort((p, q) => p - q).slice(0, 20);
        diffs.push([
            head,
            `    ${pad("#", 4)} ${pad(a.label, 40)} ${b.label}`,
            ...shown.map(i => rows[i]),
            ...(keep.size > shown.length ? [`    ... ${keep.size - shown.length} more row(s)`] : []),
        ].join("\n"));
    }

    return { ok: diffs.length == 0, diffs, values, max_skew };
}

/* A comparison as text for a failure message. */
export function report (c: Comparison, a: string, b: string): string {
    if (c.ok)
        return `${b} matches ${a}: ${c.values} DDATA values, `
            + `largest timing difference ${Math.round(c.max_skew)} ms`;
    return `${b} does not match ${a}. ${c.diffs.length} difference(s):\n\n`
        + c.diffs.join("\n\n");
}

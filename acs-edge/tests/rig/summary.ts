/*
 * ACS Edge Agent
 * Split-driver cluster rig: summarise and compare Sparkplug recordings
 * Copyright 2026 University of Sheffield
 *
 * A recording is reduced to a summary per device, in the spirit of the
 * golden harness's comparison: same metrics by name, same types,
 * values arriving. What depends on time (message rates, gaps) is
 * compared within limits, because two recordings of a live system
 * never match message for message.
 */

import { Captured, decode } from "../golden/capture.js";
import type { Rig } from "./rig.js";

/* The limits `compare` applies. */
export const Limits = {
    /* DDATA per second after / before. Above `rate_warn` it warns and
     * above `rate_fail` it fails. A split driver must not multiply the
     * broker's load (ACS-45), but the Edge Agent can only group what
     * arrives together, and ACS-45 measured split OPC UA sending a
     * little more DDATA than the built-in connection with every value
     * the same, which it reports as a warning. Ungrouped values were
     * hundreds of times more. */
    rate_warn:  1.5,
    rate_fail:  3,
    /* Below this it fails: data has slowed down. */
    rate_down:  0.5,
};

export interface MetricSummary {
    type:       string,
    /* DDATA values received. */
    values:     number,
    /* Distinct values, up to 10. */
    distinct:   number,
    last?:      string,
}

export interface DeviceSummary {
    node:       string,
    device:     string,
    connection: string,
    protocol:   string,
    births:     number,
    deaths:     number,
    ddata:      number,
    ddata_per_s: number,
    /* The longest time without DDATA, counting from the start of the
     * recording and to its end. */
    longest_gap_s: number,
    /* Whether a DBIRTH was seen, so metric names and types are known. */
    born:       boolean,
    /* Metrics from the latest DBIRTH, with what DDATA brought. */
    metrics:    { [name: string]: MetricSummary },
    /* Metrics the rig's config reads from the device (address and
     * GET), which are the ones that should get values. */
    read:       string[],
}

export interface Summary {
    label:      string,
    started:    string,
    seconds:    number,
    nodes:      { [node: string]: { nbirth: number, ndeath: number } },
    devices:    { [key: string]: DeviceSummary },
}

/* The metrics a device's config reads, by name. */
function read_metrics (dev: any): string[] {
    return (dev.tags ?? [])
        .filter((t: any) => t.address != undefined && (t.method ?? "GET").includes("GET"))
        .map((t: any) => t.Name);
}

export function summarise (rig: Rig, label: string, started: number, ended: number,
    by_node: Map<string, Captured[]>): Summary
{
    const seconds = (ended - started) / 1000;
    const summary: Summary = {
        label, started: new Date(started).toISOString(), seconds,
        nodes: {}, devices: {},
    };

    for (const node of rig.nodes) {
        const msgs = by_node.get(node.name) ?? [];
        summary.nodes[node.name] = {
            nbirth: msgs.filter(m => m.kind == "NBIRTH").length,
            ndeath: msgs.filter(m => (m.kind as string) == "NDEATH").length,
        };
        const out = decode(msgs.filter(m => (m.kind as string) != "NDEATH"));

        for (const c of rig.connections.filter(c => c.node == node.name)) {
            for (const dev of c.connection.devices ?? []) {
                const id = dev.deviceId;
                const births = out.births.get(`DBIRTH ${id}`) ?? [];
                const latest = births.at(-1) ?? [];
                const metrics: DeviceSummary["metrics"] = {};
                for (const m of latest)
                    metrics[m.name] = { type: m.type, values: 0, distinct: 0 };
                for (const [key, list] of out.data) {
                    if (!key.startsWith(`${id}/`)) continue;
                    const name = key.slice(id.length + 1);
                    const ms = metrics[name] ??= { type: list[0]?.type ?? "", values: 0, distinct: 0 };
                    ms.values += list.length;
                    ms.distinct = Math.min(10, new Set(list.map(v => v.value)).size);
                    ms.last = list.at(-1)?.value;
                }
                const times = msgs
                    .filter(m => m.kind == "DDATA" && m.device == id)
                    .map(m => m.at);
                let gap = 0, prev = started;
                for (const t of [...times, ended]) {
                    gap = Math.max(gap, t - prev);
                    prev = t;
                }
                summary.devices[`${node.name}/${id}`] = {
                    node: node.name, device: id,
                    connection: c.name, protocol: c.protocol,
                    births: (out.counts.get(`DBIRTH ${id}`) ?? 0),
                    deaths: (out.counts.get(`DDEATH ${id}`) ?? 0),
                    ddata: times.length,
                    ddata_per_s: times.length / Math.max(seconds, 1e-3),
                    longest_gap_s: gap / 1000,
                    born: births.length > 0,
                    metrics,
                    read: read_metrics(dev),
                };
            }
        }
    }
    return summary;
}

/* What a device's summary says, in one line. */
function device_line (d: DeviceSummary): string {
    const read = d.read.length;
    const got = d.read.filter(n => (d.metrics[n]?.values ?? 0) > 0).length;
    const moving = d.read.filter(n => (d.metrics[n]?.distinct ?? 0) > 1).length;
    return `${d.node}/${d.device} [${d.protocol} ${d.connection}]: `
        + (d.born ? `${Object.keys(d.metrics).length} metrics born` : "no DBIRTH seen")
        + `, ${got}/${read} read metrics got values, ${moving} changed, `
        + `${d.ddata_per_s.toFixed(2)} DDATA/s, longest gap ${d.longest_gap_s.toFixed(1)} s, `
        + `${d.births} DBIRTH, ${d.deaths} DDEATH`;
}

export function print_summary (s: Summary) {
    console.log("\n%s: %s s from %s", s.label, s.seconds.toFixed(0), s.started);
    for (const [node, n] of Object.entries(s.nodes))
        console.log("%s: %d NBIRTH, %d NDEATH", node, n.nbirth, n.ndeath);
    for (const d of Object.values(s.devices))
        console.log("  %s", device_line(d));
}

export interface Problem {
    device:     string,
    level:      "FAIL" | "WARN",
    what:       string,
}

/* Compare two summaries of the same rig. */
export function compare_summaries (a: Summary, b: Summary): Problem[] {
    const out: Problem[] = [];
    const keys = new Set([...Object.keys(a.devices), ...Object.keys(b.devices)]);
    for (const key of [...keys].sort()) {
        const x = a.devices[key], y = b.devices[key];
        const p = (level: Problem["level"], what: string) =>
            out.push({ device: key, level, what });
        if (!x || !y) {
            p("FAIL", `only in ${x ? a.label : b.label}`);
            continue;
        }
        if (!x.born || !y.born) {
            p("WARN", `no DBIRTH seen in ${!x.born ? a.label : b.label}, `
                + "so names and types can't be compared (record again with --rebirth)");
        }
        else {
            const xm = Object.keys(x.metrics), ym = Object.keys(y.metrics);
            const lost = xm.filter(n => !(n in y.metrics));
            const added = ym.filter(n => !(n in x.metrics));
            if (lost.length) p("FAIL", `metrics missing in ${b.label}: ${lost.slice(0, 10).join(", ")}${lost.length > 10 ? ` and ${lost.length - 10} more` : ""}`);
            if (added.length) p("FAIL", `metrics only in ${b.label}: ${added.slice(0, 10).join(", ")}${added.length > 10 ? ` and ${added.length - 10} more` : ""}`);
            const types = xm.filter(n => n in y.metrics && x.metrics[n].type != y.metrics[n].type);
            for (const n of types.slice(0, 10))
                p("FAIL", `${n}: type ${x.metrics[n].type} in ${a.label}, ${y.metrics[n].type} in ${b.label}`);
        }

        const flowing = (d: DeviceSummary) =>
            new Set(d.read.filter(n => (d.metrics[n]?.values ?? 0) > 0));
        const fx = flowing(x), fy = flowing(y);
        const stopped = [...fx].filter(n => !fy.has(n));
        const started = [...fy].filter(n => !fx.has(n));
        if (stopped.length)
            p("FAIL", `${stopped.length} metrics got values in ${a.label} and none in ${b.label}: ${stopped.slice(0, 10).join(", ")}`);
        if (started.length)
            p("WARN", `${started.length} metrics got values only in ${b.label}: ${started.slice(0, 10).join(", ")}`);
        if (!fy.size && !fx.size && y.read.length)
            p("WARN", `no read metric got a value in either recording`);
        else if (!fy.size && y.read.length)
            p("FAIL", `no read metric got a value in ${b.label}`);

        if (x.ddata_per_s > 0) {
            const ratio = y.ddata_per_s / x.ddata_per_s;
            const rates = `${ratio.toFixed(2)}x (${x.ddata_per_s.toFixed(2)}/s to ${y.ddata_per_s.toFixed(2)}/s)`;
            /* Metrics that only now get values add messages of their
             * own, so a rise then says nothing about grouping. */
            if (ratio > Limits.rate_fail && !started.length)
                p("FAIL", `DDATA rate ${rates}`);
            else if (ratio > Limits.rate_fail)
                p("WARN", `DDATA rate ${rates}, with ${started.length} metrics newly getting values`);
            else if (ratio > Limits.rate_warn)
                p("WARN", `DDATA rate ${rates}`);
            else if (ratio < Limits.rate_down)
                p("FAIL", `DDATA rate fell to ${ratio.toFixed(2)}x (${x.ddata_per_s.toFixed(2)}/s to ${y.ddata_per_s.toFixed(2)}/s)`);
        }
        if (y.deaths > x.deaths)
            p("WARN", `${y.deaths} DDEATH in ${b.label}, ${x.deaths} in ${a.label}`);
    }
    return out;
}

export function print_comparison (a: Summary, b: Summary, problems: Problem[]) {
    const devs = Object.keys(b.devices).length;
    const failed = new Set(problems.filter(p => p.level == "FAIL").map(p => p.device));
    console.log("\n%s against %s: %d devices, %d with failures, %d warnings",
        b.label, a.label, devs, failed.size,
        problems.filter(p => p.level == "WARN").length);
    console.log("\n%s", ["Device", `${a.label} DDATA/s`, `${b.label} DDATA/s`,
        `${b.label} longest gap s`, "Result"].join(" | "));
    for (const key of Object.keys(b.devices).sort()) {
        const x = a.devices[key], y = b.devices[key];
        const mine = problems.filter(p => p.device == key);
        const result = mine.some(p => p.level == "FAIL") ? "FAIL"
            : mine.length ? "WARN" : "ok";
        console.log([key, x?.ddata_per_s.toFixed(2) ?? "-", y.ddata_per_s.toFixed(2),
            y.longest_gap_s.toFixed(1), result].join(" | "));
    }
    for (const p of problems) console.log("%s %s: %s", p.level, p.device, p.what);
}

/* One metric's history in a recording, for the reconnect checks: each
 * DBIRTH, DDATA carrying the metric, and DDEATH of its device, with
 * the seconds since `started`. DDATA names the metric only by alias,
 * so each message is decoded with the device's latest DBIRTH. */
export interface WatchLine {
    at:     number,
    kind:   string,
    value?: string,
}

export function watch (messages: Captured[], device: string, metric: string,
    started: number): WatchLine[]
{
    const lines: WatchLine[] = [];
    let birth: Captured | undefined;
    for (const msg of messages) {
        if (msg.device != device) continue;
        const at = Math.round((msg.at - started) / 100) / 10;
        if (msg.kind == "DDEATH") {
            lines.push({ at, kind: msg.kind });
            continue;
        }
        if (msg.kind == "DBIRTH") birth = msg;
        if (msg.kind != "DBIRTH" && msg.kind != "DDATA") continue;
        const out = decode(msg.kind == "DBIRTH" || !birth ? [msg] : [birth, msg]);
        const m = msg.kind == "DBIRTH"
            ? out.births.get(`DBIRTH ${device}`)?.at(-1)?.find(x => x.name == metric)
            : out.data.get(`${device}/${metric}`)?.at(-1);
        if (m) lines.push({ at, kind: msg.kind, value: m.value });
    }
    return lines;
}

export function print_watch (device: string, metric: string, lines: WatchLine[]) {
    console.log("\n%s / %s:", device, metric);
    if (!lines.length) console.log("  (nothing for this metric)");
    for (const l of lines)
        console.log("  %s s  %s  %s", l.at.toFixed(1).padStart(7), l.kind.padEnd(6),
            l.value ?? "");
}

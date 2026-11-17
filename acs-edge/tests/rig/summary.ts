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

import * as sparkplug from "sparkplug-payload";

import { Captured, Metric, decode, repr } from "../golden/capture.js";
import type { Rig } from "./rig.js";

const SpB = sparkplug.get("spBv1.0")!;

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
    /* Metric values per second after / before. Below this it fails:
     * data has slowed down. It is values, not DDATA, because grouping
     * sends the same values in fewer messages. */
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
    /* Metric values in all those DDATA, so values per message. */
    ddata_metrics?: number,
    /* DDATA metrics known only by an alias no DBIRTH of this device in
     * the recording names, by distinct alias. They are left out of
     * `metrics`. */
    unresolved?: number,
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
        const aliases = first_birth_aliases(msgs);

        for (const c of rig.connections.filter(c => c.node == node.name)) {
            for (const dev of c.connection.devices ?? []) {
                const id = dev.deviceId;
                const births = out.births.get(`DBIRTH ${id}`) ?? [];
                const latest = births.at(-1) ?? [];
                const metrics: DeviceSummary["metrics"] = {};
                for (const m of latest)
                    metrics[m.name] = { type: m.type, values: 0, distinct: 0 };
                const data = resolve_aliases(out.data, id, aliases.get(id));
                for (const [name, list] of data.named) {
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
                    ddata_metrics: data.values,
                    unresolved: data.unresolved,
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

const ALIAS = /^\(alias (.*)\)$/;

/* Each device's alias -> metric from its first DBIRTH in the
 * recording. A recording that starts while the agents are running
 * gets DDATA before any DBIRTH, and decode() can only name those by
 * alias. The agent keeps its aliases until it restarts, so the run's
 * own first DBIRTH names them. */
function first_birth_aliases (msgs: Captured[]) {
    const out = new Map<string, Map<string, { name: string, type: string }>>();
    for (const msg of msgs) {
        if (msg.kind != "DBIRTH" || msg.device == undefined || out.has(msg.device)) continue;
        const map = new Map();
        for (const m of SpB.decodePayload(msg.bytes).metrics ?? [])
            if (m.alias != undefined && m.name)
                map.set(repr(m.alias), { name: m.name, type: m.type });
        out.set(msg.device, map);
    }
    return out;
}

/* One device's DDATA values by metric name, with aliases named from
 * `aliases` where decode() could not, merged in time order. */
function resolve_aliases (data: Map<string, Metric[]>, id: string,
    aliases?: Map<string, { name: string, type: string }>)
{
    const named = new Map<string, Metric[]>();
    let values = 0;
    const unresolved = new Set<string>();
    for (const [key, list] of data) {
        if (!key.startsWith(`${id}/`)) continue;
        values += list.length;
        let name = key.slice(id.length + 1);
        const alias = name.match(ALIAS)?.[1];
        if (alias != undefined) {
            const known = aliases?.get(alias);
            if (!known) {
                unresolved.add(alias);
                continue;
            }
            name = known.name;
            list.forEach(v => v.type ??= known.type);
        }
        named.set(name, [...(named.get(name) ?? []), ...list]
            .sort((a, b) => (a.ts_ns < b.ts_ns ? -1 : a.ts_ns > b.ts_ns ? 1 : 0)));
    }
    return { named, values, unresolved: unresolved.size };
}

/* Metrics per DDATA message, or undefined if not known. */
function per_ddata (d?: DeviceSummary) {
    if (!d || !d.ddata) return;
    const n = d.ddata_metrics
        ?? Object.values(d.metrics).reduce((t, m) => t + m.values, 0);
    return n / d.ddata;
}

/* What a device's summary says, in one line. */
function device_line (d: DeviceSummary): string {
    const read = d.read.length;
    const got = d.read.filter(n => (d.metrics[n]?.values ?? 0) > 0).length;
    const moving = d.read.filter(n => (d.metrics[n]?.distinct ?? 0) > 1).length;
    return `${d.node}/${d.device} [${d.protocol} ${d.connection}]: `
        + (d.born ? `${Object.keys(d.metrics).length} metrics born` : "no DBIRTH seen")
        + `, ${got}/${read} read metrics got values, ${moving} changed, `
        + `${d.ddata_per_s.toFixed(2)} DDATA/s, ${per_ddata(d)?.toFixed(1) ?? "-"} metrics/DDATA, `
        + `longest gap ${d.longest_gap_s.toFixed(1)} s, `
        + `${d.births} DBIRTH, ${d.deaths} DDEATH`
        + (d.unresolved ? `, ${d.unresolved} unnamed aliases skipped` : "");
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
    level:      "FAIL" | "WARN" | "EXPECTED",
    what:       string,
}

/* The differences the move is meant to make, which `compare` reports
 * as EXPECTED instead of failing. The runbook lists the same:
 *
 *  - a device the built-in connection starved (no read metric got a
 *    value before) now publishing, such as all but the last device of
 *    a multi-device OPC UA connection;
 *  - DateTime metrics getting values, where the built-in sent none
 *    or 0;
 *  - a UDP device publishing, because before the upgrade nothing
 *    outside the cluster could reach the built-in UDP connection;
 *  - ISA-95 hierarchy metrics added to a device that had none, which
 *    the placement step puts at the organisation, with the
 *    Device_Information UUIDs if it had no Device_Information;
 *  - on a connection whose other devices the built-in starved, the
 *    device that did get values getting fewer. The built-in OPC UA
 *    connection put every device's values into one device, so that
 *    device sent the whole connection's values; after the move each
 *    device gets its own. It counts as this only if the connection's
 *    values per second held up. */
export const Expected = {
    starved:    "now publishing: the built-in connection gave it no values",
    datetime:   "DateTime metrics now get values",
    udp:        "UDP now reachable from outside the cluster",
    isa95:      "ISA-95 hierarchy metrics added at the organisation",
    shared:     "fewer values: the built-in gave it its starved neighbours' values too",
};

/* Metric values a device published per second, counting values known
 * only by alias. Older summaries have no `ddata_metrics`, but keep
 * alias values in `metrics`. */
function values_per_s (d: DeviceSummary, seconds: number) {
    const n = d.ddata_metrics
        ?? Object.values(d.metrics).reduce((t, m) => t + m.values, 0);
    return n / Math.max(seconds, 1e-3);
}

const ISA95 = /^Device_Information\/ISA95_Hierarchy\//;
/* A device with no Device_Information object gains its UUID tags with
 * the hierarchy. */
const DEVINFO = /^Device_Information\/(Schema_UUID|Instance_UUID)$/;

const list = (names: string[]) =>
    names.slice(0, 10).join(", ") + (names.length > 10 ? ` and ${names.length - 10} more` : "");

/* Metric names in a summary, without any still known only by alias
 * (summaries recorded before aliases were resolved have them). */
function named (d: DeviceSummary) {
    return Object.keys(d.metrics).filter(n => !ALIAS.test(n));
}

/* Compare two summaries of the same rig. */
export function compare_summaries (a: Summary, b: Summary): Problem[] {
    const out: Problem[] = [];
    const keys = new Set([...Object.keys(a.devices), ...Object.keys(b.devices)]);

    /* Per connection: whether the built-in starved any device on it,
     * and its values per second before and after. */
    const conns = new Map<string, { starved: boolean, before: number, after: number }>();
    for (const key of keys) {
        const x = a.devices[key], y = b.devices[key];
        if (!x || !y) continue;
        const ck = `${x.node}/${x.connection}`;
        const c = conns.get(ck) ?? { starved: false, before: 0, after: 0 };
        const got = (d: DeviceSummary) => d.read.some(n => (d.metrics[n]?.values ?? 0) > 0);
        if (!got(x) && got(y)) c.starved = true;
        c.before += values_per_s(x, a.seconds);
        c.after += values_per_s(y, b.seconds);
        conns.set(ck, c);
    }

    for (const key of [...keys].sort()) {
        const x = a.devices[key], y = b.devices[key];
        const p = (level: Problem["level"], what: string) =>
            out.push({ device: key, level, what });
        if (!x || !y) {
            p("FAIL", `only in ${x ? a.label : b.label}`);
            continue;
        }

        const flowing = (d: DeviceSummary) =>
            new Set(d.read.filter(n => (d.metrics[n]?.values ?? 0) > 0));
        const fx = flowing(x), fy = flowing(y);
        const stopped = [...fx].filter(n => !fy.has(n));
        const started = [...fy].filter(n => !fx.has(n));
        /* Starved before: nothing it reads got a value. */
        const starved = !fx.size && fy.size > 0;

        const skipped = Object.keys(x.metrics).filter(n => ALIAS.test(n)).length
            + Object.keys(y.metrics).filter(n => ALIAS.test(n)).length
            + (x.unresolved ?? 0) + (y.unresolved ?? 0);
        if (skipped)
            p("WARN", `${skipped} metrics known only by alias skipped (record with --rebirth to name them)`);

        if (!x.born || !y.born) {
            p("WARN", `no DBIRTH seen in ${!x.born ? a.label : b.label}, `
                + "so names and types can't be compared (record again with --rebirth)");
        }
        else {
            const xm = named(x), ym = named(y);
            const lost = xm.filter(n => !(n in y.metrics));
            const added = ym.filter(n => !(n in x.metrics));
            const had_isa95 = xm.some(n => ISA95.test(n));
            const had_info = xm.some(n => n.startsWith("Device_Information/"));
            const isa95 = had_isa95 ? [] : added.filter(n => ISA95.test(n)
                || (!had_info && DEVINFO.test(n)));
            const other = added.filter(n => !isa95.includes(n));
            if (lost.length) p("FAIL", `metrics missing in ${b.label}: ${list(lost)}`);
            if (other.length) p("FAIL", `metrics only in ${b.label}: ${list(other)}`);
            if (isa95.length) p("EXPECTED", `${Expected.isa95}: ${list(isa95)}`);
            const types = xm.filter(n => n in y.metrics && x.metrics[n].type != y.metrics[n].type);
            for (const n of types.slice(0, 10))
                p("FAIL", `${n}: type ${x.metrics[n].type} in ${a.label}, ${y.metrics[n].type} in ${b.label}`);
        }

        if (stopped.length)
            p("FAIL", `${stopped.length} metrics got values in ${a.label} and none in ${b.label}: ${list(stopped)}`);
        if (starved && y.protocol == "UDP")
            p("EXPECTED", `${Expected.udp} (${fy.size} metrics)`);
        else if (starved)
            p("EXPECTED", `${Expected.starved} (${fy.size} metrics)`);
        else if (started.length) {
            const dt = started.filter(n => y.metrics[n]?.type == "DateTime");
            const rest = started.filter(n => !dt.includes(n));
            if (dt.length) p("EXPECTED", `${Expected.datetime}: ${list(dt)}`);
            if (rest.length)
                p("WARN", `${rest.length} metrics got values only in ${b.label}: ${list(rest)}`);
        }
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
        }
        const vx = values_per_s(x, a.seconds), vy = values_per_s(y, b.seconds);
        if (vx > 0 && vy / vx < Limits.rate_down) {
            const fell = `values per second fell to ${(vy / vx).toFixed(2)}x (${vx.toFixed(2)}/s to ${vy.toFixed(2)}/s)`;
            const c = conns.get(`${x.node}/${x.connection}`)!;
            if (c.starved && c.after >= c.before * Limits.rate_down)
                p("EXPECTED", `${Expected.shared}: ${fell}, connection ${c.before.toFixed(2)}/s to ${c.after.toFixed(2)}/s`);
            else
                p("FAIL", fell);
        }
        if (y.deaths > x.deaths)
            p("WARN", `${y.deaths} DDEATH in ${b.label}, ${x.deaths} in ${a.label}`);
    }
    return out;
}

/* The result of one device: its worst problem. */
function result (problems: Problem[]) {
    for (const level of ["FAIL", "WARN", "EXPECTED"])
        if (problems.some(p => p.level == level)) return level;
    return "ok";
}

export function print_comparison (a: Summary, b: Summary, problems: Problem[]) {
    const keys = Object.keys(b.devices).sort();
    const by = (level: string) => keys.filter(k =>
        result(problems.filter(p => p.device == k)) == level).length;
    console.log("\n%s against %s: %d devices: %d failed, %d with warnings, %d with only expected differences, %d ok",
        b.label, a.label, keys.length, by("FAIL"), by("WARN"), by("EXPECTED"), by("ok"));

    const n = (v?: number, d = 2) => v == undefined ? "-" : v.toFixed(d);
    console.log("\n%s", ["Device", `${a.label} DDATA/s`, `${b.label} DDATA/s`,
        `${a.label} metrics/DDATA`, `${b.label} metrics/DDATA`,
        `${b.label} longest gap s`, "Result"].join(" | "));
    for (const key of keys) {
        const x = a.devices[key], y = b.devices[key];
        console.log([key, n(x?.ddata_per_s), n(y.ddata_per_s),
            n(per_ddata(x), 1), n(per_ddata(y), 1),
            n(y.longest_gap_s, 1), result(problems.filter(p => p.device == key))].join(" | "));
    }

    for (const [level, title] of [["FAIL", "Failures"], ["WARN", "Warnings"],
        ["EXPECTED", "Expected differences (see the runbook's list)"]])
    {
        const mine = problems.filter(p => p.level == level);
        if (!mine.length) continue;
        console.log("\n%s:", title);
        for (const p of mine) console.log("  %s: %s", p.device, p.what);
    }
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

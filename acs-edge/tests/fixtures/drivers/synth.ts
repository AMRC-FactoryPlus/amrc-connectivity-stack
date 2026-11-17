/*
 * ACS Edge Agent
 * Driver fixtures: synthesise device input from a connection config
 * Copyright 2026 University of Sheffield
 */

import { OPCUADataType } from "../../../lib/helpers/typeHandler.js";
import {
    FORMAT, VERSION, Finding, Fixture, FixtureEvent, OpcuaValue,
} from "./fixture.js";
import { ConnectionMetrics, ReadMetric, connection_metrics, finding } from "./metrics.js";
import { DelimitedDoc, JsonDoc, PayloadDoc, XmlDoc } from "./payloads.js";
import { Signal, hash, supported_type } from "./signals.js";

export interface SynthOpts {
    agent: string,
    seed: number,
    duration_ms: number,
    /* MQTT publish interval per topic. REST and OPC UA use the
     * connection's poll interval. */
    mqtt_interval_ms: number,
}

/* The values behind each event, kept so the generator can compare
 * them with what the agent's parser reads back. Not written out. */
export interface Expected {
    /* Per event, metric index in cm.read -> value. */
    values: Map<number, any>[],
}

interface Slotted {
    m: ReadMetric,
    i: number,
    slot: number,
    signal: Signal,
}

export function protocol_of (connection: any): string {
    return connection.connType;
}

export function poll_interval (connection: any): number {
    const p = Number(connection.pollInt);
    return p > 0 ? p : 1000;
}

export function synthesise (connection: any, opts: SynthOpts)
    : { fixture: Fixture, cm: ConnectionMetrics, expected: Expected }
{
    const cm = connection_metrics(connection);
    const findings: Finding[] = [...cm.findings];
    const protocol = protocol_of(connection);
    const events: FixtureEvent[] = [];
    const expected: Expected = { values: [] };

    const usable = cm.read.map((m, i) => ({ m, i })).filter(({ m }) => {
        if (supported_type(m.type)) return true;
        findings.push(finding(m, `type ${m.type} is not synthesised`));
        return false;
    });

    let interval: number;
    if (protocol == "OPC UA") {
        interval = poll_interval(connection);
        opcua_events(usable, opts, interval, events, expected, findings);
    }
    else if (protocol == "MQTT" || protocol == "REST") {
        interval = protocol == "MQTT"
            ? opts.mqtt_interval_ms : poll_interval(connection);
        payload_events(protocol, cm, usable, opts, interval,
            events, expected, findings);
    }
    else
        throw new Error(`Connection type ${protocol} is not supported`);

    const meta = {
        format: FORMAT,
        version: VERSION,
        name: connection.name,
        agent: opts.agent,
        protocol,
        payloadFormat: cm.payloadFormat,
        delimiter: cm.delimiter,
        source: "synthetic" as const,
        seed: opts.seed,
        duration_ms: opts.duration_ms,
        interval_ms: interval,
        features: features(connection, cm),
        counts: {
            devices: cm.devices,
            metrics: cm.metrics,
            read_metrics: cm.read.length,
            addresses: new Set(cm.read.map(m => m.address)).size,
            events: events.length,
            bytes: 0,
        },
        findings,
    };
    return { fixture: { meta, connection, events }, cm, expected };
}

/* MQTT and REST: one payload per address per interval, holding every
 * metric configured on that address. */
function payload_events (
    protocol: string, cm: ConnectionMetrics,
    usable: { m: ReadMetric, i: number }[], opts: SynthOpts,
    interval: number, events: FixtureEvent[], expected: Expected,
    findings: Finding[],
) {
    const by_addr = new Map<string, { m: ReadMetric, i: number }[]>();
    for (const u of usable) {
        if (!by_addr.has(u.m.address)) by_addr.set(u.m.address, []);
        by_addr.get(u.m.address)!.push(u);
    }

    /* Collect (time, address, payload, values) first and sort after,
     * so events and expected values stay in step. */
    const pending: { t: number, ev: FixtureEvent, vals: Map<number, any> }[] = [];

    for (const [addr, ms] of by_addr) {
        const doc = new_doc(cm.payloadFormat, cm.delimiter);
        if (typeof doc == "string") {
            for (const u of ms) findings.push(finding(u.m, doc));
            continue;
        }
        if (doc instanceof XmlDoc) doc.set_root(ms.map(u => u.m.path));

        /* Two devices reading the same address and path share a slot,
         * because they parse the same payload. */
        const by_path = new Map<string, Slotted>();
        const slotted: Slotted[] = [];
        const shared: { u: { m: ReadMetric, i: number }, s: Slotted }[] = [];
        for (const u of ms) {
            const prev = by_path.get(u.m.path);
            if (prev) { shared.push({ u, s: prev }); continue; }
            const slot = doc.place(u.m.path);
            if (typeof slot == "string") {
                findings.push(finding(u.m, slot));
                continue;
            }
            const s: Slotted = {
                m: u.m, i: u.i, slot,
                signal: new Signal(u.m.type,
                    hash(`${opts.seed}|${addr}|${u.m.path}`), eng_range(u.m)),
            };
            by_path.set(u.m.path, s);
            slotted.push(s);
        }
        if (!slotted.length) continue;

        const types: string[] = [];
        for (const s of slotted) types[s.slot] = s.m.type;

        /* Stagger addresses so they don't all publish at once. */
        const phase = hash(`${opts.seed}|phase|${addr}`) % interval;
        const start = protocol == "REST" ? 0 : phase;
        for (let t = start; t < opts.duration_ms; t += interval) {
            const values: any[] = [];
            const vals = new Map<number, any>();
            for (const s of slotted) {
                values[s.slot] = s.signal.next(t);
                vals.set(s.i, values[s.slot]);
            }
            for (const { u, s } of shared) vals.set(u.i, values[s.slot]);
            const body = doc.render(values, types);
            const ev: FixtureEvent = protocol == "MQTT"
                ? { t, type: "mqtt", topic: addr, payload: body }
                : {
                    t, type: "http", path: addr, status: 200,
                    content_type: doc.content_type, body,
                };
            pending.push({ t, ev, vals });
        }
    }

    pending.sort((a, b) => a.t - b.t);
    for (const p of pending) {
        events.push(p.ev);
        expected.values.push(p.vals);
    }
}

/* The metric's engineering range, when it has a usable one. */
function eng_range (m: ReadMetric): [number, number] | undefined {
    const lo = Number(m.metric.properties?.engLow?.value);
    const hi = Number(m.metric.properties?.engHigh?.value);
    const set = (v: any) => v != null && v !== "";
    if (set(m.metric.properties?.engLow?.value)
        && set(m.metric.properties?.engHigh?.value)
        && Number.isFinite(lo) && Number.isFinite(hi) && hi > lo)
        return [lo, hi];
    return undefined;
}

function new_doc (format: string, delimiter: string): PayloadDoc | string {
    switch (format) {
        case "JSON": return new JsonDoc();
        case "XML": return new XmlDoc();
        case "Delimited String": return new DelimitedDoc(delimiter);
        default: return `payload format "${format}" is not synthesised`;
    }
}

/* OPC UA: the built-in connection subscribes to each node id and hands
 * the agent the raw value, so the fixture is node values over time.
 * The first event holds every node; later ones only the nodes whose
 * value changed, as a subscription would report them. */
function opcua_events (
    usable: { m: ReadMetric, i: number }[], opts: SynthOpts,
    interval: number, events: FixtureEvent[], expected: Expected,
    findings: Finding[],
) {
    const nodes = new Map<string, { type: string, signal: Signal, is: number[] }>();
    for (const u of usable) {
        const dt = (OPCUADataType as any)[u.m.type] as string | undefined;
        if (!dt || /^[a-z]/.test(dt)) {
            findings.push(finding(u.m, `type ${u.m.type} has no OPC UA data type`));
            continue;
        }
        const n = nodes.get(u.m.address);
        if (n) {
            if (n.type != u.m.type)
                findings.push(finding(u.m, `node is also read as ${n.type} by another metric`));
            n.is.push(u.i);
            continue;
        }
        nodes.set(u.m.address, {
            type: u.m.type, is: [u.i],
            signal: new Signal(u.m.type, hash(`${opts.seed}|${u.m.address}`),
                eng_range(u.m)),
        });
    }

    const last = new Map<string, any>();
    for (let t = 0; t < opts.duration_ms; t += interval) {
        const values: { [id: string]: OpcuaValue } = {};
        const vals = new Map<number, any>();
        for (const [id, n] of nodes) {
            const v = n.signal.next(t);
            if (t > 0 && last.get(id) === v) continue;
            last.set(id, v);
            const dataType = (OPCUADataType as any)[n.type];
            values[id] = {
                dataType,
                value: n.type == "DateTime" ? new Date(v).toISOString() : v,
            };
            for (const i of n.is) vals.set(i, v);
        }
        if (!Object.keys(values).length) continue;
        events.push({ t, type: "opcua", values });
        expected.values.push(vals);
    }
}

function features (connection: any, cm: ConnectionMetrics): string[] {
    const f = new Set<string>();
    f.add(`protocol:${connection.connType}`);
    f.add(`payload:${cm.payloadFormat}`);
    if (cm.devices > 1) f.add("multi-device");
    const per_addr = new Map<string, number>();
    for (const m of cm.read) {
        per_addr.set(m.address, (per_addr.get(m.address) ?? 0) + 1);
        f.add(`type:${m.type}`);
        const p = m.path;
        if (cm.payloadFormat == "JSON") {
            if (!p) f.add("json:value-field");
            else if (p == "$") f.add("json:whole-payload");
            if (/\[\?\(/.test(p)) f.add("jsonpath:filter");
            if (/\[\d+\]/.test(p)) f.add("jsonpath:index");
        }
        if (cm.payloadFormat == "XML") {
            if (p.includes("//")) f.add("xpath:descendant");
            if (/contains\(/.test(p)) f.add("xpath:contains");
            if (/\/@[\w-]+$/.test(p)) f.add("xpath:attribute");
            if (/text\(\)$|node\(\)$/.test(p)) f.add("xpath:text");
        }
        if (cm.payloadFormat == "Delimited String")
            f.add(p ? "delimited:field" : "delimited:whole-payload");
    }
    if ([...per_addr.values()].some(n => n > 1))
        f.add("many-metrics-per-address");
    const op = connection.OPCUAConnDetails;
    if (op) {
        f.add(`opcua:security:${op.securityMode ?? "None"}/${op.securityPolicy ?? "None"}`);
        if (op.useCredentials) f.add("opcua:credentials");
    }
    const mq = connection.MQTTConnDetails;
    if (mq) {
        f.add(`mqtt:protocol:${mq.protocol}`);
        if (mq.username) f.add("mqtt:credentials");
    }
    const rest = connection.RESTConnDetails;
    if (rest) {
        f.add(`rest:auth:${rest.authMethod ?? "None"}`);
        if (/^https:/.test(rest.baseURL ?? "")) f.add("rest:https");
    }
    return [...f].sort();
}

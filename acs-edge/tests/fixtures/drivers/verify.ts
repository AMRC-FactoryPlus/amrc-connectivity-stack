/*
 * ACS Edge Agent
 * Driver fixtures: check every metric resolves with the agent's parser
 * Copyright 2026 University of Sheffield
 */

import { resolveNodeId } from "node-opcua";
import {
    parseValueFromPayload, sparkplugDataType,
} from "../../../lib/helpers/typeHandler.js";
import {
    Finding, Fixture, HttpEvent, MqttEvent, event_address, event_payload,
} from "./fixture.js";
import { ConnectionMetrics, ReadMetric, connection_metrics, finding, js_type } from "./metrics.js";

export interface VerifyOpts {
    /* Per event, metric index in cm.read -> the value the payload was
     * built to hold. Without it only the JS type is checked. */
    expected?: Map<number, any>[],
    /* Check at most this many events per address. */
    max_events_per_address?: number,
}

export interface VerifyResult {
    findings: Finding[],
    /* Metrics that read a good value from at least one event. */
    resolved: number,
    checked_events: number,
}

/* Feed each event to the Edge Agent's parser the way Device._handleData
 * does, and report every read metric that does not get the value the
 * payload holds. Metrics the fixture already lists as findings are
 * skipped. */
export function verify (fixture: Fixture, opts: VerifyOpts = {},
    cm: ConnectionMetrics = connection_metrics(fixture.connection))
    : VerifyResult
{
    const max = opts.max_events_per_address ?? Infinity;
    const known = new Set(fixture.meta.findings.map(f =>
        key(f.device, f.metric, f.address, f.path)));
    const live = cm.read.map((m, i) => ({ m, i }))
        .filter(({ m }) => !known.has(key(m.device, m.name, m.address, m.path)));
    const failed = new Map<number, Finding>();
    const ok = new Set<number>();
    let checked = 0;

    const fail = (i: number, m: ReadMetric, why: string) => {
        if (!failed.has(i)) failed.set(i, finding(m, why));
    };

    if (fixture.meta.protocol == "OPC UA") {
        for (const { m, i } of live) {
            let id: string;
            try { id = resolveNodeId(m.address).toString(); }
            catch (e) {
                fail(i, m, `node id is not valid: ${(e as Error).message}`);
                continue;
            }
            /* The connection keys values by nodeId.toString(), and the
             * metric is found by its configured address. */
            if (id != m.address)
                fail(i, m, `node id is written "${m.address}" but OPC UA `
                    + `reports it as "${id}", so the metric is never updated`);
        }
        fixture.events.forEach((ev, n) => {
            if (ev.type != "opcua") return;
            checked++;
            for (const { m, i } of live) {
                const v = ev.values[m.address];
                if (!v) continue;
                check(i, m, v.dataType == "DateTime"
                    ? Date.parse(v.value) : v.value, opts.expected?.[n]);
            }
        });
    }
    else {
        const by_addr = new Map<string, { m: ReadMetric, i: number }[]>();
        for (const l of live) {
            if (!by_addr.has(l.m.address)) by_addr.set(l.m.address, []);
            by_addr.get(l.m.address)!.push(l);
        }
        const seen = new Map<string, number>();
        fixture.events.forEach((ev, n) => {
            if (ev.type == "opcua") return;
            const addr = event_address(ev as MqttEvent | HttpEvent);
            const count = (seen.get(addr) ?? 0) + 1;
            seen.set(addr, count);
            if (count > max) return;
            checked++;
            const payload = event_payload(ev as MqttEvent | HttpEvent);
            for (const { m, i } of by_addr.get(addr) ?? []) {
                let v = parseValueFromPayload(payload, m.metric,
                    fixture.meta.payloadFormat, fixture.meta.delimiter);
                /* Device._handleData nulls an object read as a String. */
                if (m.type == sparkplugDataType.string && typeof v == "object"
                    && v !== null && !Buffer.isBuffer(v))
                    v = null;
                check(i, m, v, opts.expected?.[n]);
            }
        });
        for (const [addr, ms] of by_addr)
            if (!seen.has(addr))
                for (const { m, i } of ms)
                    fail(i, m, "no input for this address");
    }

    function check (i: number, m: ReadMetric, v: any, exp?: Map<number, any>) {
        if (failed.has(i)) return;
        if (v === null || v === undefined || Number.isNaN(v))
            return fail(i, m, `resolves to ${v}`);
        if (exp && exp.has(i)) {
            const want = exp.get(i);
            if (v !== want)
                return fail(i, m, `reads ${show(v)} where the payload holds ${show(want)}`);
        }
        else {
            const t = js_type(m.type);
            if (t && typeof v != t)
                return fail(i, m, `reads a ${typeof v} (${show(v)}) for a ${m.type}`);
        }
        ok.add(i);
    }

    return {
        findings: [...failed.values()],
        resolved: [...ok].filter(i => !failed.has(i)).length,
        checked_events: checked,
    };
}

function key (...parts: string[]) {
    return parts.join("\u0000");
}

function show (v: any): string {
    const s = typeof v == "string" ? JSON.stringify(v) : String(v);
    return s.length > 80 ? s.slice(0, 77) + "..." : s;
}

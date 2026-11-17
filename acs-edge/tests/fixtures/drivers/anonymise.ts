/*
 * ACS Edge Agent
 * Driver fixtures: cut a real connection down to a small neutral sample
 * Copyright 2026 University of Sheffield
 */

import { Finding } from "./fixture.js";

/* The shape of a path with its literals and indices taken out, so the
 * sample keeps one metric of each kind of path. */
function shape (path: string | null | undefined): string {
    return (path ?? "")
        .replace(/'[^']*'|"[^"]*"/g, "L")
        .replace(/\d+/g, "N");
}

/* Pick up to max read metrics that resolve, covering each path shape
 * and type at least once, then fill up with more metrics on the
 * addresses already chosen. Rename every host, device, topic, node id,
 * metric and UUID. Paths and value types are kept. */
export function sample_connection (connection: any, kind: string,
    max: number, findings: Finding[]): any
{
    const bad = new Set(findings.map(f => `${f.device}\u0000${f.metric}`));
    const cands: { dev: any, tag: any }[] = [];
    for (const dev of connection.devices ?? [])
        for (const tag of dev.tags ?? [])
            if (tag.address != null && /^GET/.test(tag.method ?? "")
                && !bad.has(`${dev.deviceId}\u0000${tag.Name}`))
                cands.push({ dev, tag });

    const picked = new Set<any>();
    const kinds = new Set<string>();
    for (const c of cands) {
        if (picked.size >= max) break;
        const k = `${shape(c.tag.path)}|${c.tag.type}`;
        if (kinds.has(k)) continue;
        kinds.add(k);
        picked.add(c);
    }
    const addrs = new Set([...picked].map(c => c.tag.address));
    for (const c of cands) {
        if (picked.size >= max) break;
        if (addrs.has(c.tag.address)) picked.add(c);
    }

    const addr_map = new Map<string, string>();
    const new_addr = (a: string) => {
        if (!addr_map.has(a)) addr_map.set(a, neutral_address(kind, a, addr_map.size + 1));
        return addr_map.get(a)!;
    };

    const devices: any[] = [];
    let n = 0;
    for (const dev of connection.devices ?? []) {
        const tags = cands.filter(c => c.dev === dev && picked.has(c))
            .map(c => c.tag);
        if (!tags.length) continue;
        devices.push({
            deviceId: `Device_${devices.length + 1}`,
            deviceType: "00000000-0000-4000-8000-000000000001",
            pollInt: connection.pollInt,
            pubInterval: 0,
            payloadFormat: connection.payloadFormat,
            templates: [],
            tags: tags.map(t => ({
                Name: `Metric_${String(++n).padStart(2, "0")}`,
                type: t.type,
                method: t.method,
                address: new_addr(t.address),
                path: t.path,
                value: null,
                recordToDB: true,
                ...(t.engUnit != null ? { engUnit: t.engUnit } : {}),
            })),
        });
    }

    const out: any = {
        name: `sample-${kind}`,
        uuid: "00000000-0000-4000-8000-000000000002",
        connType: connection.connType,
        payloadFormat: connection.payloadFormat,
        ...(connection.pollInt != null ? { pollInt: connection.pollInt } : {}),
        ...(connection.delimiter != null ? { delimiter: connection.delimiter } : {}),
        devices,
    };
    if (connection.MQTTConnDetails) {
        const d = connection.MQTTConnDetails;
        out.MQTTConnDetails = {
            host: "mqtt.example", port: d.port, useSSL: d.useSSL,
            protocol: d.protocol, clientId: "sample-client",
            username: d.username ? "sample-user" : "",
            password: "REDACTED", keepAlive: d.keepAlive,
            cleanSession: d.cleanSession,
        };
    }
    if (connection.RESTConnDetails) {
        const d = connection.RESTConnDetails;
        out.RESTConnDetails = {
            baseURL: "http://device.example:8080",
            authMethod: d.authMethod,
            ...(d.authMethod == "Basic"
                ? { username: "sample-user", password: "REDACTED" } : {}),
        };
    }
    if (connection.OPCUAConnDetails) {
        const d = connection.OPCUAConnDetails;
        out.OPCUAConnDetails = {
            endpoint: "opc.tcp://opcua.example:4840",
            securityMode: d.securityMode,
            securityPolicy: d.securityPolicy,
            useCredentials: d.useCredentials,
            ...(d.useCredentials
                ? { username: "sample-user", password: "REDACTED" } : {}),
        };
    }
    return out;
}

function neutral_address (kind: string, real: string, n: number): string {
    const k = String(n).padStart(2, "0");
    if (/opcua/.test(kind)) {
        const m = /^ns=(\d+);([sigb])=/.exec(real);
        const ns = m ? m[1] : "2";
        return m && m[2] == "i" ? `ns=${ns};i=${1000 + n}`
            : `ns=${ns};s=Sample/Node_${k}`;
    }
    if (/mqtt/.test(kind)) return `sample/topic_${k}`;
    return `${real.startsWith("/") ? "/" : ""}resource_${k}`;
}

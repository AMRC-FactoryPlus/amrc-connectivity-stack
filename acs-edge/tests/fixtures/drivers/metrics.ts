/*
 * ACS Edge Agent
 * Driver fixtures: the metrics a connection config reads
 * Copyright 2026 University of Sheffield
 */

import { reHashConf } from "../../../utils/FormatConfig.js";
import { Metrics, sparkplugMetric } from "../../../lib/helpers/typeHandler.js";
import { Finding } from "./fixture.js";

/* One metric the Edge Agent reads from the device. */
export interface ReadMetric {
    device: string,
    name: string,
    type: string,
    address: string,
    path: string,
    metric: sparkplugMetric,
}

export interface ConnectionMetrics {
    payloadFormat: string,
    delimiter: string,
    devices: number,
    metrics: number,
    /* Every metric the Edge Agent will read, in config order. */
    read: ReadMetric[],
    /* Per device, the Metrics index the Edge Agent builds. */
    indices: Map<string, Metrics>,
    findings: Finding[],
}

/* Build the metrics exactly as the Edge Agent does, with reHashConf and
 * the Metrics index, so a fixture is checked against the same objects
 * the agent's parser sees. */
export function connection_metrics (connection: any): ConnectionMetrics {
    const conf = reHashConf({
        deviceConnections: [JSON.parse(JSON.stringify(connection))],
    });
    const conn = conf.deviceConnections[0];
    const out: ConnectionMetrics = {
        payloadFormat: conn.payloadFormat,
        /* Device: options.delimiter || "" */
        delimiter: conn.delimiter || "",
        devices: conn.devices?.length ?? 0,
        metrics: 0,
        read: [],
        indices: new Map(),
        findings: [],
    };

    for (const dev of conn.devices ?? []) {
        const metrics: sparkplugMetric[] = dev.metrics;
        out.metrics += metrics.length;
        const index = new Metrics(metrics);
        out.indices.set(dev.deviceId, index);

        metrics.forEach((m, i) => {
            const props = m.properties;
            const address = props?.address?.value as string | undefined;
            const method = (props?.method?.value ?? "") as string;
            if (address == null || !/GET/.test(method)) return;
            const path = (props?.path?.value ?? "") as string;
            const rm: ReadMetric = {
                device: dev.deviceId, name: m.name ?? "", type: m.type,
                address, path, metric: m,
            };
            /* Device._handleData only reads ^GET. */
            if (!/^GET/.test(method)) {
                out.findings.push(finding(rm,
                    `method "${method}" is indexed but never read, `
                    + `because Device only reads methods starting GET`));
                return;
            }
            /* The index keeps one metric per address and path, so a
             * second metric with the same pair never gets a value. */
            if (index.getByAddrPath(address, path) !== m) {
                const winner = index.getByAddrPath(address, path);
                out.findings.push(finding(rm,
                    `shadowed: "${winner.name}" on the same device has the `
                    + `same address and path, so only that one is updated`));
                return;
            }
            out.read.push(rm);
        });
    }
    return out;
}

export function finding (m: ReadMetric, problem: string): Finding {
    return {
        device: m.device, metric: m.name,
        address: m.address, path: m.path, problem,
    };
}

/* The JS type a parsed value of this Sparkplug type should have. */
export function js_type (type: string): string | undefined {
    if (/^U?Int(8|16|32|64)$|^Float$|^Double$|^DateTime$/.test(type))
        return "number";
    if (type == "Boolean") return "boolean";
    if (/^(String|Text|UUID)$/.test(type)) return "string";
    return undefined;
}

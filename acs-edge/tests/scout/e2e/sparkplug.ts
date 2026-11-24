/*
 * ACS Edge Agent
 * Edge Scout end-to-end tests: the agent's Sparkplug traffic
 * Copyright 2026 University of Sheffield
 *
 * Watches what the agent publishes on the real MQTT broker and sends
 * it NCMDs, as cmdesc does for the Admin UI.
 */

import Long from "long";
import * as mqtt from "mqtt";
import * as sparkplug from "sparkplug-payload";

import { AGENT } from "./services";

const SpB = sparkplug.get("spBv1.0")!;

export interface SpMessage {
    kind:       string,
    device?:    string,
    at:         number,
    payload:    any,
}

const num = (v: any) => Long.isLong(v) ? (v as Long).toNumber() : Number(v);

export class SparkplugWatch {
    client!: mqtt.MqttClient
    messages: SpMessage[] = []

    async start (url: string) {
        const c = this.client = mqtt.connect(url, {
            clientId: `scout-e2e-${process.pid}`, reconnectPeriod: 500,
        });
        await new Promise<void>((resolve, reject) => {
            c.once("connect", () => resolve());
            c.once("error", reject);
        });
        c.on("message", (topic, payload) => {
            const at = Date.now();
            const parts = topic.split("/");
            /* spBv1.0/<group>/<kind>/<node>[/<device>] */
            if (parts[1] != AGENT.group || parts[3] != AGENT.node) return;
            let decoded: any;
            try { decoded = SpB.decodePayload(payload); }
            catch { return; }
            this.messages.push({ kind: parts[2], device: parts[4], at, payload: decoded });
        });
        await c.subscribeAsync(`spBv1.0/${AGENT.group}/#`);
        return this;
    }

    async stop () {
        await this.client?.endAsync(true);
    }

    births (): SpMessage[] {
        return this.messages.filter(m => m.kind == "NBIRTH");
    }

    /* Send Node Control/Scout, as cmdesc does: a String metric whose
     * value is the request as JSON. */
    scout (req: any) {
        const payload = SpB.encodePayload({
            timestamp: Date.now(),
            metrics: [{ name: "Node Control/Scout", type: "String",
                value: JSON.stringify(req) }],
        });
        this.client.publish(`spBv1.0/${AGENT.group}/NCMD/${AGENT.node}`,
            Buffer.from(payload));
    }

    /* Each DDATA metric value for a device and metric, with the time
     * it reached the broker and the metric's timestamp. */
    values (device: string, metric: string, since = 0) {
        const out: { at: number, ts: number, value: any }[] = [];
        /* DDATA may name a metric by its DBIRTH alias only. */
        let alias: number | undefined;
        for (const m of this.messages) {
            if (m.device != device) continue;
            if (m.kind == "DBIRTH") {
                const b = (m.payload.metrics ?? []).find((mt: any) => mt.name == metric);
                alias = b?.alias == null ? undefined : num(b.alias);
                continue;
            }
            if (m.kind != "DDATA" || m.at < since) continue;
            for (const mt of m.payload.metrics ?? [])
                if (mt.name == metric || (alias != null && mt.alias != null && num(mt.alias) == alias))
                    out.push({ at: m.at, ts: num(mt.timestamp ?? m.payload.timestamp),
                        value: mt.value == null ? null : num(mt.value) });
        }
        return out;
    }
}

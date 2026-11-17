/*
 * ACS Edge Agent
 * Golden-output harness: capture the agent's Sparkplug output
 * Copyright 2026 University of Sheffield
 */

import { EventEmitter } from "events";

import Long from "long";
import * as sparkplug from "sparkplug-payload";

const SpB = sparkplug.get("spBv1.0")!;

export type Kind = "NBIRTH" | "DBIRTH" | "DDATA" | "DDEATH" | "NDATA";

/* One Sparkplug message as it would have gone on the wire. */
export interface Captured {
    kind:       Kind,
    device?:    string,
    at:         number,
    bytes:      Uint8Array,
}

/* Stands in for the client `fplus.MQTT.basic_sparkplug_node()` gives
 * the agent's SparkplugNode (utilities/lib/sparkplug/basic-node.js).
 * Each publish is encoded with the same Sparkplug B encoder that
 * client uses, and kept instead of being sent. The bdSeq metric the
 * real client adds to NBIRTH is left out: it would be the same in
 * every run. */
export class CaptureClient extends EventEmitter {
    messages:   Captured[] = []
    closed = false
    seq = 0

    connect () {
        setImmediate(() => {
            this.emit("connect");
            this.emit("birth");
        });
    }

    stop () {
        this.closed = true;
    }

    #publish (kind: Kind, device: string | undefined, payload: any) {
        if (this.closed) return;
        payload.seq = this.seq;
        this.seq = this.seq < 255 ? this.seq + 1 : 0;
        this.messages.push({
            kind, device, at: Date.now(),
            bytes: SpB.encodePayload(payload),
        });
    }

    publishNodeBirth (payload: any) {
        this.seq = 0;
        this.#publish("NBIRTH", undefined, payload);
    }
    publishDeviceBirth (device: string, payload: any) {
        this.#publish("DBIRTH", device, payload);
    }
    publishNodeData (payload: any) {
        this.#publish("NDATA", undefined, payload);
    }
    publishDeviceData (device: string, payload: any) {
        this.#publish("DDATA", device, payload);
    }
    publishDeviceDeath (device: string, payload: any) {
        this.#publish("DDEATH", device, payload);
    }
}

export const AGENT_UUID = "00000000-0000-4000-8000-00000000a6e7";
export const CONFIG_ETAG = "\"golden-config\"";

/* The parts of a ServiceClient the Translator uses, with the fixture's
 * connection as the whole agent config. */
export function fake_fplus (config: any, client: CaptureClient) {
    const sparkplug = {
        group:  "Golden",
        node:   "Agent",
        toString () { return "Golden/Agent"; },
    };
    return {
        Auth: {
            find_principal: async () => ({ uuid: AGENT_UUID, sparkplug }),
        },
        ConfigDB: {
            get_config_with_etag: async () => [config, CONFIG_ETAG],
        },
        MQTT: {
            basic_sparkplug_node: async () => client,
        },
    } as any;
}

/* A decoded metric reduced to what the comparison looks at. `value` is
 * a string so that Long, Buffer, NaN and objects compare and print. */
export interface Metric {
    name:       string,
    type:       string,
    value:      string,
    /* Nanoseconds since the epoch, as published. */
    ts_ns:      bigint,
    props?:     string,
}

export function repr (v: any): string {
    if (v === null || v === undefined) return "null";
    if (Long.isLong(v)) return v.toString();
    if (typeof v == "bigint") return v.toString();
    if (v instanceof Uint8Array) return `bytes:${Buffer.from(v).toString("hex")}`;
    if (typeof v == "number") return Object.is(v, -0) ? "-0" : String(v);
    if (typeof v == "string") return JSON.stringify(v);
    if (typeof v == "object") return JSON.stringify(sorted(v), (k, x) =>
        Long.isLong(x) ? x.toString()
        : typeof x == "bigint" ? x.toString()
        : x instanceof Uint8Array ? Buffer.from(x).toString("hex")
        : x);
    return String(v);
}

/* A copy of an object with its keys in order, for a stable string. */
function sorted (v: any): any {
    if (Array.isArray(v)) return v.map(sorted);
    if (v === null || typeof v != "object" || Long.isLong(v)
        || v instanceof Uint8Array)
        return v;
    return Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])]));
}

function ts_ns (ts: any): bigint {
    if (ts == null) return 0n;
    return BigInt(Long.isLong(ts) ? ts.toString() : ts);
}

/* A run's output decoded and grouped for comparison. */
export interface Output {
    /* NBIRTH and each device's DBIRTHs, in the order sent. */
    births:     Map<string, Metric[][]>,
    /* Each metric's DDATA values in order. Key `device/metric`. */
    data:       Map<string, Metric[]>,
    /* Messages of each kind per device: `DDATA device` and so on. */
    counts:     Map<string, number>,
}

/* Decode captured messages. DDATA metrics carry only an alias, so each
 * is named from the latest DBIRTH of its device. */
export function decode (messages: Captured[]): Output {
    const births = new Map<string, Metric[][]>();
    const data = new Map<string, Metric[]>();
    const counts = new Map<string, number>();
    const aliases = new Map<string, Map<string, { name: string, type: string }>>();

    for (const msg of messages) {
        const key = msg.device == undefined ? msg.kind : `${msg.kind} ${msg.device}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);

        const payload: any = SpB.decodePayload(msg.bytes);
        const metrics: any[] = payload.metrics ?? [];
        const dev = msg.device ?? "";

        if (msg.kind == "NBIRTH" || msg.kind == "DBIRTH") {
            const map = new Map();
            const list = metrics.map(m => {
                if (m.alias != undefined)
                    map.set(repr(m.alias), { name: m.name, type: m.type });
                return {
                    name: m.name, type: m.type, value: repr(m.value),
                    ts_ns: ts_ns(m.timestamp),
                    props: m.properties ? repr(m.properties) : undefined,
                };
            });
            aliases.set(dev, map);
            const bkey = msg.kind == "NBIRTH" ? "NBIRTH" : `DBIRTH ${dev}`;
            const all = births.get(bkey) ?? [];
            all.push(list);
            births.set(bkey, all);
        }
        else if (msg.kind == "DDATA") {
            const map = aliases.get(dev);
            for (const m of metrics) {
                const known = m.name
                    ? { name: m.name, type: m.type }
                    : map?.get(repr(m.alias));
                const name = known?.name ?? `(alias ${repr(m.alias)})`;
                const k = `${dev}/${name}`;
                const list = data.get(k) ?? [];
                list.push({
                    name, type: m.type ?? known?.type, value: repr(m.value),
                    ts_ns: ts_ns(m.timestamp),
                    props: m.properties ? repr(m.properties) : undefined,
                });
                data.set(k, list);
            }
        }
    }
    return { births, data, counts };
}

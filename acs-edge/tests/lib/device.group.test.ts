/*
 * ACS Edge Agent
 * A group of driver messages gives every metric exactly the values and
 * timestamps the messages give one at a time, in every payload format
 * Copyright 2026 University of Sheffield
 *
 * A split driver sends one address per message. DriverConnection
 * gathers the messages that arrive together into one data event with a
 * DataGroup, so each device publishes one DDATA for them. Without the
 * group, Device._handleData skips every metric with no path when a
 * message holds more than one address, which would lose the values of
 * exactly the metrics split drivers use most ({"value", "timestamp"}
 * read with no path). These tests feed the same messages both ways
 * and require the same output.
 */

import { reHashConf } from "../../utils/FormatConfig";
import { DataGroup, Device } from "../../lib/device";
import { now_ns } from "../../lib/helpers/typeHandler";

const T0 = 1_763_380_000_000;

/* Addresses as a driver might name them. "7" and "12" are integer-like,
 * so an object holding them lists them first and in numeric order,
 * not in the order they arrived. "" is the UDP address. (Names on
 * Object.prototype, such as "constructor", can't be a metric's address
 * at all: Metrics indexes addresses in plain objects.) */
const ADDRS = ["plant/speed", "12", "", "7", "ns=2;s=Line.Temp"];

interface Format {
    name:       string,
    delimiter?: string,
    /* The path of the metric that has one, per address. */
    path:       string,
    type:       string,
    payload (addr: number, k: number): any,
    /* What a metric with no path gets in this format when its message
     * comes alone: a value, nothing, or an exception. A Buffer metric
     * with no path throws (and today that stops the agent), so the
     * Buffer device has none. */
    whole:      "value" | "none" | "throws",
}

const FORMATS: Format[] = [
    {
        name: "JSON", path: "$.v", type: "Int32", whole: "value",
        /* Address 1 carries a timestamp in the payload, the rest don't. */
        payload: (a, k) => Buffer.from(JSON.stringify(a == 1
            ? { value: k * 10 + a, v: k, timestamp: T0 + 500 + k }
            : { value: k * 10 + a, v: k })),
    },
    {
        name: "JSON (Batched)", path: "$.v", type: "Int32", whole: "value",
        payload: (a, k) => Buffer.from(JSON.stringify([
            { value: k * 10 + a, v: k, timestamp: T0 + 100 * k },
            { value: k * 10 + a + 1, v: k + 50 },
        ])),
    },
    {
        name: "XML", path: "/r/v/text()", type: "Int32", whole: "none",
        payload: (a, k) => Buffer.from(`<r><v>${k * 10 + a}</v></r>`),
    },
    {
        name: "Delimited String", delimiter: ",", path: "1", type: "Int32", whole: "value",
        payload: (a, k) => Buffer.from(`${k * 10 + a},${k}`),
    },
    {
        name: "Buffer", path: "1", type: "UInt8", whole: "throws",
        payload: (a, k) => Buffer.from([k * 10 + a, k, 0, 0]),
    },
];

function make_device (f: Format) {
    const tags = ADDRS.flatMap((addr, i) => [
        ...(f.whole == "throws" ? [] : [
            { Name: `whole_${i}`, type: f.type, method: "GET", address: addr,
                path: "", value: null, recordToDB: true }]),
        { Name: `path_${i}`, type: f.type, method: "GET", address: addr,
            path: f.path, value: null, recordToDB: true },
    ]);
    const conf = reHashConf({
        deviceConnections: [{
            name: "conn", connType: "Driver", payloadFormat: f.name,
            delimiter: f.delimiter,
            devices: [{
                deviceId: "Dev", pubInterval: 0, payloadFormat: f.name,
                delimiter: f.delimiter, templates: [], tags,
            }],
        }],
    });
    const ddata: any[][] = [];
    const dev = new Device({} as any, {} as any, {
        deviceId: "Dev", pollInt: 1e9, pubInterval: 0, templates: [],
        metrics: conf.deviceConnections[0].devices[0].metrics,
        payloadFormat: f.name, delimiter: f.delimiter,
    } as any);
    (dev as any)._publishDData = (ms: any[]) =>
        ddata.push(ms.map(m => ({
            name: m.name, value: m.value,
            timestamp: m.timestamp, timestampNs: m.timestampNs,
        })));
    return { dev, ddata };
}

/* Each metric's values in the order published. */
function per_metric (ddata: any[][]) {
    const out: { [name: string]: any[] } = {};
    for (const msg of ddata)
        for (const m of msg)
            (out[m.name] ??= []).push([m.value, m.timestamp, m.timestampNs]);
    return out;
}

const ROUNDS = 4;

/* Every address gets one message per round, 3 ms apart. */
function messages (f: Format) {
    const out: { t: number, addr: string, payload: any }[] = [];
    let t = T0;
    for (let k = 1; k <= ROUNDS; k++)
        ADDRS.forEach((addr, a) => {
            out.push({ t, addr, payload: f.payload(a, k) });
            t += 3;
        });
    return out;
}

beforeEach(() => jest.useFakeTimers("modern"));
afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
});

describe.each(FORMATS)("A group of driver messages in %s", f => {
    it("gives every metric the values and timestamps of one message at a time", () => {
        const msgs = messages(f);

        /* As before: each message handled on arrival. */
        const one = make_device(f);
        for (const m of msgs) {
            jest.setSystemTime(m.t);
            one.dev._handleData({ [m.addr]: m.payload }, true);
        }

        /* Grouped: each round's messages handled together after the
         * last of them arrived, with when each one arrived. */
        const grouped = make_device(f);
        for (let k = 0; k < ROUNDS; k++) {
            const round = msgs.slice(k * ADDRS.length, (k + 1) * ADDRS.length);
            const obj: { [addr: string]: any } = Object.create(null);
            const group: DataGroup = { received: Object.create(null) };
            for (const m of round) {
                jest.setSystemTime(m.t);
                obj[m.addr] = m.payload;
                group.received[m.addr] = { ms: Date.now(), ns: now_ns() };
            }
            jest.setSystemTime(round[round.length - 1].t + 2);
            grouped.dev._handleData(obj, true, group);
        }

        expect(per_metric(grouped.ddata)).toEqual(per_metric(one.ddata));
        /* One DDATA per round, not one per message. */
        expect(grouped.ddata).toHaveLength(ROUNDS);
        expect(one.ddata.length).toBe(msgs.length);

        /* The test is not vacuous: metrics with no path got values
         * wherever the format gives them one. */
        const values = per_metric(grouped.ddata);
        for (let i = 0; i < ADDRS.length; i++) {
            expect(values[`path_${i}`]?.length).toBeGreaterThan(0);
            if (f.whole == "value")
                expect(values[`whole_${i}`]?.length).toBeGreaterThan(0);
            else
                expect(values[`whole_${i}`]).toBeUndefined();
        }
    });

    it("still skips metrics with no path in a message of several addresses that is not a group", () => {
        /* A built-in connection's message with several addresses is
         * read as it always was. */
        const { dev, ddata } = make_device(f);
        const obj: { [addr: string]: any } = Object.create(null);
        ADDRS.forEach((addr, a) => obj[addr] = f.payload(a, 1));
        jest.setSystemTime(T0);
        dev._handleData(obj, true);
        const names = new Set(ddata.flat().map(m => m.name));
        expect([...names].filter(n => n.startsWith("whole_"))).toEqual([]);
        expect([...names].filter(n => n.startsWith("path_")).length).toBe(ADDRS.length);
    });
});

describe("A group's timestamps", () => {
    it("stamp a value without one with when its message arrived, not when the group was handled", () => {
        const f = FORMATS[0];
        const { dev, ddata } = make_device(f);
        jest.setSystemTime(T0);
        const at = { ms: Date.now(), ns: now_ns() };
        jest.setSystemTime(T0 + 40);
        dev._handleData({ "plant/speed": f.payload(0, 1) }, true,
            { received: { "plant/speed": at } });
        const whole = ddata[0].find(m => m.name == "whole_0");
        expect(whole.timestamp).toBe(T0);
        expect(whole.timestampNs).toBe(at.ns);
    });

    it("keep a timestamp the payload carries", () => {
        const f = FORMATS[0];
        const { dev, ddata } = make_device(f);
        jest.setSystemTime(T0 + 40);
        dev._handleData({ "12": f.payload(1, 1) }, true,
            { received: { "12": { ms: T0, ns: BigInt(T0) * 1_000_000n } } });
        const whole = ddata[0].find(m => m.name == "whole_1");
        expect(whole.timestamp).toBe(T0 + 501);
    });
});

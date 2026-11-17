/*
 * ACS Edge Agent
 * Golden tests: the exact metrics Device._handleData publishes for each
 * payload format, so a change to the read path cannot change the output
 * Copyright 2026 University of Sheffield
 *
 * Each case loads tag configs the way the agent does (reHashConf), feeds
 * a sequence of messages to a real Device and records every metric it
 * publishes: name, type, value (with its JS type), timestamp,
 * timestampNs, isNull and the simulated-data properties. A message that
 * throws records the error instead. The snapshot file next to this one
 * is the output of the read path as it was before ACS-13, apart from
 * the one intended change named in the "JSON (Batched) Boolean" case.
 */

import path from "path";
import Long from "long";
import { reHashConf } from "../../utils/FormatConfig";
import { Device } from "../../lib/device";
import { serialisationType } from "../../lib/helpers/typeHandler";
import { event_address, event_payload, read_fixture } from "../fixtures/drivers/fixture";

/* jest.config.ts runs the tests in UTC, because a DateTime read from a
 * date string with no zone is parsed in local time. */
/* Every timestamp the agent makes up itself comes from Date.now(), which
 * the fake timers pin to this. */
const NOW = 1_763_380_800_000;
const SAMPLES = path.join(__dirname, "../fixtures/drivers/samples");

/* timestampNs values a payload may carry. Any other bigint timestampNs
 * was made by the agent from the clock and is recorded as "<now_ns>". */
const PAYLOAD_NS = new Set([
    "1763380800123456789", "1763380801987654321", "1763380802000000001",
]);

type Msg = { [addr: string]: any };
type Step = Msg | { obj: Msg, parseVals: boolean };

interface Case {
    format: string,
    delimiter?: string,
    tags: any[],
    steps: Step[],
}

beforeAll(() => {
    jest.useFakeTimers("modern");
    jest.setSystemTime(NOW);
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterAll(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
});

/* A value as the snapshot shows it, with its JS type, so 1 and "1"
 * and 1n never look alike. */
function show (v: any): any {
    if (v === undefined) return "<undefined>";
    if (v === null) return null;
    if (Long.isLong(v)) return { Long: v.toString(), unsigned: v.unsigned };
    if (Buffer.isBuffer(v)) return { Buffer: v.toString("hex") };
    if (v instanceof Date) return { Date: v.toISOString() };
    switch (typeof v) {
        case "bigint":  return { bigint: v.toString() };
        case "number":
            if (Object.is(v, -0)) return { number: "-0" };
            if (!Number.isFinite(v)) return { number: String(v) };
            return v;
        case "object":
            if (Array.isArray(v)) return { array: v.map(show) };
            return { object: Object.fromEntries(
                Object.entries(v).map(([k, x]) => [k, show(x)])) };
        default:        return v;
    }
}

function show_ns (ns: any) {
    if (typeof ns != "bigint") return show(ns);
    return PAYLOAD_NS.has(ns.toString()) ? ns.toString() : "<now_ns>";
}

function record (m: any) {
    const r: any = {
        name:       m.name,
        type:       m.type,
        value:      show(m.value),
        timestamp:  m.timestamp === NOW ? "<now>" : show(m.timestamp),
        timestampNs: show_ns(m.timestampNs),
        isNull:     m.isNull,
    };
    if (m.properties?.simulated) r.simulated = show(m.properties.simulated.value);
    if (m.properties?.run_id) r.run_id = show(m.properties.run_id.value);
    return r;
}

/* Tag config as it appears in the ConfigDB, through the agent's loader. */
function load (format: string, delimiter: string | undefined, tags: any[]) {
    const conf = reHashConf({
        deviceConnections: [{
            name: "golden",
            connType: "MQTT",
            payloadFormat: format,
            ...(delimiter !== undefined ? { delimiter } : {}),
            devices: [{
                deviceId: "Golden",
                pubInterval: 0,
                payloadFormat: format,
                templates: [],
                tags: tags.map(t => ({ method: "GET", value: null,
                    recordToDB: true, ...t })),
            }],
        }],
    });
    const conn = conf.deviceConnections[0];
    return conn.devices.map((d: any) => ({
        id: d.deviceId,
        metrics: d.metrics,
        addrs: new Set(d.metrics.map((m: any) => m.properties?.address?.value)),
        format: conn.payloadFormat,
        delimiter: conn.delimiter ?? "",
    }));
}

function make_device (d: any) {
    const published: any[][] = [];
    const dev = new Device({} as any, {} as any, {
        deviceId: d.id,
        pollInt: 1e9,
        pubInterval: 0,
        templates: [],
        metrics: d.metrics,
        payloadFormat: d.format,
        delimiter: d.delimiter,
    } as any);
    (dev as any)._publishDData = (ms: any[]) => published.push(ms.map(record));
    return { dev, published };
}

/* Run the steps and return what each one published, or what it threw. */
function run (c: Case) {
    const [d] = load(c.format, c.delimiter, c.tags);
    const { dev, published } = make_device(d);
    return c.steps.map(step => {
        const { obj, parseVals } = "parseVals" in step
            ? step as { obj: Msg, parseVals: boolean }
            : { obj: step as Msg, parseVals: true };
        published.length = 0;
        try {
            dev._handleData(obj, parseVals);
        }
        catch (e: any) {
            return { threw: `${e?.constructor?.name}: ${e?.message}` };
        }
        return published.flat();
    });
}

/* Replay a fixture's events through every device that owns the
 * address, as Translator does. */
function run_fixture (name: string) {
    const fx = read_fixture(path.join(SAMPLES, name));
    const conf = reHashConf({ deviceConnections: [JSON.parse(JSON.stringify(fx.connection))] });
    const conn = conf.deviceConnections[0];
    const devs = conn.devices.map((d: any) => {
        const { dev, published } = make_device({
            id: d.deviceId, metrics: d.metrics,
            format: conn.payloadFormat, delimiter: conn.delimiter ?? "",
        });
        const addrs = new Set(d.metrics.map((m: any) => m.properties?.address?.value));
        return { id: d.deviceId, dev, published, addrs };
    });
    const out: any[] = [];
    for (const ev of fx.events) {
        if (ev.type == "opcua") continue;
        const addr = event_address(ev);
        for (const d of devs) {
            if (!d.addrs.has(addr)) continue;
            d.published.length = 0;
            let res: any;
            try {
                d.dev._handleData({ [addr]: event_payload(ev) }, true);
                res = d.published.flat();
            }
            catch (e: any) {
                res = { threw: `${e?.constructor?.name}: ${e?.message}` };
            }
            out.push({ t: ev.t, device: d.id, addr, published: res });
        }
    }
    return out;
}

const j = (v: any) => Buffer.from(JSON.stringify(v));
const b = (s: string) => Buffer.from(s);

/* Types a JSON metric can have, each read from the same kind of
 * value, so a change to type handling shows up. */
const JSON_TYPES = [
    "Boolean", "Int8", "Int16", "Int32", "Int64", "UInt8", "UInt16",
    "UInt32", "UInt64", "Float", "Double", "DateTime", "String", "Text",
    "UUID", "Bytes",
];

/* The JSON values each type is fed in turn. */
const JSON_VALUES: any[] = [
    1, 0, -1, 2.5, -0, 300, 70000, 5e9, "12", "12.75", "-3", "0", "", "abc",
    "true", "false", "TRUE", true, false, null, [1, 2], { value: 4 },
    { type: "Buffer", data: [1, 2, 255] }, "2026-11-17T12:00:00Z",
    "9007199254740993", 1e21, "1e3", " 7 ",
];

/* A device that mixes the two kinds of MQTT topic: object payloads
 * read with filter paths, and arrays of {value, timestamp} read with
 * $.value. */
const MIXED_TAGS = [
    { Name: "load", type: "Double", address: "dataset",
        path: "$.set.datapoints[?(@.name=='ActLoad')].value" },
    { Name: "prog", type: "String", address: "dataset",
        path: "$.set.datapoints[?(@.name=='Program')].value" },
    { Name: "on", type: "Boolean", address: "dataset",
        path: "$.set.datapoints[?(@.name=='Running')].value" },
    { Name: "hf", type: "Double", address: "hf", path: "$.value" },
];

const dataset = (load: any, prog: any, on: any, extra = {}) => j({
    set: { datapoints: [
        { name: "ActLoad", value: load },
        { name: "Program", value: prog },
        { name: "Running", value: on },
    ] }, ...extra });

const MIXED_STEPS: Step[] = [
    { dataset: dataset(1.5, "P1", true) },
    { hf: j([{ value: 10, timestamp: 1763380000000 },
        { value: 11, timestamp: 1763380000010 },
        { value: 11, timestamp: 1763380000020 },
        { value: "12.5", timestamp: 1763380000030 }]) },
    { dataset: dataset(1.5, "P1", true) },
    { dataset: dataset(2.5, "P2", false, { timestamp: 1763380001000 }) },
    { dataset: dataset(3.5, "P3", true, { timestampNs: "1763380800123456789",
        simulated: true, run_id: "r1" }) },
    { hf: j([{ value: 13, timestamp: 1763380000040 }]) },
    { hf: j({ value: 14, timestamp: 1763380002000 }) },
    { dataset: JSON.stringify({ set: { datapoints: [
        { name: "ActLoad", value: 4.5 }] } }) },
    { dataset: { set: { datapoints: [{ name: "ActLoad", value: 5.5 }] } } },
    { dataset: b("{bad json") },
    { dataset: j(0) },
    { dataset: j("text") },
    /* Both topics in one call */
    { dataset: dataset(6.5, "P6", false),
        hf: j([{ value: 15, timestamp: 1763380000050 }]) },
];

/* Date strings a DateTime metric may be sent. The first five have no
 * zone. */
const ZONELESS_DATES = [
    " 7 ", "12", "2026-07-01T12:00:00", "2026-01-15T12:00:00",
    "July 1, 2026 12:00",
];
const ZONED_DATES = [
    "2026-07-01T12:00:00Z", "2026-07-01T12:00:00+02:00", "2026-07-01",
    "Wed, 01 Jul 2026 12:00:00 GMT",
];
const DATE_STRINGS = [...ZONELESS_DATES, ...ZONED_DATES];

const CASES: { [name: string]: Case } = {
    "JSON: every type through a nested path": {
        format: "JSON",
        tags: JSON_TYPES.map(type => ({ Name: `T_${type}`, type,
            address: "a", path: `$.m.${type}` })),
        steps: JSON_VALUES.map(v => ({ a: j({ m: Object.fromEntries(
            JSON_TYPES.map(t => [t, v])) }) })),
    },
    /* A DateTime read from a string with no zone depends on the agent's
     * time zone (Date.parse reads it as local time). This records it in
     * UTC; the "zoneless" test checks the dependence. */
    "JSON: DateTime from strings with and without a zone": {
        format: "JSON",
        tags: [{ Name: "dt", type: "DateTime", address: "a", path: "$.d" }],
        steps: DATE_STRINGS.map(d => ({ a: j({ d }) })),
    },
    "JSON: the same types with BE and LE suffixes": {
        format: "JSON",
        tags: ["Int16BE", "UInt32LE", "FloatBE", "DoubleLE", "Int64LE",
            "UInt64BE"].map(type => ({ Name: `E_${type}`, type,
            address: "a", path: `$.${type}` })),
        steps: [5, "6", 7.25, "1e3", 0, "x"].map(v => ({
            a: j({ Int16BE: v, UInt32LE: v, FloatBE: v, DoubleLE: v,
                Int64LE: v, UInt64BE: v }) })),
    },
    "JSON: path shapes": {
        format: "JSON",
        tags: [
            { Name: "nested", type: "Double", path: "$.a.b.c" },
            { Name: "index", type: "Double", path: "$.arr[1]" },
            { Name: "last", type: "Double", path: "$.arr[-1:]" },
            { Name: "wild", type: "Double", path: "$.arr[*]" },
            { Name: "filter", type: "Double",
                path: "$.set.datapoints[?(@.name=='ActLoad')].value" },
            { Name: "filter_num", type: "String",
                path: "$.list[?(@.id==2)].label" },
            { Name: "filter_gt", type: "Int32", path: "$.list[?(@.id>1)].id" },
            { Name: "deep", type: "Int32", path: "$..deep" },
            { Name: "bracket", type: "String", path: "$['with space']['x.y']" },
            { Name: "root", type: "String", path: "$" },
            { Name: "dollar_dot", type: "Int32", path: "$.*" },
            { Name: "missing", type: "Double", path: "$.nope.nothing" },
            { Name: "length", type: "Int32", path: "$.str.length" },
            { Name: "obj_double", type: "Double", path: "$.a.b" },
            { Name: "obj_string", type: "String", path: "$.a.b" },
            { Name: "arr_string", type: "String", path: "$.arr" },
            { Name: "no_dollar", type: "Double", path: "a.b.c" },
            { Name: "buffer", type: "Bytes", path: "$.buf" },
        ].map(t => ({ ...t, address: "a" })),
        steps: [
            { a: j({ a: { b: { c: 1.5 } }, arr: [10, 20, 30],
                set: { datapoints: [{ name: "ActPower", value: 3 },
                    { name: "ActLoad", value: 4.25 }] },
                list: [{ id: 1, label: "one" }, { id: 2, label: "two" },
                    { id: 3, label: "three" }],
                x: { y: { deep: 9 } }, "with space": { "x.y": "spaced" },
                str: "hello", buf: { type: "Buffer", data: [0, 1, 2] } }) },
            /* Same again: nothing changed, nothing published */
            { a: j({ a: { b: { c: 1.5 } }, arr: [10, 20, 30],
                set: { datapoints: [{ name: "ActPower", value: 3 },
                    { name: "ActLoad", value: 4.25 }] },
                list: [{ id: 1, label: "one" }, { id: 2, label: "two" },
                    { id: 3, label: "three" }],
                x: { y: { deep: 9 } }, "with space": { "x.y": "spaced" },
                str: "hello", buf: { type: "Buffer", data: [0, 1, 2] } }) },
            /* Values change and some go missing */
            { a: j({ a: { b: { c: "2.5" } }, arr: [11],
                set: { datapoints: [{ name: "ActLoad", value: null }] },
                list: [], deep: 1, x: { deep: 2 } }) },
            { a: j({}) },
            { a: j([]) },
            { a: j([{ a: { b: { c: 3 } } }]) },
            { a: j(0) },
            { a: j(false) },
            { a: j(true) },
            { a: j(5) },
            { a: j("text") },
            { a: b("") },
            { a: b("{not json") },
            { a: b("   ") },
            { a: j({ a: { b: { c: 7 } } }) },
        ],
    },
    /* Path shapes whose handling the jsonpath-plus changelog says
     * changed between 5.x and 11.x, so an upgrade shows up here. */
    "JSON: path shapes jsonpath-plus has changed": {
        format: "JSON",
        tags: [
            { Name: "slice_zero_end", type: "Int32", path: "$.arr[0:0]" },
            { Name: "slice_step", type: "Int32", path: "$.arr[0:4:2]" },
            { Name: "slice_neg", type: "Int32", path: "$.arr[-2:]" },
            { Name: "union_index", type: "Int32", path: "$.arr[2,0]" },
            { Name: "union_quoted", type: "String", path: "$['x','y']" },
            { Name: "comma_key", type: "String", path: "$['a,b']" },
            { Name: "dot_key", type: "String", path: "$['c.d']" },
            { Name: "at_in_literal", type: "Double",
                path: "$.pts[?(@.name=='a@ b')].v" },
            { Name: "bare_at", type: "Int32", path: "$.arr[?(@>2)]" },
            { Name: "not_equal", type: "Double",
                path: "$.pts[?(@.name!='p1')].v" },
            { Name: "strict_eq", type: "Double",
                path: "$.pts[?(@.name==='p1')].v" },
            { Name: "loose_num", type: "Double",
                path: "$.pts[?(@.id=='2')].v" },
            { Name: "and_or", type: "Double",
                path: "$.pts[?(@.id>1 && @.v<100 || @.name=='p1')].v" },
            { Name: "method", type: "Double",
                path: "$.pts[?(@.name.startsWith('p2'))].v" },
            { Name: "regex", type: "Double",
                path: "$.pts[?(@.name.match(/^p3/))].v" },
            { Name: "property", type: "String",
                path: "$.obj[?(@property=='k2')]" },
            { Name: "parent", type: "Double",
                path: "$.pts[?(@parent.length==3)].v" },
            { Name: "nested_filter", type: "String",
                path: "$.groups[?(@.items[?(@.on==true)])].name" },
            { Name: "typeof", type: "Double",
                path: "$.pts[?(typeof @.v === 'string')].v" },
            { Name: "in_array", type: "Double",
                path: "$.pts[?(['p1','p3'].includes(@.name))].v" },
            { Name: "root_ref", type: "Double",
                path: "$.pts[?(@.id==@root.pick)].v" },
            { Name: "bad_script", type: "Double",
                path: "$.pts[?(@.name==)].v" },
            { Name: "type_selector", type: "Double", path: "$.pts[*].v@number()" },
            { Name: "keys", type: "String", path: "$.obj.*~" },
        ].map(t => ({ ...t, address: t.Name })),
        /* One address per path, so a path that throws only loses its
         * own message. */
        steps: [] as Step[],
    },
    "JSON: payload already parsed or a string, as REST hands it": {
        format: "JSON",
        tags: [
            { Name: "v", type: "Double", address: "a", path: "$.v" },
            { Name: "s", type: "String", address: "a", path: "$.s" },
        ],
        steps: [
            { a: { v: 1, s: "x" } },
            { a: JSON.stringify({ v: 2, s: "y" }) },
            { a: { v: "3", s: 4 } },
            { a: "not json" },
            { a: [] },
            { a: 0 },
        ],
    },
    "JSON: no path reads the value property of a lone address": {
        format: "JSON",
        tags: [
            { Name: "d", type: "Double", address: "a" },
            { Name: "s", type: "String", address: "b" },
            { Name: "i", type: "Int32", address: "c", path: "" },
        ],
        steps: [
            { a: j({ value: 1.25 }) },
            { a: j({ value: 1.25 }) },
            { a: j({ value: "2.5", timestamp: 1763380000 }) },
            { a: j({ notvalue: 3 }) },
            { a: j({ value: null }) },
            { a: j({ value: 0 }) },
            { a: j(4) },
            { a: b("bad") },
            { b: j({ value: "hi" }) },
            { b: j({ value: { nested: 1 } }) },
            { c: j({ value: "77" }) },
            /* Two addresses at once: no-path metrics are skipped */
            { a: j({ value: 9 }), b: j({ value: "both" }) },
        ],
    },
    "JSON: timestamps, ns timestamps and simulated markers": {
        format: "JSON",
        tags: [
            { Name: "v", type: "Double", address: "a", path: "$.v" },
            { Name: "w", type: "Int32", address: "a", path: "$.w" },
            { Name: "nv", type: "Double", address: "n" },
        ],
        steps: [
            { a: j({ v: 1, w: 1, timestamp: 1763380000123 }) },
            { a: j({ v: 2, w: 2, timestamp: 1763380000 }) },
            { a: j({ v: 3, w: 3, timestamp: 1763380000.5 }) },
            { a: j({ v: 4, w: 4, timestamp: "1763380000123" }) },
            { a: j({ v: 5, w: 5, timestamp: "1763380000" }) },
            { a: j({ v: 6, w: 6, timestamp: 0 }) },
            { a: j({ v: 7, w: 7, timestamp: 12345 }) },
            { a: j({ v: 8, w: 8, timestamp: null, time: 1763380001 }) },
            { a: j({ v: 9, w: 9, time: 1763380001000 }) },
            { a: j({ v: 10, w: 10, time: 1763380001 }) },
            { a: j({ v: 11, w: 11, time: "soon" }) },
            { a: j({ v: 12, w: 12, timestamp: "never" }) },
            { a: j({ v: 13, w: 13, timestampNs: "1763380800123456789" }) },
            { a: j({ v: 14, w: 14, timestamp: 1763380000123,
                timestampNs: "1763380801987654321" }) },
            { a: j({ v: 15, w: 15, timestampNs: 1763380802000000001 }) },
            { a: j({ v: 16, w: 16, timestampNs: "not a number" }) },
            { a: j({ v: 17, w: 17, timestampNs: null }) },
            { a: j({ v: 18, w: 18, simulated: true,
                run_id: "00000000-0000-4000-8000-0000000000aa" }) },
            { a: j({ v: 19, w: 19, simulated: true }) },
            { a: j({ v: 20, w: 20, simulated: "true", run_id: "r" }) },
            { a: j({ v: 21, w: 21, simulated: false, run_id: "r" }) },
            { a: j({ v: 22, w: 22, simulated: true, run_id: 5 }) },
            /* Only w changes */
            { a: j({ v: 22, w: 23, timestamp: 1763380000999,
                simulated: true }) },
            { n: j({ value: 1, timestamp: 1763380002000,
                timestampNs: "1763380802000000001", simulated: true,
                run_id: "n" }) },
            { n: j({ value: 2, timestamp: { a: 1 } }) },
            /* JSON null: the timestamp lookup throws today */
            { a: j(null) },
            { a: j({ v: 30, w: 30 }) },
        ],
    },
    "JSON: misconfigured String metric receives an object": {
        format: "JSON",
        tags: [
            { Name: "s", type: "String", address: "a", path: "$.o" },
            { Name: "t", type: "Text", address: "a", path: "$.o" },
            { Name: "d", type: "Double", address: "a", path: "$.o" },
        ],
        steps: [
            { a: j({ o: { x: 1 } }) },
            { a: j({ o: [1, 2] }) },
            { a: j({ o: "fine" }) },
            { a: j({ o: { type: "Buffer", data: [1] } }) },
        ],
    },
    "JSON: parseVals false passes values through": {
        format: "JSON",
        tags: [
            { Name: "x", type: "Double", address: "x" },
            { Name: "y", type: "String", address: "y", path: "$.v" },
            { Name: "z", type: "Boolean", address: "z" },
        ],
        steps: [
            { obj: { x: 5, y: "s", z: true }, parseVals: false },
            { obj: { x: 5, y: "s", z: true }, parseVals: false },
            { obj: { x: 0, y: "", z: false }, parseVals: false },
            { obj: { x: null, y: undefined, z: 0 }, parseVals: false },
            { obj: { x: 10n, y: Buffer.from("ab"), z: "no" }, parseVals: false },
            { obj: { unknown: 3 }, parseVals: false },
        ],
    },
    "JSON: write-only metrics are not read": {
        format: "JSON",
        tags: [
            { Name: "r", type: "Double", address: "a", path: "$.v" },
            { Name: "w", type: "Double", address: "a", path: "$.w", method: "SET" },
            { Name: "rw", type: "Double", address: "a", path: "$.rw", method: "GET/SET" },
        ],
        steps: [{ a: j({ v: 1, w: 2, rw: 3 }) }],
    },
    "JSON (Batched)": {
        format: "JSON (Batched)",
        tags: [
            { Name: "d", type: "Double", address: "a", path: "$.d" },
            { Name: "i", type: "Int32", address: "a", path: "$.m.i" },
            { Name: "s", type: "String", address: "a", path: "$.s" },
            { Name: "u", type: "UInt64", address: "a", path: "$.u" },
            { Name: "f", type: "Double", address: "a",
                path: "$.pts[?(@.n=='f')].v" },
            { Name: "nv", type: "Double", address: "nv" },
        ],
        steps: [
            { a: j([
                { d: 1.5, m: { i: 1 }, s: "a", u: "18446744073709551615",
                    pts: [{ n: "f", v: 1 }], timestamp: 1763380000000 },
                { d: 1.5, m: { i: 2 }, s: "b", u: 5,
                    pts: [{ n: "f", v: 2 }], timestamp: 1763380001 },
                { d: 2.5, m: { i: "3" }, s: 0, u: 0,
                    timestampNs: "1763380800123456789" },
                { d: 0, m: {}, s: "", time: 1763380002000 },
                { d: null, s: null, u: null },
            ]) },
            /* Repeat of the last row: unchanged */
            { a: j([{ d: 0 }]) },
            { a: JSON.stringify([{ d: 3, s: "str" }]) },
            { a: [{ d: 4, s: "parsed" }] },
            { a: j({ d: 5 }) },
            { a: j([1, null, "x", { d: 6 }]) },
            { a: b("[not json") },
            { a: b("") },
            { a: j([{ d: 7, timestampNs: "nope" }]) },
            { nv: j([{ value: 1 }, { value: "2" }, { other: 3 },
                { value: 4, timestamp: 1763380003 }]) },
            { a: j([]) },
        ],
    },
    /* Intended change (ACS-13, for ACS-35): under JSON (Batched), a
     * payload that is not an array is read as plain JSON, so one device
     * can take both kinds of topic. Before, it published nothing. */
    "JSON (Batched): object and array topics on one device": {
        format: "JSON (Batched)",
        tags: MIXED_TAGS,
        steps: [] as Step[],
    },
    "JSON (Batched) Boolean": {
        /* Intended change (ACS-13): before, a Boolean metric was never
         * published from JSON (Batched), because false was dropped as
         * "no value" and every later true matched the last value. */
        format: "JSON (Batched)",
        tags: [
            { Name: "b", type: "Boolean", address: "a", path: "$.b" },
            { Name: "nb", type: "Boolean", address: "nb" },
        ],
        steps: [
            { a: j([{ b: false }, { b: true }, { b: true }, { b: false }]) },
            { a: j([{ b: false }]) },
            { a: j([{ b: "true" }, { b: "false" }, { b: 0 }, { b: 1 }]) },
            { a: j([{ b: null }, { b: true }]) },
            { nb: j([{ value: false }, { value: true }]) },
        ],
    },
    "XML": {
        format: "XML",
        tags: [
            { Name: "text", type: "Double", path: "/r/a/text()" },
            { Name: "attr", type: "String", path: "/r/a/@unit" },
            { Name: "attr_num", type: "Int32", path: "string(/r/a/@n)" },
            { Name: "count", type: "Int32", path: "count(/r/item)" },
            { Name: "sum", type: "Double", path: "sum(/r/item)" },
            { Name: "bool", type: "Boolean", path: "/r/a > 1" },
            { Name: "multi", type: "String", path: "/r/item/text()" },
            { Name: "node", type: "String", path: "/r/a" },
            { Name: "desc", type: "Double", path: "//*[@id='x']/text()" },
            { Name: "contains", type: "String",
                path: "/r/v[n[contains(text(),'$SER')]]/val/text()" },
            { Name: "missing", type: "Double", path: "/r/none/text()" },
            { Name: "date", type: "DateTime", path: "/r/when/text()" },
            { Name: "u64", type: "UInt64", path: "/r/big/text()" },
            { Name: "boolstr", type: "Boolean", path: "/r/flag/text()" },
            { Name: "nopath", type: "Double" },
        ].map(t => ({ ...t, address: "/x" })),
        steps: [
            { "/x": b(`<?xml version="1.0"?><r><a unit="mm" n="4">2.5</a>`
                + `<item>1</item><item>2</item><item>3</item>`
                + `<g><q id="x">8.75</q></g>`
                + `<v><n>$SERIAL</n><val>ABC</val></v>`
                + `<when>2026-11-17T12:00:00Z</when><big>18446744073709551615</big>`
                + `<flag>true</flag></r>`) },
            { "/x": b(`<?xml version="1.0"?><r><a unit="mm" n="4">2.5</a>`
                + `<item>1</item><item>2</item><item>3</item>`
                + `<g><q id="x">8.75</q></g>`
                + `<v><n>$SERIAL</n><val>ABC</val></v>`
                + `<when>2026-11-17T12:00:00Z</when><big>18446744073709551615</big>`
                + `<flag>true</flag></r>`) },
            { "/x": `<r><a unit="in">0.5</a><item>x</item><flag>false</flag>`
                + `<when>1763380000000</when><big>7</big></r>` },
            { "/x": b(`<r><a>0</a></r>`) },
            { "/x": b(`<r>`) },
            { "/x": b(`not xml at all`) },
            { "/x": b(``) },
            { "/x": b(`<r><a>3</a><a>4</a></r>`) },
        ],
    },
    "Delimited String": {
        format: "Delimited String",
        delimiter: ",",
        tags: [
            { Name: "f0", type: "Double", address: "a", path: "0" },
            { Name: "f1", type: "Int32", address: "a", path: "1" },
            { Name: "f2", type: "Boolean", address: "a", path: "2" },
            { Name: "f3", type: "String", address: "a", path: "3" },
            { Name: "f9", type: "Double", address: "a", path: "9" },
            { Name: "u64", type: "UInt64", address: "a", path: "4" },
            { Name: "whole", type: "String", address: "w" },
        ],
        steps: [
            { a: b("1.5,2,true,hello,18446744073709551615") },
            { a: b("1.5,2,true,hello,18446744073709551615") },
            { a: b("0,-3,false,,1") },
            { a: b("x,y,z") },
            { a: b("") },
            { a: "7,8,1,str,9" },
            { w: b("a,b,c") },
        ],
    },
    "Delimited String with no delimiter": {
        format: "Delimited String",
        tags: [
            { Name: "d", type: "Double", address: "a" },
            { Name: "b", type: "Boolean", address: "b" },
            { Name: "s", type: "String", address: "s" },
            { Name: "p", type: "String", address: "p", path: "0" },
        ],
        steps: [
            { a: b("12.5") },
            { a: b("12.5") },
            { a: b("0") },
            { a: b("nan") },
            { b: b("true") },
            { b: b("false") },
            { s: b("hello, world") },
            { p: b("hello") },
        ],
    },
    "Buffer": {
        format: "Buffer",
        tags: [
            { Name: "f", type: "FloatBE", address: "a", path: "0" },
            { Name: "fl", type: "FloatLE", address: "a", path: "0:" },
            { Name: "i32", type: "Int32BE", address: "a", path: "4" },
            { Name: "u16", type: "UInt16LE", address: "a", path: "8" },
            { Name: "i16", type: "Int16BE", address: "a", path: "10" },
            { Name: "u8", type: "UInt8", address: "a", path: "12" },
            { Name: "i8", type: "Int8", address: "a", path: "13" },
            { Name: "bit0", type: "Boolean", address: "a", path: "12:0" },
            { Name: "bit3", type: "Boolean", address: "a", path: "12:3" },
            { Name: "d", type: "DoubleBE", address: "a", path: "16" },
            { Name: "u64", type: "UInt64BE", address: "a", path: "24" },
            { Name: "i64", type: "Int64LE", address: "a", path: "24:" },
            { Name: "u32", type: "UInt32LE", address: "a", path: "4:" },
        ],
        steps: [
            { a: Buffer.from("40490fdbfffffffe0102fffe09f700000000000000004009"
                + "21fb54442d18ffffffffffffffff", "hex") },
            { a: Buffer.from("40490fdbfffffffe0102fffe09f700000000000000004009"
                + "21fb54442d18ffffffffffffffff", "hex") },
            { a: Buffer.from("00000000000000000000000000000000000000000000000000"
                + "00000000000000", "hex") },
            { a: Buffer.from("3f800000", "hex") },
        ],
    },
};

/* The payload for "JSON: path shapes jsonpath-plus has changed". */
const CHANGED_SHAPES = j({
        arr: [1, 2, 3, 4, 5],
        x: "ex", y: "why", "a,b": "comma", "c.d": "dotted",
        pts: [
            { name: "p1", id: 1, v: 1.5 },
            { name: "p2", id: 2, v: 250 },
            { name: "p3", id: 3, v: "3.5" },
            { name: "a@ b", id: 4, v: 4.5 },
        ],
        obj: { k1: "v1", k2: "v2" },
        groups: [{ name: "g1", items: [{ on: false }] },
            { name: "g2", items: [{ on: true }] }],
        pick: 3,
});
{
    const c = CASES["JSON: path shapes jsonpath-plus has changed"];
    c.steps = c.tags.map(t => ({ [t.Name]: CHANGED_SHAPES }));
}

{
    const c = CASES["JSON (Batched): object and array topics on one device"];
    c.steps = MIXED_STEPS;
}

describe("Device._handleData golden output", () => {
    for (const [name, c] of Object.entries(CASES)) {
        test(name, () => {
            expect(run(c)).toMatchSnapshot();
        });
    }

    /* Under JSON (Batched), an object payload gives exactly what plain
     * JSON gives. Invalid JSON is the one difference: JSON (Batched)
     * skips it, and plain JSON reads every path as 0. */
    test("JSON (Batched) reads an object payload exactly as JSON does", () => {
        const steps = MIXED_STEPS
            .filter(st => Object.keys(st).length == 1 && "dataset" in st)
            .filter(st => !(Buffer.isBuffer((st as Msg).dataset)
                && (st as Msg).dataset.toString() == "{bad json"));
        expect(steps.length).toBeGreaterThan(5);
        const tags = MIXED_TAGS.filter(t => t.address == "dataset");
        const batched = run({ format: "JSON (Batched)", tags, steps });
        const plain = run({ format: "JSON", tags, steps });
        expect(batched).toEqual(plain);
        expect(batched.flat().length).toBeGreaterThan(0);
    });

    /* Arrays under plain JSON are not batched: JSON does not detect
     * arrays, so a $.value metric reads nothing from one. */
    test("JSON does not read an array payload as a batch", () => {
        const tags = MIXED_TAGS.filter(t => t.address == "hf");
        const out = run({ format: "JSON", tags, steps: [
            { hf: j([{ value: 10, timestamp: 1763380000000 }]) }] });
        expect(out).toEqual([[]]);
    });

    /* A DateTime from a string with no zone is read in the agent's
     * time zone, which is UTC here. Existing behaviour, which split
     * drivers must match. */
    test("zoneless DateTime strings are read in the agent's time zone", () => {
        expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(0);
        const out = run(CASES["JSON: DateTime from strings with and without a zone"])
            .map(o => (o as any[])[0]?.value);
        expect(out.slice(0, ZONELESS_DATES.length)).toEqual([
            Date.UTC(2001, 6, 1), Date.UTC(2001, 11, 1),
            Date.UTC(2026, 6, 1, 12), Date.UTC(2026, 0, 15, 12),
            Date.UTC(2026, 6, 1, 12),
        ]);
    });

    for (const fx of ["mqtt-json", "mqtt-delimited", "rest-json",
        "rest-xml", "rest-xml-contains"])
    {
        test(`fixture ${fx}`, () => {
            expect(run_fixture(fx)).toMatchSnapshot();
        });
    }
});

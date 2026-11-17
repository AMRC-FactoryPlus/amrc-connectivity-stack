/*
 * ACS Edge Agent benchmark
 * Benchmark cases: metric configs and generated payloads
 * Copyright 2026 University of Sheffield
 *
 * Each case is one device with every metric on one address, so one
 * message carries a value for every metric. Payloads are generated
 * deterministically, so the in-process mode and the stub driver (a
 * separate process) build the same bytes. Every variant changes every
 * value from the one before, so the Edge Agent's "has it changed"
 * check never drops a metric and each message produces one DDATA.
 */

/* Sparkplug type names, as in sparkplugDataType in typeHandler.ts. */
const T = {
    bool:   "Boolean",
    int32:  "Int32",
    uint16: "UInt16",
    float:  "Float",
    double: "Double",
    string: "String",
};

const BIG_ENDIAN = 4321;
const BASE_MS = 1_763_000_000_000;

/* Mix of types roughly like a real device: mostly numbers, some
 * booleans and strings. */
function json_type (i) {
    const m = i % 10;
    if (m < 6) return T.double;
    if (m < 8) return T.int32;
    if (m < 9) return T.bool;
    return T.string;
}

function value (type, i, k) {
    switch (type) {
    case T.double:  return i + k * 0.5 + 0.25;
    case T.float:   return i + k * 0.5 + 0.25;
    case T.int32:   return i * 10 + k;
    case T.uint16:  return (i * 10 + k) % 65536;
    case T.bool:    return (i + k) % 2 == 0;
    case T.string:  return `s${i}-${k}`;
    }
}

function str (type, v) {
    return type == T.bool ? (v ? "true" : "false") : String(v);
}

function metric (name, type, addr, path, extra = {}) {
    const S = (v) => ({ value: v, type: T.string });
    return {
        name,
        type,
        value:      null,
        timestamp:  BASE_MS,
        properties: {
            method:         S("GET"),
            address:        S(addr),
            path:           S(path),
            friendlyName:   S(name),
            tooltip:        S(`Generated metric ${name}`),
            docs:           S(""),
            engUnit:        S(""),
            engLow:         { value: 0, type: T.float },
            engHigh:        { value: 100, type: T.float },
            ...extra,
        },
    };
}

/* Nested JSON: tag i sits at $.machine.group<g>.tag<i>, and every
 * fifth tag is an object with its value under .value, as many real
 * devices send. */
function json_layout (n) {
    return Array.from({ length: n }, (_, i) => {
        const g = Math.floor(i / 10);
        const nested = i % 5 == 4;
        return {
            i, g, nested,
            type: json_type(i),
            path: `$.machine.group${g}.tag${i}` + (nested ? ".value" : ""),
        };
    });
}

function json_object (layout, k) {
    const machine = {};
    for (const t of layout) {
        const grp = machine[`group${t.g}`] ??= {};
        const v = value(t.type, t.i, k);
        grp[`tag${t.i}`] = t.nested ? { value: v, unit: "mm" } : v;
    }
    return { machine };
}

function json_case (name, n, opts = {}) {
    const addr = `site/area/cell/${name}`;
    const layout = json_layout(n);
    return {
        name,
        description: `JSON, ${n} metrics on one address`
            + (opts.timestamps ? ", payload timestamps" : ""),
        payloadFormat: "JSON",
        addr,
        metrics: layout.map(t =>
            metric(`Group ${t.g}/Tag ${t.i}`, t.type, addr, t.path)),
        payload (k) {
            const obj = json_object(layout, k);
            if (opts.timestamps) {
                const ms = BASE_MS + k * 1000;
                obj.timestamp = ms;
                obj.timestampNs = `${BigInt(ms) * 1_000_000n + 123_456n}`;
            }
            return Buffer.from(JSON.stringify(obj));
        },
    };
}

/* One value per message, {"value": v, "timestamp": ms} with no path.
 * This is what edge-sim publishes, and what the split drivers in
 * ACS-12 are expected to publish for each address, so it is the
 * smallest message and shows the fixed cost per message best. */
function value_case (name) {
    const addr = `site/area/cell/${name}`;
    return {
        name,
        description: "JSON {value, timestamp}, 1 metric, no path",
        payloadFormat: "JSON",
        addr,
        metrics: [metric("Value", T.double, addr, "")],
        payload (k) {
            return Buffer.from(JSON.stringify({
                value: value(T.double, 0, k),
                timestamp: BASE_MS + k * 1000,
            }));
        },
    };
}

/* JSON (Batched): an array of rows, each a flat object with a value
 * for every metric and its own timestamp. Each metric path is applied
 * to each row, so one message gives `rows` values per metric. */
function batched_case (name, n, rows) {
    const addr = `site/area/cell/${name}`;
    const types = Array.from({ length: n }, (_, i) => json_type(i));
    return {
        name,
        description: `JSON (Batched), ${n} metrics x ${rows} rows`,
        payloadFormat: "JSON (Batched)",
        addr,
        metrics: types.map((type, i) =>
            metric(`Batch/Tag ${i}`, type, addr, `$.tag${i}`)),
        payload (k) {
            const arr = [];
            for (let r = 0; r < rows; r++) {
                const kk = k * rows + r;
                const row = { timestamp: BASE_MS + kk * 100 };
                types.forEach((type, i) => row[`tag${i}`] = value(type, i, kk));
                arr.push(row);
            }
            return Buffer.from(JSON.stringify(arr));
        },
    };
}

function xml_case (name, n) {
    const addr = `site/area/cell/${name}`;
    const layout = json_layout(n);
    return {
        name,
        description: `XML, ${n} metrics on one address (XPath)`,
        payloadFormat: "XML",
        addr,
        metrics: layout.map(t => metric(`Group ${t.g}/Tag ${t.i}`, t.type,
            addr, `/machine/group${t.g}/tag${t.i}/text()`)),
        payload (k) {
            const groups = new Map();
            for (const t of layout) {
                if (!groups.has(t.g)) groups.set(t.g, []);
                groups.get(t.g).push(
                    `<tag${t.i}>${str(t.type, value(t.type, t.i, k))}</tag${t.i}>`);
            }
            const body = [...groups].map(([g, tags]) =>
                `<group${g}>${tags.join("")}</group${g}>`).join("");
            return Buffer.from(
                `<?xml version="1.0" encoding="UTF-8"?><machine>${body}</machine>`);
        },
    };
}

function delimited_case (name, n) {
    const addr = `site/area/cell/${name}`;
    const types = Array.from({ length: n }, (_, i) => json_type(i));
    return {
        name,
        description: `Delimited String, ${n} fields`,
        payloadFormat: "Delimited String",
        delimiter: ",",
        addr,
        metrics: types.map((type, i) =>
            metric(`Field ${i}`, type, addr, String(i))),
        payload (k) {
            return Buffer.from(types
                .map((type, i) => str(type, value(type, i, k))).join(","));
        },
    };
}

/* Buffer: a 4-byte big-endian slot per metric. Paths are byte
 * offsets, and booleans use offset:bit. */
function buffer_case (name, n) {
    const addr = `site/area/cell/${name}`;
    const kinds = [T.float, T.int32, T.uint16, T.bool];
    const types = Array.from({ length: n }, (_, i) => kinds[i % 4]);
    const endianness = { endianness: { value: BIG_ENDIAN, type: "UInt32" } };
    return {
        name,
        description: `Buffer, ${n} metrics in ${n * 4} bytes`,
        payloadFormat: "Buffer",
        addr,
        metrics: types.map((type, i) => metric(`Register ${i}`, type, addr,
            type == T.bool ? `${i * 4}:0` : String(i * 4), endianness)),
        payload (k) {
            const buf = Buffer.alloc(n * 4);
            types.forEach((type, i) => {
                const v = value(type, i, k);
                const off = i * 4;
                switch (type) {
                case T.float:   buf.writeFloatBE(v, off); break;
                case T.int32:   buf.writeInt32BE(v, off); break;
                case T.uint16:  buf.writeUInt16BE(v, off); break;
                case T.bool:    buf.writeUInt8(v ? 1 : 0, off); break;
                }
            });
            return buf;
        },
    };
}

export const Cases = [
    value_case("json-value-1"),
    json_case("json-10", 10),
    json_case("json-100", 100),
    json_case("json-1000", 1000),
    json_case("json-ts-100", 100, { timestamps: true }),
    batched_case("json-batched-100x10", 100, 10),
    xml_case("xml-100", 100),
    delimited_case("delimited-100", 100),
    buffer_case("buffer-100", 100),
];

/* Number of payload variants each run cycles through. Even, so the
 * boolean values also change from the last variant to the first. */
export const VARIANTS = 16;

export function payloads (c) {
    return Array.from({ length: VARIANTS }, (_, k) => c.payload(k));
}

export function find_case (name) {
    const c = Cases.find(c => c.name == name);
    if (!c) throw new Error(`Unknown case ${name}`);
    return c;
}

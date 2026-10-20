/*
 * ACS Sparkplug B (Elixir)
 * Encode the test fixtures with the Tahu JS library ACS edge agents use
 * Copyright 2026 University of Sheffield
 */

/* For each fixture this writes `<name>.bin`, the payload as Tahu's
 * encoder produces it, and `<name>.json`, what Tahu's decoder returns
 * for those bytes. The Elixir tests decode the .bin and compare with
 * the .json. Run with `npm run generate` from this directory. */

import fs   from "node:fs";
import path from "node:path";

import Long             from "long";
import sparkplug_payload from "sparkplug-payload";

const SpB = sparkplug_payload.get("spBv1.0");

const OUT = path.resolve(import.meta.dirname, "../payloads");

/* ACS edge agents put nanoseconds in the uint64 timestamp fields, as an
 * unsigned Long (acs-edge/lib/sparkplugNode.ts). */
const ns = str => Long.fromString(str, true);

const TS_MS = 1_760_000_000_123;
const TS_NS = ns("1760000000123456789");

const FIXTURES = {
    /* An NBIRTH as an ACS edge agent sends it: names, aliases,
     * datatypes, an engineering unit and a transient metric. */
    nbirth: {
        timestamp:  TS_MS,
        seq:        0,
        metrics: [
            { name: "bdSeq", type: "Int64", value: 3 },
            { name: "Node Control/Rebirth", alias: 1, type: "Boolean",
                value: false },
            { name: "Instance_UUID", alias: 2, type: "UUID",
                value: "1b4e28ba-2fa1-11d2-883f-0016d3cca427" },
            { name: "Schema_UUID", alias: 3, type: "UUID",
                value: "6ba7b810-9dad-11d1-80b4-00c04fd430c8" },
            { name: "Phases/1/Voltage", alias: 4, type: "Double",
                value: 230.5, timestamp: TS_NS,
                properties: { engUnit: { type: "String", value: "V" } } },
            { name: "Status/Uptime", alias: 5, type: "UInt64",
                value: ns("86400"), isTransient: true },
        ],
    },

    /* Every scalar type, by alias with a datatype, as acs-edge sends
     * DDATA. Includes negative and extreme values. */
    ddata_scalars: {
        timestamp:  TS_MS,
        seq:        1,
        metrics: [
            { alias: 10, type: "Int8",     value: -5 },
            { alias: 11, type: "Int16",    value: -300 },
            { alias: 12, type: "Int32",    value: -70000 },
            { alias: 13, type: "Int32",    value: -2147483648 },
            { alias: 14, type: "Int64",    value: Long.fromString("-5000000000") },
            { alias: 15, type: "UInt8",    value: 250 },
            { alias: 16, type: "UInt16",   value: 65000 },
            { alias: 17, type: "UInt32",   value: 4000000000 },
            { alias: 18, type: "UInt64",   value: ns("18446744073709551615") },
            { alias: 19, type: "Float",    value: 1.5 },
            { alias: 20, type: "Double",   value: 230.5 },
            { alias: 21, type: "Boolean",  value: true },
            { alias: 22, type: "String",   value: "hello" },
            { alias: 23, type: "Text",     value: "a longer piece of text" },
            { alias: 24, type: "UUID",     value: "1b4e28ba-2fa1-11d2-883f-0016d3cca427" },
            { alias: 25, type: "DateTime", value: Long.fromNumber(TS_MS, true) },
            { alias: 26, type: "Bytes",    value: Buffer.from([0, 1, 2, 255]) },
        ].map(m => ({ ...m, timestamp: TS_NS })),
    },

    /* Values the BEAM has no float for, an explicit null and an empty
     * string. */
    ddata_special_values: {
        timestamp:  TS_MS,
        seq:        2,
        metrics: [
            { alias: 30, type: "Double", value: NaN },
            { alias: 31, type: "Double", value: Infinity },
            { alias: 32, type: "Double", value: -Infinity },
            { alias: 33, type: "Float",  value: NaN },
            { alias: 34, type: "Double", value: null },
            { alias: 35, type: "String", value: "" },
        ],
    },

    /* Millisecond and nanosecond timestamps side by side, a metric with
     * no timestamp, and both sides of the 10^15 threshold the JS
     * decoders use to tell ms from ns. */
    ddata_timestamps: {
        timestamp:  TS_NS,
        seq:        3,
        metrics: [
            { alias: 40, type: "Double", value: 1, timestamp: TS_MS },
            { alias: 41, type: "Double", value: 2, timestamp: TS_NS },
            { alias: 42, type: "Double", value: 3 },
            { alias: 43, type: "Double", value: 4,
                timestamp: ns("999999999999999") },
            { alias: 44, type: "Double", value: 5,
                timestamp: ns("1000000000000000") },
        ],
    },

    /* The one case ACS DDATA carries properties: simulated-data
     * markers from edge-sim. */
    ddata_simulated: {
        timestamp:  TS_MS,
        seq:        4,
        metrics: [
            { alias: 50, type: "Double", value: 12.5, timestamp: TS_NS,
                properties: {
                    simulated:  { type: "Boolean", value: true },
                    run_id:     { type: "String", value: "run-42" },
                } },
        ],
    },
};

/* JSON can't hold Longs, bytes or non-finite numbers, so tag them. */
function tag (value) {
    if (Long.isLong(value))
        return { long: value.toString(), unsigned: value.unsigned };
    if (value instanceof Uint8Array)
        return { bytes: Buffer.from(value).toString("base64") };
    if (typeof value == "number" && !Number.isFinite(value))
        return { float: String(value) };
    if (Array.isArray(value))
        return value.map(tag);
    if (value && typeof value == "object")
        return Object.fromEntries(
            Object.entries(value)
                .filter(([, v]) => v !== undefined)
                .map(([k, v]) => [k, tag(v)]));
    return value;
}

fs.mkdirSync(OUT, { recursive: true });

for (const [name, payload] of Object.entries(FIXTURES)) {
    const bytes = SpB.encodePayload(payload);
    const decoded = SpB.decodePayload(bytes);

    fs.writeFileSync(path.join(OUT, `${name}.bin`), bytes);
    fs.writeFileSync(path.join(OUT, `${name}.json`),
        JSON.stringify(tag(decoded), null, 2) + "\n");
    console.log("Wrote %s (%d bytes)", name, bytes.length);
}

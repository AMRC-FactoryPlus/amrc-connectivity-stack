/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/* The payload a split driver sends when it has already decoded a value,
 * as edge-sim does and as a split OPC UA driver will:
 *
 *     {"value": v, "timestamp": ms}
 *
 * The device uses payloadFormat JSON and the metric has an empty path.
 * These tests pin down how each Sparkplug type survives the trip from
 * that payload, through the agent's parser, to a Sparkplug payload and
 * back. docs/edge-split.md records the results. */

import Long from "long";
import * as sparkplug from "sparkplug-payload";

import {
    parseTimeStampFromPayload, parseValueFromPayload,
    serialisationType, sparkplugDataType, sparkplugMetric,
} from "../../../lib/helpers/typeHandler";

const SpB = sparkplug.get("spBv1.0")!;
const TS = 1_763_380_800_123;

function metric (type: sparkplugDataType, path = ""): sparkplugMetric {
    return {
        name: "m", type, value: null,
        properties: {
            method:     { type: sparkplugDataType.string, value: "GET" },
            address:    { type: sparkplugDataType.string, value: "addr" },
            path:       { type: sparkplugDataType.string, value: path },
        },
    } as sparkplugMetric;
}

function driverPayload (value: any) {
    return Buffer.from(JSON.stringify({ value, timestamp: TS }));
}

/* What the agent makes of the payload. */
function parse (type: sparkplugDataType, value: any) {
    const m = metric(type);
    const buf = driverPayload(value);
    return {
        value:      parseValueFromPayload(buf, m, serialisationType.JSON),
        timestamp:  parseTimeStampFromPayload(buf, m, serialisationType.JSON),
    };
}

/* Encode as the Sparkplug client does and decode again. */
function sparkplugTrip (type: sparkplugDataType, value: any) {
    const enc = SpB.encodePayload({
        timestamp: TS,
        metrics: [{ name: "m", type, value } as any],
    });
    return SpB.decodePayload(enc).metrics![0].value;
}

function plain (v: any) {
    return Long.isLong(v) ? (v as Long).toNumber() : v;
}

describe("Split driver JSON payload with an empty path", () => {
    it("reads payload.value and $.timestamp", () => {
        expect(parse(sparkplugDataType.double, 21.5))
            .toEqual({ value: 21.5, timestamp: TS });
    });

    it("converts a timestamp in seconds to ms", () => {
        const m = metric(sparkplugDataType.double);
        const buf = Buffer.from(JSON.stringify({ value: 1, timestamp: 1_763_380_800 }));
        expect(parseTimeStampFromPayload(buf, m, serialisationType.JSON))
            .toBe(1_763_380_800_000);
    });

    it.each([
        ["Int8",    sparkplugDataType.int8,     -128],
        ["Int16",   sparkplugDataType.int16,    -32768],
        ["Int32",   sparkplugDataType.int32,    -2147483648],
        ["Int64",   sparkplugDataType.int64,    -9007199254740991],
        ["UInt8",   sparkplugDataType.uInt8,    255],
        ["UInt16",  sparkplugDataType.uInt16,   65535],
        ["UInt32",  sparkplugDataType.uInt32,   4294967295],
        ["UInt64",  sparkplugDataType.uInt64,   9007199254740991],
        ["Float",   sparkplugDataType.float,    1.5],
        ["Double",  sparkplugDataType.double,   0.1 + 0.2],
        ["Boolean true", sparkplugDataType.boolean, true],
        ["Boolean false", sparkplugDataType.boolean, false],
        ["String",  sparkplugDataType.string,   "héllo/wörld"],
        ["DateTime as ms", sparkplugDataType.dateTime, TS],
    ])("round-trips %s", (_, type, value) => {
        const got = parse(type, value).value;
        expect(got).toBe(value);
        expect(plain(sparkplugTrip(type, got))).toBe(value);
    });

    it("turns a DateTime ISO string into ms", () => {
        const got = parse(sparkplugDataType.dateTime, new Date(TS).toISOString()).value;
        expect(got).toBe(TS);
        expect(plain(sparkplugTrip(sparkplugDataType.dateTime, got))).toBe(TS);
    });

    it("parses numbers sent as strings", () => {
        expect(parse(sparkplugDataType.int32, "42").value).toBe(42);
        expect(parse(sparkplugDataType.double, "2.5").value).toBe(2.5);
        expect(parse(sparkplugDataType.boolean, "false").value).toBe(false);
    });

    /* Known limits, written into the spec. */
    it("loses Int64 precision beyond 2^53, as a number or a string", () => {
        /* 2^53 + 1 has no exact double, so it comes out as 2^53. */
        expect(parse(sparkplugDataType.int64, "9007199254740993").value)
            .toBe(9007199254740992);
        const buf = Buffer.from('{"value": 9007199254740993}');
        expect(parseValueFromPayload(buf, metric(sparkplugDataType.int64),
            serialisationType.JSON)).toBe(9007199254740992);
    });

    it("rounds a Float to 32 bits in Sparkplug", () => {
        const got = parse(sparkplugDataType.float, 0.1).value;
        expect(got).toBe(0.1);
        expect(sparkplugTrip(sparkplugDataType.float, got))
            .toBe(Math.fround(0.1));
    });

    it("cannot carry NaN or Infinity, which JSON writes as null", () => {
        expect(parse(sparkplugDataType.double, NaN).value).toBeNull();
        expect(parse(sparkplugDataType.double, Infinity).value).toBeNull();
    });
});

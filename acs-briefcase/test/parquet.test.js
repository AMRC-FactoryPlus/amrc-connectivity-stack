/*
 * ACS Briefcase exporter
 * Tests for the Parquet copy of the telemetry
 * Copyright 2026 University of Sheffield
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import {
    asyncBufferFromFile, parquetMetadataAsync, parquetReadObjects,
} from "hyparquet";

import { time_ns, write_parquet } from "../lib/parquet.js";
import { CSV_HEADER } from "../lib/telemetry.js";

const compressors = { ZSTD: b => new Uint8Array(zlib.zstdDecompressSync(b)) };

/* Write a briefcase CSV of `lines`, convert it, and read it back. */
async function convert (lines, opts) {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "parquet-test-"));
    try {
        const csv = path.join(dir, "in.csv");
        const out = path.join(dir, "out.parquet");
        await fsp.writeFile(csv, [CSV_HEADER, ...lines, ""].join("\n"));
        const count = await write_parquet(csv, out, opts);
        const file = await asyncBufferFromFile(out);
        return {
            count,
            meta:   await parquetMetadataAsync(file),
            rows:   await parquetReadObjects({ file, compressors }),
        };
    }
    finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
}

const NULLS = {
    value_double: null, value_int: null, value_uint: null,
    value_boolean: null, value_string: null,
};

test("reads nanosecond timestamps exactly", () => {
    assert.equal(time_ns("1970-01-01T00:00:01.000000002Z"), 1_000_000_002n);
    assert.equal(time_ns("2026-10-14T09:00:00.123456789Z"), 1791968400123456789n);
    assert.throws(() => time_ns("2026-10-14T09:00:00.1Z"), /Unexpected timestamp/);
});

test("sets only the value column the type names", async () => {
    const { count, rows } = await convert([
        "2026-10-14T09:00:00.123456789Z,Axes/X/Position,double,12.5,mm",
        "2026-10-14T09:00:00.123456790Z,Count,uint,18446744073709551615,",
        "2026-10-14T09:00:00.123456791Z,Offset,int,-9007199254740993,",
        "2026-10-14T09:00:01.000000000Z,Door_Open,boolean,false,",
        '2026-10-14T09:00:02.000000000Z,Note,string,"a, ""b""\nc",',
        "2026-10-14T09:00:03.000000000Z,Name,string,,",
    ]);

    assert.equal(count, 6);
    const values = rows.map(({ timestamp, timestamp_ns, metric, type, unit, ...v }) => v);
    assert.deepEqual(values, [
        { ...NULLS, value_double: 12.5 },
        { ...NULLS, value_uint: 18446744073709551615n },
        { ...NULLS, value_int: -9007199254740993n },
        { ...NULLS, value_boolean: false },
        { ...NULLS, value_string: 'a, "b"\nc' },
        { ...NULLS, value_string: "" },
    ]);
    assert.deepEqual(rows.map(r => r.unit), ["mm", null, null, null, null, null]);
    assert.deepEqual(rows.map(r => r.metric),
        ["Axes/X/Position", "Count", "Offset", "Door_Open", "Note", "Name"]);
});

test("keeps the exact time beside the microsecond timestamp", async () => {
    const { rows } = await convert([
        "2026-10-14T09:00:00.123456789Z,T,double,1,",
    ]);
    assert.equal(rows[0].timestamp_ns, 1791968400123456789n);
    /* hyparquet reads the timestamp as a Date, to the millisecond. */
    assert.equal(rows[0].timestamp.toISOString(), "2026-10-14T09:00:00.123Z");
});

test("declares the agreed schema", async () => {
    const { meta } = await convert(["2026-10-14T09:00:00.000000000Z,T,double,1,"]);
    const col = name => meta.schema.find(c => c.name == name);

    assert.deepEqual(meta.schema.slice(1).map(c => c.name), [
        "timestamp", "timestamp_ns", "metric", "type", "unit",
        "value_double", "value_int", "value_uint", "value_boolean", "value_string",
    ]);
    assert.deepEqual(col("timestamp").logical_type,
        { type: "TIMESTAMP", isAdjustedToUTC: true, unit: "MICROS" });
    assert.equal(col("timestamp_ns").type, "INT64");
    assert.equal(col("timestamp_ns").logical_type, undefined);
    assert.equal(col("value_uint").converted_type, "UINT_64");
    assert.equal(col("value_string").logical_type.type, "STRING");
    assert.equal(meta.row_groups[0].columns[0].meta_data.codec, "ZSTD");
});

test("writes a row group per batch of rows", async () => {
    const lines = Array.from({ length: 5 }, (_, i) =>
        `2026-10-14T09:00:0${i}.000000000Z,T,int,${i},`);
    const { meta, rows } = await convert(lines, { row_group: 2 });
    assert.deepEqual(meta.row_groups.map(g => Number(g.num_rows)), [2, 2, 1]);
    assert.deepEqual(rows.map(r => r.value_int), [0n, 1n, 2n, 3n, 4n]);
});

test("refuses a value that doesn't match its type", async () => {
    await assert.rejects(convert(["2026-10-14T09:00:00.000000000Z,T,boolean,1,"]),
        /Not a boolean/);
    await assert.rejects(convert(["2026-10-14T09:00:00.000000000Z,T,int,1.5,"]),
        /SyntaxError|Cannot convert/);
    await assert.rejects(convert(["2026-10-14T09:00:00.000000000Z,T,float,1,"]),
        /Unknown type/);
});

/*
 * ACS Briefcase exporter
 * Write the Parquet copy of a device's telemetry
 * Copyright 2026 University of Sheffield
 */

import fs               from "node:fs";
import zlib             from "node:zlib";

import { parse }        from "csv-parse";
import { ParquetWriter, fileWriter } from "hyparquet-writer";

/* Rows in each row group. */
const ROW_GROUP = 100_000;

const string = (name, repetition_type = "OPTIONAL") => ({
    name, repetition_type,
    type:           "BYTE_ARRAY",
    converted_type: "UTF8",
    logical_type:   { type: "STRING" },
});

/* value_uint has only the older UINT_64 converted type. hyparquet-writer
 * 0.18 writes the INTEGER logical type wrongly (its issue #60), and
 * pyarrow then can't read the file at all. */
export const SCHEMA = [
    { name: "root", num_children: 10 },
    {
        name:               "timestamp",
        type:               "INT64",
        repetition_type:    "REQUIRED",
        logical_type:       { type: "TIMESTAMP", isAdjustedToUTC: true, unit: "MICROS" },
    },
    { name: "timestamp_ns", type: "INT64", repetition_type: "REQUIRED" },
    string("metric", "REQUIRED"),
    string("type", "REQUIRED"),
    string("unit"),
    { name: "value_double", type: "DOUBLE", repetition_type: "OPTIONAL" },
    { name: "value_int", type: "INT64", repetition_type: "OPTIONAL" },
    { name: "value_uint", type: "INT64", repetition_type: "OPTIONAL", converted_type: "UINT_64" },
    { name: "value_boolean", type: "BOOLEAN", repetition_type: "OPTIONAL" },
    string("value_string"),
];

const COLUMNS = SCHEMA.slice(1).map(c => c.name);

const BOOLEANS = { true: true, false: false };

/* How to read each type's CSV value. The CSV holds each value exactly
 * as InfluxDB wrote it. */
const VALUES = {
    double: v => {
        if (v === "") throw new Error("An empty double");
        return Number(v);
    },
    int:        v => BigInt(v),
    uint:       v => BigInt(v),
    boolean:    v => {
        if (!(v in BOOLEANS)) throw new Error(`Not a boolean: ${v}`);
        return BOOLEANS[v];
    },
    string:     v => v,
};

/** Nanoseconds since the epoch, as a BigInt, from a briefcase CSV
 * timestamp (UTC, with nine fractional digits). */
export function time_ns (ts) {
    const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)\.(\d{9})Z$/.exec(ts);
    if (!m) throw new Error(`Unexpected timestamp ${ts}`);
    return BigInt(Date.parse(`${m[1]}Z`)) * 1_000_000n + BigInt(m[2]);
}

function empty_batch () {
    return Object.fromEntries(COLUMNS.map(c => [c, []]));
}

/** Write the Parquet copy of one briefcase CSV file.
 *
 * Each CSV row becomes one Parquet row, in the same order. `timestamp`
 * is the time truncated to the microsecond, as a UTC timestamp, and
 * `timestamp_ns` is the exact time in nanoseconds since the epoch. Of
 * the value columns, only the one the row's `type` names is set. An
 * empty unit is null.
 *
 * @param csv The briefcase CSV file to read.
 * @param out The Parquet file to write.
 * @param opts.row_group Rows per row group.
 * @returns The number of rows written.
 */
export async function write_parquet (csv, out, { row_group = ROW_GROUP } = {}) {
    const writer = new ParquetWriter({
        writer:         fileWriter(out),
        schema:         SCHEMA,
        codec:          "ZSTD",
        compressors:    { ZSTD: b => new Uint8Array(zlib.zstdCompressSync(b)) },
    });

    let batch = empty_batch();
    let size = 0;
    let rows = 0;

    const flush = async () => {
        if (!size) return;
        await writer.write({
            columnData: COLUMNS.map(name => ({ name, data: batch[name] })),
        });
        batch = empty_batch();
        size = 0;
    };

    for await (const row of fs.createReadStream(csv).pipe(parse({ columns: true }))) {
        const read = VALUES[row.type];
        if (!read) throw new Error(`Unknown type ${row.type}`);
        const value = `value_${row.type}`;

        const ns = time_ns(row.timestamp);
        batch.timestamp.push(ns / 1000n);
        batch.timestamp_ns.push(ns);
        batch.metric.push(row.metric);
        batch.type.push(row.type);
        batch.unit.push(row.unit === "" ? null : row.unit);
        for (const v of Object.keys(VALUES))
            batch[`value_${v}`].push(null);
        batch[value][size] = read(row.value);

        size++;
        rows++;
        if (size == row_group) await flush();
    }
    await flush();
    await writer.finish();

    return rows;
}

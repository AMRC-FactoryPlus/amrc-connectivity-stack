/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * A stand-in for the InfluxDB transport that History streams history
 * through. It answers each Flux query with the annotated CSV InfluxDB
 * would send for the given rows, so the real parser runs in tests.
 */

type HistoryRow = { _value: unknown; _time: string };

function datatype(v: unknown): string {
    if (typeof v === "string") return "string";
    if (typeof v === "boolean") return "boolean";
    return "double";
}

function cell(v: unknown): string {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Annotated CSV for `rows`, one table per run of the same value type. */
export function annotatedCsv(rows: HistoryRow[]): string {
    let out = "";
    let table = -1;
    let type = "";
    for (const r of rows) {
        const t = datatype(r._value);
        if (t !== type) {
            if (table >= 0) out += "\r\n";
            table++;
            type = t;
            out += `#datatype,string,long,dateTime:RFC3339,${t}\r\n`
                + "#group,false,false,false,false\r\n"
                + "#default,_result,,,\r\n"
                + ",result,table,_time,_value\r\n";
        }
        out += `,,${table},${cell(r._time)},${cell(r._value)}\r\n`;
    }
    return out + "\r\n";
}

/**
 * A transport whose iterate() answers each query with `rows(query)` as
 * annotated CSV, in chunks of `chunkSize` bytes.
 */
export function csvTransport(
    rows: (query: string) => HistoryRow[] | Promise<HistoryRow[]>,
    opts: { chunkSize?: number } = {},
) {
    return {
        async *iterate(_path: string, body: string, _opts: unknown): AsyncIterableIterator<Uint8Array> {
            const csv = Buffer.from(annotatedCsv(await rows(JSON.parse(body).query)));
            const size = opts.chunkSize ?? csv.length;
            for (let i = 0; i < csv.length; i += size) yield csv.subarray(i, i + size);
        },
    };
}

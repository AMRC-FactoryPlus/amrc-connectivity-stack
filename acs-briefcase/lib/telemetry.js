/*
 * ACS Briefcase exporter
 * Split a Data Access CSV export into one file per device
 * Copyright 2026 University of Sheffield
 */

import fs               from "node:fs";
import path             from "node:path";
import { once }         from "node:events";
import { finished }     from "node:stream/promises";

import { parse }        from "csv-parse";

export const CSV_HEADER = "timestamp,metric,type,value,unit";

const TIME_rx = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/;
const UUID_rx = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Pad an RFC 3339 UTC timestamp to nine fractional digits. InfluxDB
 * drops trailing zeros, so the timestamps it returns vary in width. */
export function pad_time (ts) {
    const m = TIME_rx.exec(ts);
    if (!m) throw new Error(`Unexpected timestamp ${ts}`);
    return `${m[1]}.${(m[2] ?? "").padEnd(9, "0")}Z`;
}

export function csv_escape (value) {
    if (value == null) return "";
    const str = String(value);
    return /[,"\n\r]/.test(str)
        ? `"${str.replace(/"/g, '""')}"`
        : str;
}

async function write (out, chunk) {
    if (!out.write(chunk))
        await once(out, "drain");
}

/* finished() also settles for a stream that has already failed, where
 * waiting for "finish" would never return. */
function close (out) {
    out.end();
    return finished(out);
}

/** Split a Data Access CSV export into one file per device.
 *
 * Each file is named `<device-uuid>.csv` and has the columns in
 * CSV_HEADER. The metric is the full Sparkplug name, with its folders,
 * and every timestamp has nine fractional digits.
 *
 * @param input A readable stream of the export.
 * @param dir The directory to write the files to.
 * @returns A Map from device UUID to `{ file, rows, first, last }`,
 * where `first` and `last` are the earliest and latest timestamps.
 */
export async function split_telemetry (input, dir) {
    const devices = new Map();
    let error = null;

    try {
        for await (const row of input.pipe(parse({ columns: true }))) {
            const uuid = row.device_uuid;
            let dev = devices.get(uuid);
            if (!dev) {
                /* The UUID names a file, so it must be one. */
                if (!UUID_rx.test(uuid))
                    throw new Error(`Bad device UUID ${uuid}`);
                const file = `${uuid}.csv`;
                dev = {
                    file, rows: 0, first: null, last: null,
                    out: fs.createWriteStream(path.join(dir, file)),
                };
                devices.set(uuid, dev);
                await write(dev.out, CSV_HEADER + "\n");
            }

            const ts = pad_time(row.timestamp);
            const metric = row.path ? `${row.path}/${row.metric}` : row.metric;
            const line = [ts, metric, row.type, row.value, row.unit]
                .map(csv_escape).join(",");
            await write(dev.out, line + "\n");

            dev.rows++;
            if (dev.first == null || ts < dev.first) dev.first = ts;
            if (dev.last == null || ts > dev.last) dev.last = ts;
        }
    }
    catch (e) {
        error = e;
    }

    /* Close every file, even after a failure. A file that fails to
     * close only matters if nothing else has failed first. */
    const closed = await Promise.allSettled(
        [...devices.values()].map(d => close(d.out)));
    const failed = closed.find(c => c.status == "rejected");
    if (error) throw error;
    if (failed) throw failed.reason;

    return new Map([...devices].map(([uuid, { out, ...summary }]) =>
        [uuid, summary]));
}

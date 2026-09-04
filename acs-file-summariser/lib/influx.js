/*
 * ACS File Summariser
 * InfluxDB point writer
 * Copyright 2026 University of Sheffield
 */

import { Agent }            from "node:http";
import { InfluxDB, Point }  from "@influxdata/influxdb-client";

/* File-type-agnostic: takes generic `{ measurement, tags, fields,
 * timestamp }` rows, as produced by any summariser plugin. */
export class Influx {
    constructor (opts) {
        this.log = opts.log ?? (() => {});

        const agent = new Agent({ keepAlive: true, keepAliveMsecs: 20_000 });

        const client = new InfluxDB({
            url:                opts.url,
            token:              opts.token,
            transportOptions:   { agent },
        });

        /* Timestamps are supplied as pre-formatted nanosecond strings by
         * plugins, so line-protocol precision here just tells the server
         * how to interpret them - see Point.timestamp().
         *
         * A single file's summary can be a lot of points, so the write
         * API is left to auto-flush by size (`batch_size`) and by time
         * (`flush_interval`, a safety net for a slow-trickling file) as
         * well as being flushed explicitly once a file completes - see
         * Job.run(). */
        this.write_api = client.getWriteApi(opts.org, opts.bucket, "ns", {
            batchSize:      opts.batch_size,
            flushInterval:  opts.flush_interval,
            maxBufferLines: 30_000,
            maxRetries:     0,
        });
    }

    async init () { return this; }

    write (row) {
        const point = new Point(row.measurement).timestamp(row.timestamp);

        for (const [k, v] of Object.entries(row.tags ?? {}))
            if (v != null) point.tag(k, String(v));

        for (const [k, v] of Object.entries(row.fields ?? {})) {
            if (typeof v === "number") point.floatField(k, v);
            else if (typeof v === "boolean") point.booleanField(k, v);
            else point.stringField(k, String(v));
        }

        this.write_api.writePoint(point);
    }

    async flush () {
        await this.write_api.flush();
    }

    async close () {
        await this.write_api.close();
    }
}

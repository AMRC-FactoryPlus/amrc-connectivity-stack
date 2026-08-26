import { PassThrough } from "stream";
import { once } from "events";
import pLimit from "p-limit";

import { csv_escape, strip_metric_suffix } from "./utils.js";

const CSV_HEADER = "device,metric,timestamp,value,unit";

export class InfluxReader {
    constructor(opts) {
        this.log = opts.debug.bound("influxReader");

        this.influx_bucket = opts.influx_bucket;
        this.influx_org = opts.influx_org;

        this.influx_query_api =
            opts.influx_client.getQueryApi(
                this.influx_org
            );

        this.limit = pLimit(4);
    }

    /** Combines the resolved device sources of a dataset into a single CSV
     * stream with columns device, metric, timestamp, value, unit - see the
     * @returns doc on APIv1#dataset_data.
     */
    exportDevices(deviceSources, meta = {}) {
        const csvStream = new PassThrough({
            highWaterMark: 1024 * 1024,
        });

        csvStream.on("error", err => {
            this.log("csv export error", err);
        });

        this.#writeDevices(
            csvStream,
            deviceSources,
            meta
        ).catch(err => {
            csvStream.destroy(err);
        });

        return csvStream;
    }

    async #writeDevices(writable, deviceSources, meta) {
        await this.#write(writable, CSV_HEADER + "\n");

        await Promise.all(
            deviceSources.map(source =>
                this.limit(() =>
                    this.#streamDevice(source, writable, meta)
                )
            )
        );

        writable.end();

        await once(writable, "finish");
    }

    async #streamDevice(
        source,
        writable,
        meta
    ) {
        const query =
            this.#buildFluxQuery(
                source,
                meta
            );

        this.log(
            "streaming",
            source.device_uuid
        );

        const response =
            this.influx_query_api.response(query);

        for await (
            const row of response.iterateRows()
        ) {
            const o = row.tableMeta.toObject(row.values);

            const line = [
                csv_escape(o.device),
                csv_escape(strip_metric_suffix(o._measurement)),
                csv_escape(o._time),
                csv_escape(o._value),
                csv_escape(o.unit),
            ].join(",");

            await this.#write(writable, line + "\n");
        }
    }

    async #write(writable, chunk) {
        if (!writable.write(chunk)) {
            await once(writable, "drain");
        }
    }


    #buildFluxQuery(
        source,
        meta = {}
    ) {
        const start =
            source.from ??
            "1970-01-01T00:00:00Z";

        const stop =
            source.to ??
            "2100-01-01T00:00:00Z";

        const measurementFilter =
            meta.measurement
                ? `
                |> filter(
                    fn: (r) =>
                        r._measurement ==
                        "${meta.measurement}"
                )
            `
                : "";

        return `
            from(bucket: "${this.influx_bucket}")

            |> range(
                start: time(v: "${start}"),
                stop: time(v: "${stop}")
            )

            ${measurementFilter}

            |> filter(
                fn: (r) =>
                    r.topLevelInstance ==
                    "${source.device_uuid}"
            )

            |> keep(columns: [
                "_time",
                "_value",
                "_measurement",
                "device",
                "unit"
            ])
        `;
    }
}

import { PassThrough } from "stream";
import { once } from "events";
import pLimit from "p-limit";

import { csv_escape, csv_device_path, strip_metric_suffix } from "./utils.js";
import { build_flux_queries } from "./flux.js";
import { DataAccess as Constants } from "./constants.js";

/* `path` comes last so that clients reading the columns by position
 * still work. */
const CSV_HEADER = "device,metric,timestamp,value,unit,path";

/** Whether an error is InfluxDB saying a bucket does not exist. */
export function is_missing_bucket(err) {
    return err?.statusCode == 404;
}

export class InfluxReader {
    /**
     * @param opts.buckets The bucket for each store, `{ sparkplug, uns }`.
     *   A store with no bucket cannot be read.
     * @param opts.influx_bucket The `sparkplug` bucket, when `buckets`
     *   is not given.
     */
    constructor(opts) {
        this.log = opts.debug.bound("influxReader");

        this.buckets = opts.buckets
            ?? { [Constants.Store.Sparkplug]: opts.influx_bucket };
        this.influx_org = opts.influx_org;
        /* The UNS bucket may not exist yet when Data Access starts. */
        this.warned_missing = false;

        this.influx_query_api =
            opts.influx_client.getQueryApi(
                this.influx_org
            );

        this.limit = pLimit(4);
    }

    /** The bucket a source reads. Sources resolved before stores
     * existed read the `sparkplug` store. */
    bucket_for(source) {
        return this.buckets[source.store ?? Constants.Store.Sparkplug];
    }

    /** Combines the resolved device sources of a dataset into a single CSV
     * stream with columns device, metric, timestamp, value, unit, path - see the
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
        const queries = build_flux_queries({
            bucket: this.bucket_for(source),
            source,
            filter: meta,
        });

        this.log(
            "streaming %s from %s (%d queries)",
            source.device_uuid,
            source.store ?? Constants.Store.Sparkplug,
            queries.length
        );

        for (const query of queries) {
            try {
                await this.#streamQuery(query, source.store, writable);
            }
            catch (err) {
                /* historian-uns creates its bucket when it starts, which
                 * may be after Data Access. Until then the UNS has no
                 * data to give. */
                if (source.store != Constants.Store.UNS || !is_missing_bucket(err))
                    throw err;
                if (!this.warned_missing)
                    this.log("The UNS bucket does not exist yet; reading it as empty");
                this.warned_missing = true;
                return;
            }
        }
    }

    async #streamQuery(query, store, writable) {
        const response =
            this.influx_query_api.response(query);

        for await (
            const row of response.iterateRows()
        ) {
            const o = row.tableMeta.toObject(row.values);
            const { device, path } = csv_device_path(o, store);

            const line = [
                csv_escape(device),
                csv_escape(strip_metric_suffix(o._measurement)),
                csv_escape(o._time),
                csv_escape(o._value),
                csv_escape(o.unit),
                csv_escape(path),
            ].join(",");

            await this.#write(writable, line + "\n");
        }
    }

    async #write(writable, chunk) {
        if (!writable.write(chunk)) {
            await once(writable, "drain");
        }
    }
}

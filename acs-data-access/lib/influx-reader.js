
import {InfluxDB, flux} from '@influxdata/influxdb-client';
import {csv_escape} from './utils.js';

export class InfluxReader{
    constructor(opts){
        this.log = opts.debug.bound("influxReader");
        this.influx_bucket = opts.influx_bucket;
        this.influx_org = opts.influx_org;
        this.influx_query_api = opts.influx_client.getQueryApi(opts.influx_org);
    }

    async stream_dataset_data(device_sources, writable, meta = {}) {

        const measurementFilter = meta.measurement
            ? `|> filter(fn: (r) => r._measurement == "${meta.measurement}")`
            : ``;

        // =====================================================
        // Device + per-device session filtering
        // =====================================================

        const deviceConditions = device_sources.map(src => {

            const timeParts = [];

            if (src.from) {
                timeParts.push(`r._time >= time(v: "${src.from}")`);
            }

            if (src.to) {
                timeParts.push(`r._time <= time(v: "${src.to}")`);
            }

            const timeExpr = timeParts.length
                ? ` and ${timeParts.join(" and ")}`
                : "";

            return `(r.topLevelInstance == "${src.device_uuid}"${timeExpr})`;

        }).join(" or ");

        // =====================================================
        // Global bounds
        // =====================================================

        const froms = device_sources
            .map(s => s.from)
            .filter(Boolean)
            .sort();

        const tos = device_sources
            .map(s => s.to)
            .filter(Boolean)
            .sort();

        const globalFrom = froms.length
            ? froms[0]
            : "0";

        const globalTo = tos.length
            ? tos[tos.length - 1]
            : null;

        const rangeClause = globalTo
            ? `|> range(start: time(v: "${globalFrom}"), stop: time(v: "${globalTo}"))`
            : `|> range(start: ${globalFrom})`;

        // =====================================================
        // QUERY
        // =====================================================

        const query = `
        from(bucket: "${this.influx_bucket}")

            ${rangeClause}

            |> filter(fn: (r) => ${deviceConditions})

            ${measurementFilter}

            |> map(fn: (r) => ({
                r with
                column_name:
                    if exists r.path and r.path != ""
                    then r.device + ":" + r.path + ":" + r._measurement
                    else r.device + ":" + r._measurement
            }))

            // IMPORTANT:
            // remove grouping before pivot
            |> group()

            |> pivot(
                rowKey: ["_time", "unit"],
                columnKey: ["column_name"],
                valueColumn: "_value"
            )

            |> sort(columns: ["_time"], desc: false)
        `;

        return this._stream_influx_csv(query, writable);
    }

    async _stream_influx_csv(query, writable) {
        return new Promise((resolve, reject) => {
            let headersWritten = false;

            this.influx_query_api.queryRows(query, {
                next: (row, tableMeta) => {
                    const obj = tableMeta.toObject(row);

                    // Write headers once
                    if (!headersWritten) {
                        writable.write(
                            Object.keys(obj).join(",") + "\n"
                        );
                        headersWritten = true;
                    }

                    const csvRow = Object.values(obj)
                        .map(v => csv_escape(v))
                        .join(",");

                    writable.write(csvRow + "\n");
                },

                error: reject,

                complete: resolve,
            });
        });
    }
}
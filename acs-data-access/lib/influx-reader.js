
import {InfluxDB, flux} from '@influxdata/influxdb-client';

export class InfluxReader{
    constructor(opts){
        this.log = opts.debug.bound("influxReader");
        this.influx_bucket = opts.influx_bucket;
        this.influx_org = opts.influx_org;
        this.influx_query_api = opts.influx_client.getQueryApi(opts.influx_org);
    }

    async get_dataset_data(topLevelInstance, meta = {}) {
        const { from, to, measurement } = meta;

        // Build range
        const rangeClause = (from && to)
        ? `|> range(start: ${from}, stop: ${to})`
        : `|> range(start: -5m)`;

        // Optional measurement filter
        const measurementFilter = measurement
        ? `|> filter(fn: (r) => r._measurement == "${measurement}")`
        : ``;

        const query = `
        import "strings"

        from(bucket: "${this.influx_bucket}")
            ${rangeClause}
            |> filter(fn: (r) => r.topLevelInstance == "${topLevelInstance}")
            ${measurementFilter}
            |> drop(columns: [
            "_start","_stop","_field","table",
            "bottomLevelInstance","bottomLevelSchema",
            "group","node","topLevelSchema",
            "usesInstances","usesSchemas"
            ])
            |> map(fn: (r) => ({ r with path: if exists r.path then r.path else "" }))
            |> pivot(
            rowKey: ["_time"],
            columnKey: ["_measurement"],
            valueColumn: "_value"
            )
            |> group()
            |> sort(columns: ["_time"], desc: false)
        `;
        const res = await this._run_influx(query);
        return res;
    }

    async _run_min_max_time_agg(source_uuid, fn) {
        const query = `
            from(bucket: "${this.influx_bucket}")
            |> range(start: 0)
            |> filter(fn: (r) => r.topLevelInstance == "${source_uuid}")
            |> keep(columns: ["_time"])
            |> group()
            |> ${fn}(column: "_time")
        `;

        const rows = await this._run_influx(query);

        return rows?.[0]?._time ?? null;
    }

    async get_influx_time_bounds(topLevelInstance) {
        const [from, to] = await Promise.all([
            this._run_min_max_time_agg(topLevelInstance, "min"),
            this._run_min_max_time_agg(topLevelInstance, "max"),
        ]);

        return { from, to };
    }

    async _run_influx(query) {
        return new Promise((resolve, reject) => {
            const rows = [];

            this.influx_query_api.queryRows(query, {
            next: (row, tableMeta) => {
                rows.push(tableMeta.toObject(row));
            },
            error: reject,
            complete: () => resolve(rows)
            });
        });
    }
}
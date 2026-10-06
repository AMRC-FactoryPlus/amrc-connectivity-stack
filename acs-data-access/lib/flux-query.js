/*
 * ACS Data Access Service
 * Flux query construction for resolved dataset sources
 * Copyright 2026 University of Sheffield
 */

import { flux, fluxExpression } from "@influxdata/influxdb-client";

/* The most metric predicates ORed into one Flux filter. A source with
 * more metrics than this is read with several queries. */
export const MAX_PREDICATES = 100;

const START = "1970-01-01T00:00:00Z";
const STOP = "2100-01-01T00:00:00Z";

/* The historians append one of these to every measurement name. */
const TYPE_SUFFIX = ":[iudbs]";

function escape_rx (str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Matches a measurement by its metric name.
 * @param name The metric name, with or without a type suffix.
 * @param suffixed True if `name` never carries a suffix, so one is
 *  required; false to accept the name as given or with a suffix.
 */
function measurement_rx (name, suffixed) {
    const suffix = suffixed ? TYPE_SUFFIX : `(${TYPE_SUFFIX})?`;
    return new RegExp(`^${escape_rx(name)}${suffix}$`);
}

function metric_predicate ({ path, name }) {
    const rx = measurement_rx(name, true);

    /* Metrics at the device root are written with no path tag at all,
     * not an empty one. */
    return path == null
        ? flux`(not exists r.path and r._measurement =~ ${rx})`
        : flux`(r.path == ${path} and r._measurement =~ ${rx})`;
}

function chunks (list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size)
        out.push(list.slice(i, i + size));
    return out;
}

/** Builds the Flux queries that read one resolved dataset source.
 *
 * @param opts.bucket The InfluxDB bucket.
 * @param opts.source A resolved leaf: { device_uuid, from, to, metrics? }.
 *  `metrics` is absent for a whole-device source. For a sub-device it is
 *  a list of { path, name }, and an empty list reads nothing.
 * @param opts.measurement Optional single metric name requested by the
 *  client, with or without its type suffix.
 * @returns {Array} ParameterizedQuery objects; empty if there is
 *  nothing to read.
 */
export function source_queries ({ bucket, source, measurement }) {
    const { metrics } = source;
    if (metrics && metrics.length == 0) return [];

    const measurement_filter = measurement
        ? flux`|> filter(fn: (r) => r._measurement =~ ${measurement_rx(measurement, false)})`
        : fluxExpression("");

    const query = metric_filter => flux`
        from(bucket: ${bucket})
            |> range(start: time(v: ${source.from ?? START}), stop: time(v: ${source.to ?? STOP}))
            |> filter(fn: (r) => r.topLevelInstance == ${source.device_uuid})
            ${metric_filter}
            ${measurement_filter}
            |> keep(columns: ["_time", "_value", "_measurement", "device", "unit"])
    `;

    if (!metrics) return [query(fluxExpression(""))];

    return chunks(metrics, MAX_PREDICATES).map(chunk => {
        const predicates = chunk.map(m => metric_predicate(m).toString());
        return query(flux`|> filter(fn: (r) => ${fluxExpression(predicates.join(" or "))})`);
    });
}

/*
 * ACS Data Access Service
 * Helpers for building Flux queries from untrusted values.
 */

/* The datatype suffixes the historians append to every measurement name
 * on write (int, uint, double, boolean, string). See strip_metric_suffix
 * in utils.js. */
export const METRIC_SUFFIXES = ["i", "u", "d", "b", "s"];

/** Quote a value as a Flux string literal.
 *
 * Flux string literals treat `\` and `"` as special, and `${` starts an
 * interpolation. All three are escaped, and so are newline, carriage
 * return and tab, so that the literal stays on one line. Backslashes are
 * escaped first so the escapes added later are not doubled.
 *
 * @param {*} value Any value; it is converted with String().
 * @returns {string} A complete Flux string literal, including the quotes.
 */
export function flux_string(value) {
    const escaped = String(value)
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\$\{/g, "\\${")
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t");

    return `"${escaped}"`;
}

/* One clause per suffix, so that the filter stays a plain chain of
 * equality tests on _measurement (which Influx can push down to
 * storage, unlike contains()). */
function measurement_clause(name) {
    const tests = METRIC_SUFFIXES.map(sfx =>
        `r._measurement == ${flux_string(`${name}:${sfx}`)}`);

    return `(${tests.join(" or ")})`;
}

/** Split a metric selector into its path and name.
 *
 * The historians store a Sparkplug metric `a/b/c` as measurement `c:x`
 * with the tag `path` set to `a/b`. A selector with no `/` has a null
 * path and matches the name at any path.
 */
export function split_metric(selector) {
    const at = selector.lastIndexOf("/");
    if (at < 0) return { path: null, name: selector };
    return {
        path: selector.substring(0, at),
        name: selector.substring(at + 1),
    };
}

/** Build the Flux predicate body for a list of metric selectors.
 *
 * @param {string[]} metrics Validated selectors (see parse_download_filter).
 * @returns {string} A boolean Flux expression over `r`.
 */
export function metrics_predicate(metrics) {
    const clauses = metrics.map(selector => {
        const { path, name } = split_metric(selector);
        const by_name = measurement_clause(name);

        if (path == null) return by_name;
        return `(r.path == ${flux_string(path)} and ${by_name})`;
    });

    return clauses.join("\n                        or ");
}

/** Build the Flux query that exports one device source.
 *
 * @param {object} opts
 * @param {string} opts.bucket Influx bucket name.
 * @param {object} opts.source `{ device_uuid, from, to }`.
 * @param {object} [opts.filter] `{ metrics }` or `{ measurement }`.
 * @returns {string} The Flux query.
 */
export function build_flux_query({ bucket, source, filter = {} }) {
    const start = source.from ?? "1970-01-01T00:00:00Z";
    const stop = source.to ?? "2100-01-01T00:00:00Z";

    let metricFilter = "";

    if (filter.metrics?.length) {
        metricFilter = `
            |> filter(
                fn: (r) =>
                        ${metrics_predicate(filter.metrics)}
            )
        `;
    }
    else if (filter.measurement) {
        metricFilter = `
            |> filter(
                fn: (r) =>
                    r._measurement ==
                    ${flux_string(filter.measurement)}
            )
        `;
    }

    return `
            from(bucket: ${flux_string(bucket)})

            |> range(
                start: time(v: ${flux_string(start)}),
                stop: time(v: ${flux_string(stop)})
            )

            ${metricFilter}

            |> filter(
                fn: (r) =>
                    r.topLevelInstance ==
                    ${flux_string(source.device_uuid)}
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

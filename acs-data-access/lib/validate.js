/*
 * ACS Data Access service
 * Data validation routines
 */

export const UUID_rx = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const KRB_rx = /^[a-zA-Z0-9_./-]+@[A-Za-z0-9-.]+$/;

export const booleans = {
    undefined: false,
    "true": true, "false": false,
    "1": true, "0": false,
    on: true, off: false,
    yes: true, no: false,
};

export function valid_uuid(uuid) {
    if (UUID_rx.test(uuid))
        return true;
    //debug.log("debug", `Ignoring invalid UUID [${uuid}]`);
    return false;
}

export function valid_krb(krb) {
    if (KRB_rx.test(krb))
        return true;
    //debug.log("debug", `Ignoring invalid principal [${krb}]`);
    return false;
}

export function valid_grant (grant) {
    if (!valid_uuid(grant.principal)) return false;
    if (!valid_uuid(grant.permission)) return false;
    if (!valid_uuid(grant.target)) return false;
    return (grant.plural === true || grant.plural === false);
}


export function valid_datetime(datetime_str){
    // 1. Check the exact string format using RegEx
    const regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    if (!regex.test(datetime_str)) return false;

    // 2. Check if the calendar date and time are physically valid
    const timestamp = Date.parse(datetime_str);
    if (isNaN(timestamp)) return false;

    // 3. Ensure it matches the original string (prevents date rolling like Feb 30 -> Mar 2)
    return new Date(timestamp).toISOString() === datetime_str;
}

/* Limits on the metric filter in a download request body. */
export const MAX_METRICS = 100;
export const MAX_METRIC_LENGTH = 512;

const CONTROL_rx = /[\u0000-\u001f\u007f]/;
/* The datatype suffix the historian appends to measurement names. */
const SUFFIX_rx = /:[iudbs]$/;

/* Returns an error message, or null if the selector is acceptable. */
function metric_selector_error(value, field) {
    if (typeof value !== "string")
        return `${field} must be a string`;
    if (value.length === 0)
        return `${field} must not be empty`;
    if (value.length > MAX_METRIC_LENGTH)
        return `${field} is longer than ${MAX_METRIC_LENGTH} characters`;
    if (CONTROL_rx.test(value))
        return `${field} contains control characters`;
    return null;
}

/** Validate the optional filter in a `POST v1/data/:uuid` body.
 *
 * Accepts `{ metrics: [string] }` or the deprecated `{ measurement:
 * string }`, not both. An absent, null or empty `measurement` is
 * ignored, as before.
 *
 * @returns `{ filter }` on success, where `filter` is undefined for an
 * unfiltered export, or `{ error }` describing why the body is invalid.
 */
export function parse_download_filter(body) {
    if (body == null) return { filter: undefined };
    if (typeof body !== "object" || Array.isArray(body))
        return { error: "Request body must be a JSON object" };

    const { metrics, measurement } = body;
    const has_measurement = measurement != null && measurement !== "";

    if (metrics !== undefined) {
        if (has_measurement)
            return { error: "Use either metrics or measurement, not both" };
        if (!Array.isArray(metrics))
            return { error: "metrics must be an array of strings" };
        if (metrics.length === 0)
            return { error: "metrics must not be empty" };
        if (metrics.length > MAX_METRICS)
            return { error: `metrics has more than ${MAX_METRICS} entries` };

        for (const [i, m] of metrics.entries()) {
            const err = metric_selector_error(m, `metrics[${i}]`);
            if (err) return { error: err };

            if (m.startsWith("/") || m.endsWith("/") || m.includes("//"))
                return { error: `metrics[${i}] has an empty path segment` };

            if (SUFFIX_rx.test(m))
                return { error: `metrics[${i}] ends in a datatype suffix; `
                    + "selectors never include the :i/:u/:d/:b/:s suffix, "
                    + "every suffix is matched" };
        }

        return { filter: { metrics: [...new Set(metrics)] } };
    }

    if (has_measurement) {
        const err = metric_selector_error(measurement, "measurement");
        if (err) return { error: err };
        return { filter: { measurement } };
    }

    return { filter: undefined };
}

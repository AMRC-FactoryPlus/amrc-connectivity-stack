import { APIError } from "@amrc-factoryplus/service-api";
export function fail(log, status, message) {
    log(message);
    throw new APIError(status);
}

/** A refusal the client can act on.
 *
 * fail() throws an APIError, which WebAPI answers with the status text
 * alone. A Refusal carries a JSON body `{ error, message, ...extra }`
 * with a stable machine-readable `error` code. The route that catches
 * it sends that body; see APIv1#send_refusal.
 */
export class Refusal extends Error {
    constructor(status, error, message, extra = {}) {
        super(message);
        this.status = status;
        this.body = { error, message, ...extra };
    }
}

/** Logs and throws a Refusal. */
export function refuse(log, status, error, message, extra) {
    log(message);
    throw new Refusal(status, error, message, extra);
}


export function csv_escape(value) {
    if (value == null) return "";

    const str = String(value);

    if (
        str.includes(",") ||
        str.includes('"') ||
        str.includes("\n")
    ) {
        return `"${str.replace(/"/g, '""')}"`;
    }

    return str;
}


// historian-sparkplug and historian-uns append ":i"/":u"/":d"/":b"/":s"
// (int/uint/double/boolean/string) to every measurement name on write, per
// the Sparkplug datatype switch in their mqttclient.ts. Strip it back off
// for display.
export function strip_metric_suffix(value) {
    if (value == null) return value;

    return String(value).replace(/:[iudbs]$/, "");
}

/** The full Sparkplug metric name of an Influx row.
 *
 * The historians split a metric `a/b/c` into the `path` tag `a/b` and
 * the measurement `c:x`. A metric at the device root has an empty path,
 * which Influx does not store, so the row has no `path` at all. The
 * result is a full-path selector for the download's `metrics` filter.
 *
 * @param {string} [path] The row's `path` tag, if any.
 * @param {string} measurement The row's `_measurement`, with its suffix.
 * @returns {string} The metric name, e.g. `Axes/X/Actual`.
 */
export function metric_path(path, measurement) {
    const name = strip_metric_suffix(measurement);
    if (path == null || path === "") return name;
    return `${path}/${name}`;
}

/** The `device` and `path` columns of a CSV row.
 *
 * A row from the `default` bucket has a `device` tag (the Sparkplug
 * device ID) and a `path` tag relative to the device. A row from the
 * `uns` bucket has no `device` tag; its `path` is the Sparkplug device
 * ID, then the folder. Both give the same columns.
 *
 * @param {object} row The Influx row, with `device`, `path` and
 *   `_measurement`.
 * @param {string} [store] The source's store, `sparkplug` or `uns`.
 * @returns {{device: string, path: string}}
 */
export function csv_device_path(row, store) {
    if (store != "uns")
        return { device: row.device, path: metric_path(row.path, row._measurement) };

    const p = row.path ?? "";
    const at = p.indexOf("/");
    const device = at < 0 ? p : p.slice(0, at);
    const folder = at < 0 ? null : p.slice(at + 1);
    return { device, path: metric_path(folder, row._measurement) };
}


// const toTime = d => d ? new Date(d).getTime() : null;

export function maxDate(a, b) {

  if (!a) return b
  if (!b) return a

  return new Date(a) > new Date(b)
    ? a
    : b
}

export function minDate(a, b) {

  if (!a) return b
  if (!b) return a

  return new Date(a) < new Date(b)
    ? a
    : b
}



/** Express error middleware for request bodies the JSON parser
 * refused. It answers in the same JSON shape as the series route's
 * errors, instead of the generic 500 text reply. Other errors pass on. */
export function body_errors(err, req, res, next) {
    if (res.headersSent) return next(err);
    if (err?.type == "entity.parse.failed")
        return res.status(400).json({
            error: "bad_request", message: "The body is not valid JSON." });
    if (err?.type == "entity.too.large")
        return res.status(413).json({
            error: "too_large", message: "The body is too large.",
            ...(err.limit ? { limit: err.limit } : {}) });
    if (err?.type == "encoding.unsupported" || err?.type == "charset.unsupported")
        return res.status(415).json({
            error: "unsupported_media_type", message: err.message });
    return next(err);
}

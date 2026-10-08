import { APIError } from "@amrc-factoryplus/service-api";
export function fail(log, status, message) {
    log(message);
    throw new APIError(status);
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

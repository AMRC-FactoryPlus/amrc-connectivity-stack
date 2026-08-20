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


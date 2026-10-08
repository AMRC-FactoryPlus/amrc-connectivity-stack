/*
 * ACS Data Access Service
 * Unit tests for the metric filter on POST v1/data/:uuid.
 *
 * These run against fakes, so they need no cluster.
 */

import { Map as IMap } from "immutable";
import * as rx from "rxjs";
import { PassThrough } from "stream";
import { describe, expect, test } from "vitest";
import { fluxString } from "@influxdata/influxdb-client";

import { APIv1 } from "../../lib/api-v1.js";
import { DataAccess as Constants } from "../../lib/constants.js";
import { InfluxReader } from "../../lib/influx-reader.js";
import { build_flux_query, flux_string } from "../../lib/flux.js";
import {
  MAX_METRICS, MAX_METRIC_LENGTH, parse_download_filter,
} from "../../lib/validate.js";

const DATASET = "11111111-1111-1111-1111-111111111111";
const DEVICE = "55555555-5555-5555-5555-555555555555";

const HOSTILE = [
  'a"b',
  "back\\slash",
  "trailing\\",
  "${r._value}",
  'x") |> drop(columns: ["_value"]) |> yield(name: "y',
  '\\") or true or ("',
  "tab\there",
];

/* Undo flux_string, following the Flux string literal grammar. Returns
 * null if the literal is malformed: an unescaped quote or `${` inside it,
 * an unknown escape, or a raw newline. */
function parse_flux_string(lit) {
  if (!lit.startsWith('"') || !lit.endsWith('"')) return null;
  const body = lit.slice(1, -1);
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"' || c === "\n" || c === "\r") return null;
    if (c === "$" && body[i + 1] === "{") return null;
    if (c !== "\\") { out += c; continue; }
    const n = body[++i];
    if (n === "n") out += "\n";
    else if (n === "r") out += "\r";
    else if (n === "t") out += "\t";
    else if (n === "\\" || n === '"') out += n;
    else if (n === "$" && body[i + 1] === "{") { out += "${"; i++; }
    else return null;
  }
  return out;
}

/* Every string literal in a Flux query, scanned with the same rules. */
function flux_literals(query) {
  const lits = [];
  let i = 0;
  while (i < query.length) {
    if (query[i] !== '"') { i++; continue; }
    let j = i + 1;
    while (j < query.length && query[j] !== '"') j += query[j] === "\\" ? 2 : 1;
    lits.push(query.slice(i, j + 1));
    i = j + 1;
  }
  return lits;
}

describe("flux_string", () => {
  test.each([...HOSTILE, "line\nbreak", "cr\rhere", "plain", ""])(
    "round-trips %j", value => {
      const lit = flux_string(value);
      expect(parse_flux_string(lit)).toBe(value);
    });

  test.each([...HOSTILE, "line\nbreak", "cr\rhere"])(
    "matches the Influx client's own escaping for %j", value => {
      expect(flux_string(value)).toBe(fluxString(value).toString());
    });
});

describe("build_flux_query", () => {
  const source = { device_uuid: DEVICE, from: null, to: null };

  test("has no metric filter without a filter", () => {
    const q = build_flux_query({ bucket: "b", source });
    expect(q).not.toContain("_measurement ==");
    expect(q).toContain(`r.topLevelInstance ==\n                    "${DEVICE}"`);
  });

  test("a name selector matches every datatype suffix at any path", () => {
    const q = build_flux_query({
      bucket: "b", source, filter: { metrics: ["Temperature"] } });
    for (const sfx of ["i", "u", "d", "b", "s"])
      expect(q).toContain(`r._measurement == "Temperature:${sfx}"`);
    expect(q).not.toContain("r.path");
  });

  test("a path selector also matches the path tag", () => {
    const q = build_flux_query({
      bucket: "b", source, filter: { metrics: ["Axis/X/Position"] } });
    expect(q).toContain('(r.path == "Axis/X" and (r._measurement == "Position:i"');
  });

  test("several selectors are or-ed together", () => {
    const q = build_flux_query({
      bucket: "b", source, filter: { metrics: ["A/B", "C"] } });
    expect(q).toMatch(/\(r\.path == "A" and \(.*\)\)\s+or \(r\._measurement == "C:i"/s);
  });

  test.each(HOSTILE)("escapes hostile selector %j", hostile => {
    const metrics = [hostile, `Folder/${hostile}`, `${hostile}/Name`];
    const q = build_flux_query({ bucket: "b", source, filter: { metrics } });

    /* Every literal is well formed and the query has exactly the literals
     * the builder meant to write: bucket, start, stop, device, the five
     * kept column names, plus five
     * per name selector and six per path selector. */
    const lits = flux_literals(q);
    expect(lits.every(l => parse_flux_string(l) !== null)).toBe(true);
    expect(lits.length).toBe(4 + 5 + 5 + 6 + 6);

    const values = lits.map(parse_flux_string);
    expect(values).toContain(`${hostile}:d`);
    expect(values).toContain(`Folder`);

    /* The hostile text never reaches the query outside a literal. */
    let outside = q;
    for (const l of lits) outside = outside.replace(l, '""');
    expect(outside).not.toContain("drop(");
    expect(outside).not.toContain("yield(");
    expect(outside).not.toContain("${");
    expect(outside).not.toMatch(/or true/);
  });

  test.each(HOSTILE)("escapes hostile measurement %j", hostile => {
    const q = build_flux_query({
      bucket: "b", source, filter: { measurement: hostile } });
    const lits = flux_literals(q);
    expect(lits.every(l => parse_flux_string(l) !== null)).toBe(true);
    expect(lits.map(parse_flux_string)).toContain(hostile);
    expect(lits.length).toBe(4 + 5 + 1);
  });

  test("escapes the device and time range too", () => {
    const q = build_flux_query({
      bucket: 'bu"cket',
      source: { device_uuid: 'd") |> drop(', from: "2024\\", to: "${x}" },
    });
    const values = flux_literals(q).map(parse_flux_string);
    expect(values).toEqual(['bu"cket', "2024\\", "${x}", 'd") |> drop(', "_time",
      "_value", "_measurement", "device", "unit"]);
  });
});

describe("parse_download_filter", () => {
  test.each([undefined, null, {}, { measurement: "" }, { measurement: null }])(
    "treats %j as unfiltered", body => {
      expect(parse_download_filter(body)).toEqual({ filter: undefined });
    });

  test("accepts metrics and removes duplicates", () => {
    expect(parse_download_filter({ metrics: ["A/B", "C", "A/B"] }))
      .toEqual({ filter: { metrics: ["A/B", "C"] } });
  });

  test("accepts hostile but printable selectors, for escaping later", () => {
    expect(parse_download_filter({ metrics: HOSTILE.slice(0, 5) }).error)
      .toBeUndefined();
  });

  test("keeps the deprecated measurement", () => {
    expect(parse_download_filter({ measurement: "Temp:d" }))
      .toEqual({ filter: { measurement: "Temp:d" } });
  });

  test.each([
    ["a non-object body", "metrics"],
    ["an array body", []],
    ["metrics not an array", { metrics: "A" }],
    ["empty metrics", { metrics: [] }],
    ["a number entry", { metrics: ["A", 7] }],
    ["a null entry", { metrics: [null] }],
    ["an object entry", { metrics: [{ path: "A" }] }],
    ["an empty entry", { metrics: [""] }],
    ["an overlong entry", { metrics: ["x".repeat(MAX_METRIC_LENGTH + 1)] }],
    ["too many entries", {
      metrics: Array.from({ length: MAX_METRICS + 1 }, (_, i) => `m${i}`) }],
    ["a newline", { metrics: ["a\nb"] }],
    ["a NUL", { metrics: ["a\u0000b"] }],
    ["a leading slash", { metrics: ["/A"] }],
    ["a trailing slash", { metrics: ["A/"] }],
    ["a double slash", { metrics: ["A//B"] }],
    ["both fields", { metrics: ["A"], measurement: "A:d" }],
    ["a name with a suffix", { metrics: ["Position:d"] }],
    ["a path with a suffix", { metrics: ["Axis/X/Position:s"] }],
    ["a later entry with a suffix", { metrics: ["A", "B:i"] }],
    ["a non-string measurement", { measurement: 7 }],
    ["an array measurement", { measurement: ["A"] }],
    ["an overlong measurement", { measurement: "x".repeat(MAX_METRIC_LENGTH + 1) }],
    ["a measurement with a newline", { measurement: "a\nb" }],
  ])("rejects %s", (_, body) => {
    expect(parse_download_filter(body).error).toEqual(expect.any(String));
  });

  test("explains a suffixed selector", () => {
    expect(parse_download_filter({ metrics: ["Position:d"] }).error)
      .toMatch(/metrics\[0\].*suffix/);
  });

  test.each(["Ratio:x", "Mode:", "a:b/Name", "Position:dd", "Clock:12"])(
    "accepts %j, which is not a suffix", m => {
      expect(parse_download_filter({ metrics: [m] }).error).toBeUndefined();
    });

  test("ignores an empty measurement next to metrics", () => {
    expect(parse_download_filter({ metrics: ["A"], measurement: "" }))
      .toEqual({ filter: { metrics: ["A"] } });
  });

  test("accepts exactly the maximum", () => {
    const metrics = Array.from({ length: MAX_METRICS }, (_, i) => `m${i}`);
    metrics[0] = "x".repeat(MAX_METRIC_LENGTH);
    expect(parse_download_filter({ metrics }).error).toBeUndefined();
  });
});

/* An APIv1 with one Sparkplug source dataset and a fake Influx client
 * that records the queries it is given. */
function make_api() {
  const queries = [];
  const influx_client = {
    getQueryApi() {
      return {
        response(query) {
          queries.push(query);
          return {
            async *iterateRows() {
              const values = ["Dev", "Temp:d", "2024-01-01T00:00:00Z", 1, "C"];
              yield {
                values,
                tableMeta: {
                  toObject: () => ({
                    device: "Dev", _measurement: "Temp:d",
                    _time: "2024-01-01T00:00:00Z", _value: 1, unit: "C",
                  }),
                },
              };
            },
          };
        },
      };
    },
  };

  const influxReader = new InfluxReader({
    debug: { bound: () => () => {} },
    influx_bucket: "bucket",
    influx_org: "org",
    influx_client,
  });

  const datasets = {
    [DATASET]: {
      structure: Constants.App.SparkplugSrc,
      config: { source: DEVICE },
    },
  };

  const api = new APIv1({
    data: { datasets: rx.of(IMap(datasets)) },
    auth: { async check_acl() { return true; } },
    cdb: {},
    debug: { bound: () => () => {} },
    influxReader,
  });

  return { api, queries };
}

/* A writable response double that collects the CSV. */
function make_res() {
  const res = new PassThrough();
  res.code = 200;
  res.body = null;
  res.headers = {};
  res.status = function (code) { this.code = code; return this; };
  res.json = function (body) { this.body = body; this.end(); return this; };
  res.setHeader = function (k, v) { this.headers[k] = v; };
  res.text = new Promise(resolve => {
    let s = "";
    res.on("data", c => s += c);
    res.on("end", () => resolve(s));
  });
  return res;
}

async function post(api, body) {
  const res = make_res();
  await api.dataset_data(
    { params: { uuid: DATASET }, auth: "tester", body }, res);
  const text = await res.text;
  return { res, text };
}

describe("dataset_data", () => {
  test("returns 422 for a suffixed selector", async () => {
    const { api, queries } = make_api();
    const { res } = await post(api, { metrics: ["Folder/Temp:d"] });
    expect(res.code).toBe(422);
    expect(res.body.error).toMatch(/suffix/);
    expect(queries).toEqual([]);
  });

  test("returns 422 with a reason for an invalid filter", async () => {
    const { api, queries } = make_api();
    const { res } = await post(api, { metrics: [42] });
    expect(res.code).toBe(422);
    expect(res.body.error).toMatch(/metrics\[0\]/);
    expect(queries).toEqual([]);
  });

  test("streams the unchanged CSV header and rows", async () => {
    const { api } = make_api();
    const { res, text } = await post(api, {});
    expect(res.code).toBe(200);
    expect(text).toBe(
      "device,metric,timestamp,value,unit\nDev,Temp,2024-01-01T00:00:00Z,1,C\n");
  });

  test("passes a metrics filter to Influx", async () => {
    const { api, queries } = make_api();
    await post(api, { metrics: ["Folder/Temp", 'x"y'] });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('r.path == "Folder"');
    expect(queries[0]).toContain('r._measurement == "Temp:d"');
    expect(queries[0]).toContain('r._measurement == "x\\"y:s"');
  });

  test("still honours the deprecated measurement, escaped", async () => {
    const { api, queries } = make_api();
    await post(api, { measurement: 'Temp:d") |> drop(columns: ["_value"])' });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain(
      'r._measurement ==\n                    "Temp:d\\") |> drop(columns: [\\"_value\\"])"');
  });
});

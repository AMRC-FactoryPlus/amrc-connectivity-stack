/*
 * ACS Data Access Service
 * Unit tests for the path column of the CSV download.
 *
 * These run against fakes, so they need no cluster.
 */

import { describe, expect, test } from "vitest";

import { InfluxReader } from "../../lib/influx-reader.js";
import { build_flux_query, MAX_SUBSET_CLAUSES } from "../../lib/flux.js";
import { metric_path } from "../../lib/utils.js";
import { parse_download_filter } from "../../lib/validate.js";

const DEVICE = "55555555-5555-5555-5555-555555555555";
const TIME = "2024-01-01T00:00:00Z";

/* An Influx row as the query API returns it. A row with no `path` key
 * is a metric at the device root, where the historian writes no tag. */
function row(measurement, path, extra = {}) {
    const o = {
        device: "Dev", _measurement: measurement,
        _time: TIME, _value: 1, unit: "mm", ...extra,
    };
    if (path !== undefined) o.path = path;
    return o;
}

/* An InfluxReader whose fake query API answers each query with the
 * next list of rows. */
function make_reader(answers) {
    const queries = [];
    const influx_client = {
        getQueryApi() {
            return {
                response(query) {
                    const rows = answers[queries.length] ?? [];
                    queries.push(query);
                    return {
                        async *iterateRows() {
                            for (const o of rows)
                                yield { values: [], tableMeta: { toObject: () => o } };
                        },
                    };
                },
            };
        },
    };

    const reader = new InfluxReader({
        debug: { bound: () => () => {} },
        influx_bucket: "bucket",
        influx_org: "org",
        influx_client,
    });

    return { reader, queries };
}

async function export_csv(reader, sources) {
    let text = "";
    for await (const chunk of reader.exportDevices(sources))
        text += chunk;
    return text.split("\n").filter(l => l != "");
}

describe("metric_path", () => {
    test("joins the path tag and the measurement name", () => {
        expect(metric_path("Axes/X/Position_Indirect", "Actual:d"))
            .toBe("Axes/X/Position_Indirect/Actual");
    });

    test("a metric at the device root is its name", () => {
        expect(metric_path(undefined, "Switch_Closed:b")).toBe("Switch_Closed");
        expect(metric_path(null, "Switch_Closed:b")).toBe("Switch_Closed");
        expect(metric_path("", "Switch_Closed:b")).toBe("Switch_Closed");
    });

    test("the result is a valid full-path selector", () => {
        const path = metric_path("Axes/X", "Actual:i");
        expect(parse_download_filter({ metrics: [path] }).error).toBeUndefined();
    });
});

describe("CSV path column", () => {
    test("the header ends with path", async () => {
        const { reader } = make_reader([[]]);
        const [header] = await export_csv(reader, [{ device_uuid: DEVICE }]);
        expect(header).toBe("device,metric,timestamp,value,unit,path");
    });

    test("a top-level metric has its name as its path", async () => {
        const { reader } = make_reader([[row("Switch_Closed:b")]]);
        const [, line] = await export_csv(reader, [{ device_uuid: DEVICE }]);
        expect(line).toBe(`Dev,Switch_Closed,${TIME},1,mm,Switch_Closed`);
    });

    test("a nested metric has its full name as its path", async () => {
        const { reader } = make_reader([[
            row("Actual:d", "Axes/A_LF/Base_Axis/Feedrate"),
        ]]);
        const [, line] = await export_csv(reader, [{ device_uuid: DEVICE }]);
        expect(line).toBe(
            `Dev,Actual,${TIME},1,mm,Axes/A_LF/Base_Axis/Feedrate/Actual`);
    });

    test("tells apart two metrics with the same name", async () => {
        const { reader } = make_reader([[
            row("Actual:d", "Axes/X/Position_Indirect"),
            row("Actual:d", "Axes/A_LF/Base_Axis/Feedrate"),
        ]]);
        const [, a, b] = await export_csv(reader, [{ device_uuid: DEVICE }]);
        expect(a.split(",")[1]).toBe("Actual");
        expect(b.split(",")[1]).toBe("Actual");
        expect(a.split(",")[5]).toBe("Axes/X/Position_Indirect/Actual");
        expect(b.split(",")[5]).toBe("Axes/A_LF/Base_Axis/Feedrate/Actual");
    });

    test("escapes a path with a comma or a quote", async () => {
        const { reader } = make_reader([[
            row("Temp:d", 'Zone,1/Sensor "A"'),
        ]]);
        const [, line] = await export_csv(reader, [{ device_uuid: DEVICE }]);
        expect(line).toBe(
            `Dev,Temp,${TIME},1,mm,"Zone,1/Sensor ""A""/Temp"`);
    });

    test("keeps the path column in the Flux query", () => {
        const q = build_flux_query({
            bucket: "bucket", source: { device_uuid: DEVICE } });
        const keep = q.match(/keep\(columns: \[([^\]]*)\]\)/s)[1];
        expect(keep).toContain("\"path\"");
        expect(q).not.toMatch(/drop\(/);
    });

    test("every query of a large sub-device keeps the path", async () => {
        const metrics = Array.from({ length: MAX_SUBSET_CLAUSES + 1 },
            (_, i) => ({ path: i ? "Axes/X" : null, name: `M${i}` }));
        const { reader, queries } = make_reader([
            [row("M0:d")],
            [row(`M${MAX_SUBSET_CLAUSES}:d`, "Axes/X")],
        ]);

        const [, a, b] = await export_csv(reader,
            [{ device_uuid: DEVICE, metrics }]);

        expect(queries).toHaveLength(2);
        for (const q of queries)
            expect(q).toMatch(/keep\(columns: \[[^\]]*"path"/s);
        expect(a.split(",")[5]).toBe("M0");
        expect(b.split(",")[5]).toBe(`Axes/X/M${MAX_SUBSET_CLAUSES}`);
    });
});

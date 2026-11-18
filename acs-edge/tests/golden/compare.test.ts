/*
 * ACS Edge Agent
 * Golden-output harness: the comparison reports each kind of difference
 * Copyright 2026 University of Sheffield
 */

import { CaptureClient, decode } from "./capture.js";
import type { Metric, Output } from "./capture.js";
import { compare, Run } from "./compare.js";

const T0 = 1_000_000;

function metric (name: string, value: string, at_ms: number, type = "Float"): Metric {
    return { name, type, value, ts_ns: BigInt(T0 + at_ms) * 1_000_000n };
}

function run (label: string, data: { [k: string]: Metric[] }, birth?: Metric[]): Run {
    const output: Output = {
        births: new Map([["DBIRTH Dev", [birth ?? [metric("M", "null", 0)]]]]),
        data: new Map(Object.entries(data)),
        counts: new Map(),
    };
    return { label, output, t0: T0 };
}

describe("compare", () => {
    const base = { "Dev/M": [metric("M", "1", 0), metric("M", "2", 200)] };

    it("passes identical output and counts the values", () => {
        const c = compare(run("a", base), run("b", base));
        expect(c.diffs).toEqual([]);
        expect(c.values).toBe(2);
    });

    it("allows timing differences up to the allowance", () => {
        const late = { "Dev/M": [metric("M", "1", 40), metric("M", "2", 260)] };
        expect(compare(run("a", base), run("b", late), { allowance_ms: 100 }).ok).toBe(true);
        const c = compare(run("a", base), run("b", late), { allowance_ms: 50 });
        expect(c.ok).toBe(false);
        expect(c.diffs[0]).toContain("DDATA Dev/M (Float)");
        expect(c.diffs[0]).toContain("time (60 ms apart, allowance 50 ms)");
    });

    it("reports a changed type, a missing value and an extra value", () => {
        const other = { "Dev/M": [metric("M", "1", 0, "Double")] };
        const c = compare(run("a", base), run("b", other));
        expect(c.diffs[0]).toContain("2 value(s) from a, 1 from b");
        expect(c.diffs[0]).toMatch(/<-- type/);
        expect(c.diffs[0]).toMatch(/<-- missing in b/);
    });

    it("reports a metric only one run published", () => {
        const c = compare(run("a", base), run("b", { ...base, "Dev/N": [metric("N", "5", 0)] }));
        expect(c.diffs).toHaveLength(1);
        expect(c.diffs[0]).toContain("DDATA Dev/N");
        expect(c.diffs[0]).toContain("extra in b");
    });

    it("reports birth differences by metric name", () => {
        const c = compare(run("a", base), run("b", base, [metric("M", "null", 0, "Double")]));
        expect(c.diffs).toEqual([
            `DBIRTH Dev metric "M": type Float in a, Double in b`,
        ]);
    });
});

describe("decode", () => {
    const client = () => {
        const c = new CaptureClient();
        const birth = (value: number) => ({
            timestamp: Date.now(),
            metrics: [{ name: "M", type: "Float", value }],
        });
        return { c, birth };
    };

    it("leaves out a DBIRTH that repeats the one before it", () => {
        const { c, birth } = client();
        c.publishDeviceBirth("Dev", birth(1));
        c.publishDeviceBirth("Dev", birth(1));
        const out = decode(c.messages);
        expect(out.births.get("DBIRTH Dev")).toHaveLength(1);
        expect(out.repeated?.get("DBIRTH Dev")).toBe(1);
    });

    it("keeps a DBIRTH with different metrics or with data before it", () => {
        const { c, birth } = client();
        c.publishDeviceBirth("Dev", birth(1));
        c.publishDeviceBirth("Dev", birth(2));
        c.publishDeviceData("Dev", { timestamp: Date.now(), metrics: [{ name: "M", type: "Float", value: 3 }] });
        c.publishDeviceBirth("Dev", birth(2));
        const out = decode(c.messages);
        expect(out.births.get("DBIRTH Dev")).toHaveLength(3);
        expect(out.repeated?.get("DBIRTH Dev")).toBeUndefined();
    });
});

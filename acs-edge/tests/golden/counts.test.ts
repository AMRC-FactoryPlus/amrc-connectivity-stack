/*
 * ACS Edge Agent
 * Golden-output harness: DDATA message counts per device
 * Copyright 2026 University of Sheffield
 */

import { ddata_counts, ddata_excess, ddata_line, RunResult } from "./harness.js";

function run (label: string, counts: { [k: string]: number }): RunResult {
    return {
        label,
        output: { births: new Map(), data: new Map(), counts: new Map(Object.entries(counts)) },
    } as unknown as RunResult;
}

describe("DDATA counts", () => {
    const builtin = run("built-in", { "NBIRTH": 1, "DBIRTH A": 1, "DDATA A": 15, "DDATA B": 4 });

    it("are counted per device, DDATA only", () => {
        const split = run("split", { "DBIRTH A": 1, "DDATA A": 5, "DDATA C": 2 });
        expect(ddata_counts(builtin, split)).toEqual([
            { device: "A", a: 15, b: 5 },
            { device: "B", a: 4, b: 0 },
            { device: "C", a: 0, b: 2 },
        ]);
        expect(ddata_line(builtin, split))
            .toBe("DDATA per device (built-in / split): A 15 / 5, B 4 / 0, C 0 / 2");
    });

    it("may be lower from a split driver but not higher", () => {
        expect(ddata_excess(builtin, run("split", { "DDATA A": 5, "DDATA B": 4 }))).toEqual([]);
        expect(ddata_excess(builtin, run("split", { "DDATA A": 16, "DDATA B": 1 })))
            .toEqual(["DDATA A: 16 message(s) from split, more than the 15 from built-in"]);
    });
});

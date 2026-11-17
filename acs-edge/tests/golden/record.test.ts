/*
 * ACS Edge Agent
 * Golden-output harness: record the built-in connections' runs
 * Copyright 2026 University of Sheffield
 */

/* Runs only with GOLDEN_RECORD set. With GOLDEN_RECORD=check it writes
 * nothing, and instead compares a new built-in run with each recorded
 * one at the recorded run's speed, which shows a recorded run compares
 * as the run it came from did. With GOLDEN_RECORD=1, each
 * reference in references.ts is run through the built-in connection and
 * written to recorded/ (or GOLDEN_SNAPSHOTS). This only works while the Edge Agent still has its
 * built-in connections, which ACS 7 removes: this file is deleted with
 * them, and the runs it wrote are the reference from then on. */

import { compare_runs, merge_runs, run_agent, speed_for } from "./harness.js";
import { recorded, references } from "./references.js";
import { to_snapshot, write_snapshot } from "./snapshot.js";

jest.setTimeout(600_000);

const RECORD = !!process.env.GOLDEN_RECORD;
const REFS = RECORD ? references() : [];
const SOURCE = process.env.GOLDEN_RECORD_SOURCE ?? "built-in connection";

(RECORD ? describe : describe.skip)("record the built-in runs", () => {
    it.each(REFS.map(r => [r.key, r] as const))("%s", async (key, ref) => {
        const fixture = ref.fixture();
        const check = process.env.GOLDEN_RECORD == "check"
            ? recorded(key, fixture) : undefined;
        const speed = check?.speed ?? speed_for(fixture);
        /* Runs share the process's environment, so they go one after
         * another. */
        const runs = [];
        for (const opts of ref.runs)
            runs.push(await run_agent(fixture, { ...opts, speed }));
        const run = ref.merged ? merge_runs(runs, ref.merged) : runs[0];
        for (const r of runs)
            if (r.timed_out)
                throw new Error(`${key}: the built-in run timed out\n${r.log.slice(-4000)}`);
        if (check) {
            const c = compare_runs(check.run, run);
            process.stdout.write(`\n[${key}] ${c.summary}\n`);
            expect(c.comparison.ok ? "" : c.summary).toBe("");
            return;
        }
        write_snapshot(key, to_snapshot(run, {
            fixture:    fixture.meta.name,
            duration_ms: fixture.meta.duration_ms,
            speed,
            source:     SOURCE,
        }));
    });
});

if (!RECORD) it("records nothing without GOLDEN_RECORD", () => {});

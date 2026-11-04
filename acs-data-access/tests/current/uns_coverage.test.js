/*
 * ACS Data Access Service
 * Unit tests for the UNS bucket's own coverage summary.
 *
 * These run against fakes, so they need no cluster and no InfluxDB.
 */

import { describe, expect, test } from "vitest";

import { SeriesReader } from "../../lib/series-reader.js";
import { Coverage } from "../../lib/coverage-service.js";
import { DEVICE, FROM, TO, debug, make_api, make_res } from "../uns_fixtures.js";

/*
 * ---------------------------------------------------------------
 * The second coverage summary
 * ---------------------------------------------------------------
 */

describe("the UNS coverage summary", () => {
    test("has its own bucket and task names", () => {
        const main = new Coverage({ debug, org: "org", raw_bucket: "default", env: {} });
        const uns = new Coverage({ debug, org: "org", raw_bucket: "uns", suffix: "uns", env: {} });

        expect([main.bucket, main.task_name]).toEqual(["acs_coverage", "acs-coverage"]);
        expect([uns.bucket, uns.task_name]).toEqual(["acs_coverage_uns", "acs-coverage-uns"]);
        expect(uns.task_flux()).toContain(`from(bucket: "uns")`);
        expect(uns.task_flux()).toContain(`to(bucket: "acs_coverage_uns"`);
    });

    test("keeps a custom name's suffix", () => {
        const uns = new Coverage({ debug, raw_bucket: "uns", suffix: "uns",
            env: { COVERAGE_BUCKET: "summary", COVERAGE_TASK: "summary-task" } });
        expect([uns.bucket, uns.task_name]).toEqual(["summary_uns", "summary-task-uns"]);
    });

    test("waits for its raw bucket before it provisions anything", async () => {
        const made = [];
        const admin = {
            org_id: async () => "org1",
            find_bucket: async (org, name) => (name == "uns" ? null : { id: "b1" }),
            create_bucket: async (...a) => made.push(a),
        };
        const uns = new Coverage({ debug, admin, raw_bucket: "uns", suffix: "uns",
            wait_for_raw: true, env: {} });

        await expect(uns.ensure()).rejects.toThrow(/does not exist yet/);
        expect(made).toEqual([]);
    });

    test("counts read the summary of the store asked for", async () => {
        const seen = [];
        const query_api = {
            queryRows (query, consumer) {
                seen.push(query);
                setImmediate(() => consumer.complete());
            },
        };
        const state = { covered_from: -Infinity, summary_to: Date.parse(TO) };
        const summary = bucket => ({ bucket, read_state: () => state });
        const reader = new SeriesReader({ debug, query_api,
            buckets: { sparkplug: "default", uns: "uns" },
            coverages: { sparkplug: summary("acs_coverage"), uns: summary("acs_coverage_uns") } });

        const req = { from: Date.parse(FROM), to: Date.parse(TO), every: "1h", count: true };
        const groups = [{ devices: [DEVICE], windows: [[req.from, req.to]] }];
        await reader.counts(req, groups, new AbortController().signal,
            reader.coverage_state("uns"), "uns");

        expect(seen.length).toBeGreaterThan(0);
        expect(seen.every(q => q.includes(`from(bucket: "acs_coverage_uns")`))).toBe(true);
    });

    test("the status route reports both summaries", async () => {
        const status = name => ({ read_state: () => null,
            status: ({ detail }) => ({ name, detail }) });
        const { api } = make_api();
        api.seriesReader = new SeriesReader({ debug, query_api: {},
            buckets: { sparkplug: "default", uns: "uns" },
            coverages: { sparkplug: status("default"), uns: status("uns") } });
        api.auth.check_acl = async () => true;

        const res = make_res();
        await api.coverage_status({ auth: "tester" }, res);
        expect(res.body).toEqual({
            name: "default", detail: true,
            uns: { name: "uns", detail: true },
        });
    });
});

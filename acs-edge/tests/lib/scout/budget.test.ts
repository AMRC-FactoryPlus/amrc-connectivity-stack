/*
 * ACS Edge Agent
 * The CPU budget for scan work, and reading the cgroup's CPU limit
 * Copyright 2026 University of Sheffield
 */

import fs from "fs";
import os from "os";
import path from "path";

import { cgroup_cpu, CpuBudget, throttle_reader } from "../../../lib/scout-budget";

/* A clock and a CPU counter a test moves by hand, in µs. */
function fake () {
    const t = { now: 0, cpu: 0 };
    return {
        t,
        clock:  () => t.now,
        cpu:    () => t.cpu,
    };
}

describe("CpuBudget", () => {
    it("lets work run while the process is under its share, and holds it back when over", () => {
        const f = fake();
        const b = new CpuBudget({ cpus: 0.1, share: 0.5, burst_ms: 2, clock: f.clock, cpu: f.cpu });
        expect(b.rate).toBeCloseTo(0.05);
        expect(b.wait()).toBe(0);

        /* 5 ms of CPU in 10 ms of wall time is far over 5% of 0.1 CPU. */
        f.t.now += 10_000;
        f.t.cpu += 5_000;
        /* The bucket is 2.5 ms of CPU in debt, which takes 50 ms to
         * pay back at 5% of 0.1 CPU. */
        expect(b.wait()).toBe(50);

        f.t.now += 49_000;
        expect(b.wait()).toBe(5);
        f.t.now += 2_000;
        expect(b.wait()).toBe(0);
    });

    it("counts every CPU microsecond the process uses, not only the scan's", () => {
        const f = fake();
        const b = new CpuBudget({ cpus: 1, share: 0.5, burst_ms: 2, clock: f.clock, cpu: f.cpu });
        /* Data alone uses 60% of a CPU: no room for scan work. */
        for (let i = 0; i < 10; i++) {
            f.t.now += 10_000;
            f.t.cpu += 6_000;
        }
        expect(b.wait()).toBeGreaterThan(0);
    });

    it("keeps a burst small and a debt bounded, so waits are capped", () => {
        const f = fake();
        const b = new CpuBudget({ cpus: 0.1, share: 0.5, burst_ms: 2, clock: f.clock, cpu: f.cpu });
        f.t.now += 60_000_000;
        expect(b.tokens).toBe(2_000);
        f.t.cpu += 60_000_000;
        expect(b.tokens).toBe(b.floor);
        expect(b.wait()).toBe(b.max_wait);
    });

    it("holds scan work off for a CFS period after the kernel throttled the process", () => {
        const f = fake();
        let throttled: number | null = 7;
        const b = new CpuBudget({ cpus: 0.1, share: 0.5, clock: f.clock, cpu: f.cpu,
            throttled: () => throttled });
        expect(b.wait()).toBe(0);
        throttled = 8;
        f.t.now += 1_000;
        expect(b.wait()).toBe(100);
        f.t.now += 60_000;
        expect(b.wait()).toBe(40);
        f.t.now += 41_000;
        expect(b.wait()).toBe(0);
        /* A cpu.stat that can't be read holds nothing back. */
        throttled = null;
        expect(b.wait()).toBe(0);
    });

    it("never lets scan work have more than one CPU", () => {
        const b = new CpuBudget({ cpus: 4, share: 0.6 });
        expect(b.rate).toBeCloseTo(0.6);
        expect(new CpuBudget({ cpus: null, share: 0.6 }).rate).toBeCloseTo(0.6);
    });
});

describe("cgroup_cpu", () => {
    let dir: string;
    beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "scout-cg-")); });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    const put = (file: string, text: string) => {
        fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        fs.writeFileSync(path.join(dir, file), text);
    };

    it("reads cgroup v2 cpu.max, taking the smallest along the path", () => {
        put("proc", "0::/kubepods/pod1/agent\n");
        put("cg/kubepods/cpu.max", "200000 100000\n");
        put("cg/kubepods/pod1/agent/cpu.max", "10000 100000\n");
        expect(cgroup_cpu(path.join(dir, "cg"), path.join(dir, "proc")).cpus).toBeCloseTo(0.1);
    });

    it("reads a container's own cgroup v2 root", () => {
        put("proc", "0::/\n");
        put("cg/cpu.max", "50000 100000\n");
        expect(cgroup_cpu(path.join(dir, "cg"), path.join(dir, "proc")).cpus).toBeCloseTo(0.5);
    });

    it("answers null for no limit", () => {
        put("proc", "0::/\n");
        put("cg/cpu.max", "max 100000\n");
        expect(cgroup_cpu(path.join(dir, "cg"), path.join(dir, "proc")).cpus).toBeNull();
        expect(cgroup_cpu(path.join(dir, "none"), path.join(dir, "none")).cpus).toBeNull();
    });

    it("names the cpu.stat of the cgroup that sets the limit, and reads nr_throttled from it", () => {
        put("proc", "0::/a/b\n");
        put("cg/a/cpu.max", "10000 100000\n");
        put("cg/a/b/cpu.max", "max 100000\n");
        put("cg/a/cpu.stat", "usage_usec 5\nnr_periods 40\nnr_throttled 3\nthrottled_usec 9\n");
        const { cpus, stat } = cgroup_cpu(path.join(dir, "cg"), path.join(dir, "proc"));
        expect(cpus).toBeCloseTo(0.1);
        expect(stat).toBe(path.join(dir, "cg/a/cpu.stat"));
        expect(throttle_reader(stat)()).toBe(3);
        expect(throttle_reader(null)()).toBeNull();
        expect(throttle_reader(path.join(dir, "missing"))()).toBeNull();
    });

    it("reads cgroup v1 cfs quota and period", () => {
        put("proc", "4:cpu,cpuacct:/docker/abc\n3:memory:/docker/abc\n");
        put("cg/cpu,cpuacct/cpu.cfs_quota_us", "25000\n");
        put("cg/cpu,cpuacct/cpu.cfs_period_us", "100000\n");
        expect(cgroup_cpu(path.join(dir, "cg"), path.join(dir, "proc")).cpus).toBeCloseTo(0.25);
        put("cg/cpu,cpuacct/cpu.cfs_quota_us", "-1\n");
        expect(cgroup_cpu(path.join(dir, "cg"), path.join(dir, "proc")).cpus).toBeNull();
    });
});

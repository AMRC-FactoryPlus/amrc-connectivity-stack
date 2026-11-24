/*
 * ACS Edge Agent
 * Edge Scout: the CPU budget that keeps scan work behind data
 * Copyright 2026 University of Sheffield
 *
 * The edge-agent chart gives the agent 100m CPU. When a process uses
 * up its CPU quota within a CFS period, the kernel stops it until the
 * next period, so data waits too. Scan work therefore runs only while
 * the whole process, data included, uses less than a share of its CPU
 * limit. The budget is a token bucket: tokens build up at that share
 * of the limit and every CPU microsecond the process uses, on any
 * thread, takes one away. When the cgroup's cpu.stat shows that the
 * kernel has just throttled the process, scan work also holds off for
 * HOLD_MS, because data is already waiting.
 */

import fs from "fs";
import { performance } from "perf_hooks";

/* The longest scan work waits for tokens. After this a slice runs
 * anyway, so a busy agent still finishes a scan, slowly. */
const MAX_WAIT_MS = 200;
/* The shortest wait, so a waiting scan doesn't spin. */
const MIN_WAIT_MS = 5;
/* The most debt the bucket carries, in seconds of its rate. */
const MAX_DEBT_S = 1;
/* How long scan work holds off after the kernel throttled the
 * process: one CFS period. */
const HOLD_MS = 100;

export interface BudgetOpts {
    /* The CPUs the process may use, from its cgroup, or null for no
     * limit. */
    cpus:       number | null,
    /* The share of that the whole process may use before scan work
     * waits. */
    share:      number,
    /* The longest one slice of scan work runs, in ms. */
    slice_ms?:  number,
    /* The most tokens the bucket holds, in ms of CPU. */
    burst_ms?:  number,
    /* How many times the kernel has throttled the process, or null
     * when that can't be read. */
    throttled?: () => number | null,
    /* Tests only: the clock and the CPU counter, both in µs. */
    clock?:     () => number,
    cpu?:       () => number,
}

const process_cpu = () => {
    const u = process.cpuUsage();
    return u.user + u.system;
};

export class CpuBudget {
    /* CPU µs a wall µs, and the bucket's bounds in CPU µs. */
    rate:       number
    burst:      number
    floor:      number
    slice_ms:   number

    #clock: () => number
    #cpu: () => number
    #throttled: () => number | null
    #tokens: number
    #at: number
    #used: number
    #nr_throttled: number | null = null
    #hold_until = 0

    constructor (opts: BudgetOpts) {
        /* One event loop can't use more than one CPU, however many the
         * process may have, and data needs that loop. */
        const cpus = Math.min(opts.cpus ?? 1, 1);
        this.rate = cpus * opts.share;
        this.slice_ms = opts.slice_ms ?? 1;
        this.burst = (opts.burst_ms ?? 1) * 1000;
        this.floor = -this.rate * MAX_DEBT_S * 1e6;

        this.#clock = opts.clock ?? (() => performance.now() * 1000);
        this.#cpu = opts.cpu ?? process_cpu;
        this.#throttled = opts.throttled ?? (() => null);
        this.#tokens = this.burst;
        this.#at = this.#clock();
        this.#used = this.#cpu();
    }

    #refill () {
        const at = this.#clock(), used = this.#cpu();
        this.#tokens += (at - this.#at) * this.rate - (used - this.#used);
        this.#tokens = Math.max(this.floor, Math.min(this.burst, this.#tokens));
        this.#at = at;
        this.#used = used;
    }

    /* The tokens left, in CPU µs, for tests and logging. */
    get tokens () {
        this.#refill();
        return this.#tokens;
    }

    /* How long scan work must wait before its next slice, in ms. 0
     * means it may run now. */
    wait (): number {
        this.#refill();
        const n = this.#throttled();
        if (n != null) {
            if (this.#nr_throttled != null && n > this.#nr_throttled)
                this.#hold_until = this.#at + HOLD_MS * 1000;
            this.#nr_throttled = n;
        }
        const hold = (this.#hold_until - this.#at) / 1000;
        const debt = this.#tokens > 0 ? 0 : -this.#tokens / this.rate / 1000;
        const ms = Math.max(hold, debt);
        if (ms <= 0) return 0;
        return Math.min(MAX_WAIT_MS, Math.max(MIN_WAIT_MS, Math.ceil(ms)));
    }

    /* The longest wait() answers. A scheduler that has waited this
     * long runs a slice whatever the tokens say. */
    get max_wait () { return MAX_WAIT_MS; }
}

/* Read a cgroup file, or null. */
function read (file: string): string | null {
    try {
        return fs.readFileSync(file, "utf8").trim();
    }
    catch (e) {
        return null;
    }
}

export interface CgroupCpu {
    /* The CPUs the process may use, or null for no limit. */
    cpus:   number | null,
    /* The cpu.stat file of the cgroup that sets the limit. */
    stat:   string | null,
}

/* The CPUs this process may use under its cgroup's CPU quota, and the
 * cpu.stat of the cgroup that sets it. Under cgroup v2 the limit is
 * the smallest cpu.max of the process's cgroup and its parents. Under
 * cgroup v1 it is cpu.cfs_quota_us over cpu.cfs_period_us. */
export function cgroup_cpu (root = "/sys/fs/cgroup", self = "/proc/self/cgroup"): CgroupCpu {
    const lines = (read(self) ?? "").split("\n");
    const best: CgroupCpu = { cpus: null, stat: null };
    const take = (quota: number, period: number, dir: string) => {
        if (!(quota > 0) || !(period > 0)) return;
        const cpus = quota / period;
        if (best.cpus != null && cpus >= best.cpus) return;
        best.cpus = cpus;
        best.stat = `${dir}/cpu.stat`;
    };

    /* cgroup v2: "0::/path". */
    const v2 = lines.find(l => l.startsWith("0::"));
    if (v2 != null) {
        const parts = v2.slice(3).split("/").filter(p => p && p != "..");
        for (let i = parts.length; i >= 0; i--) {
            const dir = [root, ...parts.slice(0, i)].join("/");
            const max = read(`${dir}/cpu.max`);
            if (!max) continue;
            const [quota, period] = max.split(/\s+/);
            if (quota != "max") take(Number(quota), Number(period), dir);
        }
    }

    /* cgroup v1: "N:cpu,cpuacct:/path". Inside a container the path
     * may be the host's, so the mount's own top is tried too. */
    const v1 = lines.find(l => /^\d+:[^:]*\bcpu\b[^:]*:/.test(l));
    if (v1 != null) {
        const path = v1.split(":")[2] ?? "/";
        for (const mount of ["cpu", "cpu,cpuacct", "cpuacct,cpu"]) {
            for (const dir of [`${root}/${mount}${path}`, `${root}/${mount}`]) {
                const quota = read(`${dir}/cpu.cfs_quota_us`);
                const period = read(`${dir}/cpu.cfs_period_us`);
                if (quota && period) take(Number(quota), Number(period), dir);
            }
        }
    }
    return best;
}

/* A reader of nr_throttled from a cpu.stat file, which answers null
 * when the file can't be read. */
export function throttle_reader (stat: string | null): () => number | null {
    if (!stat) return () => null;
    return () => {
        const m = /^nr_throttled (\d+)$/m.exec(read(stat) ?? "");
        return m ? Number(m[1]) : null;
    };
}

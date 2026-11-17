/*
 * ACS Edge Agent
 * Golden-output harness: the split driver under test
 * Copyright 2026 University of Sheffield
 */

import { ChildProcess, execFileSync, spawn } from "child_process";
import fs from "fs";
import path from "path";

/* What a split driver is given, as the Edge Agent's Helm chart gives
 * its sidecars. */
export interface DriverEnv {
    EDGE_MQTT:      string,
    EDGE_USERNAME:  string,
    EDGE_PASSWORD:  string,
}

export interface RunningDriver {
    /* CPU time the driver has used, in microseconds, if it runs in its
     * own process. Undefined for an in-process driver, whose CPU is
     * counted with the agent's. */
    cpu_us (): Promise<number | undefined>,
    /* What the driver printed, for a failure report. */
    output (): string,
    stop (): Promise<void>,
}

/* A split driver to run against the agent's driver broker. */
export interface DriverSpec {
    name: string,
    start (env: DriverEnv): Promise<RunningDriver>,
}

/* A driver that runs in the test process. `start` connects to the
 * broker in `env` and returns something to stop it. */
export function in_process (name: string,
    start: (env: DriverEnv) => Promise<{ stop (): Promise<void> | void }>,
): DriverSpec {
    return {
        name,
        async start (env) {
            const drv = await start(env);
            return {
                cpu_us: async () => undefined,
                output: () => "",
                stop: async () => { await drv.stop(); },
            };
        },
    };
}

/* A driver run as its own process, the way a real driver image runs.
 * The command gets the driver environment on top of the test's own.
 * Run the driver's binary directly rather than through a shell or
 * npx, because only the spawned process's CPU is counted. */
export function spawned (name: string, command: string, args: string[] = [],
    opts: { cwd?: string, env?: NodeJS.ProcessEnv } = {},
): DriverSpec {
    return {
        name,
        async start (env) {
            const child = spawn(command, args, {
                cwd: opts.cwd,
                env: { ...process.env, ...opts.env, ...env },
                stdio: ["ignore", "pipe", "pipe"],
            });
            let out = "";
            const keep = (b: Buffer) => {
                out += b.toString();
                if (out.length > 100_000) out = out.slice(-50_000);
            };
            child.stdout!.on("data", keep);
            child.stderr!.on("data", keep);
            const exited = new Promise<void>(r => child.once("exit", () => r()));
            await new Promise<void>((resolve, reject) => {
                child.once("spawn", () => resolve());
                child.once("error", reject);
            });

            return {
                cpu_us: async () => child_cpu_us(child),
                output: () => out,
                async stop () {
                    if (child.exitCode != null || child.signalCode != null) return;
                    child.kill("SIGTERM");
                    const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
                    await exited;
                    clearTimeout(timer);
                },
            };
        },
    };
}

/* The CPU time a running child has used, in microseconds. Linux gives
 * it in /proc in clock ticks (10 ms each on every kernel we run).
 * macOS has no /proc, so ask ps, which gives minutes:seconds to 10 ms. */
function child_cpu_us (child: ChildProcess): number | undefined {
    const pid = child.pid;
    if (pid == undefined || child.exitCode != null) return;
    try {
        if (fs.existsSync(`/proc/${pid}/stat`)) {
            const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
            /* Fields after the command name, which is in parens. */
            const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
            const ticks = Number(f[11]) + Number(f[12]);
            return ticks * 10_000;
        }
        const t = execFileSync("ps", ["-o", "time=", "-p", String(pid)],
            { encoding: "utf8" }).trim();
        const parts = t.split(":").map(Number);
        const secs = parts.reduce((acc, p) => acc * 60 + p, 0);
        return Math.round(secs * 1e6);
    }
    catch {
        return;
    }
}

/* The reference REST driver in rest-driver/, run with this Node. */
export function rest_reference (): DriverSpec {
    return spawned("reference REST driver (js-edge-driver)",
        process.execPath, [path.join(__dirname, "rest-driver", "main.mjs")]);
}

/* Is lib/js-edge-driver installed, so the reference driver can run? */
export function reference_ready (): boolean {
    return fs.existsSync(path.join(__dirname,
        "../../../lib/js-edge-driver/node_modules/mqtt"));
}

/* A driver named by GOLDEN_DRIVER, a command line split on spaces:
 * the way a real driver binary is plugged in. Undefined if unset. */
export function env_driver (): DriverSpec | undefined {
    const cmd = process.env.GOLDEN_DRIVER?.trim();
    if (!cmd) return;
    const [command, ...args] = cmd.split(/\s+/);
    return spawned(cmd, command, args);
}

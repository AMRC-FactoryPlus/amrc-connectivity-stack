/*
 * ACS Edge Agent
 * Edge Scout end-to-end tests: the processes a test runs
 * Copyright 2026 University of Sheffield
 *
 * The Edge Agent, compiled and run as its own Node process, the split
 * drivers as their own processes, mosquitto, and the node-opcua test
 * server from edge-opcua.
 */

import { ChildProcess, execFileSync, spawn } from "child_process";
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";

import { RunningDriver, spawned } from "../../golden/driver";

import { FakeAcs } from "./services";

export const ACS_EDGE = path.resolve(__dirname, "../../..");
export const REPO = path.resolve(ACS_EDGE, "..");
const OUT = path.join(ACS_EDGE, "node_modules/.cache/scout-e2e");
export const AGENT_JS = path.join(OUT, "tests/scout/e2e/agent-main.js");

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function until (cond: () => boolean, what: string, ms = 10_000) {
    const end = Date.now() + ms;
    while (!cond()) {
        if (Date.now() > end)
            throw new Error(`Timed out after ${ms} ms waiting for ${what}`);
        await sleep(20);
    }
}

export function free_port (): Promise<number> {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.once("error", reject);
        srv.listen(0, "127.0.0.1", () => {
            const { port } = srv.address() as net.AddressInfo;
            srv.close(() => resolve(port));
        });
    });
}

async function port_open (port: number): Promise<boolean> {
    return new Promise(resolve => {
        const s = net.connect(port, "127.0.0.1");
        s.once("connect", () => { s.destroy(); resolve(true); });
        s.once("error", () => resolve(false));
    });
}

/* Compile the agent and the entry point with the agent's own
 * tsconfig, as the Docker build does, into node_modules/.cache, which
 * neither git nor the Docker build sees. */
export function build_agent () {
    const tsc = path.join(ACS_EDGE, "node_modules/typescript/bin/tsc");
    execFileSync(process.execPath,
        [tsc, "-p", path.join(__dirname, "tsconfig.json")],
        { cwd: ACS_EDGE, stdio: "pipe" });
    fs.writeFileSync(path.join(OUT, "package.json"), '{ "type": "module" }\n');
}

/* A child process whose output is kept for a failure report. */
class Child {
    child?: ChildProcess
    out = ""
    exited?: Promise<number | null>

    keep (b: Buffer) {
        this.out += b.toString();
        if (this.out.length > 400_000) this.out = this.out.slice(-200_000);
    }

    async stop (signal: NodeJS.Signals = "SIGTERM", grace = 5000) {
        const c = this.child;
        if (!c || c.exitCode != null || c.signalCode != null) return;
        c.kill(signal);
        const timer = setTimeout(() => c.kill("SIGKILL"), grace);
        await this.exited;
        clearTimeout(timer);
    }

    tail (n = 60) {
        return this.out.split("\n").slice(-n).join("\n");
    }
}

/* mosquitto from PATH on a free port, allowing anyone in. It carries
 * the agent's Sparkplug traffic and is edge-mqtt's device broker. */
export class Mosquitto extends Child {
    port = 0
    dir = ""

    get url () { return `mqtt://127.0.0.1:${this.port}`; }

    async start () {
        this.port = await free_port();
        this.dir = fs.mkdtempSync(path.join(os.tmpdir(), "scout-e2e-mosq-"));
        const conf = path.join(this.dir, "mosquitto.conf");
        fs.writeFileSync(conf, [
            `listener ${this.port} 127.0.0.1`,
            "allow_anonymous true",
            "persistence false",
            "max_queued_messages 100000",
            "",
        ].join("\n"));
        const cmd = process.env.SCOUT_E2E_MOSQUITTO || "mosquitto";
        const c = this.child = spawn(cmd, ["-c", conf], { stdio: ["ignore", "pipe", "pipe"] });
        c.stdout!.on("data", b => this.keep(b));
        c.stderr!.on("data", b => this.keep(b));
        this.exited = new Promise(r => c.once("exit", code => r(code)));
        await new Promise<void>((resolve, reject) => {
            c.once("spawn", () => resolve());
            c.once("error", reject);
        });
        const end = Date.now() + 10_000;
        while (!await port_open(this.port)) {
            if (Date.now() > end) throw new Error(`mosquitto did not start:\n${this.out}`);
            await sleep(50);
        }
        return this;
    }

    async stop () {
        await super.stop();
        fs.rmSync(this.dir, { recursive: true, force: true });
    }
}

/* The node-opcua server edge-opcua's integration tests use, in its
 * SCOUT mode. Its node-opcua comes from acs-edge's node_modules. */
export class OpcuaServer extends Child {
    port = 0
    pki = ""

    get url () { return `opc.tcp://127.0.0.1:${this.port}`; }

    async start (env: Record<string, string> = {}) {
        this.port = await free_port();
        this.pki = fs.mkdtempSync(path.join(os.tmpdir(), "scout-e2e-pki-"));
        const c = this.child = spawn(process.execPath,
            [path.join(REPO, "edge-opcua/tests/server/server.cjs"), String(this.port), this.pki], {
                env: { ...process.env, NODE_PATH: path.join(ACS_EDGE, "node_modules"),
                    SCOUT: "1", ...env },
                stdio: ["ignore", "pipe", "pipe"],
            });
        c.stdout!.on("data", b => this.keep(b));
        c.stderr!.on("data", b => this.keep(b));
        this.exited = new Promise(r => c.once("exit", code => r(code)));
        await until(() => /^READY$/m.test(this.out) || c.exitCode != null,
            "the OPC UA server", 60_000);
        if (c.exitCode != null) throw new Error(`The OPC UA server stopped:\n${this.out}`);
        return this;
    }

    async stop () {
        await super.stop("SIGKILL");
        fs.rmSync(this.pki, { recursive: true, force: true });
    }
}

/* One E2E-USAGE line from the agent. */
export interface Usage {
    at:         number,
    rss:        number,
    heap:       number,
    max_rss_kb: number,
    cpu_us:     number,
}

export interface AgentOpts {
    acs:        FakeAcs,
    mqtt:       Mosquitto,
    /* The driver broker's port. The same port across a restart, so
     * the drivers find the new agent. */
    edge_port:  number,
    passwords:  string,
    env?:       Record<string, string>,
    /* A command to run the agent under, such as limit.sh. */
    wrap?:      string[],
}

/* The Edge Agent as its own Node process. */
export class AgentProcess extends Child {
    usage: Usage[] = []
    started = false
    #buf = ""

    constructor (public opts: AgentOpts) { super(); }

    async start () {
        const { acs, mqtt, edge_port, passwords } = this.opts;
        this.usage = [];
        this.started = false;
        const env = {
            ...process.env,
            DIRECTORY_URL:      acs.url,
            CONFIGDB_URL:       acs.url,
            AUTHN_URL:          acs.url,
            MQTT_URL:           mqtt.url,
            SERVICE_USERNAME:   "edge-agent",
            SERVICE_PASSWORD:   "e2e",
            EDGE_MQTT:          `mqtt://127.0.0.1:${edge_port}`,
            EDGE_PASSWORDS:     passwords,
            POLL_INT:           "30",
            ...this.opts.env,
        };
        const wrap = this.opts.wrap ?? [];
        const [cmd, ...args] = [...wrap, process.execPath, AGENT_JS];
        const c = this.child = spawn(cmd, args, { cwd: ACS_EDGE, env, stdio: ["ignore", "pipe", "pipe"] });
        c.stdout!.on("data", b => this.#line(b));
        c.stderr!.on("data", b => this.keep(b));
        this.exited = new Promise(r => c.once("exit", code => r(code)));
        await until(() => this.started || c.exitCode != null, "the Edge Agent to start", 60_000);
        if (!this.started) throw new Error(`The Edge Agent stopped:\n${this.tail()}`);
        return this;
    }

    #line (b: Buffer) {
        this.#buf += b.toString();
        const lines = this.#buf.split("\n");
        this.#buf = lines.pop()!;
        for (const l of lines) {
            if (l.startsWith("E2E-USAGE ")) {
                this.usage.push(JSON.parse(l.slice(10)));
                continue;
            }
            if (l == "E2E-STARTED") this.started = true;
            this.keep(Buffer.from(l + "\n"));
        }
    }

    get alive () {
        const c = this.child;
        return !!c && c.exitCode == null && c.signalCode == null;
    }

    /* The agent's peak resident memory so far, in bytes. */
    peak_rss (since = 0): number {
        return Math.max(0, ...this.usage.filter(u => u.at >= since).map(u => u.rss));
    }
}

/* What each driver under test is run from. The Rust drivers are
 * release builds, as their images run them. */
export const DriverBins = {
    opcua:  process.env.SCOUT_E2E_OPCUA ?? path.join(REPO, "edge-opcua/target/release/driver"),
    mqtt:   process.env.SCOUT_E2E_MQTT ?? path.join(REPO, "edge-mqtt/target/release/driver"),
    test_rs: process.env.SCOUT_E2E_TEST_RS ?? path.join(REPO, "edge-test-rs/target/release/driver"),
    test_js: path.join(REPO, "edge-test/bin/driver.js"),
};

/* Which drivers are missing, so the suite can say so. */
export function missing_drivers (): string[] {
    const out: string[] = [];
    for (const [k, f] of Object.entries(DriverBins))
        if (!fs.existsSync(f)) out.push(`${k} (${f})`);
    if (!fs.existsSync(path.join(REPO, "edge-test/node_modules/@amrc-factoryplus/edge-driver")))
        out.push("edge-test's node_modules (npm ci --install-links in edge-test)");
    return out;
}

/* A split driver process logged in to the agent's broker as `id`.
 * The password is written to the agent's password directory. */
export async function start_driver (kind: keyof typeof DriverBins, id: string, opts: {
    passwords: string, edge_port: number, env?: Record<string, string>,
}): Promise<RunningDriver> {
    const password = `pw-${id}`;
    fs.writeFileSync(path.join(opts.passwords, id), password);
    const bin = DriverBins[kind];
    const spec = kind == "test_js"
        ? spawned(id, process.execPath, [bin], { cwd: path.join(REPO, "edge-test"),
            env: { VERBOSE: "", ...opts.env } as unknown as NodeJS.ProcessEnv })
        : spawned(id, bin, [], { env: { RUST_LOG: "info", ...opts.env } as unknown as NodeJS.ProcessEnv });
    return spec.start({
        EDGE_MQTT:      `mqtt://127.0.0.1:${opts.edge_port}`,
        EDGE_USERNAME:  id,
        EDGE_PASSWORD:  password,
    });
}

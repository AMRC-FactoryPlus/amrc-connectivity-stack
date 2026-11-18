/*
 * ACS Edge Agent
 * Driver fixtures: command-line generator
 *
 *   synth  <config.json> <out-dir>   synthetic input for a real config
 *   sample <config.json> <out-dir>   small anonymised synthetic sample
 *   record <config.json> <out-dir>   real responses from a public REST API
 *
 * <config.json> is {agent, connection} (or a bare deviceConnections[]
 * entry). See README.md for the fixture format and the options.
 * Copyright 2026 University of Sheffield
 */

import fs from "fs";
import { sample_connection } from "./anonymise.js";
import { FORMAT, Finding, Fixture, FixtureEvent, VERSION, write_fixture } from "./fixture.js";
import { connection_metrics } from "./metrics.js";
import { poll_interval, synthesise } from "./synth.js";
import { verify } from "./verify.js";

interface Opts {
    seed: number,
    duration_ms: number,
    mqtt_interval_ms: number,
    max_metrics: number,
    kind: string,
    polls: number,
    verify_events: number,
}

function parse_args (argv: string[]) {
    const pos: string[] = [];
    const opts: Opts = {
        seed: 1, duration_ms: 600_000, mqtt_interval_ms: 1000,
        max_metrics: 12, kind: "", polls: 3, verify_events: 50,
    };
    const num: { [k: string]: keyof Opts } = {
        "--seed": "seed", "--duration": "duration_ms",
        "--mqtt-interval": "mqtt_interval_ms", "--max-metrics": "max_metrics",
        "--polls": "polls", "--verify-events": "verify_events",
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a in num) (opts as any)[num[a]] = Number(argv[++i]);
        else if (a == "--kind") opts.kind = argv[++i];
        else if (a.startsWith("--")) throw new Error(`Unknown option ${a}`);
        else pos.push(a);
    }
    return { pos, opts };
}

function load_config (file: string): { agent: string, connection: any } {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    return j.connection
        ? { agent: j.agent ?? "", connection: j.connection }
        : { agent: "", connection: j };
}

function finish (dir: string, fixture: Fixture, extra: Finding[]) {
    fixture.meta.findings.push(...extra);
    fixture.meta.counts.events = fixture.events.length;
    fixture.meta.counts.bytes = fixture.events.reduce((n, e) =>
        n + (e.type == "mqtt" || e.type == "udp" ? e.payload.length
            : e.type == "http" ? e.body.length
            : JSON.stringify(e.values).length), 0);
    write_fixture(dir, fixture);
}

function report (dir: string, fixture: Fixture, resolved: number, checked: number) {
    const m = fixture.meta;
    console.log(`${m.name}: ${m.counts.read_metrics} read metrics on `
        + `${m.counts.addresses} addresses, ${m.counts.events} events, `
        + `${(m.counts.bytes / 1e6).toFixed(1)} MB -> ${dir}`);
    console.log(`  ${resolved} resolve, ${m.findings.length} findings `
        + `(${checked} events checked with the agent's parser)`);
    for (const f of m.findings)
        console.log(`  - ${f.device} / ${f.metric} [${f.address}] ${f.path ?? ""}: ${f.problem}`);
}

function cmd_synth (file: string, dir: string, opts: Opts) {
    const { agent, connection } = load_config(file);
    const { fixture, cm, expected } = synthesise(connection, {
        agent, seed: opts.seed, duration_ms: opts.duration_ms,
        mqtt_interval_ms: opts.mqtt_interval_ms,
    });
    const res = verify(fixture, {
        expected: expected.values,
        max_events_per_address: opts.verify_events,
    }, cm);
    finish(dir, fixture, res.findings);
    report(dir, fixture, res.resolved, res.checked_events);
}

function cmd_sample (file: string, dir: string, opts: Opts) {
    if (!opts.kind) throw new Error("sample needs --kind, e.g. mqtt-json");
    const { connection } = load_config(file);
    /* Find what resolves on the real config, then sample from that. */
    const full = synthesise(connection, {
        agent: "", seed: opts.seed, duration_ms: 10 * poll_interval(connection),
        mqtt_interval_ms: opts.mqtt_interval_ms,
    });
    const bad = [
        ...full.fixture.meta.findings,
        ...verify(full.fixture, { expected: full.expected.values }, full.cm).findings,
    ];
    const sample = sample_connection(connection, opts.kind, opts.max_metrics, bad);
    const { fixture, cm, expected } = synthesise(sample, {
        agent: "sample-agent", seed: opts.seed, duration_ms: opts.duration_ms,
        mqtt_interval_ms: opts.mqtt_interval_ms,
    });
    const res = verify(fixture, { expected: expected.values }, cm);
    finish(dir, fixture, res.findings);
    report(dir, fixture, res.resolved, res.checked_events);
}

/* Poll each configured address of a REST connection and save the real
 * responses. Only for public APIs that need no credentials. */
async function cmd_record (file: string, dir: string, opts: Opts) {
    const { agent, connection } = load_config(file);
    const rest = connection.RESTConnDetails;
    if (connection.connType != "REST" || !rest)
        throw new Error("record only works for REST connections");
    if (rest.authMethod && rest.authMethod != "None")
        throw new Error("record refuses connections that need credentials");

    const cm = connection_metrics(connection);
    const addrs = [...new Set(cm.read.map(m => m.address))];
    const interval = poll_interval(connection);
    const fetch = (globalThis as any).fetch;
    const events: FixtureEvent[] = [];
    for (let p = 0; p < opts.polls; p++) {
        if (p > 0) await new Promise(r => setTimeout(r, interval));
        for (const a of addrs) {
            const res = await fetch(rest.baseURL + a, {
                headers: { "User-Agent": "acs-driver-fixtures" },
            });
            events.push({
                t: p * interval, type: "http", path: a, status: res.status,
                content_type: res.headers.get("content-type") ?? "",
                body: await res.text(),
            });
            console.log(`poll ${p + 1}/${opts.polls} ${a}: ${res.status}`);
        }
    }

    const fixture: Fixture = {
        meta: {
            format: FORMAT, version: VERSION,
            name: connection.name, agent,
            protocol: "REST",
            payloadFormat: cm.payloadFormat,
            delimiter: cm.delimiter,
            source: "recorded",
            duration_ms: opts.polls * interval,
            interval_ms: interval,
            features: ["protocol:REST", `payload:${cm.payloadFormat}`, "recorded"],
            counts: {
                devices: cm.devices, metrics: cm.metrics,
                read_metrics: cm.read.length, addresses: addrs.length,
                events: 0, bytes: 0,
            },
            findings: [...cm.findings],
        },
        connection,
        events,
    };
    const res = verify(fixture, {}, cm);
    finish(dir, fixture, res.findings);
    report(dir, fixture, res.resolved, res.checked_events);
}

async function main () {
    const { pos, opts } = parse_args(process.argv.slice(2));
    const [cmd, file, dir] = pos;
    if (!dir) {
        console.error("Usage: generate.js synth|sample|record <config.json> <out-dir> [options]");
        process.exit(2);
    }
    if (cmd == "synth") cmd_synth(file, dir, opts);
    else if (cmd == "sample") cmd_sample(file, dir, opts);
    else if (cmd == "record") await cmd_record(file, dir, opts);
    else throw new Error(`Unknown command ${cmd}`);
}

await main();

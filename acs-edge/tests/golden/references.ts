/*
 * ACS Edge Agent
 * Golden-output harness: the fixtures, and the recorded built-in runs
 * each split driver is compared with
 * Copyright 2026 University of Sheffield
 */

import fs from "fs";
import path from "path";

import * as UUIDs from "../../lib/uuids.js";

import { Fixture, read_fixture } from "../fixtures/drivers/fixture.js";
import { Kinds } from "./devices/index.js";
import type { Command, RunOpts, RunResult } from "./harness.js";
import { from_snapshot, read_snapshot, snapshot_dir, snapshot_path } from "./snapshot.js";

export const SAMPLES = path.join(__dirname, "../fixtures/drivers/samples");
/* Samples the fixture generator can't make, built by hand. */
export const HAND_MADE = path.join(__dirname, "samples");

const cap = () => Number(process.env.GOLDEN_DURATION_MS) || Infinity;

/* A fixture cut to its first `cap` ms, for long private fixtures. */
export function truncate (f: Fixture, cap: number): Fixture {
    if (f.meta.duration_ms <= cap) return f;
    return {
        ...f,
        meta: { ...f.meta, duration_ms: cap },
        events: f.events.filter(e => e.t <= cap),
    };
}

/* The committed samples, or every fixture in GOLDEN_FIXTURES. */
export function fixtures (): [string, Fixture][] {
    const dirs = process.env.GOLDEN_FIXTURES
        ? [process.env.GOLDEN_FIXTURES] : [SAMPLES, HAND_MADE];
    return dirs.flatMap(dir => fs.readdirSync(dir).sort()
        .filter(d => fs.existsSync(path.join(dir, d, "fixture.json")))
        .map((d): [string, Fixture] => [d, truncate(read_fixture(path.join(dir, d)), cap())]));
}

export const ALL = fixtures();
export const RUNNABLE = ALL.filter(([, f]) => Kinds[f.meta.protocol]);
export const of_protocol = (p: string) => RUNNABLE.filter(([, f]) => f.meta.protocol == p);

/* A sample is a directory of the committed samples, or a path from
 * acs-edge/tests. */
export const sample_dir = (sample: string) => sample.includes("/")
    ? path.join(__dirname, "..", sample) : path.join(SAMPLES, sample);
export const read_sample = (sample: string) =>
    truncate(read_fixture(sample_dir(sample)), cap());

export interface MoveCase {
    name:   string,
    sample: string,
    /* The connection's entry as the site had it, and as service-setup's
     * move left it. */
    before: any,
    after:  any,
}

/* The site one of service-setup's move tests starts from, and the
 * configs the move leaves: one case for each connection the test moves.
 * The test checks that the move gives exactly moved.json, so a run of
 * `after` runs what an upgrade writes, not a copy of the move. */
export function move_cases (test: string) {
    const dir = path.join(__dirname, "../../../acs-service-setup/test", test);
    const read = (f: string) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const site = read("site.json");
    const moved = read("moved.json");
    const agent_configs = (configs: any) =>
        Object.values(configs[UUIDs.App.AgentConfig]) as any[];
    const find = (configs: any, uuid: string) => agent_configs(configs)
        .flatMap(c => c.deviceConnections)
        .find((e: any) => e.uuid == uuid);
    const cases = Object.entries(site.samples as { [uuid: string]: string })
        .map(([uuid, sample]): MoveCase => {
            const before = find(site.configs, uuid);
            return { name: before.name, sample, before, after: find(moved, uuid) };
        });
    return { test, cases, secrets: site.secrets as { [k: string]: string } };
}

export const REST_MOVE = move_cases("rest-move");
export const MQTT_MOVE = move_cases("mqtt-move");
export const UDP_MOVE = move_cases("udp-move");
export const OPCUA_MOVE = move_cases("opcua-move");

/* The OPC UA move runs write 300.25 to each writable metric. */
export function opcua_writes (before: any) {
    const writable = before.devices.flatMap((d: any) => d.tags
        .filter((t: any) => /SET/.test(t.method))
        .map((t: any) => ({ device: d.deviceId as string, tag: t })));
    const commands: Command[] = writable.map(({ device, tag }: any) => ({
        t: 1500, device, metric: tag.Name, type: "Double", value: 300.25,
    }));
    return { writable, commands };
}

/* One DateTime node, to pin how its value is published. */
export const DATETIME_ID = "ns=2;s=Types/DateTime";
export const DATETIMES = ["2026-01-01T00:00:00.000Z", "2026-03-01T12:30:00.000Z"];
export function datetime_fixture (): Fixture {
    const base = read_fixture(path.join(SAMPLES, "opcua-types"));
    return {
        meta: { ...base.meta, name: "sample-opcua-datetime" },
        connection: {
            ...base.connection,
            devices: [{
                ...base.connection.devices[0],
                tags: [{ Name: "Types/DateTime", type: "DateTime", method: "GET",
                    address: DATETIME_ID, value: null, recordToDB: true }],
            }],
        },
        events: DATETIMES.map((value, i) => ({
            t: i * 2000, type: "opcua",
            values: { [DATETIME_ID]: { dataType: "DateTime", value } },
        })) as any,
    };
}

/* A file name from a connection name. */
const slug = (s: string) => s.replace(/[^A-Za-z0-9_.-]+/g, "_");

/* A recorded built-in run. `runs` are the RunOpts of the run, or of
 * several runs of one device each that were joined into one with
 * merge_runs(). */
export interface Reference {
    key:        string,
    fixture:    () => Fixture,
    runs:       RunOpts[],
    merged?:    string,
}

export const sample_key = (name: string) => `sample/${name}`;
export const dotted_key = (name: string) => `dotted-name/${name}`;
export const move_key = (test: string, name: string) => `${test}/${slug(name)}`;
export const several_key = (name: string) => `opcua-move/${slug(name)}.several-devices`;
export const DATETIME_KEY = "opcua-datetime";
export const DOTTED_NAME = "api.example.org";

/* Every built-in run the harness compares split drivers with. */
export function references (): Reference[] {
    const refs: Reference[] = RUNNABLE.map(([name, f]) =>
        ({ key: sample_key(name), fixture: () => f, runs: [{}] }));
    if (process.env.GOLDEN_FIXTURES) return refs;

    for (const [name, f] of of_protocol("REST").slice(0, 1))
        refs.push({ key: dotted_key(name), fixture: () => f,
            runs: [{ connection_name: DOTTED_NAME }] });

    for (const move of [REST_MOVE, MQTT_MOVE, UDP_MOVE])
        for (const c of move.cases)
            refs.push({ key: move_key(move.test, c.name),
                fixture: () => read_sample(c.sample),
                runs: [{ entry: c.before, secrets: move.secrets }] });

    /* The built-in OPC UA connection gives several devices' values to
     * the wrong device, so with several devices the reference is the
     * built-in run with one device at a time. */
    const { secrets } = OPCUA_MOVE;
    for (const c of OPCUA_MOVE.cases) {
        const { commands } = opcua_writes(c.before);
        const devices = c.before.devices;
        const opts = (entry: any): RunOpts => ({ entry, secrets, secure: true, commands });
        refs.push({ key: move_key("opcua-move", c.name),
            fixture: () => read_sample(c.sample),
            runs: devices.length == 1 ? [opts(c.before)]
                : devices.map((d: any) => opts({ ...c.before, devices: [d] })),
            merged: devices.length == 1 ? undefined : "built-in, one device at a time" });
        if (devices.length > 1)
            refs.push({ key: several_key(c.name),
                fixture: () => read_sample(c.sample),
                runs: [{ entry: c.before, secrets }] });
    }

    refs.push({ key: DATETIME_KEY, fixture: datetime_fixture, runs: [{}] });
    return refs;
}

/* The recorded built-in run for `key`, and the speed it was recorded
 * at. The built-in connections' output depends on the speed (how many
 * polls and samples fall in each interval), so a run compared with it
 * must go at that speed: pass `speed` to run_agent(). */
export function recorded (key: string, fixture: Fixture): { run: RunResult, speed: number } {
    const s = read_snapshot(key);
    if (!s)
        throw new Error(`No recorded built-in run ${snapshot_path(key)}. `
            + `The built-in connections are gone, so it can't be recorded `
            + `now: see "Recorded runs" in tests/golden/README.md.`
            + (process.env.GOLDEN_FIXTURES && !process.env.GOLDEN_SNAPSHOTS
                ? " For private fixtures set GOLDEN_SNAPSHOTS to where their runs are." : ""));
    if (s.duration_ms != fixture.meta.duration_ms)
        throw new Error(`${snapshot_path(key)} covers ${s.duration_ms} ms of `
            + `the fixture, and this run plays ${fixture.meta.duration_ms} ms. `
            + `Set GOLDEN_DURATION_MS=${s.duration_ms}.`);
    return { run: from_snapshot(s), speed: s.speed };
}

export { snapshot_dir };

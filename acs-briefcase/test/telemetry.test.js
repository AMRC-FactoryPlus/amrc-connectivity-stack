/*
 * ACS Briefcase exporter
 * Tests for splitting the telemetry by device
 * Copyright 2026 University of Sheffield
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { CSV_HEADER, pad_time, split_telemetry } from "../lib/telemetry.js";

const A = "a0000000-0000-4000-8000-000000000000";
const B = "b0000000-0000-4000-8000-000000000000";

/* A Data Access export, as the current CSV columns. */
const HEADER = "device,metric,timestamp,value,unit,device_uuid,path,type";

async function split (lines) {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "telemetry-test-"));
    const input = Readable.from([[HEADER, ...lines].join("\n") + "\n"]);
    try {
        const summary = await split_telemetry(input, dir);
        const files = {};
        for (const name of await fsp.readdir(dir))
            files[name] = await fsp.readFile(path.join(dir, name), "utf8");
        return { summary, files };
    }
    finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
}

test("pads timestamps to nine fractional digits", () => {
    assert.equal(pad_time("2026-10-14T09:00:00Z"), "2026-10-14T09:00:00.000000000Z");
    assert.equal(pad_time("2026-10-14T09:00:00.1234Z"), "2026-10-14T09:00:00.123400000Z");
    assert.equal(pad_time("2026-10-14T09:00:00.123456789Z"), "2026-10-14T09:00:00.123456789Z");
});

test("refuses a timestamp that is not UTC", () => {
    assert.throws(() => pad_time("2026-10-14T09:00:00+01:00"), /Unexpected timestamp/);
    assert.throws(() => pad_time("2026-10-14T09:00:00.1234567890Z"), /Unexpected timestamp/);
});

test("writes one file per device, with full metric names", async () => {
    const { summary, files } = await split([
        `Dev,Position,2026-10-14T09:00:00.5Z,12.5,mm,${A},Axes/X,double`,
        `Other,Count,2026-10-14T09:00:01Z,18446744073709551615,,${B},,uint`,
        `Dev,Position,2026-10-14T09:00:00.25Z,12.25,mm,${A},Axes/X,double`,
    ]);

    assert.deepEqual(Object.keys(files).sort(), [`${A}.csv`, `${B}.csv`]);
    assert.equal(files[`${A}.csv`], [
        CSV_HEADER,
        "2026-10-14T09:00:00.500000000Z,Axes/X/Position,double,12.5,mm",
        "2026-10-14T09:00:00.250000000Z,Axes/X/Position,double,12.25,mm",
        "",
    ].join("\n"));
    assert.equal(files[`${B}.csv`], [
        CSV_HEADER,
        "2026-10-14T09:00:01.000000000Z,Count,uint,18446744073709551615,",
        "",
    ].join("\n"));

    assert.deepEqual(summary.get(A), {
        file:   `${A}.csv`,
        rows:   2,
        first:  "2026-10-14T09:00:00.250000000Z",
        last:   "2026-10-14T09:00:00.500000000Z",
    });
    assert.equal(summary.get(B).rows, 1);
});

test("keeps commas, quotes and newlines in values", async () => {
    const { files } = await split([
        `Dev,Note,2026-10-14T09:00:00Z,"a, ""b""\nc",,${A},,string`,
    ]);
    assert.equal(files[`${A}.csv`].split("\n").slice(1).join("\n"),
        `2026-10-14T09:00:00.000000000Z,Note,string,"a, ""b""\nc",\n`);
});

test("refuses a device UUID that is not a UUID", async () => {
    await assert.rejects(
        split(["Dev,T,2026-10-14T09:00:00Z,1,,../../etc,,double"]),
        /Bad device UUID/);
});

test("an export with no rows gives no files", async () => {
    const { summary, files } = await split([]);
    assert.equal(summary.size, 0);
    assert.deepEqual(files, {});
});

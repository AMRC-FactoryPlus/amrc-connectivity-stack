/*
 * ACS Briefcase exporter
 * Tests for building a briefcase
 * Copyright 2026 University of Sheffield
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import yauzl from "yauzl";

import { UUIDs } from "@amrc-factoryplus/rx-client";

import { Builder } from "../lib/builder.js";
import { App } from "../lib/constants.js";
import { RO_CRATE } from "../lib/crate.js";

const DATASET = "11111111-1111-4111-8111-111111111111";
const DEVICE = "a0000000-0000-4000-8000-000000000000";
const BRIEFCASE = "c0000000-0000-4000-8000-000000000000";
const OLD = "0b5e3a52-7f41-4c2e-a8d6-6a9f3e2d1c40";

const POLICY = {
    tier: "approved-project",
    data_owner: {
        organisation: "AMRC",
        contact: { name: "Data Owner", email: "owner@example.ac.uk" },
    },
    terms: { licence: "CC-BY-4.0" },
    permitted_use: "Non-commercial research into machining stability.",
};

const META = {
    uuid: DATASET,
    name: "Cutting trial 7",
    from: "2026-10-14T08:00:00.000Z",
    to: "2026-10-14T12:00:00.000Z",
    function: [],
    parts: [],
    metadata: {
        [App.ReleasePolicy]: POLICY,
        [App.Tags]: { tags: ["cutting"] },
        [App.RunMetadata]: {
            createdBy: "jbloggs", operator: "Sam Smith",
            note: "Sam's private note", description: "Seven passes",
            reference: "T7",
        },
    },
};

const CSV = [
    "device,metric,timestamp,value,unit,device_uuid,path,type",
    `Lathe,Actual,2026-10-14T09:00:00.5Z,12.5,mm,${DEVICE},Axes/X/Position,double`,
    `Lathe,Actual,2026-10-14T09:00:01Z,12.75,mm,${DEVICE},Axes/X/Position,double`,
    "",
].join("\n");

const INFO = {
    originMap: {
        Schema_UUID: "d6de8765-bfbe-4f6b-b5d8-822dbd7f3a49",
        Axes: { X: { Position: { Actual: {
            Sparkplug_Type: "Double", Record_To_Historian: true, Eng_Unit: "mm",
        } } } },
    },
};

function fake_fplus ({ meta = META, data_status = 200 } = {}) {
    return {
        debug: { bound: () => () => {} },
        DataAccess: {
            get_single_metadata: async uuid => uuid == DATASET ? meta : {},
            fetch: async opts => {
                assert.equal(opts.url, `v1/data/${DATASET}`);
                return [data_status, Readable.from([CSV])];
            },
        },
        ConfigDB: {
            get_config: async (app, obj) => {
                assert.equal(obj, DEVICE);
                if (app == UUIDs.App.DeviceInformation) return INFO;
                if (app == UUIDs.App.Info) return { name: "Lathe 3" };
            },
        },
    };
}

async function with_work_dir (fn) {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "builder-test-"));
    try { return await fn(dir); }
    finally { await fsp.rm(dir, { recursive: true, force: true }); }
}

function builder (work_dir, opts) {
    return new Builder({
        fplus: fake_fplus(opts), work_dir,
        exporter: "test",
        source: { organisation: "AMRC", url: "https://factoryplus.example.ac.uk" },
    });
}

/* Read every entry of a zip into a Map from name to Buffer. */
function read_zip (file) {
    return new Promise((resolve, reject) => {
        yauzl.open(file, { lazyEntries: true }, (err, zip) => {
            if (err) return reject(err);
            const entries = new Map();
            zip.on("error", reject);
            zip.on("end", () => resolve(entries));
            zip.on("entry", entry => {
                zip.openReadStream(entry, async (err, stream) => {
                    if (err) return reject(err);
                    const chunks = [];
                    for await (const c of stream) chunks.push(c);
                    entries.set(entry.fileName, Buffer.concat(chunks));
                    zip.readEntry();
                });
            });
            zip.readEntry();
        });
    });
}

const sha256 = buf => crypto.createHash("sha256").update(buf).digest("hex");

test("builds a bag with the RO-Crate inside data/", () => with_work_dir(async dir => {
    const b = await builder(dir).build(DATASET, { briefcase: BRIEFCASE });
    const top = `briefcase-${b.briefcase}`;
    const zip = await read_zip(b.file);

    assert.deepEqual([...zip.keys()].sort(), [
        "bag-info.txt",
        "bagit.txt",
        `data/metadata/dataset.json`,
        `data/metadata/devices/${DEVICE}.json`,
        "data/policy.json",
        "data/ro-crate-metadata.json",
        `data/telemetry/csv/${DEVICE}.csv`,
        `data/telemetry/parquet/${DEVICE}.parquet`,
        "manifest-sha256.txt",
        "tagmanifest-sha256.txt",
    ].map(n => `${top}/${n}`).sort());

    /* The zip on disk is the one reported, and nothing else is left. */
    const file = await fsp.readFile(b.file);
    assert.equal(b.sha256, sha256(file));
    assert.equal(b.size, file.length);
    assert.deepEqual(await fsp.readdir(dir), [path.basename(b.file)]);
}));

test("the manifest covers every payload file", () => with_work_dir(async dir => {
    const b = await builder(dir).build(DATASET, { briefcase: BRIEFCASE });
    const top = `briefcase-${b.briefcase}/`;
    const zip = await read_zip(b.file);
    const get = n => zip.get(top + n);

    const payload = [...zip.keys()]
        .filter(n => n.startsWith(`${top}data/`))
        .map(n => n.slice(top.length));
    const manifest = get("manifest-sha256.txt").toString().trim().split("\n")
        .map(l => l.split(/\s+/));
    assert.deepEqual(manifest.map(([, n]) => n).sort(), payload.sort());
    for (const [sum, name] of manifest)
        assert.equal(sum, sha256(get(name)), name);

    const octets = payload.reduce((n, p) => n + get(p).length, 0);
    assert.match(get("bag-info.txt").toString(),
        new RegExp(`^Payload-Oxum: ${octets}\\.${payload.length}$`, "m"));

    for (const [sum, name] of get("tagmanifest-sha256.txt").toString()
            .trim().split("\n").map(l => l.split(/\s+/)))
        assert.equal(sum, sha256(get(name)), name);
}));

test("copies only the listed dataset fields", () => with_work_dir(async dir => {
    const b = await builder(dir).build(DATASET, { briefcase: BRIEFCASE });
    const zip = await read_zip(b.file);
    const dataset = zip.get(`briefcase-${b.briefcase}/data/metadata/dataset.json`);

    assert.deepEqual(JSON.parse(dataset), {
        name: "Cutting trial 7",
        description: "Seven passes",
        reference: "T7",
        from: META.from,
        to: META.to,
        tags: ["cutting"],
    });
    for (const content of zip.values())
        assert.doesNotMatch(content.toString(), /jbloggs|Sam Smith|private note/);
}));

test("describes the briefcase as an RO-Crate", () => with_work_dir(async dir => {
    const b = await builder(dir).build(DATASET, { briefcase: BRIEFCASE });
    const zip = await read_zip(b.file);
    const crate = JSON.parse(zip.get(
        `briefcase-${b.briefcase}/data/ro-crate-metadata.json`));
    const by_id = new Map(crate["@graph"].map(e => [e["@id"], e]));

    assert.equal(crate["@context"][0], `${RO_CRATE}/context`);
    assert.deepEqual(by_id.get("ro-crate-metadata.json").conformsTo, { "@id": RO_CRATE });

    const root = by_id.get("./");
    assert.equal(root.name, "Cutting trial 7");
    assert.equal(by_id.get(root.identifier["@id"]).value, b.briefcase);
    assert.equal(root.datePublished, b.built);
    assert.deepEqual(root.license, { "@id": "https://spdx.org/licenses/CC-BY-4.0" });
    assert.equal(root.temporalCoverage, `${META.from}/${META.to}`);

    /* Every file is listed, and the telemetry says what it covers. */
    for (const part of root.hasPart)
        assert.ok(zip.has(`briefcase-${b.briefcase}/data/${part["@id"]}`), part["@id"]);
    const telemetry = by_id.get(`telemetry/csv/${DEVICE}.csv`);
    assert.deepEqual(telemetry.about, { "@id": `#device-${DEVICE}` });
    assert.equal(telemetry.temporalCoverage,
        "2026-10-14T09:00:00.500000000Z/2026-10-14T09:00:01.000000000Z");
    assert.equal(by_id.get(`#device-${DEVICE}`).name, "Lathe 3");
}));

test("refuses a dataset with no release policy", () => with_work_dir(async dir => {
    const meta = { ...META, metadata: { ...META.metadata, [App.ReleasePolicy]: undefined } };
    await assert.rejects(builder(dir, { meta }).build(DATASET, { briefcase: BRIEFCASE }), /no release policy/);
    assert.deepEqual(await fsp.readdir(dir), []);
}));

test("refuses a dataset with no time range", () => with_work_dir(async dir => {
    const meta = { ...META, to: undefined };
    await assert.rejects(builder(dir, { meta }).build(DATASET, { briefcase: BRIEFCASE }), /no start and end time/);
}));

test("cleans up when the data can't be read", () => with_work_dir(async dir => {
    await assert.rejects(builder(dir, { data_status: 403 }).build(DATASET, { briefcase: BRIEFCASE }), /returned 403/);
    assert.deepEqual(await fsp.readdir(dir), []);
}));

test("names the briefcase it replaces", () => with_work_dir(async dir => {
    const b = await builder(dir).build(DATASET, { briefcase: BRIEFCASE, replaces: OLD });
    const zip = await read_zip(b.file);
    const crate = JSON.parse(zip.get(`briefcase-${BRIEFCASE}/data/ro-crate-metadata.json`));
    const by_id = new Map(crate["@graph"].map(e => [e["@id"], e]));

    assert.deepEqual(crate["@context"][1], { replaces: "http://purl.org/dc/terms/replaces" });
    assert.deepEqual(by_id.get("./").replaces, { "@id": `urn:uuid:${OLD}` });
    assert.equal(by_id.get(`urn:uuid:${OLD}`)["@type"], "CreativeWork");
}));

test("a first briefcase replaces nothing", () => with_work_dir(async dir => {
    const b = await builder(dir).build(DATASET, { briefcase: BRIEFCASE });
    const zip = await read_zip(b.file);
    const crate = JSON.parse(zip.get(`briefcase-${BRIEFCASE}/data/ro-crate-metadata.json`));
    assert.equal(crate["@graph"].find(e => e["@id"] == "./").replaces, undefined);
}));

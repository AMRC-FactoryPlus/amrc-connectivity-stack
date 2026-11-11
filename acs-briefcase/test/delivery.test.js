/*
 * ACS Briefcase exporter
 * Tests for delivering briefcases to the ingest container
 * Copyright 2026 University of Sheffield
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import yazl from "yazl";

import {
    Delivery, blob_names, open_container, release_notice, withdraw_notice,
} from "../lib/delivery.js";

const DATASET = "11111111-1111-4111-8111-111111111111";
const ZIP = Buffer.from("not really a zip");
const SOURCE = { organisation: "AMRC", url: "https://factoryplus.example" };

const X = {
    uuid:       "0b5e3a52-7f41-4c2e-a8d6-6a9f3e2d1c40",
    file:       "f0000000-0000-4000-8000-000000000000",
    sha256:     crypto.createHash("sha256").update(ZIP).digest("hex"),
    size:       ZIP.length,
    built:      "2026-11-11T10:15:00.000Z",
    exporter:   "v1",
};
const NAMES = blob_names(X.uuid);

/* A Delivery over a container that records what is written to it. The
 * zip's content is read while the file still exists. */
async function make_delivery (opts = {}) {
    const work_dir = await fsp.mkdtemp(path.join(os.tmpdir(), "delivery-"));
    const blobs = [];
    const container = {
        getBlockBlobClient: name => ({
            uploadFile: async (file, options) => {
                if (opts.fail === name) throw new Error("upload refused");
                blobs.push({ name, options, body: await fsp.readFile(file) });
            },
            upload: async (body, length, options) => {
                if (opts.fail === name) throw new Error("upload refused");
                assert.equal(length, Buffer.byteLength(body));
                blobs.push({ name, options, body });
            },
        }),
    };
    const fplus = {
        debug: { bound: () => () => {} },
        Files: {
            get_file_stream: async uuid => {
                assert.equal(uuid, X.file);
                return opts.missing ? undefined : Readable.from([opts.zip ?? ZIP]);
            },
        },
    };
    const delivery = new Delivery({ fplus, container, work_dir, source: SOURCE });
    return { delivery, blobs, work_dir };
}

test("blobs are named by the briefcase's UUID", () => {
    assert.deepEqual(NAMES, {
        zip:        `briefcases/${X.uuid}.zip`,
        release:    `notices/${X.uuid}.release.json`,
        withdraw:   `notices/${X.uuid}.withdraw.json`,
    });
});

test("a release notice carries the record, the dataset and the source", () => {
    assert.deepEqual(release_notice(DATASET, X, SOURCE), {
        notice:     "release",
        version:    1,
        briefcase:  X.uuid,
        dataset:    DATASET,
        sha256:     X.sha256,
        size:       X.size,
        built:      X.built,
        exporter:   X.exporter,
        source:     SOURCE,
    });
});

test("a release notice names the briefcase it replaces, and not the file", () => {
    const old = "1c6f4b63-8052-4d3f-b9e7-7ba0f4e3e2d1";
    const notice = release_notice(DATASET, { ...X, replaces: old }, SOURCE);
    assert.equal(notice.replaces, old);
    assert.equal("file" in notice, false);
});

test("a withdrawal notice carries the time and no reason", () => {
    const withdrawn = "2026-11-12T09:00:00.000Z";
    assert.deepEqual(withdraw_notice(DATASET, { ...X, withdrawn }, SOURCE), {
        notice:     "withdraw",
        version:    1,
        briefcase:  X.uuid,
        dataset:    DATASET,
        withdrawn,
        source:     SOURCE,
    });
});

test("delivers the zip, then the release notice", async () => {
    const { delivery, blobs, work_dir } = await make_delivery();
    await delivery.release(DATASET, X);

    assert.deepEqual(blobs.map(b => b.name), [NAMES.zip, NAMES.release]);
    assert.deepEqual(blobs[0].body, ZIP);
    assert.equal(blobs[0].options.blobHTTPHeaders.blobContentType,
        "application/zip");
    assert.deepEqual(JSON.parse(blobs[1].body),
        release_notice(DATASET, X, SOURCE));
    assert.equal(blobs[1].options.blobHTTPHeaders.blobContentType,
        "application/json");
    assert.deepEqual(await fsp.readdir(work_dir), []);
});

test("sends no notice if the zip is refused", async () => {
    const { delivery, blobs, work_dir } = await make_delivery({ fail: NAMES.zip });
    await assert.rejects(delivery.release(DATASET, X), /upload refused/);
    assert.deepEqual(blobs, []);
    assert.deepEqual(await fsp.readdir(work_dir), []);
});

test("sends nothing if the stored zip is not the one recorded", async () => {
    const { delivery, blobs, work_dir } = await make_delivery({
        zip: Buffer.from("not really a zap") });
    await assert.rejects(delivery.release(DATASET, X), /has checksum/);
    assert.deepEqual(blobs, []);
    assert.deepEqual(await fsp.readdir(work_dir), []);
});

test("sends nothing if the stored zip is the wrong size", async () => {
    const { delivery, blobs } = await make_delivery({ zip: Buffer.from("short") });
    await assert.rejects(delivery.release(DATASET, X), /is 5 bytes, not 16/);
    assert.deepEqual(blobs, []);
});

test("sends nothing if the zip is missing from the Files service", async () => {
    const { delivery, blobs } = await make_delivery({ missing: true });
    await assert.rejects(delivery.release(DATASET, X),
        /is not in the Files service/);
    assert.deepEqual(blobs, []);
});

test("a withdrawal sends only its notice", async () => {
    const { delivery, blobs } = await make_delivery();
    const withdrawn = "2026-11-12T09:00:00.000Z";
    await delivery.withdraw(DATASET, { ...X, withdrawn });

    assert.deepEqual(blobs.map(b => b.name), [NAMES.withdraw]);
    assert.deepEqual(JSON.parse(blobs[0].body),
        withdraw_notice(DATASET, { ...X, withdrawn }, SOURCE));
});

/* A zip holding the given files, as a Buffer. */
async function make_zip (files) {
    const zip = new yazl.ZipFile();
    for (const [name, content] of Object.entries(files))
        zip.addBuffer(Buffer.from(content), name);
    zip.end();
    const chunks = [];
    for await (const c of zip.outputStream) chunks.push(c);
    return Buffer.concat(chunks);
}

/* A briefcase record for a zip. */
const record_of = zip => ({ ...X, size: zip.length,
    sha256: crypto.createHash("sha256").update(zip).digest("hex") });

test("reads a briefcase's tier from the policy in its zip", async () => {
    const zip = await make_zip({
        "briefcase-x/bagit.txt":                    "BagIt-Version: 1.0\n",
        "briefcase-x/data/metadata/policy.json":    '{"tier":"open"}',
        "briefcase-x/data/policy.json":             '{"tier":"enclave-only"}',
        "briefcase-x/data/telemetry/csv/a.csv":     "timestamp\n",
    });
    const { delivery, blobs, work_dir } = await make_delivery({ zip });
    assert.equal(await delivery.tier(record_of(zip)), "enclave-only");
    assert.deepEqual(blobs, []);
    assert.deepEqual(await fsp.readdir(work_dir), []);
});

test("refuses a zip with no tier in its policy", async () => {
    const zip = await make_zip({ "briefcase-x/bagit.txt": "BagIt-Version: 1.0\n" });
    const { delivery, work_dir } = await make_delivery({ zip });
    await assert.rejects(delivery.tier(record_of(zip)), /has no tier/);
    assert.deepEqual(await fsp.readdir(work_dir), []);
});

test("a container URL with a SAS token needs nothing else", async () => {
    const container = await open_container({
        url: "https://acct.blob.core.windows.net/ingest?sv=2025-01-05&sig=abc" });
    assert.equal(container.containerName, "ingest");
});

test("a container URL with no SAS token needs a service principal", async () => {
    const url = "https://acct.blob.core.windows.net/ingest";
    await assert.rejects(open_container({ url }), /SAS token/);

    const container = await open_container({
        url, tenant: "22222222-2222-4222-8222-222222222222",
        client: "33333333-3333-4333-8333-333333333333", secret: "s" });
    assert.equal(container.containerName, "ingest");
});

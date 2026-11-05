/*
 * Factory+ NodeJS Utilities
 * Tests for the dependency-free v5 UUIDs
 * Copyright 2026 University of Sheffield AMRC
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { metric_instance_uuid, sha1, uuid_v5 } from "../lib/uuid-v5.js";
import { Special } from "../lib/uuids.js";

/* A reference v5 implementation using Node's own SHA-1. */
function reference_v5 (name, namespace) {
    const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
    const h = crypto.createHash("sha1")
        .update(Buffer.concat([ns, Buffer.from(name, "utf8")]))
        .digest();
    h[6] = (h[6] & 0x0f) | 0x50;
    h[8] = (h[8] & 0x3f) | 0x80;
    const x = h.subarray(0, 16).toString("hex");
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

test("sha1 matches node:crypto for many lengths", () => {
    for (let n = 0; n < 200; n++) {
        const buf = crypto.randomBytes(n);
        const want = crypto.createHash("sha1").update(buf).digest("hex");
        assert.equal(Buffer.from(sha1(buf)).toString("hex"), want, `length ${n}`);
    }
});

test("uuid_v5 matches the RFC 4122 DNS example", () => {
    /* The well-known v5 UUID of "www.example.com" in the DNS namespace. */
    assert.equal(
        uuid_v5("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8"),
        "2ed6657d-e927-568b-95e1-2665a8aea6a2");
});

test("uuid_v5 matches a reference implementation, including non-ASCII", () => {
    for (const name of ["", "a", "Device_Information/ISA95_Hierarchy", "Straße ☃"]) {
        assert.equal(uuid_v5(name, Special.FactoryPlus),
            reference_v5(name, Special.FactoryPlus));
    }
});

test("metric_instance_uuid is the acs-edge scheme", () => {
    const device = "0b6d8c55-2f5e-4c43-9c39-5c2b3a1e7f10";
    const path = "Device_Information/ISA95_Hierarchy";
    assert.equal(metric_instance_uuid(device, path),
        reference_v5(`${Special.V5Metric}:${device}:${path}`, Special.FactoryPlus));
    assert.equal(metric_instance_uuid(device, path), metric_instance_uuid(device, path));
    assert.notEqual(metric_instance_uuid(device, path),
        metric_instance_uuid(device, "Device_Information"));
});

test("uuid_v5 refuses a namespace that is not a UUID", () => {
    assert.throws(() => uuid_v5("x", "not-a-uuid"), RangeError);
});

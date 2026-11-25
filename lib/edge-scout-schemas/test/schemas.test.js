/*
 * ACS Edge Scout schemas
 * Checks every shared fixture against its schema
 * Copyright 2026 University of Sheffield
 *
 * Run with `node --test test/`.
 */

import test     from "node:test";
import assert   from "node:assert/strict";

import Ajv2020      from "ajv/dist/2020.js";
import add_formats  from "ajv-formats";

import {
    SchemaNames, add_schemas, check_snapshot, load_fixtures, load_schemas,
} from "../lib/index.js";
import { merge_scan } from "./reference-merge.js";

function make_ajv () {
    const ajv = new Ajv2020({ strictTypes: true, strictTuples: true, allErrors: true });
    add_formats(ajv);
    return ajv;
}

const validator = add_schemas(make_ajv());
const schemas = load_schemas();
const valid = load_fixtures("valid");
const invalid = load_fixtures("invalid");
const merges = load_fixtures("merge");

function errors (validate) {
    return JSON.stringify(validate.errors, null, 2);
}

test("every schema compiles in strict mode", () => {
    for (const name of SchemaNames)
        assert.ok(validator(name), `${name} did not compile`);
});

test("every schema's $id matches its file name", () => {
    for (const [name, schema] of schemas)
        assert.equal(schema.$id, `urn:edge-scout:${name}`);
});

test("the status schema compiles alone, as ConfigDB loads it", () => {
    /* acs-configdb/lib/model.js builds its ajv like this, and loads a
     * ConfigSchema with no other schemas beside it. */
    const ajv = new Ajv2020({ addUsedSchema: false });
    add_formats(ajv);
    const validate = ajv.compile(schemas.get("status"));
    for (const fx of valid.filter(f => f.schema == "status"))
        assert.ok(validate(fx.data), `${fx.file}: ${errors(validate)}`);
});

test("the values schema compiles alone, as ConfigDB loads it", () => {
    const ajv = new Ajv2020({ addUsedSchema: false });
    add_formats(ajv);
    const validate = ajv.compile(schemas.get("values"));
    for (const fx of valid.filter(f => f.schema == "values"))
        assert.ok(validate(fx.data), `${fx.file}: ${errors(validate)}`);
});

test("the values schema's types match the shared definitions", () => {
    const common = schemas.get("common").$defs;
    const entry = schemas.get("values").properties.values.additionalProperties;
    assert.deepEqual(entry.properties.type.enum.filter(t => t), common.sparkplug_type.enum);
});

test("every value in a values answer is checked against read_value", () => {
    const fx = valid.find(f => f.file == "found-values.json");
    const ajv = make_ajv();
    add_schemas(ajv);
    const check = ajv.getSchema("urn:edge-scout:common#/$defs/read_value");
    for (const v of fx.data.values)
        assert.ok(check(v), errors(check));
    const [first] = fx.data.values;
    assert.equal(check({ ...first, value: "x".repeat(1025) }), false);
    assert.equal(check({ ...first, error: "x".repeat(257) }), false);
    assert.equal(check({ ...first, type: "Int16BE" }), false);
    assert.equal(check({ ...first, address: "" }), false);
});

test("the status schema's codes match the shared definitions", () => {
    const common = schemas.get("common").$defs;
    const status = schemas.get("status").properties;
    const all = [...common.library_code.enum, ...common.agent_code.enum];

    assert.deepEqual(new Set(status.code.enum.filter(c => c)), new Set(all));
    assert.deepEqual(
        status.last_request.oneOf[1].properties.code.enum.filter(c => c),
        common.refusal_code.enum);
    assert.deepEqual(
        schemas.get("status").$defs.snapshot_ref.oneOf[1].properties.reason.enum.filter(c => c),
        common.truncation_reason.enum);
});

test("every fixture names a known schema", () => {
    for (const fx of [...valid, ...invalid]) {
        assert.ok(SchemaNames.includes(fx.schema), `${fx.file} names ${fx.schema}`);
        assert.equal(typeof fx.description, "string", `${fx.file} has no description`);
        assert.ok("data" in fx != "lines" in fx, `${fx.file} needs data or lines`);
    }
});

test("every message schema has valid and invalid fixtures", () => {
    for (const name of SchemaNames) {
        if (["common", "merge-fixture"].includes(name)) continue;
        assert.ok(valid.some(f => f.schema == name), `no valid fixture for ${name}`);
        assert.ok(invalid.some(f => f.schema == name), `no invalid fixture for ${name}`);
    }
});

for (const fx of valid) {
    test(`valid: ${fx.file}`, () => {
        const validate = validator(fx.schema);
        if (fx.lines) {
            for (const [ix, line] of fx.lines.entries())
                assert.ok(validate(line), `line ${ix + 1}: ${errors(validate)}`);
            assert.deepEqual(check_snapshot(fx.lines, validator), []);
            return;
        }
        assert.ok(validate(fx.data), errors(validate));

        /* An items message's entries are checked on their own */
        if (fx.schema == "found" && fx.data.type == "items") {
            const item = validator("item");
            for (const it of fx.data.items)
                assert.ok(item(it), errors(item));
        }
    });
}

for (const fx of invalid) {
    test(`invalid: ${fx.file}`, () => {
        if (fx.lines) {
            assert.notDeepEqual(check_snapshot(fx.lines, validator), []);
            return;
        }
        const validate = validator(fx.schema);
        assert.equal(validate(fx.data), false, "the fixture was accepted");
    });
}

function by_id (items) {
    return new Map(items.map(i => [i.id, i]));
}

for (const fx of merges) {
    test(`merge: ${fx.file}`, () => {
        const { file, ...body } = fx;
        const validate = validator("merge-fixture");
        assert.ok(validate(body), `${file}: ${errors(validate)}`);

        /* Item ids are unique in every snapshot the fixture gives */
        for (const snap of [fx.base, fx.scan, fx.expected].filter(s => s.items))
            assert.equal(by_id(snap.items).size, snap.items.length);

        const got = merge_scan(fx.base, fx.scan);
        if (fx.expected.error) {
            assert.deepEqual(got, fx.expected);
            return;
        }

        const { items, ...flags } = got;
        const { items: want_items, ...want_flags } = fx.expected;
        assert.deepEqual(flags, want_flags);
        assert.deepEqual(by_id(items), by_id(want_items));
    });
}

test("the reference merge keeps only the last 10 branches", () => {
    const branches = Array.from({ length: 10 },
        (_, i) => ({ folder_id: `f${i}`, finished: "2026-11-24T10:00:00Z" }));
    const base = {
        root: null, options_hash: "h", exhaustive: true, truncated: false,
        reason: null, excluded: [], branches,
        items: [{ id: "f", parent: null, name: "f", kind: "folder" }],
    };
    const scan = {
        root: "f", folder_id: "f", finished: "2026-11-24T11:00:00Z",
        options_hash: "h", exhaustive: true, truncated: false, reason: null,
        excluded: [], items: [{ id: "f", parent: null, name: "f", kind: "folder" }],
    };
    const got = merge_scan(base, scan);
    assert.equal(got.branches.length, 10);
    assert.equal(got.branches[0].folder_id, "f1");
    assert.equal(got.branches.at(-1).folder_id, "f");
});

test("check_snapshot finds each structural fault", () => {
    const fx = valid.find(f => f.file == "snapshot-whole.json");
    const [header, ...rest] = fx.lines;
    assert.match(check_snapshot([header], validator)[0], /header line and an end line/);
    assert.ok(check_snapshot([...rest, header], validator)
        .includes("The first line is not a valid header"));
});

test("a values entry the agent writes under 64 KiB holds 40 long values", () => {
    /* The schema allows more than ConfigDB's 100kb limit at its
     * extremes, so the agent drops the largest values first to stay
     * under 64 KiB. This is the case it is sized for: 40 addresses of
     * 512 characters, each with a 1024 character value. */
    const time = "2026-11-25T10:42:15.123Z";
    const values = {};
    for (let i = 0; i < 40; i++)
        values[`${i}`.padStart(512, "a")] = {
            value: "v".repeat(1024), type: "String", ts: 1795600000000,
            read: time, error: null,
        };
    const entry = {
        version: 1, node: "5d0c7f3e-8a21-4c55-9a7e-0f6b1d2c3e4a", updated: time,
        interval_ms: 5000, leases: 4, dropped: 0, values,
    };
    const validate = validator("values");
    assert.ok(validate(entry), errors(validate));
    const size = Buffer.byteLength(JSON.stringify(entry));
    assert.ok(size < 64 * 1024, `${size} bytes`);
});

test("the largest status entry the schema allows fits ConfigDB's 100kb limit", () => {
    const s = n => "x".repeat(n);
    const uuid = "5d0c7f3e-8a21-4c55-9a7e-0f6b1d2c3e4a";
    const time = "2026-11-24T10:42:15.123456789+00:00";
    const hash = "sha256:" + "a".repeat(64);
    const ref = {
        file: uuid, items: Number.MAX_SAFE_INTEGER, bytes_gz: Number.MAX_SAFE_INTEGER,
        exhaustive: false, truncated: true, reason: "partial_access",
        finished: time, root: s(1024), options_hash: hash, config_hash: hash,
        excluded: Array.from({ length: 8 },
            () => ({ id: s(256), reason: s(32), prefixes: Array(4).fill(s(256)) })),
        branches: Array.from({ length: 10 }, () => ({ folder_id: s(1024), finished: time })),
    };
    const entry = {
        version: 1, node: uuid, supported: "library", scan: uuid, request: uuid,
        state: "cancelled", code: "INTERRUPTED", message: s(512),
        started: time, updated: time, finished: time,
        root: s(1024), folder_id: s(1024), options_hash: hash, config_hash: hash,
        progress: { visited: Number.MAX_SAFE_INTEGER, found: Number.MAX_SAFE_INTEGER, note: s(512) },
        last_request: { request: uuid, code: "NOTRUNNING", message: s(512), at: time },
        current: ref, previous: ref,
    };
    const validate = validator("status");
    assert.ok(validate(entry), errors(validate));
    const size = Buffer.byteLength(JSON.stringify(entry));
    assert.ok(size < 100 * 1024, `${size} bytes`);
    console.log(`Largest ASCII status entry: ${size} bytes`);
});

/*
 * ACS Edge Scout schemas
 * Loads the Edge Scout JSON Schemas and shared fixtures
 * Copyright 2026 University of Sheffield
 */

import fs   from "node:fs";
import path from "node:path";
import url  from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));

export const SCHEMA_DIR = path.resolve(here, "../schemas");
export const FIXTURE_DIR = path.resolve(here, "../fixtures");

/* The short name of each schema, which is also its file name without
 * `.schema.json` and the last part of its `$id`. */
export const SchemaNames = [
    "common",
    "addr",
    "ncmd",
    "request",
    "found",
    "item",
    "status",
    "snapshot-header",
    "snapshot-end",
    "snapshot-line",
    "merge-fixture",
];

export function schema_id (name) {
    return `urn:edge-scout:${name}`;
}

function read_json (file) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

/* Returns a map from schema name to the parsed schema. */
export function load_schemas () {
    return new Map(SchemaNames.map(name =>
        [name, read_json(path.join(SCHEMA_DIR, `${name}.schema.json`))]));
}

/* Adds every schema to an ajv instance. The schemas are draft
 * 2020-12, so the instance must come from `ajv/dist/2020.js`, with
 * ajv-formats added for `date-time`. Returns a function that gives
 * the compiled validator for a schema name. */
export function add_schemas (ajv) {
    for (const schema of load_schemas().values())
        ajv.addSchema(schema);
    return name => ajv.getSchema(schema_id(name));
}

/* Returns the fixtures of one kind: "valid", "invalid" or "merge".
 * Each is the parsed file with `file` added. A valid or invalid
 * fixture has `schema` (a schema name), `description`, and either
 * `data` (one value) or `lines` (a whole snapshot as an array of
 * NDJSON lines). */
export function load_fixtures (kind) {
    const dir = path.join(FIXTURE_DIR, kind);
    return fs.readdirSync(dir)
        .filter(f => f.endsWith(".json"))
        .sort()
        .map(f => ({ file: f, ...read_json(path.join(dir, f)) }));
}

/* Checks a whole snapshot, given as an array of parsed NDJSON lines.
 * `validator` is the function `add_schemas` returns. Returns a list of
 * problems, empty when the snapshot is valid. */
export function check_snapshot (lines, validator) {
    const header = validator("snapshot-header");
    const item = validator("item");
    const end = validator("snapshot-end");
    const problems = [];

    if (lines.length < 2)
        return ["A snapshot needs a header line and an end line"];

    if (!header(lines[0]))
        problems.push("The first line is not a valid header");
    if (!end(lines.at(-1)))
        problems.push("The last line is not a valid end line");

    const items = lines.slice(1, -1);
    const ids = new Set();
    items.forEach((line, ix) => {
        if (!item(line))
            problems.push(`Line ${ix + 2} is not a valid item`);
        else if (ids.has(line.id))
            problems.push(`Line ${ix + 2} repeats the id ${line.id}`);
        else
            ids.add(line.id);
    });

    const count = lines.at(-1)?.end?.items;
    if (Number.isInteger(count) && count != items.length)
        problems.push(`The end line counts ${count} items but there are ${items.length}`);

    return problems;
}

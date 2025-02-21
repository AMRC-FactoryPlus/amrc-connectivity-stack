#!/usr/bin/env node

/* This script converts service dump files from YAML to JSON. The
 * services only accept JSON format dumps, but JSON is an awkward format
 * for humans to edit for a variety of reasons.
 *
 * Running the script (`npm run convert-dumps`) will convert all `.yaml`
 * files in `dumps` to JSON and write them out, overwriting any existing
 * `.json` files present.
 *
 * In addition to converting from YAML to JSON, this script will expand
 * the YAML custom data type tag `!u` to a UUID pulled from the object
 * UUID_SOURCES defined below.
 */

import fs from "fs/promises";
import path from "path";

import yaml from "yaml";

import { UUIDs } from "@amrc-factoryplus/service-client";
import { Git } from "../lib/uuids.js";

const UUID_SOURCES = { FP: UUIDs, G: Git };
const DUMPS = "dumps";

function resolve (str) {
    const cpts = str.split(".");
    let it = UUID_SOURCES;
    for (const c of cpts) {
        if (!(c in it))
            throw `Undefined UUID ref ${str}`;
        it = it[c];
    }
    return it;
}

const uuidTag = {
    tag:        "!u",
    resolve:    str => resolve(str),
};

const files = (await fs.readdir(DUMPS))
    .filter(f => f.endsWith(".yaml"))
    .map(f => f.slice(0, -5));

for (const f of files) {
    console.log(`Converting ${f}`);
    const yml = await fs.readFile(
        path.join(DUMPS, `${f}.yaml`),
        { encoding: "utf-8" });
    const data = yaml.parse(yml, null, { customTags: [uuidTag] });
    await fs.writeFile(
        path.join(DUMPS, `${f}.json`),
        JSON.stringify(data, null, 2));
}
console.log("Done");
